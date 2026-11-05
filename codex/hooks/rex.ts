export type Status = 'idle' | 'working' | 'blocked' | 'done' | 'error'
export type RunRex = (args: string[]) => Promise<string | undefined>
export type RexWindow = { window_id: string; label: string; layers: { blocks: { block_id: string }[] }[] }

const EMOJI: Record<Status, string> = {
  idle: '💤',
  working: '⏳',
  blocked: '❓',
  done: '✅',
  error: '❌',
}
const PREFIX = /^(💤|⏳|❓|✅|❌) /
const REX_DEFAULT_LABEL = /^Window [0-9a-f]+$/

export function parse(text: string | undefined): any {
  try {
    return text === undefined ? undefined : JSON.parse(text)
  } catch {
    return undefined
  }
}

function clean(text: unknown): string {
  return String(text ?? '')
    .slice(0, 60)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim()
}

export async function paintTab(
  run: RunRex,
  options: {
    session: string
    block: string
    status: Status
    ownName?: string
    isEnding?: boolean
    windows?: RexWindow[]
    formatTitle?: (title: string) => string
  },
): Promise<{ ownName?: string; label?: string }> {
  const { session, block, status, ownName, isEnding } = options
  const windows: RexWindow[] = options.windows ?? parse(await run(['window', 'ls', '-s', session, '--json']))?.windows ?? []
  const win = windows.find(w => w.layers.some(l => l.blocks.some(b => b.block_id === block)))
  if (!win) return { ownName }

  const bare = win.label.replace(PREFIX, '')
  const isAutoNamed = bare === '' || REX_DEFAULT_LABEL.test(bare) || bare === ownName

  if (isEnding) {
    const renamed = await run(['window', 'rename', '-s', session, '--', win.window_id, isAutoNamed ? '' : bare])
    return renamed === undefined ? { ownName, label: win.label } : { label: isAutoNamed ? '' : bare }
  }

  let name = bare
  if (isAutoNamed) {
    const title = parse(await run(['block', 'call', '-s', session, '-b', block, 'title']))?.title ?? ''
    name = clean(options.formatTitle ? options.formatTitle(title) : title)
      || clean(parse(await run(['session', 'inspect', session, '--json']))?.label)
      || bare
  }

  const label = `${EMOJI[status]} ${name}`
  if (label !== win.label && await run(['window', 'rename', '-s', session, '--', win.window_id, label]) === undefined) {
    return { ownName, label: win.label }
  }
  return { ownName: isAutoNamed ? name : undefined, label }
}
