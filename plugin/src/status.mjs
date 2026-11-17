export const SLEEP_MS = 15 * 60 * 1000
export const DEFAULT_APPS = ['claude-code', 'codex', 'pi', 'opencode']

// Minutes as text. Zero means never fall asleep, and anything unusable means the default.
export function sleepMsFrom(text) {
  if (text === undefined || String(text).trim() === '') return SLEEP_MS
  const minutes = Number(text)
  if (!Number.isFinite(minutes) || minutes < 0) return SLEEP_MS
  return minutes === 0 ? Infinity : minutes * 60 * 1000
}

const RANK = { none: 0, idle: 1, done: 2, error: 3, working: 4, auth: 5, blocked: 6 }
const ICON_KEY = {
  working: 'working',
  blocked: 'blocked',
  auth: 'error',
  error: 'error',
  done: 'done',
}

function shownOf(record) {
  switch (record?.state) {
    case 'working':
    case 'error':
    case 'done':
    case 'idle':
      return record.state
    case 'blocked':
      return record.kind === 'auth' ? 'auth' : 'blocked'
    default:
      return undefined
  }
}

// Rex keeps done and error records after their program exits, so a record only counts while its
// owner is the foreground process or one of its ancestors.
export function liveOwners(proc) {
  if (!proc) return undefined
  const pids = [proc.foreground?.pid, ...(proc.ancestors ?? []).map(a => a?.pid)]
  return new Set(pids.filter(Number.isInteger))
}

export function isLive(owner, live) {
  return !owner || !live || live.has(owner.pid)
}

function isAllowed(record, apps) {
  return apps.includes('*') || apps.includes(record.effective_app ?? record.app)
}

// A record without an id is the program's own. Records with an id belong to its subagents, whose
// finished states go stale, so only their active states count.
export function reduceBlock(records, { proc, apps = DEFAULT_APPS } = {}) {
  const live = liveOwners(proc)
  let state = 'none'
  let hasAgent = false
  let restAt
  for (const record of records) {
    if (!isAllowed(record, apps) || !isLive(record.owner, live)) continue
    const shown = shownOf(record)
    if (!shown) continue
    hasAgent = true
    const isChild = Boolean(record.id)
    if (isChild && !['working', 'blocked', 'auth'].includes(shown)) continue
    if (RANK[shown] > RANK[state]) state = shown
    const at = Date.parse(record.updated_at)
    if (!isChild && (shown === 'done' || shown === 'error') && Number.isFinite(at))
      restAt = Math.max(restAt ?? at, at)
  }
  return { state, hasAgent, restAt }
}

export function reduceWindow(blocks, now, sleepMs = SLEEP_MS) {
  let state = 'none'
  for (const block of blocks) if (RANK[block.state] > RANK[state]) state = block.state
  const hasAgent = blocks.some(block => block.hasAgent)
  let wakeAt
  let sleeping = false
  if (state === 'done' || state === 'error') {
    const rests = blocks
      .filter(block => block.state === 'done' || block.state === 'error')
      .map(block => block.restAt)
    if (rests.every(Number.isFinite) && Number.isFinite(sleepMs)) {
      wakeAt = Math.max(...rests) + sleepMs
      sleeping = now >= wakeAt
    }
  }
  const iconKey = sleeping ? 'sleeping' : ICON_KEY[state]
  return { state, hasAgent, sleeping, wakeAt, iconKey }
}

export function pickTitleSource(blocks, focusedId) {
  const agents = blocks.filter(block => block.hasAgent)
  return agents.find(block => block.id === focusedId) ?? agents[0]
}
