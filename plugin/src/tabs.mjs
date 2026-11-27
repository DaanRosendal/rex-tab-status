import { cleanTitle, decideLabel, isEcho } from './label.mjs'
import { blocksOf, parse, parseWindows } from './rex-cli.mjs'
import {
  DEFAULT_APPS,
  SLEEP_MS,
  isLive,
  liveOwners,
  pickTitleSource,
  reduceBlock,
  reduceWindow,
} from './status.mjs'
import { resolveTheme } from './themes.mjs'

const TERMINAL = 'com.superlogical.terminal'
const MAX_TIMER_MS = 2 ** 31 - 1
// Any report can start an agent. The others only matter for panes already known to run one.
const ALWAYS_REFRESH = ['program_status_changed', 'program_status_removed']
const KNOWN_PANE_EVENTS = ['process_changed', 'child_exited']

export class Tabs {
  owned = new Map()
  titles = new Map()
  timers = new Map()
  agentBlocks = new Set()
  painting = Promise.resolve()
  stopping = false

  constructor({
    run,
    icons = resolveTheme(undefined),
    apps = DEFAULT_APPS,
    sleepMs = SLEEP_MS,
    watch,
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  }) {
    this.run = run
    this.icons = icons
    this.apps = apps
    this.sleepMs = sleepMs
    this.watch = watch
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
    // Without both reads a finished agent could look gone or a gone agent finished.
    if (statusText === undefined || processText === undefined) return undefined
    const proc = parse(processText)
    const reduced = reduceBlock(parse(statusText)?.records ?? [], {
      proc,
      apps: this.apps,
      watch: this.watch,
    })
    const terminalTitle = parse(titleText)
    const text = typeof terminalTitle?.title === 'string' ? terminalTitle.title : ''
    const title = isLive(terminalTitle?.owner, liveOwners(proc)) ? cleanTitle(text) : ''
    const key = `${session}/${blockId}`
    this.titles.set(key, cleanTitle(text))
    if (reduced.hasAgent) this.agentBlocks.add(key)
    else this.agentBlocks.delete(key)
    return { id: blockId, title, ...reduced }
  }

  async paint(session, win) {
    const key = `${session}/${win.window_id}`
    const terminals = blocksOf(win).filter(b => !b.creator_name || b.creator_name === TERMINAL)
    const reports = await Promise.all(terminals.map(b => this.inspect(session, b.block_id)))
    if (reports.includes(undefined)) return

    // The reads above take a while, so the label is read again to not overwrite a rename made meanwhile.
    const fresh = parseWindows(await this.run(['window', 'ls', '-s', session, '--json']))?.find(
      w => w.window_id === win.window_id,
    )
    if (!fresh) return

    const now = this.now()
    const view = reduceWindow(reports, now, this.sleepMs)
    const source = pickTitleSource(reports, fresh.focused_block_id)
    const result = decideLabel({
      actual: fresh.label,
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

  schedule(key, session, window, view, now) {
    this.cancel(key)
    if (view.sleeping || view.wakeAt === undefined) return
    const delay = Math.min(Math.max(0, view.wakeAt - now), MAX_TIMER_MS)
    const timer = this.setTimer(() => {
      this.timers.delete(key)
      this.refresh(session, { window })
    }, delay)
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
      for (const map of [this.titles, this.agentBlocks])
        for (const key of [...map.keys()]) if (key.startsWith(`${session}/`)) map.delete(key)
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
      const key = `${session}/${block}`
      if (name === 'title_changed') {
        if (typeof payload?.title !== 'string' || !this.agentBlocks.has(key)) return
        const title = cleanTitle(payload.title)
        if (this.titles.get(key) === title) return
        this.titles.set(key, title)
      } else if (KNOWN_PANE_EVENTS.includes(name)) {
        if (!this.agentBlocks.has(key)) return
      } else if (!ALWAYS_REFRESH.includes(name)) return
      await this.refresh(session, { block })
    } else if (change.type === 'window_label_changed') {
      const { window_id: window, label } = change.payload ?? {}
      if (typeof window !== 'string') return
      if (isEcho(this.owned.get(`${session}/${window}`), label)) return
      await this.refresh(session, { window })
    } else if (change.type === 'window_closed') {
      this.forget(`${session}/${change.payload?.window_id}`)
    } else if (['block_created', 'block_closed', 'session_label_changed'].includes(change.type)) {
      if (change.type === 'block_closed') {
        const key = `${session}/${change.payload?.block_id}`
        this.titles.delete(key)
        this.agentBlocks.delete(key)
      }
      await this.refresh(session)
    }
  }

  async restore() {
    this.stopping = true
    await this.painting
    const labels = new Map()
    for (const [key, own] of [...this.owned]) {
      this.cancel(key)
      const slash = key.indexOf('/')
      const session = key.slice(0, slash)
      const window = key.slice(slash + 1)
      if (!labels.has(session))
        labels.set(
          session,
          parseWindows(await this.run(['window', 'ls', '-s', session, '--json'])) ?? [],
        )
      const win = labels.get(session).find(w => w.window_id === window)
      if (!win) continue
      const { write } = decideLabel({ actual: win.label, own, hasAgent: false })
      if (write !== undefined)
        await this.run(['window', 'rename', '-s', session, '--', window, write])
    }
    this.owned.clear()
  }
}
