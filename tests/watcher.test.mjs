import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const watcher = fileURLToPath(new URL('../plugin/src/watcher.mjs', import.meta.url))
const manifest = fileURLToPath(new URL('../plugin/.claude-plugin/plugin.json', import.meta.url))
const TERMINAL = 'com.superlogical.terminal'
const POLL_MS = 50
const WAIT_MS = 8000

// A stand-in `rex` that logs each call and answers from environment variables.
async function fakeRex(dir) {
  const bin = join(dir, 'bin')
  await mkdir(bin)
  await writeFile(
    join(bin, 'rex'),
    `#!/usr/bin/env node
const { appendFileSync } = require('node:fs')
const args = process.argv.slice(2)
appendFileSync(process.env.FAKE_REX_LOG, args.join(' ') + '\\n')
if (process.env.FAKE_REX_FAIL) process.exit(3)
const out = text => process.stdout.write((text ?? '') + '\\n')
if (args.includes('events')) {
  for (const line of JSON.parse(process.env.FAKE_REX_EVENTS ?? '[]')) out(line)
} else if (args.includes('whoami')) out('{"endpoint":"unix:///fake","instance_id":"fake"}')
else if (args.includes('window')) out(process.env.FAKE_REX_WINDOWS)
else if (args.includes('ls')) out(process.env.FAKE_REX_SESSIONS)
else if (args.includes('call')) {
  const method = args.at(-1)
  out(method === 'program_status' ? process.env.FAKE_REX_STATUS : method === 'process' ? process.env.FAKE_REX_PROCESS : '{}')
}
`,
  )
  await chmod(join(bin, 'rex'), 0o755)
  return bin
}

const withoutRexVariables = env =>
  Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('REX_')))

async function eventually(check) {
  const deadline = Date.now() + WAIT_MS
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error('condition not met in time')
    await sleep(POLL_MS)
  }
}

