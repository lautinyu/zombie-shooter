/**
 * Player-configurable audio levels and keybindings, persisted verbatim in
 * localStorage. Keys are stored as lowercased KeyboardEvent.code values
 * ('keyw', 'arrowup', 'space'), and mouse buttons as 'mouse0' / 'mouse2'.
 */

export const SETTINGS_KEY = 'ZOMBIE_SHOOTER_SETTINGS'

export type BindableAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'shoot'
  | 'reload'
  | 'swap'
  | 'ability'

export const BINDABLE_ACTIONS: { id: BindableAction; label: string }[] = [
  { id: 'up', label: 'Move Up' },
  { id: 'down', label: 'Move Down' },
  { id: 'left', label: 'Move Left' },
  { id: 'right', label: 'Move Right' },
  { id: 'shoot', label: 'Shoot' },
  { id: 'reload', label: 'Reload' },
  { id: 'swap', label: 'Swap Weapon' },
  { id: 'ability', label: 'Active Ability' },
]

export type KeyBindings = Record<BindableAction, string>

/** WASD or click-to-move for player 1; player 2 always walks on its keys. */
export type MovementMode = 'keys' | 'click'
/** Player 1's trigger: the left mouse button or the bound shoot key. */
export type FireBinding = 'mouse' | 'key'

/** Avatars are emoji so a profile costs nothing to store or draw. */
export const AVATARS = ['🧟', '🔫', '🪖', '🧪', '🩸', '🛠️', '🐺', '☠️'] as const

export const NAME_MIN = 3
export const NAME_MAX = 16

export interface Settings {
  /** Display name shown in the menu header; empty until one is set. */
  playerName: string
  avatar: string
  /** 0→1 gains applied to the music bus and every one-shot sound. */
  bgmVolume: number
  sfxVolume: number
  p1: KeyBindings
  p2: KeyBindings
  movementMode: MovementMode
  fireBinding: FireBinding
}

export const DEFAULT_SETTINGS: Settings = {
  playerName: '',
  avatar: AVATARS[0],
  bgmVolume: 0.35,
  sfxVolume: 0.9,
  p1: {
    up: 'keyw',
    down: 'keys',
    left: 'keya',
    right: 'keyd',
    shoot: 'space',
    reload: 'keyr',
    swap: 'keyq',
    ability: 'keye',
  },
  p2: {
    up: 'arrowup',
    down: 'arrowdown',
    left: 'arrowleft',
    right: 'arrowright',
    shoot: 'period',
    reload: 'slash',
    swap: 'keyn',
    ability: 'keym',
  },
  movementMode: 'keys',
  fireBinding: 'mouse',
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** Trims a typed name to the accepted length; '' means 'not set yet'. */
export function cleanName(value: string): string {
  const trimmed = value.trim().slice(0, NAME_MAX)
  return trimmed.length >= NAME_MIN ? trimmed : ''
}

function readBindings(raw: unknown, fallback: KeyBindings): KeyBindings {
  const out: KeyBindings = { ...fallback }
  if (!raw || typeof raw !== 'object') return out
  const record = raw as Record<string, unknown>
  for (const { id } of BINDABLE_ACTIONS) {
    const value = record[id]
    if (typeof value === 'string' && value) out[id] = value
  }
  return out
}

function parse(raw: string | null): Settings {
  if (!raw) return structuredClone(DEFAULT_SETTINGS)
  try {
    const data = JSON.parse(raw) as Record<string, unknown>
    return {
      playerName: typeof data.playerName === 'string' ? cleanName(data.playerName) : '',
      avatar:
        typeof data.avatar === 'string' && AVATARS.includes(data.avatar as (typeof AVATARS)[number])
          ? data.avatar
          : DEFAULT_SETTINGS.avatar,
      bgmVolume:
        typeof data.bgmVolume === 'number' ? clamp01(data.bgmVolume) : DEFAULT_SETTINGS.bgmVolume,
      sfxVolume:
        typeof data.sfxVolume === 'number' ? clamp01(data.sfxVolume) : DEFAULT_SETTINGS.sfxVolume,
      p1: readBindings(data.p1, DEFAULT_SETTINGS.p1),
      p2: readBindings(data.p2, DEFAULT_SETTINGS.p2),
      movementMode: data.movementMode === 'click' ? 'click' : 'keys',
      fireBinding: data.fireBinding === 'key' ? 'key' : 'mouse',
    }
  } catch {
    return structuredClone(DEFAULT_SETTINGS)
  }
}

let current: Settings = parse(localStorage.getItem(SETTINGS_KEY))

type Listener = (settings: Settings) => void
const listeners: Listener[] = []

export function settings(): Settings {
  return current
}

/** Subscribe to every change; the callback also fires once immediately. */
export function onSettingsChange(listener: Listener): void {
  listeners.push(listener)
  listener(current)
}

export function saveSettings(next: Settings): void {
  current = next
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
  for (const listener of listeners) listener(current)
}

export function updateSettings(patch: Partial<Settings>): void {
  saveSettings({ ...current, ...patch })
}

export function resetSettings(): void {
  // Defaults cover audio and controls; the profile is not a preference.
  const { playerName, avatar } = current
  saveSettings({ ...structuredClone(DEFAULT_SETTINGS), playerName, avatar })
}

/** The code this key event binds to, e.g. 'keyw' or 'arrowleft'. */
export function eventCode(e: KeyboardEvent): string {
  return (e.code || e.key).toLowerCase()
}

export function mouseCode(button: number): string {
  return `mouse${button}`
}

const KEY_LABELS: Record<string, string> = {
  space: 'Space',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  period: '.',
  comma: ',',
  slash: '/',
  semicolon: ';',
  quote: "'",
  backslash: '\\',
  minus: '-',
  equal: '=',
  bracketleft: '[',
  bracketright: ']',
  controlleft: 'L Ctrl',
  controlright: 'R Ctrl',
  shiftleft: 'L Shift',
  shiftright: 'R Shift',
  altleft: 'L Alt',
  altright: 'R Alt',
  enter: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  mouse0: 'Left Click',
  mouse1: 'Middle Click',
  mouse2: 'Right Click',
}

/** Human-readable name for a stored binding code. */
export function keyLabel(code: string): string {
  const known = KEY_LABELS[code]
  if (known) return known
  if (code.startsWith('key')) return code.slice(3).toUpperCase()
  if (code.startsWith('digit')) return code.slice(5)
  if (code.startsWith('numpad')) return `Numpad ${code.slice(6)}`
  return code.toUpperCase()
}
