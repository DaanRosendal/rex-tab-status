import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SLEEP_MS, pickTitleSource, reduceBlock, reduceWindow } from '../plugin/src/status.mjs'

const owner = { pid: 10, name: 'claude' }
const proc = { foreground: { pid: 10 }, ancestors: [{ pid: 5 }] }
const rec = (state, extra = {}) => ({ state, app: 'claude-code', owner, ...extra })
const shown = (records, options = { proc }) => reduceBlock(records, options).state

test('each native state maps to what is shown', () => {
  assert.equal(shown([rec('idle')]), 'idle')
  assert.equal(shown([rec('working')]), 'working')
  assert.equal(shown([rec('done')]), 'done')
  assert.equal(shown([rec('error')]), 'error')
  assert.equal(shown([rec('blocked', { kind: 'permission' })]), 'blocked')
  assert.equal(shown([rec('blocked', { kind: 'question' })]), 'blocked')
  assert.equal(shown([rec('blocked', { kind: 'auth' })]), 'auth')
  assert.equal(shown([rec('blocked')]), 'blocked')
  assert.equal(shown([rec('blocked', { kind: 'future-kind' })]), 'blocked')
  assert.equal(shown([]), 'none')
})

test('an unknown state is ignored and does not count as an agent', () => {
  const reduced = reduceBlock([rec('hibernating')], { proc })
  assert.deepEqual(reduced, { state: 'none', hasAgent: false, restAt: undefined })
})

test('a blocked root beats a working subagent, as in the live permission ask', () => {
  const records = [
    rec('blocked', { kind: 'permission' }),
    rec('working', { id: 'a447', title: 'Touch sub-a.txt' }),
  ]
  assert.equal(shown(records), 'blocked')
})

test('the order of records does not matter', () => {
  const records = [rec('working', { id: 'a447' }), rec('blocked', { kind: 'permission' })]
  assert.equal(shown(records), 'blocked')
})

test('a working subagent keeps a finished root working', () => {
  assert.equal(shown([rec('done'), rec('working', { id: 'a1' })]), 'working')
  assert.equal(shown([rec('idle'), rec('working', { id: 'a1' })]), 'working')
})

test('finished states of subagents are stale and ignored', () => {
  assert.equal(
    shown([rec('working'), rec('done', { id: 'a1' }), rec('error', { id: 'a2' })]),
    'working',
  )
  assert.equal(shown([rec('idle'), rec('error', { id: 'a2' })]), 'idle')
})

test('auth and error rank below blocked and working', () => {
  assert.equal(shown([rec('blocked', { kind: 'auth' }), rec('working', { id: 'a1' })]), 'auth')
  assert.equal(shown([rec('error'), rec('working', { id: 'a1' })]), 'working')
  assert.equal(shown([rec('blocked', { kind: 'auth' }), rec('blocked', { id: 'a1' })]), 'blocked')
})

test('only allowed apps count', () => {
  assert.equal(shown([rec('working', { app: 'brew' })]), 'none')
  assert.equal(shown([rec('working', { app: 'brew' })], { proc, apps: ['brew'] }), 'working')
  assert.equal(shown([rec('working', { app: 'brew' })], { proc, apps: ['*'] }), 'working')
  assert.equal(shown([rec('done', { app: 'x', effective_app: 'codex' })]), 'done')
})

test('a record whose owner is gone does not count, but a foreground ancestor does', () => {
  assert.equal(shown([rec('done', { owner: { pid: 99 } })]), 'none')
  assert.equal(shown([rec('done', { owner: { pid: 5 } })]), 'done')
  assert.equal(shown([rec('done')], { proc: { foreground: undefined } }), 'none')
  assert.equal(shown([rec('done')], { proc: undefined }), 'done')
})

test('a finished root reports when it came to rest', () => {
  const at = '2026-11-16T21:00:00.000+01:00'
  const reduced = reduceBlock([rec('done', { updated_at: at })], { proc })
  assert.equal(reduced.restAt, Date.parse(at))
  assert.equal(reduceBlock([rec('working', { updated_at: at })], { proc }).restAt, undefined)
})

const block = (state, extra = {}) => ({ id: 'b', state, hasAgent: state !== 'none', ...extra })

test('the latest finished root decides when the agent came to rest, whatever the record order', () => {
  const early = rec('done', { updated_at: '2026-11-16T21:00:00.000Z' })
  const late = rec('error', { updated_at: '2026-11-16T21:30:00.000Z' })
  const expected = Date.parse('2026-11-16T21:30:00.000Z')
  assert.equal(reduceBlock([early, late], { proc }).restAt, expected)
  assert.equal(reduceBlock([late, early], { proc }).restAt, expected)
})

test('a window shows the highest state across its panes', () => {
  const view = reduceWindow([block('done', { restAt: 0 }), block('working')], 1)
  assert.equal(view.state, 'working')
  assert.equal(view.iconKey, 'working')
  assert.equal(
    reduceWindow([block('error', { restAt: 0 }), block('done', { restAt: 0 })], 1).state,
    'error',
  )
  assert.equal(reduceWindow([block('none'), block('idle')], 1).iconKey, undefined)
  assert.equal(reduceWindow([block('none')], 1).hasAgent, false)
})

test('auth and error both show the error icon', () => {
  assert.equal(reduceWindow([block('auth')], 1).iconKey, 'error')
  assert.equal(reduceWindow([block('error', { restAt: 0 })], 1).iconKey, 'error')
})

test('a finished window starts sleeping five minutes after it came to rest', () => {
  const rest = 1_000_000
  const view = reduceWindow([block('done', { restAt: rest })], rest + SLEEP_MS - 1)
  assert.deepEqual([view.iconKey, view.sleeping, view.wakeAt], ['done', false, rest + SLEEP_MS])
  assert.equal(reduceWindow([block('done', { restAt: rest })], rest + SLEEP_MS).iconKey, 'sleeping')
})

test('a sleeping window waits for its latest finished pane', () => {
  const blocks = [block('done', { restAt: 0 }), block('error', { restAt: 100_000 })]
  const view = reduceWindow(blocks, SLEEP_MS)
  assert.equal(view.sleeping, false)
  assert.equal(view.wakeAt, 100_000 + SLEEP_MS)
})

test('active work never sleeps', () => {
  const view = reduceWindow([block('working'), block('done', { restAt: 0 })], 10 * SLEEP_MS)
  assert.equal(view.sleeping, false)
  assert.equal(view.wakeAt, undefined)
})

test('the title comes from the focused agent pane, then the first one', () => {
  const blocks = [
    block('working', { id: 'a' }),
    block('done', { id: 'b' }),
    block('none', { id: 'c', hasAgent: false }),
  ]
  assert.equal(pickTitleSource(blocks, 'b').id, 'b')
  assert.equal(pickTitleSource(blocks, 'c').id, 'a')
  assert.equal(pickTitleSource([block('none', { hasAgent: false })], 'b'), undefined)
})
