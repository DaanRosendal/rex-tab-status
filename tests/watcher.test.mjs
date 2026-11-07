import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const plugin = fileURLToPath(new URL('../codex/hooks/codex.mjs', import.meta.url))
const TERMINAL = 'com.superlogical.terminal'

async function fakeRex(dir) {
  const bin = join(dir, 'bin')
  await mkdir(bin)
  await writeFile(
    join(bin, 'rex'),
    `#!/usr/bin/env node
const { appendFileSync } = require('node:fs')
const args = process.argv.slice(2)
appendFileSync(process.env.FAKE_REX_LOG, args.join(' ') + '\\n')
const out = text => process.stdout.write((text ?? '') + '\\n')
if (args.includes('events')) {
  for (const line of JSON.parse(process.env.FAKE_REX_EVENTS ?? '[]')) out(line)
} else if (args.includes('whoami')) out('{"endpoint":"unix:///fake","instance_id":"fake"}')
else if (args.includes('window')) out(process.env.FAKE_REX_WINDOWS)
else if (args.includes('inspect')) out(process.env.FAKE_REX_VIEW)
else if (args.includes('ls')) out(process.env.FAKE_REX_SESSIONS)
else if (args.includes('call')) out('{}')
`,
  )
  await chmod(join(bin, 'rex'), 0o755)
  return bin
}

const withoutRexVariables = env =>
  Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('REX_')))

async function scenario(run) {
  const dir = await mkdtemp(join(tmpdir(), 'rex-tab-status-fake-'))
  try {
    const bin = await fakeRex(dir)
    const log = join(dir, 'calls.log')
    await writeFile(log, '')
    const env = {
      ...withoutRexVariables(process.env),
      PATH: bin + delimiter + process.env.PATH,
      PLUGIN_DATA: join(dir, 'data'),
      FAKE_REX_LOG: log,
    }
    await run({
      dir,
      env,
      calls: async () => (await readFile(log, 'utf8')).split('\n').filter(Boolean),
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('the watcher survives malformed Rex data and keeps reading events', async () => {
  await scenario(async ({ dir, env, calls }) => {
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
      FAKE_REX_EVENTS: JSON.stringify([
        'not json',
        'null',
        JSON.stringify({
          type: 'session_event',
          payload: { session_id: 'session:a', event: { type: 'block_event', payload: null } },
        }),
        JSON.stringify({
          type: 'session_event',
          payload: {
            session_id: 'session:a',
            event: { type: 'window_label_changed', payload: null },
          },
        }),
        JSON.stringify({
          type: 'session_created',
          payload: { session: { session_id: 'session:b' } },
        }),
      ]),
    })
    const { stderr } = await exec(process.execPath, [plugin, 'watch', 'unix:///fake', 'fake'], {
      env,
    })
    assert.equal(stderr, '')
    assert.ok(
      (await calls()).some(call => call.includes('window ls -s session:b')),
      'the event after the bad ones was handled',
    )
    assert.deepEqual(
      (await readdir(join(dir, 'data'))).filter(name => name.endsWith('.pid')),
      [],
    )
  })
})

test('start does nothing outside a Rex terminal', async () => {
  await scenario(async ({ env, calls }) => {
    await exec(process.execPath, [plugin, 'start'], { env })
    assert.deepEqual(await calls(), [])
  })
})

for (const variable of ['REX_SESSION', 'REX_BLOCK', 'REX_SERVER']) {
  test(`start asks Rex for its endpoint when ${variable} is set`, async () => {
    await scenario(async ({ env, calls }) => {
      await exec(process.execPath, [plugin, 'start'], {
        env: { ...env, [variable]: 'unix:///fake' },
      })
      assert.ok((await calls()).some(call => call.includes('whoami')))
    })
  })
}
