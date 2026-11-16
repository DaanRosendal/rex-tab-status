export const SESSION = 'session:s1'
export const BLOCK = 'block:b1'
export const WINDOW = 'window:w1'
export const TERMINAL = 'com.superlogical.terminal'
export const DEFAULT_LABEL = 'Window 0000beef'
export const AGENT_PID = 10

export const record = (state, extra = {}) => ({
  state,
  app: 'claude-code',
  owner: { pid: AGENT_PID, name: 'claude' },
  updated_at: new Date().toISOString(),
  ...extra,
})

// A single-window Rex server that answers the commands the watcher issues.
export function createFakeRex({
  label = DEFAULT_LABEL,
  title = '⠹ Fix login redirect | project',
  records = [],
} = {}) {
  const blocks = new Map([
    [BLOCK, { title, proc: { foreground: { pid: AGENT_PID, name: 'claude' } }, records }],
  ])
  const tab = { label }
  const calls = []
  const run = async args => {
    calls.push(args)
    const [noun, verb] = args
    if (noun === 'window' && verb === 'ls') {
      return JSON.stringify({
        windows: [
          {
            window_id: WINDOW,
            label: tab.label,
            focused_block_id: BLOCK,
            layers: [
              {
                blocks: [...blocks.keys()].map(block_id => ({ block_id, creator_name: TERMINAL })),
              },
            ],
          },
        ],
      })
    }
    if (noun === 'window' && verb === 'rename') {
      tab.label = args.at(-1).trim() || DEFAULT_LABEL
      return ''
    }
    if (noun === 'block' && verb === 'call') {
      const block = blocks.get(args[args.indexOf('-b') + 1])
      if (!block) return undefined
      const method = args.at(-1)
      if (method === 'program_status') return JSON.stringify({ records: block.records })
      if (method === 'process') return JSON.stringify(block.proc)
      if (method === 'title')
        return JSON.stringify({ title: block.title, owner: { pid: AGENT_PID, name: 'claude' } })
    }
    return undefined
  }
  const renames = () => calls.filter(c => c[0] === 'window' && c[1] === 'rename')
  return { blocks, tab, calls, run, renames }
}
