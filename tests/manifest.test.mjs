import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('each host selects its own hook format under the same plugin identity', async () => {
  const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))
  const claude = await json('../.claude-plugin/plugin.json')
  const marketplace = await json('../.agents/plugins/marketplace.json')
  const source = marketplace.plugins.find(plugin => plugin.name === 'rex-tab-status').source
  assert.deepEqual(source, { source: 'local', path: './codex' })
  const codex = await json(`../${source.path}/.codex-plugin/plugin.json`)
  assert.equal(claude.name, 'rex-tab-status')
  assert.equal(codex.name, claude.name)
  assert.equal(codex.version, claude.version)
  assert.equal(codex.hooks, './hooks/codex.json')
  const claudeHooks = await json('../hooks/hooks.json')
  const codexHooks = await json(`../${source.path}/${codex.hooks}`)
  assert.deepEqual(claudeHooks.modules, ['./register.ts'])
  assert.equal(codexHooks.modules, undefined)
  assert.equal(codexHooks.hooks.SessionStart[0].hooks[0].type, 'command')
  assert.match(codexHooks.hooks.SessionStart[0].hooks[0].command, /watcher\.mjs/)
  assert.equal(codexHooks.hooks.SessionStart[0].hooks[0].async, true)
})
