import { stripIcons } from './themes.mjs'

const MAX_NAME_LENGTH = 60
const REX_DEFAULT_LABEL = /^Window [0-9a-f]+$/
// Agents prefix their title with an activity spinner, which would otherwise rewrite the label on every frame.
const SPINNER = /^[⠀-⣿✳]\s+/u
const MAX_RECENT_LABELS = 8

export const isDefault = label => label === '' || REX_DEFAULT_LABEL.test(label)

export function cleanTitle(text) {
  const plain = String(text ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim()
    .replace(SPINNER, '')
  return stripIcons(plain.trim()).slice(0, MAX_NAME_LENGTH).trim()
}

// Our own writes come back as label events, so recent labels identify them.
export function isEcho(own, label) {
  return Boolean(own) && (own.written === label || own.recent.includes(label))
}

// Returns the ownership to remember and the label to write, if any. An empty label resets the tab
// to Rex's default.
export function decideLabel({ actual, own, hasAgent, icon = '', title = '' }) {
  const bare = stripIcons(actual)
  const owned = isEcho(own, actual)

  let mode
  if (own && owned) mode = own.mode
  else if (isDefault(bare)) mode = 'auto'
  else if (own?.mode === 'auto' && bare === own.base) mode = 'auto'
  else if (!own && title && bare === title) mode = 'auto'
  else mode = 'manual'

  if (!hasAgent) {
    if (!own && bare === actual) return { own: undefined }
    const target = mode === 'auto' && owned ? '' : isDefault(bare) ? '' : bare
    const needsWrite = target === '' ? !isDefault(actual) : target !== actual
    return { own: undefined, write: needsWrite ? target : undefined }
  }

  const base = mode === 'auto' ? title || own?.base || bare : bare
  const desired = icon ? `${icon} ${base}`.trim() : base
  const write = desired === actual || (desired === '' && isDefault(actual)) ? undefined : desired
  const written = write ?? actual
  return {
    own: {
      mode,
      base,
      written,
      recent: [...(own?.recent ?? []), written].slice(-MAX_RECENT_LABELS),
    },
    write,
  }
}
