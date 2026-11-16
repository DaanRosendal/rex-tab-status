import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { claimLock, compareVersions, isAlive, readLock } from '../plugin/src/lock.mjs'

async function lockPath(t) {
  const dir = await mkdtemp(join(tmpdir(), 'rex-lock-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return join(dir, 'server.lock')
}

test('only one watcher can claim a server, and its lock file is private and records its version', async t => {
  const path = await lockPath(t)
  const release = await claimLock(path, { version: '1.2.3' })
  assert.equal(typeof release, 'function')
  assert.equal((await stat(path)).mode & 0o777, 0o600)
  assert.equal(await claimLock(path, { version: '9.9.9' }), undefined)
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { version: '1.2.3', pid: process.pid })
  assert.equal((await readLock(path)).version, '1.2.3')
  await release()
  await assert.rejects(stat(path), { code: 'ENOENT' })
  const next = await claimLock(path)
  assert.equal(typeof next, 'function')
  await next()
})

test('a lock left by a dead process is reclaimed', async t => {
  const path = await lockPath(t)
  await writeFile(path, JSON.stringify({ pid: 999999999, version: '1.0.0' }))
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

test('releasing never removes a lock another watcher now holds', async t => {
  const path = await lockPath(t)
  const release = await claimLock(path)
  await writeFile(path, JSON.stringify({ pid: process.pid + 1, version: '2.0.0' }))
  await release()
  assert.equal((await readLock(path)).pid, process.pid + 1)
})

test('unreadable lock content reads as no lock', async t => {
  const path = await lockPath(t)
  assert.equal(await readLock(path), undefined)
  await writeFile(path, 'not json')
  assert.equal(await readLock(path), undefined)
  await writeFile(path, '{"pid":"x"}')
  assert.equal(await readLock(path), undefined)
})

test('versions compare numerically', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1)
  assert.equal(compareVersions('1.0', '1.0.1'), -1)
  assert.equal(compareVersions('2.0.0', '10.0.0'), -1)
})

test('a live process is alive and a missing one is not', () => {
  assert.equal(isAlive(process.pid), true)
  assert.equal(isAlive(999999999), false)
})
