import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanTitle, decideLabel, isDefault, isEcho } from '../plugin/src/label.mjs'

const DEFAULT = 'Window 0000beef'
const base = { hasAgent: true, icon: '⏳', title: 'Fix login' }

test('titles lose spinners, control characters and old icons, and are capped', () => {
  assert.equal(cleanTitle('⠹ Fix login'), 'Fix login')
  assert.equal(cleanTitle('✳ Claude Code'), 'Claude Code')
  assert.equal(cleanTitle('Fix\u0007 login'), 'Fix login')
  assert.equal(cleanTitle('✅ done already'), 'done already')
  assert.equal(cleanTitle('x'.repeat(100)).length, 60)
  assert.equal(cleanTitle(undefined), '')
})

test('Rex default labels are recognised', () => {
  assert.equal(isDefault(DEFAULT), true)
  assert.equal(isDefault(''), true)
  assert.equal(isDefault('Window notes'), false)
})

test('a default-named tab takes the title as its name', () => {
  const { own, write } = decideLabel({ ...base, actual: DEFAULT })
  assert.equal(write, '⏳ Fix login')
  assert.deepEqual([own.mode, own.base, own.written], ['auto', 'Fix login', '⏳ Fix login'])
})

test('a renamed tab keeps its name and only the icon changes', () => {
  const first = decideLabel({ ...base, actual: 'My tab' })
  assert.equal(first.write, '⏳ My tab')
  assert.equal(first.own.mode, 'manual')
  const next = decideLabel({
    ...base,
    icon: '✅',
    actual: '⏳ My tab',
    own: first.own,
    title: 'Other',
  })
  assert.equal(next.write, '✅ My tab')
})

test('an auto-named tab follows the title as it changes', () => {
  const first = decideLabel({ ...base, actual: DEFAULT })
  const next = decideLabel({ ...base, actual: first.write, own: first.own, title: 'Review MR' })
  assert.equal(next.write, '⏳ Review MR')
  assert.equal(next.own.mode, 'auto')
})

test('a rename during a run switches the tab to manual', () => {
  const first = decideLabel({ ...base, actual: DEFAULT })
  const renamed = decideLabel({
    ...base,
    actual: 'Release notes',
    own: first.own,
    title: 'Fix login',
  })
  assert.equal(renamed.own.mode, 'manual')
  assert.equal(renamed.write, '⏳ Release notes')
})

test('a rename that keeps an icon is stripped and kept as the name', () => {
  const first = decideLabel({ ...base, actual: DEFAULT })
  const edited = decideLabel({ ...base, actual: '⏳ My own', own: first.own })
  assert.equal(edited.own.mode, 'manual')
  assert.equal(edited.write, undefined)
  assert.equal(edited.own.base, 'My own')
})

test('resetting a tab to the default hands the name back to the title', () => {
  const first = decideLabel({ ...base, actual: 'My tab' })
  const reset = decideLabel({ ...base, actual: DEFAULT, own: first.own })
  assert.equal(reset.own.mode, 'auto')
  assert.equal(reset.write, '⏳ Fix login')
})

test('a state without an icon writes only the name, and nothing when it is already right', () => {
  const first = decideLabel({ ...base, icon: '', actual: DEFAULT })
  assert.equal(first.write, 'Fix login')
  const same = decideLabel({ ...base, icon: '', actual: 'Fix login', own: first.own })
  assert.equal(same.write, undefined)
})

test('a tab with nothing to show is left alone', () => {
  assert.deepEqual(decideLabel({ ...base, icon: '', title: '', actual: DEFAULT }), {
    own: { mode: 'auto', base: DEFAULT, written: DEFAULT, recent: [DEFAULT] },
    write: undefined,
  })
})

test('an icon with no name is stored without a trailing space', () => {
  const { write } = decideLabel({ hasAgent: true, icon: '⏳', actual: '', title: '' })
  assert.equal(write, '⏳')
})

test('echoes of our own writes are recognised, including a late older one', () => {
  let own = decideLabel({ ...base, actual: DEFAULT }).own
  const second = decideLabel({ ...base, icon: '✅', actual: own.written, own })
  own = second.own
  assert.equal(isEcho(own, '✅ Fix login'), true)
  assert.equal(isEcho(own, '⏳ Fix login'), true)
  assert.equal(isEcho(own, 'Something else'), false)
  assert.equal(isEcho(undefined, 'x'), false)
})

test('when the agent leaves, an auto-named tab returns to the default and a manual one to its name', () => {
  const auto = decideLabel({ ...base, actual: DEFAULT })
  const gone = decideLabel({ hasAgent: false, actual: auto.write, own: auto.own })
  assert.deepEqual(gone, { own: undefined, write: '' })
  const manual = decideLabel({ ...base, actual: 'My tab' })
  assert.deepEqual(decideLabel({ hasAgent: false, actual: manual.write, own: manual.own }), {
    own: undefined,
    write: 'My tab',
  })
})

test('a leftover prefix with no agent is cleaned and a plain tab is untouched', () => {
  assert.deepEqual(decideLabel({ hasAgent: false, actual: '⏳ notes' }), {
    own: undefined,
    write: 'notes',
  })
  assert.deepEqual(decideLabel({ hasAgent: false, actual: '✅' }), { own: undefined, write: '' })
  assert.deepEqual(decideLabel({ hasAgent: false, actual: 'notes' }), { own: undefined })
  assert.deepEqual(decideLabel({ hasAgent: false, actual: DEFAULT }), { own: undefined })
})

test('after a watcher restart a tab already showing the current title counts as auto-named', () => {
  const { own, write } = decideLabel({ ...base, icon: '✅', actual: '⏳ Fix login' })
  assert.equal(own.mode, 'auto')
  assert.equal(write, '✅ Fix login')
})
