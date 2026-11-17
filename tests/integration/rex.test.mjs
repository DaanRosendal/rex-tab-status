import assert from 'node:assert/strict'
import { execFile, spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const skip =
  spawnSync('rex', ['--help'], { stdio: 'ignore' }).status === 0 ? false : 'rex is not installed'
const plugin = fileURLToPath(new URL('../../plugin/src/watcher.mjs', import.meta.url))
const fixture = fileURLToPath(new URL('../fixtures/agent-terminal.mjs', import.meta.url))

const TEST_TIMEOUT_MS = 45000
const EVENTUALLY_TIMEOUT_MS = 8000
const POLL_INTERVAL_MS = 50

async function eventually(check) {
  const deadline = Date.now() + EVENTUALLY_TIMEOUT_MS
  let error
  while (Date.now() < deadline) {
    try {
      await check()
      return
    } catch (e) {
      error = e
      await setTimeout(POLL_INTERVAL_MS)
    }
  }
  throw error
}

test(
  'the watcher follows real Rex status reports and restores labels on shutdown',
  { timeout: TEST_TIMEOUT_MS, skip },
  async () => {
    // Unix socket paths are limited to about 100 characters, which os.tmpdir() exceeds on macOS.
    const dir = await mkdtemp('/tmp/rex-tab-status-test-')
    const endpoint = `unix://${dir}/server.sock`
    const data = join(dir, 'watcher-state')
    const env = { ...process.env, REX_SERVER: endpoint, REX_TAB_STATUS_STATE: data }
    delete env.REX_SESSION
    delete env.REX_BLOCK
    const run = async args =>
      (
        await exec('rex', ['--server', endpoint, '--autostart=false', '--timeout', '3s', ...args], {
          env,
          timeout: 5000,
        })
      ).stdout
    let watcher
    let exited
    let started = false
    try {
      await writeFile(join(dir, 'init.lua'), '')
      await run([
        'server',
        'start',
        '--state-dir',
        join(dir, 'state'),
        '--config',
        join(dir, 'init.lua'),
      ])
      started = true
      const info = JSON.parse(await run(['whoami', '--json']))
      const created = JSON.parse(
        await run([
          'new',
          'rex-tab-status-test',
          '--shell=none',
          '--json',
          '--',
          process.execPath,
          fixture,
        ]),
      )
      const session = created.session_id
      const block = created.initial_windows[0].block_ids[0]
      const window = created.initial_windows[0].window_id
      const label = async () =>
        JSON.parse(await run(['window', 'ls', '-s', session, '--json'])).windows.find(
          w => w.window_id === window,
        ).label
      const send = async input => {
        await run(['send', '-s', session, '-b', block, JSON.stringify(input)])
        await run(['send-key', '-s', session, '-b', block, 'enter'])
      }

      watcher = spawn(process.execPath, [plugin, 'watch', endpoint, info.instance_id], {
        env,
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      let errors = ''
      watcher.stderr.on('data', chunk => {
        errors += chunk
      })
      exited = once(watcher, 'exit')
      await eventually(async () => assert.equal(await label(), 'Agent integration test'))

      const startEnv = { ...env, REX_SESSION: 'session:obsolete' }
      await Promise.all([
        exec(process.execPath, [plugin, 'start'], { env: startEnv }),
        exec(process.execPath, [plugin, 'start'], { env: startEnv }),
      ])
      const locks = (await readdir(data)).filter(name => name.endsWith('.lock'))
      assert.equal(locks.length, 1)
      assert.equal(JSON.parse(await readFile(join(data, locks[0]), 'utf8')).pid, watcher.pid)

      for (const [input, emoji] of [
        [{ state: 'working' }, '⏳'],
        [{ state: 'blocked', kind: 'permission' }, '❓'],
        [{ state: 'working' }, '⏳'],
        [{ state: 'blocked', kind: 'question' }, '❓'],
        [{ state: 'done' }, '✅'],
        [{ state: 'error' }, '❌'],
        [{ state: 'blocked', kind: 'auth' }, '❌'],
      ]) {
        await send(input)
        await eventually(async () => assert.equal(await label(), `${emoji} Agent integration test`))
      }
      await send({ state: 'idle' })
      await eventually(async () => assert.equal(await label(), 'Agent integration test'))
      await send({ titleOnly: true, title: '⠹ After idle' })
      await eventually(async () => assert.equal(await label(), 'After idle'))
      await send({ state: 'working', title: '⠹ New topic' })
      await eventually(async () => assert.equal(await label(), '⏳ New topic'))
      await send({ titleOnly: true, title: '⠸ New topic' })
      await setTimeout(300)
      assert.equal(await label(), '⏳ New topic')

      const custom = 'deploy $(keep-this-literal)'
      await run(['window', 'rename', '-s', session, '--', window, custom])
      await eventually(async () => assert.equal(await label(), `⏳ ${custom}`))
      await send({ state: 'done' })
      await eventually(async () => assert.equal(await label(), `✅ ${custom}`))

      watcher.kill('SIGTERM')
      const [code] = await exited
      watcher = undefined
      assert.equal(code, 0, errors)
      assert.equal(await label(), custom)
      assert.deepEqual(
        (await readdir(data)).filter(name => name.endsWith('.lock')),
        [],
      )
      assert.equal(errors, '')
    } finally {
      if (watcher) {
        watcher.kill('SIGTERM')
        await exited
      }
      if (started) await run(['server', 'stop']).catch(() => {})
      await rm(dir, { recursive: true, force: true })
    }
  },
)
