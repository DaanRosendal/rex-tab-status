import { fileURLToPath } from 'node:url'

const watcher = fileURLToPath(new URL('../plugin/src/watcher.mjs', import.meta.url))

// Pi has no plugin hooks, so its extension starts the same watcher the Claude Code and Codex hook does.
export default function (pi) {
  pi.on('session_start', async () => {
    await pi.exec(process.execPath, [watcher, 'start'], { timeout: 10000 }).catch(() => {})
  })
}
