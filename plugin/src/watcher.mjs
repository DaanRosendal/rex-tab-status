import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { claimLock, compareVersions, isAlive, readLock } from './lock.mjs'
import { parse, rexArgs, runner } from './rex-cli.mjs'
import { DEFAULT_APPS } from './status.mjs'
import { Tabs, blocksOf, parseWindows } from './tabs.mjs'
import { resolveTheme } from './themes.mjs'

const exec = promisify(execFile)
const filename = fileURLToPath(import.meta.url)
const STOP_WAIT_MS = 6000
const LOCK_RETRIES = 25
const LOCK_RETRY_MS = 200
const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 30000
const MAX_FAILED_RECONNECTS = 20
const KNOWN_AGENTS = ['claude', 'codex', 'gemini', 'opencode', 'aider', 'amp', 'goose']

const stateDir = () =>
  process.env.REX_TAB_STATUS_STATE ?? join(homedir(), '.local', 'state', 'rex-tab-status')

const lockPath = (endpoint, instance) =>
  join(
    stateDir(),
    `${createHash('sha256').update(`${endpoint}/${instance}`).digest('hex').slice(0, 16)}.lock`,
  )

async function version() {
  const manifest = new URL('../.claude-plugin/plugin.json', import.meta.url)
  return JSON.parse(await readFile(manifest, 'utf8')).version
}

function apps() {
  const list = (process.env.REX_TAB_STATUS_APPS ?? '')
    .split(',')
    .map(app => app.trim())
    .filter(Boolean)
  return list.length > 0 ? list : DEFAULT_APPS
}

// A pid in a lock file can be recycled by an unrelated process, so it only counts as a watcher
// when its command line is one.
async function isWatcher(pid) {
  if (!isAlive(pid)) return false
  try {
    const { stdout } = await exec('ps', ['-o', 'command=', '-p', String(pid)])
    return stdout.includes('watcher.mjs') && /\swatch(\s|$)/.test(stdout)
  } catch (error) {
    return error.code === 'ENOENT'
  }
}

async function waitForExit(pid) {
  const deadline = Date.now() + STOP_WAIT_MS
  while (isAlive(pid) && Date.now() < deadline) await sleep(50)
  return !isAlive(pid)
}

