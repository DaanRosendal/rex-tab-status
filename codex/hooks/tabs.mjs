import { initialState, step, Timers } from './vendor/core.ts'
import { blocksOf, paintTab, parse, parseWindows } from './vendor/paint.ts'
import { resolveTheme } from './vendor/themes.ts'

const PRIORITY = { idle: 0, done: 1, error: 2, working: 3, blocked: 4 }
const TERMINAL = 'com.superlogical.terminal'
// Codex marks an async question in the terminal title while its status report can stay at working.
const ACTION_REQUIRED = /^\[ [!.] \] Action Required(?: \| |$)/

function startTimer(callback, ms) {
  const timer = setTimeout(callback, ms)
  timer.unref?.()
  return { cancel: () => clearTimeout(timer) }
}

const CLAUDE_NAMES = ['claude', 'claude-code']

function isClaude(foreground) {
  return CLAUDE_NAMES.includes(foreground?.name)
}

function isForeground(owner, foreground) {
  return owner.pid === foreground?.pid && owner.name === foreground?.name
}

function cleanTitle(title) {
  return title.replace(/^[\u2800-\u28ff]\s+/u, '').replace(ACTION_REQUIRED, '')
}

function titleSignature(title) {
  return title.replace(/^[\u2800-\u28ff]\s+/u, '').replace(ACTION_REQUIRED, '[action-required] ')
}

export class CodexTabs {
  owned = new Map()
  titles = new Map()
  painting = Promise.resolve()
  stopping = false

  constructor(run, icons = resolveTheme(undefined)) {
    this.run = run
    this.icons = icons
  }

  refresh(session, blockId, windowId) {
    if (this.stopping) return this.painting
    this.painting = this.painting
      .then(() => this.repaint(session, blockId, windowId))
      .catch(() => {})
    return this.painting
  }

  async repaint(session, blockId, windowId) {
    const windows = parseWindows(await this.run(['window', 'ls', '-s', session, '--json']))
    if (!windows) return
    for (const win of windows) {
      if (windowId && win.window_id !== windowId) continue
      if (blockId && !blocksOf(win).some(b => b.block_id === blockId)) continue
      await this.paint(session, win)
    }
    for (const [key, own] of this.owned) {
      if (own.session === session && !windows.some(w => w.window_id === own.window)) {
        own.timers.cancelAll()
        this.owned.delete(key)
      }
    }
  }

