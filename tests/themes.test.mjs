import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ICON_PREFIX, THEMES, resolveTheme, stripIcons } from '../plugin/src/themes.mjs'

test('a theme name picks its icons and anything else falls back to default', () => {
  assert.equal(resolveTheme('ASCII ').working, '[..]')
  assert.equal(resolveTheme('circles').error, '⛔')
  assert.equal(resolveTheme('nope'), THEMES.default)
  assert.equal(resolveTheme(undefined), THEMES.default)
  assert.equal(resolveTheme(''), THEMES.default)
})

test('every theme defines the same states', () => {
  const states = Object.keys(THEMES.default).sort()
  for (const icons of Object.values(THEMES)) assert.deepEqual(Object.keys(icons).sort(), states)
})

test('icons from every theme are stripped, with or without a name', () => {
  for (const icons of Object.values(THEMES))
    for (const icon of Object.values(icons)) {
      assert.equal(stripIcons(`${icon} notes`), 'notes')
      assert.equal(stripIcons(icon), '')
    }
})

test('a doubled prefix heals and a name that merely starts with an icon character stays', () => {
  assert.equal(stripIcons('⏳ ✅ notes'), 'notes')
  assert.equal(stripIcons('✅notes'), '✅notes')
  assert.equal(stripIcons('notes ⏳'), 'notes ⏳')
  assert.equal(ICON_PREFIX.test('[zz] x'), true)
})
