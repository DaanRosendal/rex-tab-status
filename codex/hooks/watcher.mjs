import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { claimLock } from './lock.mjs'
import { parse } from './paint.ts'
import { rexArgs, runner } from './rex-cli.mjs'
import { CodexTabs } from './tabs.mjs'
import { resolveTheme } from './themes.ts'

const filename = fileURLToPath(import.meta.url)

async function watch(server, instance) {
  const data =
    process.env.PLUGIN_DATA ??
    join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'plugins', 'data', 'rex-tab-status')
  await mkdir(data, { recursive: true, mode: 0o700 })
  const key = createHash('sha256').update(`${server}/${instance}`).digest('hex').slice(0, 16)
  const release = await claimLock(join(data, `codex-${key}.pid`))
  if (!release) return

  const run = runner(server)
  const tabs = new CodexTabs(run, resolveTheme(process.env.REX_TAB_STATUS_THEME))
  const events = spawn('rex', rexArgs(server, ['events', '--all', '--json']), {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const lines = createInterface({ input: events.stdout })
  const input = lines[Symbol.asyncIterator]()
  const stop = () => events.kill('SIGTERM')
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  events.on('error', () => lines.close())
  try {
    const sessions = parse(await run(['ls', '--json']))?.sessions ?? []
    for (const session of sessions)
      if (typeof session?.session_id === 'string') await tabs.refresh(session.session_id)
    for await (const line of input) {
      try {
        await tabs.handle(parse(line))
      } catch {}
    }
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
  if (process.argv[2] !== 'start') throw new Error('Usage: node hooks/watcher.mjs start')
  if (!process.env.REX_SESSION && !process.env.REX_BLOCK && !process.env.REX_SERVER) return
  const info = parse(await runner()(['whoami', '--json']))
  if (!info?.endpoint || !info?.instance_id) return
  const child = spawn(process.execPath, [filename, 'watch', info.endpoint, info.instance_id], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

if (process.argv[1] && resolve(process.argv[1]) === filename) {
  main().catch(error => {
    console.error(`rex-tab-status: ${error.message}`)
    process.exitCode = 1
  })
}