  async paint(session, win) {
    const key = `${session}/${win.window_id}`
    const own = this.owned.get(key)
    const blocks = blocksOf(win).filter(b => !b.creator_name || b.creator_name === TERMINAL)
    const reports = await Promise.all(
      blocks.map(async block => {
        const [statusText, processText, titleText] = await Promise.all([
          this.run(['block', 'call', '-s', session, '-b', block.block_id, 'program_status']),
          this.run(['block', 'call', '-s', session, '-b', block.block_id, 'process']),
          this.run(['block', 'call', '-s', session, '-b', block.block_id, 'title']),
        ])
        const processInfo = parse(processText)
        const foreground = processInfo?.foreground
        const records = (parse(statusText)?.records ?? []).filter(
          r =>
            (r.effective_app ?? r.app) === 'codex' &&
            Object.hasOwn(PRIORITY, r.state) &&
            (!r.owner || isForeground(r.owner, foreground)),
        )
        const terminalTitle = parse(titleText)
        const titleIsCurrent =
          !terminalTitle?.owner || isForeground(terminalTitle.owner, foreground)
        const text = typeof terminalTitle?.title === 'string' ? terminalTitle.title : ''
        this.titles.set(`${session}/${block.block_id}`, titleSignature(text))
        return {
          block: block.block_id,
          foreground,
          records,
          processKnown: processInfo !== undefined,
          needsInput: titleIsCurrent && ACTION_REQUIRED.test(text),
        }
      }),
    )

    // Claude's function hooks own the label while Claude shares this tab.
    if (reports.some(r => !r.processKnown || isClaude(r.foreground))) return

    const candidates = reports.filter(r => r.records.length > 0)
    if (candidates.length === 0) {
      own?.timers.cancelAll()
      if (own && win.label === own.label && blocks.length > 0) {
        await paintTab(this.run, {
          session,
          block: blocks[0].block_id,
          status: 'idle',
          ownName: own.name,
          isEnding: true,
          windows: [win],
          icons: this.icons,
        })
      }
      this.owned.delete(key)
      return
    }

    const block = candidates[0].block
    const status = candidates.some(c => c.needsInput)
      ? 'blocked'
      : candidates
          .flatMap(c => c.records)
          .reduce((state, r) => (PRIORITY[r.state] > PRIORITY[state] ? r.state : state), 'idle')
    const owners = candidates
      .map(c => `${c.block}/${c.foreground?.pid}/${c.foreground?.name}`)
      .join(',')
    if (own && own.owners !== owners) own.timers.cancelAll()
    const current =
      own?.owners === owners
        ? own
        : { session, window: win.window_id, owners, core: initialState, timers: new Timers() }
    const observed = step(current.core, { type: 'observed', status })
    current.core = observed.state
    current.timers.sync(observed.timers, (key, ms) =>
      startTimer(() => {
        current.timers.fired(key)
        current.core = step(current.core, { type: 'timer', key }).state
        return this.refresh(session, undefined, win.window_id)
      }, ms),
    )
    const result = await paintTab(this.run, {
      session,
      block,
      status: observed.shown,
      ownName: own?.name,
      windows: [win],
      formatTitle: cleanTitle,
      icons: this.icons,
    })
    current.name = result.ownName
    current.label = result.label
    this.owned.set(key, current)
  }

  async handle(event) {
    if (event?.type === 'session_destroyed') {
      const session = event.payload?.session_id
      if (typeof session !== 'string') return
      for (const [key, own] of this.owned)
        if (own.session === session) {
          own.timers.cancelAll()
          this.owned.delete(key)
        }
      for (const key of this.titles.keys())
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
        const title = titleSignature(payload.title)
        if (this.titles.get(`${session}/${block}`) === title) return
        this.titles.set(`${session}/${block}`, title)
      } else if (
        ![
          'program_status_changed',
          'program_status_removed',
          'process_changed',
          'child_exited',
        ].includes(name)
      )
        return
      await this.refresh(session, block)
    } else if (change.type === 'window_label_changed') {
      const { window_id: window, label } = change.payload ?? {}
      if (typeof window !== 'string' || this.owned.get(`${session}/${window}`)?.label === label)
        return
      await this.refresh(session, undefined, window)
    } else if (['block_created', 'block_closed', 'session_label_changed'].includes(change.type)) {
      if (change.type === 'block_closed')
        this.titles.delete(`${session}/${change.payload?.block_id}`)
      await this.refresh(session)
    }
  }

  async restore() {
    this.stopping = true
    await this.painting
    for (const own of [...this.owned.values()]) {
      own.timers.cancelAll()
      const windows =
        parseWindows(await this.run(['window', 'ls', '-s', own.session, '--json'])) ?? []
      const win = windows.find(w => w.window_id === own.window)
      if (!win || win.label !== own.label) continue
      const blocks = blocksOf(win)
      const processes = await Promise.all(
        blocks.map(b =>
          this.run(['block', 'call', '-s', own.session, '-b', b.block_id, 'process']),
        ),
      )
      const infos = processes.map(parse)
      if (infos.some(info => info === undefined || isClaude(info.foreground))) continue
      if (blocks.length > 0)
        await paintTab(this.run, {
          session: own.session,
          block: blocks[0].block_id,
          status: 'idle',
          ownName: own.name,
          isEnding: true,
          windows: [win],
          icons: this.icons,
        })
    }
    this.owned.clear()
  }
}
