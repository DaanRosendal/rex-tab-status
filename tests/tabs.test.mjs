import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SLEEP_MS } from '../plugin/src/status.mjs'
import { Tabs } from '../plugin/src/tabs.mjs'
import {
  BLOCK,
  DEFAULT_LABEL,
  SESSION,
  TERMINAL,
  WINDOW,
  createFakeRex,
  record,
} from './helpers/fake-rex.mjs'

function setup(options) {
  const rex = createFakeRex(options)
  const clock = { now: Date.now(), timers: [] }
  const tabs = new Tabs({
    run: rex.run,
    now: () => clock.now,
    setTimer: (fn, ms) => {
      const timer = { ms, cancelled: false, unref() {} }
      timer.fn = () => {
        timer.cancelled = true
        fn()
      }
      clock.timers.push(timer)
      return timer
    },
    clearTimer: timer => {
      timer.cancelled = true
    },
  })
  const pending = () => clock.timers.filter(t => !t.cancelled)
  return { rex, tabs, clock, pending }
}

const setRecords = (rex, ...records) => {
  rex.blocks.get(BLOCK).records = records
}
const blockEvent = (name, payload = {}) => ({
  type: 'session_event',
  payload: {
    session_id: SESSION,
    event: {
      type: 'block_event',
      payload: { block_id: BLOCK, creator_name: TERMINAL, name, payload },
    },
  },
})
const sessionEvent = (type, payload) => ({
  type: 'session_event',
  payload: { session_id: SESSION, event: { type, payload } },
})

test('a working agent labels an unnamed tab with its title', async () => {
  const { rex, tabs } = setup({ records: [record('working')] })
  await tabs.refresh(SESSION)
  assert.equal(rex.tab.label, '⏳ Fix login redirect | project')
})

test('each state shows its icon as the agent moves through a turn', async () => {
  const { rex, tabs } = setup({ records: [record('idle')] })
  const labels = []
  for (const records of [
    [record('idle')],
    [record('working')],
    [record('blocked', { kind: 'permission' })],
    [record('working')],
    [record('done')],
    [record('error')],
    [record('blocked', { kind: 'auth' })],
  ]) {
    setRecords(rex, ...records)
    await tabs.refresh(SESSION)
    labels.push(rex.tab.label.split(' ')[0])
  }
  assert.deepEqual(labels, ['Fix', '⏳', '❓', '⏳', '✅', '❌', '❌'])
})

test('a blocked permission ask shows even while a subagent keeps working', async () => {
  const { rex, tabs } = setup({
    records: [record('blocked', { kind: 'permission' }), record('working', { id: 'a1' })],
  })
  await tabs.refresh(SESSION)
  assert.match(rex.tab.label, /^❓ /)
})

test('a tab you renamed keeps its name', async () => {
  const { rex, tabs } = setup({ label: 'My tab', records: [record('working')] })
  await tabs.refresh(SESSION)
  assert.equal(rex.tab.label, '⏳ My tab')
  rex.blocks.get(BLOCK).title = 'Something else'
  setRecords(rex, record('done'))
  await tabs.refresh(SESSION)
  assert.equal(rex.tab.label, '✅ My tab')
})

test('the label follows the title of an unnamed tab', async () => {
  const { rex, tabs } = setup({ records: [record('working')] })
  await tabs.refresh(SESSION)
  rex.blocks.get(BLOCK).title = '⠙ Review MR 123'
  await tabs.handle(blockEvent('title_changed', { title: '⠙ Review MR 123' }))
  assert.equal(rex.tab.label, '⏳ Review MR 123')
})

test('a spinner frame alone does not rewrite the label', async () => {
  const { rex, tabs } = setup({ records: [record('working')] })
  await tabs.refresh(SESSION)
  const before = rex.calls.length
  await tabs.handle(blockEvent('title_changed', { title: '⠸ Fix login redirect | project' }))
  assert.equal(rex.calls.length, before)
})

test('the label returns to the default when the agent is gone', async () => {
  const { rex, tabs } = setup({ records: [record('working')] })
  await tabs.refresh(SESSION)
  setRecords(rex)
  await tabs.handle(blockEvent('program_status_removed'))
  assert.equal(rex.tab.label, DEFAULT_LABEL)
})

test('a renamed tab gets its own name back when the agent is gone', async () => {
  const { rex, tabs } = setup({ label: 'My tab', records: [record('working')] })
  await tabs.refresh(SESSION)
  setRecords(rex)
  await tabs.refresh(SESSION)
  assert.equal(rex.tab.label, 'My tab')
})

test('a finished record whose process exited is not an agent', async () => {
  const { rex, tabs } = setup({ label: '✅ notes', records: [record('done')] })
  rex.blocks.get(BLOCK).proc = { foreground: undefined }
  await tabs.refresh(SESSION)
  assert.equal(rex.tab.label, 'notes')
})

test('programs that are not allowed agents leave the tab alone', async () => {
  const { rex, tabs } = setup({ records: [record('working', { app: 'brew' })] })
  await tabs.refresh(SESSION)
  assert.equal(rex.renames().length, 0)
})

