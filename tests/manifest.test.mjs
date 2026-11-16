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

test('the hook starts asynchronously with time to replace an old watcher', async () => {
  const { hooks } = await read('plugin/hooks/hooks.json')
  const [hook] = hooks.SessionStart[0].hooks
  assert.equal(hook.async, true)
  assert.ok(hook.timeout >= 10)
})

test('the changelog leads with the manifest version', async () => {
  const { version } = await read('plugin/.claude-plugin/plugin.json')
  const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8')
  assert.equal(changelog.match(/^## (\S+)/m)[1], version)
})

test('the README documents every icon and every setting the code reads', async () => {
  const readme = await readFile(join(root, 'README.md'), 'utf8')
  const { THEMES } = await import('../plugin/src/themes.mjs')
  for (const icons of Object.values(THEMES))
    for (const icon of Object.values(icons))
      assert.ok(readme.includes(icon), `README is missing ${icon}`)
  const variables = new Set()
  for (const name of await readdir(join(root, 'plugin/src')))
    for (const [variable] of (await readFile(join(root, 'plugin/src', name), 'utf8')).matchAll(
      /REX_TAB_STATUS(_[A-Z]+)?/g,
    ))
      if (variable !== 'REX_TAB_STATUS_STATE') variables.add(variable)
  for (const variable of variables)
    assert.match(readme, new RegExp(`${variable}(?![A-Z_])`), `README is missing ${variable}`)
})
