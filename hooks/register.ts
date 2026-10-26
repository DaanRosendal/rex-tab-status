import type { EngineInterface, Register, Timer } from 'claude-code'

type Status = 'idle' | 'working' | 'blocked' | 'done' | 'error'

const EMOJI: Record<Status, string> = {
  idle: '💤',
  working: '⏳',
  blocked: '❓',
  done: '🟢',
  error: '❌',
}
const SEEN_DONE_EMOJI = '✅'
const PREFIX = /^(💤|⏳|❓|🟢|✅|❌) /
const SEEN_POLL_MS = 2000
const REX_DEFAULT_LABEL = /^Window [0-9a-f]+$/
const MAX_NAME = 60

type RexWindow = { window_id: string; label: string; layers: { blocks: { block_id: string }[] }[] }

let status: Status = 'idle'
let isMainTurnRunning = false
const runningAgentTurns = new Set<string>()
const pendingAsks = new Set<string>()
let painting: Promise<void> = Promise.resolve()
let lastShown: Status = 'idle'
let isSeen = false
let windowId: string | undefined
let seenWatch: Timer | undefined

function reset() {
  status = 'idle'
  isMainTurnRunning = false
  runningAgentTurns.clear()
  pendingAsks.clear()
  lastShown = 'idle'
  isSeen = false
  stopSeenWatch()
}

function shown(): Status {
  return pendingAsks.size > 0 ? 'blocked' : status
}

function emoji(state: Status): string {
  return state === 'done' && isSeen ? SEEN_DONE_EMOJI : EMOJI[state]
}

function stopSeenWatch() {
  seenWatch?.cancel()
  seenWatch = undefined
}

function parse(text: string | undefined): any {
  try {
    return text === undefined ? undefined : JSON.parse(text)
  } catch {
    return undefined
  }
}

// Rex rejects control characters and trims labels, so match that up front.
function clean(text: unknown): string {
  return String(text ?? '')
    .slice(0, MAX_NAME)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
}

async function rex($: EngineInterface, args: string[]): Promise<string | undefined> {
  try {
    const ran = await $.process.run(['rex', ...args], { timeoutMs: 3000 })
    return ran.exitCode === 0 ? ran.stdout : undefined
  } catch {
    return undefined
  }
}

async function activeWindowId($: EngineInterface, session: string): Promise<string | undefined> {
  return parse(await rex($, ['session', 'inspect', session, '--json']))?.active_window_id
}

// Rex knows the frontmost tab per session, not whether the app or this session is in front.
async function checkSeen($: EngineInterface) {
  const session = await $.env.get('REX_SESSION')
  if (!session || !windowId || isSeen) return stopSeenWatch()
  if ((await activeWindowId($, session)) !== windowId) return
  isSeen = true
  stopSeenWatch()
  await paint($)
}

async function repaint($: EngineInterface, isEnding: boolean) {
  const session = await $.env.get('REX_SESSION')
  const block = await $.env.get('REX_BLOCK')
  if (!session || !block) return

  const windows: RexWindow[] = parse(await rex($, ['window', 'ls', '-s', session, '--json']))?.windows ?? []
  const win = windows.find(w => w.layers.some(l => l.blocks.some(b => b.block_id === block)))
  if (!win) return
  windowId = win.window_id

  const state = shown()
  if (state !== lastShown) {
    lastShown = state
    isSeen = false
  }
  if (isEnding || state !== 'done') stopSeenWatch()
  else if (!isSeen) {
    isSeen = (await activeWindowId($, session)) === win.window_id
    if (!isSeen && !seenWatch) seenWatch = $.clock.every(SEEN_POLL_MS, () => void checkSeen($))
  }

  const nameKey = `name:${block}`
  const ownName = await $.store.get(nameKey)
  const bare = win.label.replace(PREFIX, '')
  const isAutoNamed = bare === '' || REX_DEFAULT_LABEL.test(bare) || bare === ownName

  let name = bare
  if (isAutoNamed) {
    const title = parse(await rex($, ['block', 'call', '-s', session, '-b', block, 'title']))?.title
    name = clean(title) || clean(parse(await rex($, ['session', 'inspect', session, '--json']))?.label) || bare
  }

  if (isEnding) {
    await rex($, ['window', 'rename', '-s', session, '--', win.window_id, isAutoNamed ? '' : bare])
    await $.store.delete(nameKey)
    return
  }

  const label = `${emoji(state)} ${name}`
  if (label !== win.label) await rex($, ['window', 'rename', '-s', session, '--', win.window_id, label])
  if (isAutoNamed) await $.store.set(nameKey, name)
  else await $.store.delete(nameKey)
}

// Each hook awaits its own repaint so the `$` it hands over is still live.
function paint($: EngineInterface, isEnding = false): Promise<void> {
  painting = painting.then(() => repaint($, isEnding)).catch(() => {})
  return painting
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
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
      status = e.reason === 'error' ? 'error' : e.isAborted ? 'idle' : 'done'
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
