// Identical in rex-tab-status and rex-session-names. Keep both copies in sync.
import { open, readFile, stat, unlink } from 'node:fs/promises'

// A lock file with no PID yet is still being written, so its owner gets this long before we reclaim it.
const PARTIAL_LOCK_GRACE_MS = 5000

export async function claimLock(path) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(path, 'wx', 0o600)
      await file.writeFile(String(process.pid))
      await file.close()
      return async () => {
        if ((await readFile(path, 'utf8').catch(() => '')) === String(process.pid))
          await unlink(path).catch(() => {})
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const pid = Number(await readFile(path, 'utf8').catch(() => ''))
      if (!Number.isSafeInteger(pid) || pid <= 0) {
        const file = await stat(path).catch(() => undefined)
        if (!file || Date.now() - file.mtimeMs < PARTIAL_LOCK_GRACE_MS) return
        await unlink(path).catch(() => {})
        continue
      }
      try {
        process.kill(pid, 0)
        return
      } catch (killError) {
        if (killError.code !== 'ESRCH') return
      }
      await unlink(path).catch(() => {})
    }
  }
}
