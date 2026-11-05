import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { paintTab, parse } from './rex.ts'

const exec = promisify(execFile)
const PRIORITY = { idle: 0, done: 1, error: 2, working: 3, blocked: 4 }
const TERMINAL = 'com.superlogical.terminal'
// Codex marks async questions in its title while OSC 7501 can stay working.
const ACTION_REQUIRED = /^\[ [!.] \] Action Required(?: \| |$)/
const filename = fileURLToPath(import.meta.url)

export function cleanTitle(title) {
  return title.replace(/^[\u2800-\u28ff]\s+/u, '').replace(ACTION_REQUIRED, '')
}

function titleSignature(title) {
  return title.replace(/^[\u2800-\u28ff]\s+/u, '').replace(ACTION_REQUIRED, '[action-required] ')
}

export class CodexTabs {
  owned = new Map()
  titles = new Map()

  constructor(run) {
    this.run = run
  }

  async refresh(session, blockId, windowId) {
    const windows = parse(await this.run(['window', 'ls', '-s', session, '--json']))?.windows
    if (!Array.isArray(windows)) return
    for (const win of windows) {
      if (windowId && win.window_id !== windowId) continue
      if (blockId && !win.layers.some(l => l.blocks.some(b => b.block_id === blockId))) continue
      await this.paint(session, win)
    }
    for (const [key, own] of this.owned) {
      if (own.session === session && !windows.some(w => w.window_id === own.window)) this.owned.delete(key)
    }
  }

  async paint(session, win) {
    const key = `${session}/${win.window_id}`
    const own = this.owned.get(key)
    const blocks = win.layers.flatMap(l => l.blocks).filter(b => !b.creator_name || b.creator_name === TERMINAL)
    const reports = await Promise.all(blocks.map(async block => {
      const [status, process, title] = await Promise.all([
        this.run(['block', 'call', '-s', session, '-b', block.block_id, 'program_status']),
        this.run(['block', 'call', '-s', session, '-b', block.block_id, 'process']),
        this.run(['block', 'call', '-s', session, '-b', block.block_id, 'title']),
      ])
      const foreground = parse(process)?.foreground
      const records = (parse(status)?.records ?? []).filter(r =>
        (r.effective_app ?? r.app) === 'codex'
        && Object.hasOwn(PRIORITY, r.state)
        && (!r.owner || (r.owner.pid === foreground?.pid && r.owner.name === foreground?.name)),
      )
      const terminalTitle = parse(title)
      const titleIsCurrent = !terminalTitle?.owner
        || (terminalTitle.owner.pid === foreground?.pid && terminalTitle.owner.name === foreground?.name)
      const text = typeof terminalTitle?.title === 'string' ? terminalTitle.title : ''
      this.titles.set(`${session}/${block.block_id}`, titleSignature(text))
      return {
        block: block.block_id,
        foreground,
        records,
        processKnown: parse(process) !== undefined,
        needsInput: titleIsCurrent && ACTION_REQUIRED.test(text),
      }
    }))

    // Claude's function hooks own the label while Claude shares this tab.
    if (reports.some(r => !r.processKnown || ['claude', 'claude-code'].includes(r.foreground?.name))) return

    const candidates = reports.filter(r => r.records.length > 0)
    if (candidates.length === 0) {
      if (own && win.label === own.label && blocks.length > 0) {
        await paintTab(this.run, { session, block: blocks[0].block_id, status: 'idle', ownName: own.name, isEnding: true, windows: [win] })
      }
      this.owned.delete(key)
      return
    }

    const block = candidates[0].block
    const status = candidates.some(c => c.needsInput)
      ? 'blocked'
      : candidates.flatMap(c => c.records).reduce((state, r) => PRIORITY[r.state] > PRIORITY[state] ? r.state : state, 'idle')
    const result = await paintTab(this.run, {
      session,
      block,
      status,
      ownName: own?.name,
      windows: [win],
      formatTitle: cleanTitle,
    })
    this.owned.set(key, { session, window: win.window_id, name: result.ownName, label: result.label })
  }

