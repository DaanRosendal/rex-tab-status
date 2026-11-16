import { cleanTitle, decideLabel, isEcho } from './label.mjs'
import { parse } from './rex-cli.mjs'
import {
  DEFAULT_APPS,
  isLive,
  liveOwners,
  pickTitleSource,
  reduceBlock,
  reduceWindow,
} from './status.mjs'
import { resolveTheme } from './themes.mjs'

const TERMINAL = 'com.superlogical.terminal'
const REFRESH_EVENTS = [
  'program_status_changed',
  'program_status_removed',
  'process_changed',
  'child_exited',
]

export function parseWindows(text) {
  const windows = parse(text)?.windows
  return Array.isArray(windows)
    ? windows.filter(w => typeof w?.window_id === 'string' && typeof w?.label === 'string')
    : undefined
}

export function blocksOf(win) {
  return (win.layers ?? []).flatMap(layer => layer?.blocks ?? [])
}

export class Tabs {
  owned = new Map()
  titles = new Map()
  timers = new Map()
  painting = Promise.resolve()
  stopping = false

  constructor({
    run,
    icons = resolveTheme(undefined),
    apps = DEFAULT_APPS,
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  }) {
    this.run = run
    this.icons = icons
    this.apps = apps
    this.now = now
    this.setTimer = setTimer
    this.clearTimer = clearTimer
  }

  // Repaints are serialized so a label is never decided from a stale read.
  refresh(session, filter = {}) {
    if (this.stopping) return this.painting
    this.painting = this.painting.then(() => this.repaint(session, filter)).catch(() => {})
    return this.painting
  }

  async repaint(session, { block, window } = {}) {
    const windows = parseWindows(await this.run(['window', 'ls', '-s', session, '--json']))
    if (!windows) return
    for (const win of windows) {
      if (window && win.window_id !== window) continue
      if (block && !blocksOf(win).some(b => b.block_id === block)) continue
      await this.paint(session, win)
    }
    for (const key of [...this.owned.keys()]) {
      if (key.startsWith(`${session}/`) && !windows.some(w => `${session}/${w.window_id}` === key))
        this.forget(key)
    }
  }

  async inspect(session, blockId) {
    const call = method => this.run(['block', 'call', '-s', session, '-b', blockId, method])
    const [statusText, processText, titleText] = await Promise.all([
      call('program_status'),
      call('process'),
      call('title'),
    ])
    if (statusText === undefined) return undefined
    const proc = parse(processText)
    const reduced = reduceBlock(parse(statusText)?.records ?? [], { proc, apps: this.apps })
    const terminalTitle = parse(titleText)
    const text = typeof terminalTitle?.title === 'string' ? terminalTitle.title : ''
    const title = isLive(terminalTitle?.owner, liveOwners(proc)) ? cleanTitle(text) : ''
    this.titles.set(`${session}/${blockId}`, cleanTitle(text))
    return { id: blockId, title, ...reduced }
  }

  async paint(session, win) {
    const key = `${session}/${win.window_id}`
    const terminals = blocksOf(win).filter(b => !b.creator_name || b.creator_name === TERMINAL)
    const reports = await Promise.all(terminals.map(b => this.inspect(session, b.block_id)))
    if (reports.includes(undefined)) return

    const now = this.now()
    const view = reduceWindow(reports, now)
    const source = pickTitleSource(reports, win.focused_block_id)
    const result = decideLabel({
      actual: win.label,
      own: this.owned.get(key),
      hasAgent: view.hasAgent,
      icon: view.iconKey ? this.icons[view.iconKey] : '',
      title: source?.title ?? '',
    })
    if (result.write !== undefined) {
      const renamed = await this.run([
        'window',
        'rename',
        '-s',
        session,
        '--',
        win.window_id,
        result.write,
      ])
      if (renamed === undefined) return
    }
    if (!result.own) return this.forget(key)
    this.owned.set(key, result.own)
    this.schedule(key, session, win.window_id, view, now)
  }

  // A finished or failed agent shows its result until the sleep delay passes.
  schedule(key, session, window, view, now) {
    this.cancel(key)
    if (view.sleeping || view.wakeAt === undefined) return
    const timer = this.setTimer(
      () => {
        this.timers.delete(key)
        this.refresh(session, { window })
      },
      Math.max(0, view.wakeAt - now),
    )
    timer.unref?.()
    this.timers.set(key, timer)
  }

  cancel(key) {
    const timer = this.timers.get(key)
    if (timer === undefined) return
    this.clearTimer(timer)
    this.timers.delete(key)
  }

  forget(key) {
    this.cancel(key)
    this.owned.delete(key)
  }

  async handle(event) {
    if (event?.type === 'session_destroyed') {
      const session = event.payload?.session_id
      if (typeof session !== 'string') return
      for (const key of [...this.owned.keys()]) if (key.startsWith(`${session}/`)) this.forget(key)
      for (const key of [...this.titles.keys()])
        if (key.startsWith(`${session}/`)) this.titles.delete(key)
      return
    }
    if (event?.type === 'session_created') {
      const session = event.payload?.session?.session_id
      if (typeof session === 'string') await this.refresh(session)
      return
    }
    if (event?.type !== 'session_event') return
    const { session_id: session, event: change } = event.payload ?? {}
    if (typeof session !== 'string' || !change) return

    if (change.type === 'block_event') {
      const { block_id: block, creator_name: creator, name, payload } = change.payload ?? {}
      if (creator !== TERMINAL || typeof block !== 'string') return
      if (name === 'title_changed') {
        if (typeof payload?.title !== 'string') return
        const title = cleanTitle(payload.title)
        if (this.titles.get(`${session}/${block}`) === title) return
        this.titles.set(`${session}/${block}`, title)
      } else if (!REFRESH_EVENTS.includes(name)) return
      await this.refresh(session, { block })
    } else if (change.type === 'window_label_changed') {
      const { window_id: window, label } = change.payload ?? {}
      if (typeof window !== 'string') return
      if (isEcho(this.owned.get(`${session}/${window}`), label)) return
      await this.refresh(session, { window })
    } else if (change.type === 'window_closed') {
      this.forget(`${session}/${change.payload?.window_id}`)
    } else if (['block_created', 'block_closed', 'session_label_changed'].includes(change.type)) {
      if (change.type === 'block_closed')
        this.titles.delete(`${session}/${change.payload?.block_id}`)
      await this.refresh(session)
    }
  }

  async restore() {
    this.stopping = true
    await this.painting
    for (const [key, own] of [...this.owned]) {
      this.cancel(key)
      const slash = key.indexOf('/')
      const session = key.slice(0, slash)
      const window = key.slice(slash + 1)
      const windows = parseWindows(await this.run(['window', 'ls', '-s', session, '--json'])) ?? []
      const win = windows.find(w => w.window_id === window)
      if (!win) continue
      const { write } = decideLabel({ actual: win.label, own, hasAgent: false })
      if (write !== undefined)
        await this.run(['window', 'rename', '-s', session, '--', window, write])
    }
    this.owned.clear()
  }
}
