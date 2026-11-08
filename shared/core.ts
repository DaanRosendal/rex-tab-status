import type { Status } from './themes.ts'

export const IDLE_DELAY_MS = 5 * 60 * 1000
// Auto mode's classifier also answers an `ask`, and does so within a second or two. Only an ask
// still open after this wait is a dialog worth showing.
export const ASK_GRACE_MS = 2000

type Base = Exclude<Status, 'ready'>

export type CoreEvent =
  | { type: 'reset' }
  // A snapshot adapter reports the status it sees. It replaces the turn and ask tracking.
  | { type: 'observed'; status: Base }
  | { type: 'turnStarted'; turnId: string; isSubagent: boolean }
  | {
      type: 'turnEnded'
      turnId: string
      isSubagent: boolean
      outcome: 'done' | 'error' | 'aborted'
    }
  // An immediate ask is a dialog the person certainly sees. Any other waits out the grace period.
  | { type: 'askOpened'; id: string; isImmediate: boolean }
  | { type: 'askClosed'; id: string }
  | { type: 'timer'; key: string }

export type CoreState = {
  base: Base
  isMainTurnRunning: boolean
  subagentTurns: string[]
  // Maps each open ask to whether it has earned the question mark.
  asks: Record<string, boolean>
  isIdleExpired: boolean
  // The last status shown while not idle. A finished or failed turn stays visible during the wait.
  previous: Status
}

export type CoreResult = {
  state: CoreState
  shown: Status
  // Every timer that should be running, by key, with its delay. An adapter keeps these with `Timers`
  // and sends `{ type: 'timer', key }` when one fires.
  timers: Record<string, number>
}

export const initialState: CoreState = {
  base: 'idle',
  isMainTurnRunning: false,
  subagentTurns: [],
  asks: {},
  isIdleExpired: false,
  previous: 'ready',
}

function apply(state: CoreState, event: CoreEvent): CoreState {
  switch (event.type) {
    case 'reset':
      return initialState
    case 'observed':
      return { ...state, base: event.status, asks: {} }
    case 'turnStarted':
      return {
        ...state,
        base: 'working',
        isMainTurnRunning: event.isSubagent ? state.isMainTurnRunning : true,
        subagentTurns:
          event.isSubagent && !state.subagentTurns.includes(event.turnId)
            ? [...state.subagentTurns, event.turnId]
            : state.subagentTurns,
      }
    case 'turnEnded': {
      let { base, asks } = state
      const isMainTurnRunning = event.isSubagent ? state.isMainTurnRunning : false
      const subagentTurns = event.isSubagent
        ? state.subagentTurns.filter(id => id !== event.turnId)
        : state.subagentTurns
      if (!event.isSubagent) {
        asks = {}
        base = event.outcome === 'error' ? 'error' : event.outcome === 'aborted' ? 'idle' : 'done'
      } else if (!isMainTurnRunning && base === 'working') {
        base = 'done'
      }
      if (isMainTurnRunning || subagentTurns.length > 0) base = 'working'
      return { ...state, base, asks, isMainTurnRunning, subagentTurns }
    }
    case 'askOpened':
      if (event.isImmediate) return { ...state, asks: { ...state.asks, [event.id]: true } }
      return Object.hasOwn(state.asks, event.id)
        ? state
        : { ...state, asks: { ...state.asks, [event.id]: false } }
    case 'askClosed': {
      const { [event.id]: _closed, ...asks } = state.asks
      return { ...state, asks }
    }
    case 'timer': {
      if (event.key === 'idle') return { ...state, isIdleExpired: true }
      const id = event.key.startsWith('ask:') ? event.key.slice('ask:'.length) : undefined
      return id !== undefined && Object.hasOwn(state.asks, id)
        ? { ...state, asks: { ...state.asks, [id]: true } }
        : state
    }
  }
}

export function step(state: CoreState, event: CoreEvent): CoreResult {
  const next = apply(state, event)
  const timers: Record<string, number> = {}
  for (const [id, isVisible] of Object.entries(next.asks))
    if (!isVisible) timers[`ask:${id}`] = ASK_GRACE_MS

  const current: Base = Object.values(next.asks).some(Boolean) ? 'blocked' : next.base
  if (current !== 'idle') {
    return {
      state: { ...next, isIdleExpired: false, previous: current },
      shown: current,
      timers,
    }
  }
  if (!next.isIdleExpired) timers.idle = IDLE_DELAY_MS
  const shown: Status = next.isIdleExpired
    ? 'idle'
    : next.previous === 'done' || next.previous === 'error'
      ? next.previous
      : 'ready'
  return { state: next, shown, timers }
}

export type TimerHandle = { cancel: () => void }

// Keeps running exactly the timers `step` asks for. `start` is the adapter's own clock.
export class Timers {
  running = new Map<string, TimerHandle>()

  sync(wanted: Record<string, number>, start: (key: string, ms: number) => TimerHandle) {
    for (const [key, handle] of this.running) {
      if (Object.hasOwn(wanted, key)) continue
      handle.cancel()
      this.running.delete(key)
    }
    for (const [key, ms] of Object.entries(wanted))
      if (!this.running.has(key)) this.running.set(key, start(key, ms))
  }

  // A timer that fired is finished, so it needs no cancelling.
  fired(key: string) {
    this.running.delete(key)
  }

  cancelAll() {
    for (const handle of this.running.values()) handle.cancel()
    this.running.clear()
  }
}
