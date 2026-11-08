import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ASK_GRACE_MS, IDLE_DELAY_MS, initialState, step, Timers } from '../shared/core.ts'

// Replays events and returns the status shown after each one, plus the final result.
function run(...events) {
  let result = { state: initialState, shown: 'ready', timers: {} }
  const shown = []
  for (const event of events) {
    result = step(result.state, event)
    shown.push(result.shown)
  }
  return { ...result, sequence: shown }
}

const main = (turnId = 't1') => ({ turnId, isSubagent: false })
const sub = turnId => ({ turnId, isSubagent: true })
const start = turn => ({ type: 'turnStarted', ...turn })
const end = (turn, outcome = 'done') => ({ type: 'turnEnded', ...turn, outcome })
const ask = (id, isImmediate = false) => ({ type: 'askOpened', id, isImmediate })
const closed = id => ({ type: 'askClosed', id })
const timer = key => ({ type: 'timer', key })

test('a new session shows nothing and arms the idle timer', () => {
  const result = run({ type: 'reset' })
  assert.equal(result.shown, 'ready')
  assert.deepEqual(result.timers, { idle: IDLE_DELAY_MS })
})

test('the idle timer turns the blank tab into sleeping, and work wakes it', () => {
  const result = run({ type: 'reset' }, timer('idle'), start(main()))
  assert.deepEqual(result.sequence, ['ready', 'idle', 'working'])
  assert.deepEqual(result.timers, {})
})

test('a text-only answer goes working then done and stays done', () => {
  const result = run(start(main()), end(main()))
  assert.deepEqual(result.sequence, ['working', 'done'])
  assert.deepEqual(result.timers, {})
})

test('an interrupted turn goes blank and starts a fresh idle wait', () => {
  const result = run(start(main()), end(main(), 'aborted'))
  assert.deepEqual(result.sequence, ['working', 'ready'])
  assert.deepEqual(result.timers, { idle: IDLE_DELAY_MS })
})

test('an error shows until the next turn', () => {
  const result = run(start(main()), end(main(), 'error'), start(main('t2')))
  assert.deepEqual(result.sequence, ['working', 'error', 'working'])
})

test('the tab stays working until the last subagent finishes', () => {
  const result = run(start(main()), start(sub('a1')), end(main()), end(sub('a1')))
  assert.deepEqual(result.sequence, ['working', 'working', 'working', 'done'])
})

test('a subagent that runs after the main turn ends leaves it done', () => {
  const result = run(start(main()), end(main()), start(sub('a1')), end(sub('a1')))
  assert.deepEqual(result.sequence, ['working', 'done', 'working', 'done'])
})

test('a subagent starting twice is counted once', () => {
  const result = run(start(main()), start(sub('a1')), start(sub('a1')), end(sub('a1')), end(main()))
  assert.equal(result.shown, 'done')
})

test('an ask waits out the grace period before it shows', () => {
  const result = run(start(main()), ask('u1'))
  assert.equal(result.shown, 'working')
  assert.deepEqual(result.timers, { 'ask:u1': ASK_GRACE_MS })
  assert.equal(step(result.state, timer('ask:u1')).shown, 'blocked')
})

test('an ask answered within the grace period never shows', () => {
  const result = run(start(main()), ask('u1'), closed('u1'), timer('ask:u1'))
  assert.deepEqual(result.sequence, ['working', 'working', 'working', 'working'])
  assert.deepEqual(result.timers, {})
})

test('an ask that earned the question mark clears when answered', () => {
  const result = run(start(main()), ask('u1'), timer('ask:u1'), closed('u1'))
  assert.deepEqual(result.sequence, ['working', 'working', 'blocked', 'working'])
})

test('an immediate ask shows at once and is not downgraded by a later check', () => {
  const result = run(start(main()), ask('u1', true), ask('u1'))
  assert.deepEqual(result.sequence, ['working', 'blocked', 'blocked'])
  assert.deepEqual(result.timers, {})
})

test('a repeated check keeps the first ask and its timer', () => {
  const first = run(start(main()), ask('u1'))
  const again = step(first.state, ask('u1'))
  assert.deepEqual(again.state, first.state)
})

test('the end of a turn drops every open ask', () => {
  const result = run(start(main()), ask('u1', true), ask('u2'), end(main()))
  assert.equal(result.shown, 'done')
  assert.deepEqual(result.state.asks, {})
})

test('a timer for an ask that is gone does nothing', () => {
  const result = run(start(main()), timer('ask:missing'))
  assert.equal(result.shown, 'working')
})

test('a reset forgets turns, asks and the idle wait', () => {
  const result = run(start(main()), ask('u1', true), end(main(), 'error'), { type: 'reset' })
  assert.equal(result.shown, 'ready')
  assert.deepEqual(result.state, initialState)
})

test('an observed done stays visible through the idle wait, then sleeps', () => {
  const observedDone = { type: 'observed', status: 'done' }
  const observedIdle = { type: 'observed', status: 'idle' }
  const waiting = run(observedDone, observedIdle)
  assert.deepEqual(waiting.sequence, ['done', 'done'])
  assert.deepEqual(waiting.timers, { idle: IDLE_DELAY_MS })
  assert.equal(step(waiting.state, timer('idle')).shown, 'idle')
})

test('an observed blocked shows without a grace period', () => {
  const result = run({ type: 'observed', status: 'blocked' })
  assert.equal(result.shown, 'blocked')
  assert.deepEqual(result.timers, {})
})

test('Timers starts new timers, keeps running ones and cancels dropped ones', () => {
  const timers = new Timers()
  const started = []
  const cancelled = []
  const start = (key, ms) => {
    started.push([key, ms])
    return { cancel: () => cancelled.push(key) }
  }

  timers.sync({ idle: 10, 'ask:a': 5 }, start)
  timers.sync({ idle: 10 }, start)
  assert.deepEqual(started, [
    ['idle', 10],
    ['ask:a', 5],
  ])
  assert.deepEqual(cancelled, ['ask:a'])

  timers.fired('idle')
  timers.sync({ idle: 10 }, start)
  assert.equal(started.length, 3)

  timers.cancelAll()
  assert.deepEqual(cancelled, ['ask:a', 'idle'])
})