  async handle(event) {
    if (event?.type === 'session_destroyed') {
      const session = event.payload?.session_id
      if (typeof session !== 'string') return
      for (const [key, own] of this.owned) if (own.session === session) this.owned.delete(key)
      for (const key of this.titles.keys()) if (key.startsWith(`${session}/`)) this.titles.delete(key)
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
      } else if (!['program_status_changed', 'program_status_removed', 'process_changed', 'child_exited'].includes(name)) return
      await this.refresh(session, block)
    } else if (change.type === 'window_label_changed') {
      const { window_id: window, label } = change.payload ?? {}
      if (typeof window !== 'string' || this.owned.get(`${session}/${window}`)?.label === label) return
      await this.refresh(session, undefined, window)
    } else if (['block_created', 'block_closed', 'session_label_changed'].includes(change.type)) {
      if (change.type === 'block_closed') this.titles.delete(`${session}/${change.payload?.block_id}`)
      await this.refresh(session)
    }
  }

  async restore() {
    for (const own of [...this.owned.values()]) {
      const windows = parse(await this.run(['window', 'ls', '-s', own.session, '--json']))?.windows ?? []
      const win = windows.find(w => w.window_id === own.window)
      if (!win || win.label !== own.label) continue
      const blocks = win.layers.flatMap(l => l.blocks)
      const processes = await Promise.all(blocks.map(b => this.run(['block', 'call', '-s', own.session, '-b', b.block_id, 'process'])))
      if (processes.some(p => parse(p) === undefined || ['claude', 'claude-code'].includes(parse(p)?.foreground?.name))) continue
      if (blocks.length > 0) await paintTab(this.run, { session: own.session, block: blocks[0].block_id, status: 'idle', ownName: own.name, isEnding: true, windows: [win] })
    }
    this.owned.clear()
  }
}

function rexArgs(server, args) {
  return ['--autostart=false', '--timeout', '2s', ...(server ? ['--server', server] : []), ...args]
}

function runner(server) {
  return async args => {
    try {
      return (await exec('rex', rexArgs(server, args), { timeout: 2500, maxBuffer: 4 * 1024 * 1024 })).stdout
    } catch {
      return undefined
    }
  }
}

export async function claimLock(path) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(path, 'wx', 0o600)
      await file.writeFile(String(process.pid))
      await file.close()
      return async () => {
        if (await readFile(path, 'utf8').catch(() => '') === String(process.pid)) await unlink(path).catch(() => {})
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const pid = Number(await readFile(path, 'utf8').catch(() => ''))
      if (!Number.isSafeInteger(pid) || pid <= 0) {
        const file = await stat(path).catch(() => undefined)
        if (!file || Date.now() - file.mtimeMs < 5000) return
        await unlink(path).catch(() => {})
        continue
      }
      try {
        process.kill(pid, 0)
        return
      } catch (error) {
        if (error.code !== 'ESRCH') return
      }
      await unlink(path).catch(() => {})
    }
  }
}

async function watch(server, instance) {
  const data = process.env.PLUGIN_DATA ?? join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'plugins', 'data', 'rex-tab-status')
  await mkdir(data, { recursive: true, mode: 0o700 })
  const key = createHash('sha256').update(`${server}/${instance}`).digest('hex').slice(0, 16)
  const release = await claimLock(join(data, `codex-${key}.pid`))
  if (!release) return

  const run = runner(server)
  const tabs = new CodexTabs(run)
  const events = spawn('rex', rexArgs(server, ['events', '--all', '--json']), { stdio: ['ignore', 'pipe', 'ignore'] })
  const lines = createInterface({ input: events.stdout })
  const stop = () => events.kill('SIGTERM')
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  events.on('error', () => lines.close())
  try {
    const sessions = parse(await run(['ls', '--json']))?.sessions ?? []
    for (const session of sessions) await tabs.refresh(session.session_id)
    for await (const line of lines) await tabs.handle(parse(line))
  } finally {
    stop()
    await tabs.restore()
    await release()
    process.removeListener('SIGTERM', stop)
    process.removeListener('SIGINT', stop)
  }
}

async function main() {
  if (process.argv[2] === 'watch') return watch(process.argv[3], process.argv[4])
  if (process.argv[2] !== 'start') throw new Error('Usage: node hooks/codex.mjs start')
  const info = parse(await runner()(['whoami', '--json']))
  if (!info?.endpoint || !info?.instance_id) return
  const child = spawn(process.execPath, [filename, 'watch', info.endpoint, info.instance_id], { detached: true, stdio: 'ignore' })
  child.unref()
}

if (process.argv[1] && resolve(process.argv[1]) === filename) {
  main().catch(error => {
    console.error(`rex-tab-status: ${error.message}`)
    process.exitCode = 1
  })
}
