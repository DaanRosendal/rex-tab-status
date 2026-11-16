import { open, readFile, stat, unlink } from 'node:fs/promises'

// A lock file with no content yet is still being written, so its owner gets this long before we reclaim it.
const PARTIAL_LOCK_GRACE_MS = 5000

export async function readLock(path) {
  const text = await readFile(path, 'utf8').catch(() => '')
  try {
    const info = JSON.parse(text)
    return Number.isSafeInteger(info?.pid) && info.pid > 0 ? info : undefined
  } catch {
    return undefined
  }
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code !== 'ESRCH'
  }
}

export function compareVersions(a, b) {
  const left = String(a).split('.').map(Number)
  const right = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] || 0) - (right[i] || 0)
    if (diff !== 0) return Math.sign(diff)
  }
  return 0
}

async function isStale(path, isHolder) {
  const held = await readLock(path)
  if (held) return !(await isHolder(held.pid))
  const file = await stat(path).catch(() => undefined)
  return !file || Date.now() - file.mtimeMs >= PARTIAL_LOCK_GRACE_MS
}

// Only the holder of the guard file removes a stale lock, and it checks again under the guard, so
// two claimers never remove each other's fresh lock.
async function removeStale(path, isHolder) {
  const guard = `${path}.reclaim`
  let file
  try {
    file = await open(guard, 'wx', 0o600)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const age = Date.now() - ((await stat(guard).catch(() => undefined))?.mtimeMs ?? Date.now())
    if (age >= PARTIAL_LOCK_GRACE_MS) await unlink(guard).catch(() => {})
    return false
  }
  try {
    if (!(await isStale(path, isHolder))) return false
    await unlink(path).catch(() => {})
    return true
  } finally {
    await file.close()
    await unlink(guard).catch(() => {})
  }
}

// Returns a release function, or undefined when a live holder already has the lock. `isHolder`
// tells whether a pid still belongs to a holder, so a recycled pid does not block a claim.
export async function claimLock(path, info = {}, { isHolder = isAlive } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(path, 'wx', 0o600)
      await file.writeFile(JSON.stringify({ ...info, pid: process.pid }))
      await file.close()
      return async () => {
        if ((await readLock(path))?.pid === process.pid) await unlink(path).catch(() => {})
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      if (!(await isStale(path, isHolder)) || !(await removeStale(path, isHolder))) return
    }
  }
}
