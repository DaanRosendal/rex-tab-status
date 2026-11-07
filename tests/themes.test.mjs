import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CodexTabs } from '../codex/hooks/codex.mjs'
import { paintTab, resolveTheme, THEMES } from '../codex/hooks/rex.ts'

const SESSION = 'session:s1'
const BLOCK = 'block:b1'
const WINDOW = 'window:w1'
const STATES = ['idle', 'working', 'blocked', 'done', 'error']

function fakeRex(label = 'Window 0000beef') {
  const tab = { label }
  const run = async args => {
    const [noun, verb] = args
    if (noun === 'window' && verb === 'ls') {
      return JSON.stringify({
        windows: [
          { window_id: WINDOW, label: tab.label, layers: [{ blocks: [{ block_id: BLOCK }] }] },
        ],
      })
    }
    if (noun === 'window' && verb === 'rename') {
      tab.label = args.at(-1) || 'Window 0000beef'
      return ''
    }
    if (noun === 'block' && verb === 'call') return JSON.stringify({ title: 'Fix login redirect' })
    if (noun === 'session' && verb === 'inspect') return JSON.stringify({ label: 'project' })
    return undefined
  }
  return { tab, run }
}

test('default theme keeps the original emoji', () => {
  assert.deepEqual(
    STATES.map(state => THEMES.default[state]),
    ['💤', '⏳', '❓', '✅', '❌'],
  )
})

test('every theme defines all five states, none empty', () => {
  for (const [name, icons] of Object.entries(THEMES)) {
    assert.equal(icons.ready, '', name)
    for (const state of STATES) assert.ok(icons[state].length > 0, `${name}.${state}`)
  }
})

test('no icon collides with another icon in the same or another theme', () => {
  const all = Object.entries(THEMES).flatMap(([theme, icons]) =>
    STATES.map(state => ({ id: `${theme}.${state}`, icon: icons[state] })),
  )
  for (const a of all) {
    for (const b of all) {
      if (a.id === b.id) continue
      if (a.icon === b.icon) assert.fail(`${a.id} and ${b.id} share ${a.icon}`)
      assert.ok(
        !b.icon.startsWith(a.icon),
        `${a.id} (${a.icon}) is a prefix of ${b.id} (${b.icon})`,
      )
    }
  }
})

test('resolveTheme picks a theme by name, ignoring case and spaces', () => {
  assert.equal(resolveTheme('ascii'), THEMES.ascii)
  assert.equal(resolveTheme('  Circles '), THEMES.circles)
  assert.equal(resolveTheme('MINIMAL'), THEMES.minimal)
})

test('resolveTheme falls back to default for missing or unknown names', () => {
  for (const name of [undefined, '', '   ', 'nope', 'constructor', '__proto__', 'toString']) {
    assert.equal(resolveTheme(name), THEMES.default, String(name))
  }
})

for (const [name, icons] of Object.entries(THEMES)) {
  for (const state of STATES) {
    test(`paintTab ${name}/${state} writes "${icons[state]} <title>"`, async () => {
      const { tab, run } = fakeRex()
      await paintTab(run, { session: SESSION, block: BLOCK, status: state, icons })
      assert.equal(tab.label, `${icons[state]} Fix login redirect`)
    })
  }
}

test('paintTab without icons uses the default theme', async () => {
  const { tab, run } = fakeRex()
  await paintTab(run, { session: SESSION, block: BLOCK, status: 'done' })
  assert.equal(tab.label, '✅ Fix login redirect')
})

test('switching themes replaces the old prefix instead of stacking', async () => {
  for (const from of Object.keys(THEMES)) {
    for (const to of Object.keys(THEMES)) {
      const { tab, run } = fakeRex()
      const first = await paintTab(run, {
        session: SESSION,
        block: BLOCK,
        status: 'working',
        icons: THEMES[from],
      })
      await paintTab(run, {
        session: SESSION,
        block: BLOCK,
        status: 'done',
        icons: THEMES[to],
        ownName: first.ownName,
      })
      assert.equal(tab.label, `${THEMES[to].done} Fix login redirect`, `${from} -> ${to}`)
    }
  }
})

test('ending strips the prefix of any theme and restores the automatic name', async () => {
  for (const [name, icons] of Object.entries(THEMES)) {
    const { tab, run } = fakeRex()
    const painted = await paintTab(run, { session: SESSION, block: BLOCK, status: 'done', icons })
    await paintTab(run, {
      session: SESSION,
      block: BLOCK,
      status: 'idle',
      icons: THEMES.default,
      ownName: painted.ownName,
      isEnding: true,
    })
    assert.equal(tab.label, 'Window 0000beef', name)
  }
})

test('a hand-named tab keeps its name when any theme ends', async () => {
  for (const [name, icons] of Object.entries(THEMES)) {
    const { tab, run } = fakeRex(`${icons.working} deploy`)
    await paintTab(run, {
      session: SESSION,
      block: BLOCK,
      status: 'idle',
      icons: THEMES.default,
      isEnding: true,
    })
    assert.equal(tab.label, 'deploy', name)
  }
})

test('names that merely start like an icon without the trailing space are untouched', async () => {
  for (const label of ['[ok]deploy', '[okay] build', 'x86 build', '✓deploy', 'okay']) {
    const { tab, run } = fakeRex(label)
    await paintTab(run, { session: SESSION, block: BLOCK, status: 'working', icons: THEMES.ascii })
    assert.equal(tab.label, `[..] ${label}`, label)
  }
})

test('CodexTabs paints with the theme it was given and defaults to emoji', async () => {
  for (const [name, icons] of [['default', undefined], ...Object.entries(THEMES)]) {
    const { tab, run } = fakeRex()
    const tabs = new CodexTabs(run, icons)
    const windows = JSON.parse(await run(['window', 'ls', '-s', SESSION, '--json'])).windows
    const result = await paintTab(run, {
      session: SESSION,
      block: BLOCK,
      status: 'working',
      icons: tabs.icons,
      windows,
    })
    assert.equal(result.label, `${(icons ?? THEMES.default).working} Fix login redirect`, name)
    assert.equal(tab.label, result.label)
  }
})