test('a leftover prefix is cleaned on startup', async () => {
  const { rex, tabs } = setup({ label: '⏳ notes' })
  await tabs.refresh(SESSION)
  assert.equal(rex.tab.label, 'notes')
})

test('our own label write is not treated as a rename', async () => {
  const { rex, tabs } = setup({ records: [record('working')] })
  await tabs.refresh(SESSION)
  const before = rex.calls.length
  await tabs.handle(
    sessionEvent('window_label_changed', { window_id: WINDOW, label: rex.tab.label }),
  )
  assert.equal(rex.calls.length, before)
})

test('a rename by the person is picked up and kept', async () => {
  const { rex, tabs } = setup({ records: [record('working')] })
  await tabs.refresh(SESSION)
  rex.tab.label = 'Release notes'
  await tabs.handle(
    sessionEvent('window_label_changed', { window_id: WINDOW, label: 'Release notes' }),
  )
  assert.equal(rex.tab.label, '⏳ Release notes')
})

test('a finished agent falls asleep five minutes after it came to rest', async () => {
  const { rex, tabs, clock, pending } = setup({ records: [record('done')] })
  await tabs.refresh(SESSION)
  assert.match(rex.tab.label, /^✅ /)
  const [timer] = pending()
  assert.ok(timer.ms > SLEEP_MS - 5000 && timer.ms <= SLEEP_MS)
  clock.now += SLEEP_MS
  timer.fn()
  await tabs.painting
  assert.match(rex.tab.label, /^💤 /)
  assert.equal(pending().length, 0)
})

test('new work cancels the sleep timer', async () => {
  const { rex, tabs, pending } = setup({ records: [record('done')] })
  await tabs.refresh(SESSION)
  assert.equal(pending().length, 1)
  setRecords(rex, record('working'))
  await tabs.refresh(SESSION)
  assert.equal(pending().length, 0)
  assert.match(rex.tab.label, /^⏳ /)
})

test('an agent that finished long ago is shown asleep at once', async () => {
  const old = new Date(Date.now() - 2 * SLEEP_MS).toISOString()
  const { rex, tabs, pending } = setup({ records: [record('done', { updated_at: old })] })
  await tabs.refresh(SESSION)
  assert.match(rex.tab.label, /^💤 /)
  assert.equal(pending().length, 0)
})

test('a failed rename is retried by the next event and leaves state untouched', async () => {
  const { rex, tabs } = setup({ records: [record('working')] })
  const run = rex.run
  let failing = true
  tabs.run = async args => (failing && args[1] === 'rename' ? undefined : run(args))
  await tabs.refresh(SESSION)
  assert.equal(rex.tab.label, DEFAULT_LABEL)
  failing = false
  await tabs.refresh(SESSION)
  assert.match(rex.tab.label, /^⏳ /)
})

test('an unreadable status leaves the tab alone', async () => {
  const { rex, tabs } = setup({ label: '⏳ keep', records: [] })
  const run = rex.run
  tabs.run = async args => (args.at(-1) === 'program_status' ? undefined : run(args))
  await tabs.refresh(SESSION)
  assert.equal(rex.tab.label, '⏳ keep')
})

test('closing the window or destroying the session drops its state', async () => {
  const { tabs, pending, rex } = setup({ records: [record('done')] })
  await tabs.refresh(SESSION)
  assert.equal(tabs.owned.size, 1)
  await tabs.handle(sessionEvent('window_closed', { window_id: WINDOW }))
  assert.equal(tabs.owned.size, 0)
  assert.equal(pending().length, 0)
  await tabs.refresh(SESSION)
  assert.equal(tabs.owned.size, 1)
  await tabs.handle({ type: 'session_destroyed', payload: { session_id: SESSION } })
  assert.equal(tabs.owned.size, 0)
  assert.equal(rex.tab.label.startsWith('✅'), true)
})

test('events from other blocks and unknown events are ignored', async () => {
  const { rex, tabs } = setup({ records: [record('working')] })
  await tabs.handle(null)
  await tabs.handle({ type: 'session_event' })
  await tabs.handle({ ...blockEvent('bell'), type: 'session_event' })
  await tabs.handle({
    type: 'session_event',
    payload: {
      session_id: SESSION,
      event: {
        type: 'block_event',
        payload: { block_id: BLOCK, creator_name: 'other', name: 'program_status_changed' },
      },
    },
  })
  assert.equal(rex.calls.length, 0)
})

test('status events repaint the window', async () => {
  const { rex, tabs } = setup({ records: [record('working')] })
  await tabs.handle(blockEvent('program_status_changed', { record: { state: 'working' } }))
  assert.match(rex.tab.label, /^⏳ /)
})

test('stopping restores every label and cancels timers', async () => {
  const { rex, tabs, pending } = setup({ records: [record('done')] })
  await tabs.refresh(SESSION)
  assert.match(rex.tab.label, /^✅ /)
  await tabs.restore()
  assert.equal(rex.tab.label, DEFAULT_LABEL)
  assert.equal(pending().length, 0)
})

test('stopping gives a renamed tab its plain name back', async () => {
  const { rex, tabs } = setup({ label: 'My tab', records: [record('working')] })
  await tabs.refresh(SESSION)
  await tabs.restore()
  assert.equal(rex.tab.label, 'My tab')
})
