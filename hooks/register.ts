import type { EngineInterface, Register } from 'claude-code'
import { paintTab } from '../codex/hooks/paint.ts'
import { resolveTheme, type Status } from '../codex/hooks/themes.ts'
import { IdleDelay } from '../codex/hooks/idle.mjs'

let status: Status = 'idle'
let isMainTurnRunning = false
const runningAgentTurns = new Set<string>()
const pendingAsks = new Set<string>()
let painting: Promise<void> = Promise.resolve()
let idle: IdleDelay | undefined
// A `claude -p` run inside a Rex pane inherits its variables and must leave that tab alone.
let isInteractive = false

function reset() {
  idle?.cancel()
  idle = undefined
  status = 'idle'
  isMainTurnRunning = false
  runningAgentTurns.clear()
  pendingAsks.clear()
}

function shown(): Status {
  return pendingAsks.size > 0 ? 'blocked' : status
}

async function rex($: EngineInterface, args: string[]): Promise<string | undefined> {
  try {
    const ran = await $.process.run(['rex', ...args], { timeoutMs: 3000 })
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
  const current = shown()
  if (isEnding || current !== 'idle') {
    idle?.cancel()
    idle = undefined
  } else {
    idle ??= new IdleDelay(
      () => paint($),
      (ms, callback) => $.clock.after(ms, callback),
    )
  }
  const displayed = idle ? idle.update(current) : current
  painting = painting.then(() => repaint($, isEnding, displayed)).catch(() => {})
  return painting
}

type CallRow = { tool_use_id?: string; isRunning: boolean; output?: unknown }

async function settleAsks($: EngineInterface, rows: readonly CallRow[]) {
  let isSettled = false
  for (const row of rows) {
    const isPastDialog = row.isRunning || row.output !== undefined
    if (isPastDialog && row.tool_use_id && pendingAsks.delete(row.tool_use_id)) isSettled = true
  }
  if (isSettled) await paint($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    isInteractive = e.isInteractive
    reset()
    await paint($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) isMainTurnRunning = true
    else runningAgentTurns.add(e.turnId)
    status = 'working'
    await paint($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      isMainTurnRunning = false
      pendingAsks.clear()
      status =
        e.reason === 'error' || e.reason === 'refusal' ? 'error' : e.isAborted ? 'idle' : 'done'
    } else {
      runningAgentTurns.delete(e.turnId)
      if (!isMainTurnRunning && status === 'working') status = 'done'
    }
    if (isMainTurnRunning || runningAgentTurns.size > 0) status = 'working'
    await paint($)
    return next(e)
  })

  // An ask reaches a person only when the mode's decider puts up a dialog.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask' && e.approver === 'person' && e.tool_use_id) {
      pendingAsks.add(e.tool_use_id)
      await paint($)
    }
    return verdict
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'AskUserQuestion' || e.tool === 'ExitPlanMode') {
      pendingAsks.add(e.tool_use_id)
      await paint($)
    }
    const ran = await next(e)
    if (pendingAsks.delete(e.tool_use_id)) await paint($)
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
      reset()
      await paint($)
    } else {
      await paint($, true)
    }
    return next(e)
  })
}
