import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const SESSION = 'session:s1'
const BLOCK = 'block:b1'
const WINDOW = 'window:w1'

type FakeRex = { label: string; title: string; activeWindow: string }

function fakeRex(on: On, initialLabel = 'Window 0000beef', env: Record<string, string> = { REX_SESSION: SESSION, REX_BLOCK: BLOCK }): FakeRex {
  const rex: FakeRex = { label: initialLabel, title: 'Fix login redirect', activeWindow: WINDOW }
  const ok = (stdout: string) => ({
    value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  })

  on('process.run', (_, e) => {
    const [bin, noun, verb, ...rest] = e.argv
    if (bin !== 'rex') return ok('')
    if (noun === 'window' && verb === 'ls') {
      return ok(
        JSON.stringify({
          windows: [{ window_id: WINDOW, label: rex.label, layers: [{ blocks: [{ block_id: BLOCK }] }] }],
        }),
      )
    }
    if (noun === 'block' && verb === 'call') return ok(JSON.stringify({ title: rex.title }))
    if (noun === 'session' && verb === 'inspect') return ok(JSON.stringify({ label: 'silent-glade', active_window_id: rex.activeWindow }))
    if (noun === 'window' && verb === 'rename') {
      const label = rest[rest.length - 1] ?? ''
      rex.label = label === '' ? 'Window 0000beef' : label
      return ok('')
    }
    return ok('')
  })
  mock.env(on, env)
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  return rex
}

const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const
const END = { sessionId: 's', resume: {} as never }
const done = (turnId: string, agentId?: string) =>
  ({ turnId, agentId, answer: '', durationMs: 1, isAborted: false, reason: 'answer' }) as const

test('a text-only answer goes idle, working, done', async ($, on) => {
  const rex = fakeRex(on)

  await $.session.start(START)
  expect(rex.label).toBe('💤 Fix login redirect')

  await $.turn.start({ text: 'why?', turnId: 't1' })
  expect(rex.label).toBe('⏳ Fix login redirect')

  await $.turn.complete(done('t1'))
  expect(rex.label).toBe('✅ Fix login redirect')
})

test('the tab stays working until the last subagent finishes', async ($, on) => {
  const rex = fakeRex(on)

  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.start({ text: 'sub', turnId: 'a1-t', agentId: 'a1' })
  await $.turn.complete(done('t1'))
  expect(rex.label).toBe('⏳ Fix login redirect')

  await $.turn.complete(done('a1-t', 'a1'))
  expect(rex.label).toBe('✅ Fix login redirect')
})

test('an interrupt and an error each show', async ($, on) => {
  const rex = fakeRex(on)

  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete({ ...done('t1'), isAborted: true, reason: 'aborted' })
  expect(rex.label).toBe('💤 Fix login redirect')

  await $.turn.start({ text: 'again', turnId: 't2' })
  await $.turn.complete({ ...done('t2'), reason: 'error' })
  expect(rex.label).toBe('❌ Fix login redirect')
})

test('a question to the person shows while it is open', async ($, on) => {
  const rex = fakeRex(on)
  rex.activeWindow = 'window:other'
  let labelDuringQuestion = ''
  on('tool.call', () => {
    labelDuringQuestion = rex.label
    return { result: {} }
  })

  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)

  expect(labelDuringQuestion).toBe('❓ Fix login redirect')
  expect(rex.label).toBe('⏳ Fix login redirect')
})

test('a name the person gave the tab is kept, and the end hands it back', async ($, on) => {
  const rex = fakeRex(on, 'deploy')

  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't1' })
  expect(rex.label).toBe('⏳ deploy')

  await $.session.end({ ...END, reason: 'prompt_input_exit' })
  expect(rex.label).toBe('deploy')
})

test('an auto-named tab follows the title and returns to the default at the end', async ($, on) => {
  const rex = fakeRex(on)

  await $.session.start(START)
  rex.title = 'Second topic'
  await $.turn.start({ text: 'go', turnId: 't1' })
  expect(rex.label).toBe('⏳ Second topic')

  await $.session.end({ ...END, reason: 'prompt_input_exit' })
  expect(rex.label).toBe('Window 0000beef')
})

test('outside Rex nothing is renamed', async ($, on) => {
  const rex = fakeRex(on, 'Window 0000beef', {})

  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't1' })
  expect(rex.label).toBe('Window 0000beef')
})

test('an answer you have not looked at shows until you switch to the tab', async ($, on) => {
  const rex = fakeRex(on)
  const clock = mock.clock(on)
  rex.activeWindow = 'window:other'

  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete(done('t1'))
  expect(rex.label).toBe('🟢 Fix login redirect')

  await clock.advance(5000)
  expect(rex.label).toBe('🟢 Fix login redirect')

  rex.activeWindow = WINDOW
  await clock.advance(2000)
  expect(rex.label).toBe('✅ Fix login redirect')

  rex.activeWindow = 'window:other'
  await clock.advance(2000)
  expect(rex.label).toBe('✅ Fix login redirect')
})

test('a question keeps asking even on the tab you are looking at', async ($, on) => {
  const rex = fakeRex(on)
  let labelDuringQuestion = ''
  on('tool.call', () => {
    labelDuringQuestion = rex.label
    return { result: {} }
  })

  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)

  expect(labelDuringQuestion).toBe('❓ Fix login redirect')
})

test('a new turn makes the next answer unseen again', async ($, on) => {
  const rex = fakeRex(on)
  mock.clock(on)

  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete(done('t1'))
  expect(rex.label).toBe('✅ Fix login redirect')

  rex.activeWindow = 'window:other'
  await $.turn.start({ text: 'more', turnId: 't2' })
  await $.turn.complete(done('t2'))
  expect(rex.label).toBe('🟢 Fix login redirect')
})
