// Never remove an icon from a preset: tabs already showing it could no longer be cleaned.
export const THEMES = {
  default: {
    working: '⏳',
    blocked: '❓',
    done: '✅',
    error: '❌',
    sleeping: '💤',
    watching: '📡',
  },
  ascii: {
    working: '[..]',
    blocked: '[?]',
    done: '[ok]',
    error: '[x]',
    sleeping: '[zz]',
    watching: '[~]',
  },
  minimal: { working: '◐', blocked: '◆', done: '✓', error: '✗', sleeping: '○', watching: '◎' },
  circles: {
    working: '🟡',
    blocked: '🔴',
    done: '🟢',
    error: '⛔',
    sleeping: '⚪',
    watching: '🔵',
  },
}

export function resolveTheme(name) {
  const key = (name ?? '').trim().toLowerCase()
  return Object.hasOwn(THEMES, key) ? THEMES[key] : THEMES.default
}

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Rex trims labels, so a bare icon is stored without its trailing space.
export const ICON_PREFIX = new RegExp(
  `^(?:${[...new Set(Object.values(THEMES).flatMap(icons => Object.values(icons)))]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|')})(?: +|$)`,
)

export function stripIcons(label) {
  let text = label
  for (;;) {
    const next = text.replace(ICON_PREFIX, '')
    if (next === text) return text
    text = next
  }
}
