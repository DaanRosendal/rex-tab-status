import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { claimLock } from '../codex/hooks/lock.mjs'

async function lockPath(t) {
  const dir = await mkdtemp(join(tmpdir(), 'rex-lock-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return join(dir, 'server.pid')
}

test('only one watcher can claim a server, and its PID file is private', async t => {
  const path = await lockPath(t)
  const release = await claimLock(path)
  assert.equal(typeof release, 'function')
  assert.equal((await stat(path)).mode & 0o777, 0o600)
  assert.equal(await claimLock(path), undefined)
  assert.equal(await readFile(path, 'utf8'), String(process.pid))
  await release()
  await assert.rejects(stat(path), { code: 'ENOENT' })
  const next = await claimLock(path)
  assert.equal(typeof next, 'function')
  await next()
})

test('a lock left by a dead process is reclaimed', async t => {
  const path = await lockPath(t)
  await writeFile(path, '999999999')
  const release = await claimLock(path)
  assert.equal(typeof release, 'function')
  await release()
})

test('an unfinished lock is respected while fresh and reclaimed after its startup window', async t => {
  const path = await lockPath(t)
  await writeFile(path, '')
  assert.equal(await claimLock(path), undefined)
  const earlier = new Date(Date.now() - 10000)
  await utimes(path, earlier, earlier)
  const release = await claimLock(path)
  assert.equal(typeof release, 'function')
  await release()
})
