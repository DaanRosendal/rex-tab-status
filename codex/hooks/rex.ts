export type Status = 'ready' | 'idle' | 'working' | 'blocked' | 'done' | 'error'
export type RunRex = (args: string[]) => Promise<string | undefined>
export type RexWindow = {
  window_id: string
  label: string
  layers?: { blocks?: { block_id: string; creator_name?: string }[] }[]
}

export type Icons = Record<Status, string>

// Never remove an icon from a preset: tabs already showing it could no longer be cleaned.
export const THEMES = {
  default: { ready: '', idle: '💤', working: '⏳', blocked: '❓', done: '✅', error: '❌' },
  ascii: { ready: '', idle: '[zz]', working: '[..]', blocked: '[?]', done: '[ok]', error: '[x]' },
  minimal: { ready: '', idle: '○', working: '◐', blocked: '◆', done: '✓', error: '✗' },
  circles: { ready: '', idle: '⚪', working: '🟡', blocked: '🔴', done: '🟢', error: '⛔' },
} as const satisfies Record<string, Icons>

export type ThemeName = keyof typeof THEMES

export function resolveTheme(name: string | undefined): Icons {
  const key = (name ?? '').trim().toLowerCase()
  return Object.hasOwn(THEMES, key) ? THEMES[key as ThemeName] : THEMES.default
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const PREFIX = new RegExp(
  `^(${[...new Set(Object.values(THEMES).flatMap(icons => Object.values(icons)))]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|')}) `,
)
const REX_DEFAULT_LABEL = /^Window [0-9a-f]+$/

export function parse(text: string | undefined): any {
  try {
    return text === undefined ? undefined : JSON.parse(text)
  } catch {
    return undefined
  }
}

export function parseWindows(text: string | undefined): RexWindow[] | undefined {
  const windows = parse(text)?.windows
  return Array.isArray(windows)
    ? windows.filter(w => typeof w?.window_id === 'string' && typeof w?.label === 'string')
    : undefined
}

export function blocksOf(win: RexWindow) {
  return (win.layers ?? []).flatMap(layer => layer?.blocks ?? [])
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
    icons?: Icons
  },
): Promise<{ ownName?: string; label?: string }> {
  const { session, block, status, ownName, isEnding } = options
  const icons = options.icons ?? THEMES.default
  const windows: RexWindow[] =
    options.windows ?? parseWindows(await run(['window', 'ls', '-s', session, '--json'])) ?? []
  const win = windows.find(w => blocksOf(w).some(b => b.block_id === block))
  if (!win) return { ownName }

  const bare = win.label.replace(PREFIX, '')
  const isAutoNamed = bare === '' || REX_DEFAULT_LABEL.test(bare) || bare === ownName

  if (isEnding) {
    const renamed = await run([
      'window',
      'rename',
      '-s',
      session,
      '--',
      win.window_id,
      isAutoNamed ? '' : bare,
    ])
    return renamed === undefined
      ? { ownName, label: win.label }
      : { label: isAutoNamed ? '' : bare }
  }

  let name = bare
  if (isAutoNamed) {
    const title =
      parse(await run(['block', 'call', '-s', session, '-b', block, 'title']))?.title ?? ''
    name =
      clean(options.formatTitle ? options.formatTitle(title) : title) ||
      clean(parse(await run(['session', 'inspect', session, '--json']))?.label) ||
      bare
  }

  const label = icons[status] ? `${icons[status]} ${name}` : name
  if (
    label !== win.label &&
    (await run(['window', 'rename', '-s', session, '--', win.window_id, label])) === undefined
  ) {
    return { ownName, label: win.label }
  }
  return { ownName: isAutoNamed ? name : undefined, label }
}
