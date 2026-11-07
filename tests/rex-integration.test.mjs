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
const skip = spawnSync('rex', ['--help'], { stdio: 'ignore' }).status === 0 ? false : 'rex is not installed'
const plugin = fileURLToPath(new URL('../codex/hooks/codex.mjs', import.meta.url))
const fixture = fileURLToPath(new URL('./fixtures/codex-terminal.mjs', import.meta.url))

async function eventually(check) {
  const deadline = Date.now() + 8000
  let error
  while (Date.now() < deadline) {
    try {
      await check()
      return
    } catch (e) {
      error = e
      await setTimeout(50)
    }
  }
  throw error
}

test('the installed watcher follows real Rex events and restores labels on shutdown', { timeout: 45000, skip }, async () => {
  const dir = await mkdtemp('/tmp/rex-tab-status-test-')
  const endpoint = `unix://${dir}/server.sock`
  const data = join(dir, 'codex-data')
  const env = { ...process.env, REX_SERVER: endpoint, PLUGIN_DATA: data }
  delete env.REX_SESSION
  delete env.REX_BLOCK
  const run = async args => (await exec('rex', ['--server', endpoint, '--autostart=false', '--timeout', '3s', ...args], { env, timeout: 5000 })).stdout
  let worker
  let exited
  let started = false
  try {
    await writeFile(join(dir, 'init.lua'), '')
    await run(['server', 'start', '--state-dir', join(dir, 'state'), '--config', join(dir, 'init.lua')])
    started = true
    const info = JSON.parse(await run(['whoami', '--json']))
    const created = JSON.parse(await run(['new', 'rex-tab-status-test', '--shell=none', '--json', '--', process.execPath, fixture]))
    const session = created.session_id
    const block = created.initial_windows[0].block_ids[0]
    const window = created.initial_windows[0].window_id
    const label = async () => JSON.parse(await run(['window', 'ls', '-s', session, '--json'])).windows.find(w => w.window_id === window).label
    const send = async input => {
      await run(['send', '-s', session, '-b', block, JSON.stringify(input)])
      await run(['send-key', '-s', session, '-b', block, 'enter'])
    }

    worker = spawn(process.execPath, [plugin, 'watch', endpoint, info.instance_id], { env, stdio: ['ignore', 'ignore', 'pipe'] })
    let errors = ''
    worker.stderr.on('data', chunk => { errors += chunk })
    exited = once(worker, 'exit')
    await eventually(async () => assert.equal(await label(), 'Codex integration test'))

    const startEnv = { ...env, REX_SESSION: 'session:obsolete' }
    await Promise.all([exec(process.execPath, [plugin, 'start'], { env: startEnv }), exec(process.execPath, [plugin, 'start'], { env: startEnv })])
    const locks = (await readdir(data)).filter(name => name.endsWith('.pid'))
    assert.equal(locks.length, 1)
    assert.equal(await readFile(join(data, locks[0]), 'utf8'), String(worker.pid))

    for (const [state, emoji] of [['working', '⏳'], ['blocked', '❓'], ['working', '⏳'], ['done', '✅'], ['error', '❌']]) {
      await send({ state })
      await eventually(async () => assert.equal(await label(), `${emoji} Codex integration test`))
    }
    await send({ state: 'idle' })
    assert.equal(await label(), '❌ Codex integration test')
    await send({ state: 'working', title: '⠹ New topic' })
    await eventually(async () => assert.equal(await label(), '⏳ New topic'))
    await send({ titleOnly: true, title: '[ ! ] Action Required | New topic' })
    await eventually(async () => assert.equal(await label(), '❓ New topic'))
    const native = JSON.parse(await run(['block', 'call', '-s', session, '-b', block, 'program_status']))
    assert.equal(native.records[0].state, 'working')
    await send({ titleOnly: true, title: '⠸ New topic' })
    await eventually(async () => assert.equal(await label(), '⏳ New topic'))

    const custom = 'deploy $(keep-this-literal)'
    await run(['window', 'rename', '-s', session, '--', window, custom])
    await eventually(async () => assert.equal(await label(), `⏳ ${custom}`))
    await send({ state: 'done' })
    await eventually(async () => assert.equal(await label(), `✅ ${custom}`))

    worker.kill('SIGTERM')
    const [code] = await exited
    worker = undefined
    assert.equal(code, 0, errors)
    assert.equal(await label(), custom)
    assert.equal(errors, '')
  } finally {
    if (worker) {
      worker.kill('SIGTERM')
      await exited
    }
    if (started) await run(['server', 'stop'])
    await rm(dir, { recursive: true, force: true })
  }
})