async function scenario(run) {
  const dir = await mkdtemp(join(tmpdir(), 'rex-tab-status-fake-'))
  const state = join(dir, 'state')
  const log = join(dir, 'calls.log')
  const bin = await fakeRex(dir)
  await writeFile(log, '')
  const env = {
    ...withoutRexVariables(process.env),
    PATH: bin + delimiter + process.env.PATH,
    REX_TAB_STATUS_STATE: state,
    FAKE_REX_LOG: log,
  }
  const lockFiles = async () =>
    (await readdir(state).catch(() => [])).filter(n => n.endsWith('.lock'))
  const stop = () => exec(process.execPath, [watcher, 'stop'], { env })
  try {
    await run({
      dir,
      env,
      state,
      lockFiles,
      stop,
      calls: async () => (await readFile(log, 'utf8')).split('\n').filter(Boolean),
    })
  } finally {
    await stop().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

const start = (env, extra = {}) =>
  exec(process.execPath, [watcher, 'start'], { env: { ...env, ...extra } })

test('start does nothing outside a Rex terminal', async () => {
  await scenario(async ({ env, calls, lockFiles }) => {
    const { stdout } = await start(env)
    assert.equal(stdout, '')
    await sleep(300)
    assert.deepEqual(await calls(), [])
    assert.deepEqual(await lockFiles(), [])
  })
})

test('start does nothing when switched off', async () => {
  await scenario(async ({ env, calls }) => {
    await start(env, { REX_SESSION: 'session:s', REX_TAB_STATUS: 'off' })
    await sleep(300)
    assert.deepEqual(await calls(), [])
  })
})

test('start prints nothing and runs one detached watcher that stop shuts down', async () => {
  await scenario(async ({ env, lockFiles, calls, stop }) => {
    const { stdout } = await start(env, { REX_SESSION: 'session:s' })
    assert.equal(stdout, '')
    const [name] = await eventually(async () => {
      const files = await lockFiles()
      return files.length > 0 ? files : undefined
    })
    const held = JSON.parse(await readFile(join(env.REX_TAB_STATUS_STATE, name), 'utf8'))
    assert.equal(held.version, JSON.parse(await readFile(manifest, 'utf8')).version)
    assert.equal(typeof held.startedAt, 'string')
    await eventually(async () => (await calls()).some(c => c.includes('events --all --json')))

    await start(env, { REX_SESSION: 'session:s' })
    assert.equal((await lockFiles()).length, 1)

    const { stdout: stopped } = await stop()
    assert.match(stopped, /Stopped 1 watcher/)
    assert.deepEqual(await lockFiles(), [])
    assert.equal(
      (await exec(process.execPath, [watcher, 'stop'], { env })).stdout.trim(),
      'No watcher is running.',
    )
  })
})

test('the watcher survives malformed Rex data and keeps reading events', async () => {
  await scenario(async ({ env, calls, lockFiles }) => {
    Object.assign(env, {
      FAKE_REX_SESSIONS: JSON.stringify({ sessions: [null, 5, { session_id: 'session:a' }] }),
      FAKE_REX_WINDOWS: JSON.stringify({
        windows: [
          null,
          { window_id: 'window:1', label: 'x', layers: null },
          {
            window_id: 'window:2',
            label: 'y',
            layers: [
              null,
              { blocks: null },
              { blocks: [{ block_id: 'block:1', creator_name: TERMINAL }] },
            ],
          },
        ],
      }),
      FAKE_REX_STATUS: '{"records":[null,{"state":5},{"state":"done"}]}',
      FAKE_REX_EVENTS: JSON.stringify(['not json', 'null', '{"type":"session_event"}', '[1]']),
    })
    await start(env, { REX_SESSION: 'session:s' })
    await eventually(async () => (await calls()).some(c => c.includes('window ls -s session:a')))
    assert.equal((await lockFiles()).length, 1)
  })
})

// Looks like a running watcher to the identity check, without needing a Rex server.
function standInWatcher() {
  const child = spawn(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)', 'watcher.mjs', 'watch'],
    { stdio: 'ignore' },
  )
  return { child, exited: new Promise(resolve => child.once('exit', resolve)) }
}

test('a newer plugin version replaces a running older watcher', async () => {
  await scenario(async ({ env, state, lockFiles }) => {
    await mkdir(state, { recursive: true })
    const old = standInWatcher()
    const key = createKey()
    await writeFile(
      join(state, `${key}.lock`),
      JSON.stringify({ pid: old.child.pid, version: '0.0.1' }),
    )
    await start(env, { REX_SESSION: 'session:s' })
    await old.exited
    const held = await eventually(async () => {
      const file = JSON.parse(await readFile(join(state, `${key}.lock`), 'utf8'))
      return file.pid !== old.child.pid ? file : undefined
    })
    assert.notEqual(held.version, '0.0.1')
    assert.equal((await lockFiles()).length, 1)
  })
})

test('a watcher of the same or a newer version is left running', async () => {
  await scenario(async ({ env, state, calls }) => {
    await mkdir(state, { recursive: true })
    const running = standInWatcher()
    try {
      const key = createKey()
      await writeFile(
        join(state, `${key}.lock`),
        JSON.stringify({ pid: running.child.pid, version: '99.0.0' }),
      )
      await start(env, { REX_SESSION: 'session:s' })
      await sleep(300)
      assert.equal(running.child.exitCode, null)
      assert.equal(
        JSON.parse(await readFile(join(state, `${key}.lock`), 'utf8')).pid,
        running.child.pid,
      )
      assert.equal(
        (await calls()).some(c => c.includes('events')),
        false,
      )
    } finally {
      running.child.kill()
    }
  })
})

test('a recycled pid in the lock is neither trusted nor killed', async () => {
  await scenario(async ({ env, state, lockFiles, stop }) => {
    await mkdir(state, { recursive: true })
    const bystander = spawn('sleep', ['30'], { stdio: 'ignore' })
    try {
      const key = createKey()
      await writeFile(
        join(state, `${key}.lock`),
        JSON.stringify({ pid: bystander.pid, version: '0.0.1' }),
      )
      await start(env, { REX_SESSION: 'session:s' })
      const held = await eventually(async () => {
        const file = JSON.parse(await readFile(join(state, `${key}.lock`), 'utf8'))
        return file.pid !== bystander.pid ? file : undefined
      })
      assert.equal(typeof held.pid, 'number')
      assert.equal(bystander.exitCode, null)
      assert.equal(bystander.signalCode, null)
      await stop()
      assert.equal(bystander.exitCode, null)
      assert.equal(bystander.signalCode, null)
      assert.deepEqual(await lockFiles(), [])
    } finally {
      bystander.kill()
    }
  })
})

test('start prints nothing and succeeds when rex fails', async () => {
  await scenario(async ({ env, calls, lockFiles }) => {
    const { stdout, stderr } = await start(env, { REX_SESSION: 'session:s', FAKE_REX_FAIL: '1' })
    assert.equal(stdout, '')
    assert.equal(stderr, '')
    assert.ok((await calls()).length > 0)
    assert.deepEqual(await lockFiles(), [])
  })
})

test('doctor flags an agent that runs without reporting status', async () => {
  await scenario(async ({ env }) => {
    Object.assign(env, {
      FAKE_REX_SESSIONS: JSON.stringify({ sessions: [{ session_id: 'session:a', label: 'work' }] }),
      FAKE_REX_WINDOWS: JSON.stringify({
        windows: [
          {
            window_id: 'window:1',
            label: 'tab',
            layers: [{ blocks: [{ block_id: 'block:1', creator_name: TERMINAL }] }],
          },
        ],
      }),
      FAKE_REX_STATUS: '{"records":[]}',
      FAKE_REX_PROCESS: JSON.stringify({
        foreground: { pid: 1, name: '2.1.325', argv0: 'claude' },
      }),
    })
    const { stdout } = await exec(process.execPath, [watcher, 'doctor'], { env })
    assert.match(
      stdout,
      /work \| tab \| block:1 \| claude \| no status <- runs an agent but sends no status/,
    )
  })
})

function createKey() {
  return createHash('sha256').update('unix:///fake/fake').digest('hex').slice(0, 16)
}
