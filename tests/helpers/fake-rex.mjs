export const SESSION = 'session:s1'
export const BLOCK = 'block:b1'
export const WINDOW = 'window:w1'
export const TERMINAL = 'com.superlogical.terminal'
export const DEFAULT_LABEL = 'Window 0000beef'

export function createFakeRex({
  label = DEFAULT_LABEL,
  title = '⠹ Fix login redirect | project',
  records = [{ state: 'idle', app: 'codex', owner: { pid: 10, name: 'codex' } }],
} = {}) {
  const blocks = new Map([[BLOCK, { title, foreground: { pid: 10, name: 'codex' }, records }]])
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
      tab.label = args.at(-1) || DEFAULT_LABEL
      return ''
    }
    if (noun === 'session' && verb === 'inspect') return JSON.stringify({ label: 'project' })
    if (noun === 'block' && verb === 'call') {
      const block = blocks.get(args[args.indexOf('-b') + 1])
      if (!block) return undefined
      const method = args.at(-1)
      if (method === 'program_status') return JSON.stringify({ records: block.records })
      if (method === 'process') return JSON.stringify({ foreground: block.foreground })
      if (method === 'title') return JSON.stringify({ title: block.title, owner: block.titleOwner })
    }
    return undefined
  }
  return { blocks, tab, calls, run }
}
