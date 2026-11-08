import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkVendor, checkVersions, loadHarnesses, ROOT } from '../scripts/harnesses.mjs'

const json = async path => JSON.parse(await readFile(join(ROOT, path), 'utf8'))

test('each host selects its own hook format under the same plugin identity', async () => {
  const claude = await json('claude/.claude-plugin/plugin.json')
  const claudeMarketplace = await json('.claude-plugin/marketplace.json')
  assert.equal(claudeMarketplace.plugins.find(p => p.name === 'rex-tab-status').source, './claude')
  const marketplace = await json('.agents/plugins/marketplace.json')
  const source = marketplace.plugins.find(plugin => plugin.name === 'rex-tab-status').source
  assert.deepEqual(source, { source: 'local', path: './codex' })
  const codex = await json(`${source.path}/.codex-plugin/plugin.json`)
  assert.equal(claude.name, 'rex-tab-status')
  assert.equal(codex.name, claude.name)
  assert.equal(codex.hooks, './hooks/codex.json')
  const claudeHooks = await json('claude/hooks/hooks.json')
  const codexHooks = await json(`${source.path}/${codex.hooks}`)
  assert.deepEqual(claudeHooks.modules, ['./register.ts'])
  assert.equal(codexHooks.modules, undefined)
  assert.equal(codexHooks.hooks.SessionStart[0].hooks[0].type, 'command')
  assert.match(codexHooks.hooks.SessionStart[0].hooks[0].command, /watcher\.mjs/)
  assert.equal(codexHooks.hooks.SessionStart[0].hooks[0].async, true)
})

test('every harness manifest carries the repo version', async () => {
  assert.deepEqual(await checkVersions(), [])
})

test('every harness vendors an exact copy of shared/', async () => {
  assert.deepEqual(await checkVendor(), [])
})

test('every harness is a self-contained plugin root', async () => {
  for (const harness of await loadHarnesses()) {
    const manifest = await json(join(harness.root, harness.manifest))
    assert.equal(manifest.name, 'rex-tab-status')
    const marketplace = await json(harness.marketplace)
    assert.ok(marketplace.plugins.some(plugin => plugin.name === manifest.name))
  }
})
