import type { EngineInterface, Register } from 'claude-code'
import { paintTab } from './vendor/paint.ts'
import { resolveTheme, type Status } from './vendor/themes.ts'
import { initialState, step, Timers, type CoreEvent, type CoreState } from './vendor/core.ts'

const REX_TIMEOUT_MS = 3000
let state: CoreState = initialState
let shown: Status = 'ready'
const timers = new Timers()
let painting: Promise<void> = Promise.resolve()
// A `claude -p` run inside a Rex pane inherits its variables and must leave that tab alone.
let isInteractive = false

// Each timer's callback keeps the `$` of the hook that started it, which must stay live.
function dispatch($: EngineInterface, event: CoreEvent) {
  const result = step(state, event)
  state = result.state
  shown = result.shown
  if (!isInteractive) {
    timers.cancelAll()
    return
  }
  timers.sync(result.timers, (key, ms) =>
    $.clock.after(ms, async () => {
      timers.fired(key)
      dispatch($, { type: 'timer', key })
      await paint($)
    }),
  )
}

async function rex($: EngineInterface, args: string[]): Promise<string | undefined> {
  try {
    const ran = await $.process.run(['rex', ...args], { timeoutMs: REX_TIMEOUT_MS })
    return ran.exitCode === 0 ? ran.stdout : undefined
  } catch {
    return undefined
  }
}

async function repaint($: EngineInterface, isEnding: boolean, displayed: Status) {
  const session = await $.env.get('REX_SESSION')
  const block = await $.env.get('REX_BLOCK')
  if (!session || !block) return

  const nameKey = `name:${block}`
  const ownName = await $.store.get(nameKey)
  const { ownName: name } = await paintTab(args => rex($, args), {
    session,
    block,
    status: displayed,
    ownName: typeof ownName === 'string' ? ownName : undefined,
    isEnding,
    icons: resolveTheme(await $.env.get('REX_TAB_STATUS_THEME')),
  })
  if (name !== undefined) await $.store.set(nameKey, name)
  else await $.store.delete(nameKey)
}

// Each hook awaits its own repaint so the `$` it hands over is still live.
function paint($: EngineInterface, isEnding = false): Promise<void> {
  if (!isInteractive) return painting
  if (isEnding) timers.cancelAll()
  const displayed = shown
  painting = painting.then(() => repaint($, isEnding, displayed)).catch(() => {})
  return painting
}

type CallRow = { tool_use_id?: string; isRunning: boolean; output?: unknown }

async function settleAsks($: EngineInterface, rows: readonly CallRow[]) {
  let isSettled = false
  for (const row of rows) {
    const isPastDialog = row.isRunning || row.output !== undefined
    if (isPastDialog && row.tool_use_id && Object.hasOwn(state.asks, row.tool_use_id)) {
      dispatch($, { type: 'askClosed', id: row.tool_use_id })
      isSettled = true
    }
  }
  if (isSettled) await paint($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    isInteractive = e.isInteractive
    dispatch($, { type: 'reset' })
    await paint($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    dispatch($, { type: 'turnStarted', turnId: e.turnId, isSubagent: e.agentId !== undefined })
    await paint($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const outcome =
      e.reason === 'error' || e.reason === 'refusal' ? 'error' : e.isAborted ? 'aborted' : 'done'
    dispatch($, {
      type: 'turnEnded',
      turnId: e.turnId,
      isSubagent: e.agentId !== undefined,
      outcome,
    })
    await paint($)
    return next(e)
  })

  // An ask goes to the mode's decider, which may be a dialog or the auto-mode classifier. Only an ask
  // that stays open past the grace wait is shown, so the grace timer does the painting.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask' && e.approver === 'person' && e.tool_use_id)
      dispatch($, { type: 'askOpened', id: e.tool_use_id, isImmediate: false })
    return verdict
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'AskUserQuestion' || e.tool === 'ExitPlanMode') {
      dispatch($, { type: 'askOpened', id: e.tool_use_id, isImmediate: true })
      await paint($)
    }
    const ran = await next(e)
    if (Object.hasOwn(state.asks, e.tool_use_id)) {
      dispatch($, { type: 'askClosed', id: e.tool_use_id })
      await paint($)
    }
    return ran
  })

  // An answered dialog's call redraws as running at once, while `tool.call` resolves only when the tool finishes.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    await settleAsks($, [e.props])
    return next(e)
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    await settleAsks($, e.props.calls)
    return next(e)
  })

  // A /clear ends the conversation but keeps the tab, so it resets instead of restoring the name.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      dispatch($, { type: 'reset' })
      await paint($)
    } else {
      await paint($, true)
    }
    return next(e)
  })
}
