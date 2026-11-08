// Generated from shared/ by scripts/sync.mjs. Edit shared/, not this copy.
export type Status = 'ready' | 'idle' | 'working' | 'blocked' | 'done' | 'error'
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
export const ICON_PREFIX = new RegExp(
  `^(${[...new Set(Object.values(THEMES).flatMap(icons => Object.values(icons)))]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|')}) `,
)
