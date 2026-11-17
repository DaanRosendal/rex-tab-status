import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Plugin } from '@opencode/plugin/tui'

const watcher = fileURLToPath(new URL('../plugin/src/watcher.mjs', import.meta.url))

// OpenCode runs plugins in Bun, so the watcher starts through the node on the PATH.
export default Plugin.define({
  id: 'rex-tab-status',
  setup() {
    const child = spawn('node', [watcher, 'start'], { stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
  },
})
