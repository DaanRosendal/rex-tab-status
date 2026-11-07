// Identical in rex-tab-status and rex-session-names. Keep both copies in sync.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const REX_TIMEOUT_SECONDS = 2
const EXEC_TIMEOUT_MS = (REX_TIMEOUT_SECONDS + 0.5) * 1000
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024

export function rexArgs(server, args) {
  return [
    '--autostart=false',
    '--timeout',
    `${REX_TIMEOUT_SECONDS}s`,
    ...(server ? ['--server', server] : []),
    ...args,
  ]
}

export function runner(server) {
  return async args => {
    try {
      const { stdout } = await exec('rex', rexArgs(server, args), {
        timeout: EXEC_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
      })
      return stdout
    } catch {
      return undefined
    }
  }
}
