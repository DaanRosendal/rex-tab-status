import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = async path => JSON.parse(await readFile(join(root, path), 'utf8'))

test('both marketplaces list the same plugin directory, which holds the manifest', async () => {
  const claude = await read('.claude-plugin/marketplace.json')
  const codex = await read('.agents/plugins/marketplace.json')
  const [claudeEntry] = claude.plugins
  const [codexEntry] = codex.plugins
  assert.equal(claudeEntry.source, './plugin')
  assert.equal(codexEntry.source.path, claudeEntry.source)
  assert.equal(claudeEntry.name, codexEntry.name)
  const plugin = await read('plugin/.claude-plugin/plugin.json')
  assert.equal(plugin.name, claudeEntry.name)
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/)
})

test('the start hook runs the watcher through the plugin root variable both hosts set', async () => {
  const { hooks } = await read('plugin/hooks/hooks.json')
  const [entry] = hooks.SessionStart
  const [hook] = entry.hooks
  assert.equal(hook.type, 'command')
  assert.match(hook.command, /\$\{CLAUDE_PLUGIN_ROOT\}\/src\/watcher\.mjs" start$/)
  await stat(join(root, 'plugin/src/watcher.mjs'))
})

test('the plugin directory holds only the files the hosts need', async () => {
  const names = []
  async function walk(dir) {
    for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`
      assert.equal(entry.isSymbolicLink(), false, `${path} is a symlink`)
      if (entry.isDirectory()) await walk(path)
      else names.push(path)
    }
  }
  await walk('plugin')
  assert.deepEqual(names.sort(), [
    'plugin/.claude-plugin/plugin.json',
    'plugin/hooks/hooks.json',
    'plugin/src/label.mjs',
    'plugin/src/lock.mjs',
    'plugin/src/rex-cli.mjs',
    'plugin/src/status.mjs',
    'plugin/src/tabs.mjs',
    'plugin/src/themes.mjs',
    'plugin/src/watcher.mjs',
  ])
})

test('plugin code imports only relative files and Node built-ins', async () => {
  for (const name of await readdir(join(root, 'plugin/src'))) {
    const text = await readFile(join(root, 'plugin/src', name), 'utf8')
    for (const [, specifier] of text.matchAll(/from '([^']+)'/g))
      assert.match(specifier, /^(\.\/|node:)/, `${name} imports ${specifier}`)
  }
})
