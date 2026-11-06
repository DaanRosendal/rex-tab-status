export const IDLE_DELAY_MS = 5 * 60 * 1000

function after(ms, callback) {
  const timer = setTimeout(callback, ms)
  timer.unref?.()
  return { cancel: () => clearTimeout(timer) }
}

export class IdleDelay {
  timer
  expired = false
  previous = 'ready'

  constructor(repaint, schedule = after) {
    this.repaint = repaint
    this.schedule = schedule
  }

  update(status) {
    if (status !== 'idle') {
      this.cancel()
      this.previous = status
      return status
    }
    if (this.timer === undefined && !this.expired) {
      this.timer = this.schedule(IDLE_DELAY_MS, () => {
        this.timer = undefined
        this.expired = true
        return Promise.resolve().then(this.repaint).catch(() => {})
      })
    }
    return this.expired ? 'idle' : ['done', 'error'].includes(this.previous) ? this.previous : 'ready'
  }

  cancel() {
    this.timer?.cancel()
    this.timer = undefined
    this.expired = false
  }
}