async function watch(endpoint, instance) {
  await mkdir(stateDir(), { recursive: true, mode: 0o700 })
  const path = lockPath(endpoint, instance)
  const info = { version: await version(), startedAt: new Date().toISOString() }
  let release
  for (let attempt = 0; attempt < LOCK_RETRIES && !release; attempt++) {
    release = await claimLock(path, info, { isHolder: isWatcher })
    if (!release) await sleep(LOCK_RETRY_MS)
  }
  if (!release) return

  const run = runner(endpoint)
  const tabs = new Tabs({
    run,
    icons: resolveTheme(process.env.REX_TAB_STATUS_THEME),
    apps: apps(),
  })
  let events
  let stopping = false
  const wake = new AbortController()
  const stop = () => {
    stopping = true
    tabs.stopping = true
    wake.abort()
    events?.kill('SIGTERM')
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)

  try {
    let delay = RECONNECT_MIN_MS
    let failures = 0
    while (!stopping) {
      events = spawn('rex', rexArgs(endpoint, ['events', '--all', '--json']), {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const closed = new Promise(resolve => events.once('close', resolve))
      events.on('error', () => events.stdout.destroy())
      // The iterator must exist before any await, or a stream that ends early never finishes it.
      const lines = createInterface({ input: events.stdout })[Symbol.asyncIterator]()
      const sessions = parse(await run(['ls', '--json']))?.sessions ?? []
      for (const session of sessions)
        if (typeof session?.session_id === 'string') await tabs.refresh(session.session_id)
      let received = false
      for await (const line of lines) {
        if (stopping) break
        received = true
        try {
          await tabs.handle(parse(line))
        } catch {}
      }
      await closed
      if (stopping) break
      if (received) delay = RECONNECT_MIN_MS
      await sleep(delay, undefined, { signal: wake.signal }).catch(() => {})
      if (stopping) break
      delay = Math.min(delay * 2, RECONNECT_MAX_MS)
      const current = parse(await run(['whoami', '--json']))
      if (current && current.instance_id !== instance) break
      failures = current ? 0 : failures + 1
      if (failures >= MAX_FAILED_RECONNECTS) break
    }
  } finally {
    stop()
    await tabs.restore()
    await release()
    process.removeListener('SIGTERM', stop)
    process.removeListener('SIGINT', stop)
  }
}

// Runs from the SessionStart hook, which must print nothing and never fail the session.
async function start() {
  if (process.env.REX_TAB_STATUS === 'off') return
  if (!process.env.REX_SESSION && !process.env.REX_BLOCK && !process.env.REX_SERVER) return
  const info = parse(await runner()(['whoami', '--json']))
  if (!info?.endpoint || !info?.instance_id) return

  const mine = await version()
  const held = await readLock(lockPath(info.endpoint, info.instance_id))
  if (held && (await isWatcher(held.pid))) {
    if (compareVersions(mine, held.version ?? '0') <= 0) return
    process.kill(held.pid, 'SIGTERM')
    await waitForExit(held.pid)
  }
  const child = spawn(process.execPath, [filename, 'watch', info.endpoint, info.instance_id], {
    cwd: homedir(),
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

async function stopAll() {
  const names = await readdir(stateDir()).catch(() => [])
  let stopped = 0
  let lingering = 0
  for (const name of names.filter(n => n.endsWith('.lock'))) {
    const held = await readLock(join(stateDir(), name))
    if (!held || !(await isWatcher(held.pid))) continue
    process.kill(held.pid, 'SIGTERM')
    if (await waitForExit(held.pid)) stopped++
    else lingering++
  }
  if (lingering > 0) console.log(`${lingering} watcher(s) did not exit in time.`)
  if (stopped > 0) console.log(`Stopped ${stopped} watcher(s).`)
  if (stopped + lingering === 0) console.log('No watcher is running.')
}

// Lists every terminal pane with the status Rex holds for it, flagging agents that report none.
async function doctor() {
  const run = runner()
  const sessions = parse(await run(['ls', '--json']))?.sessions ?? []
  if (sessions.length === 0) return console.log('No Rex sessions found. Is Rex running?')
  const watchers = (await readdir(stateDir()).catch(() => [])).filter(n => n.endsWith('.lock'))
  console.log(`Watcher lock files: ${watchers.length}`)
  for (const session of sessions) {
    const windows = parseWindows(await run(['window', 'ls', '-s', session.session_id, '--json']))
    for (const win of windows ?? []) {
      for (const block of blocksOf(win)) {
        const call = method =>
          run(['block', 'call', '-s', session.session_id, '-b', block.block_id, method])
        const records = parse(await call('program_status'))?.records ?? []
        const foreground = parse(await call('process'))?.foreground
        const exe = basename(
          foreground?.argv0 ?? foreground?.invoked_path ?? foreground?.name ?? '',
        )
        const states = records.map(r => `${r.state}${r.kind ? `/${r.kind}` : ''}`).join(', ')
        const silent = records.length === 0 && KNOWN_AGENTS.includes(exe)
        console.log(
          `${session.label} | ${win.label} | ${block.block_id} | ${exe || '-'} | ${states || 'no status'}${silent ? ' <- runs an agent but sends no status, so update it' : ''}`,
        )
      }
    }
  }
}

async function main() {
  const [command, endpoint, instance] = process.argv.slice(2)
  if (command === 'watch') return watch(endpoint, instance)
  if (command === 'start')
    return start().catch(error => console.error(`rex-tab-status: ${error.message}`))
  if (command === 'stop') return stopAll()
  if (command === 'doctor') return doctor()
  console.error('Usage: node watcher.mjs start|stop|doctor')
  process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === filename) {
  main().catch(error => {
    console.error(`rex-tab-status: ${error.message}`)
    process.exitCode = 1
  })
}
