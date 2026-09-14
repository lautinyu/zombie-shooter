import type { BindableAction, KeyBindings } from './settings'
import { eventCode, settings } from './settings'
import { isTouchDevice, mountTouchControls } from './TouchControls'

/**
 * Persistent input state. Movement flags and the shooting flag are separate
 * fields that are only ever written by their own listener, so a mouse press
 * can never clear, reset or pause a movement direction that is being held.
 */
export const keysPressed = {
  // Player 1 movement.
  w: false,
  a: false,
  s: false,
  d: false,
  // Player 2 movement (also drives player 1 in solo play).
  up: false,
  down: false,
  left: false,
  right: false,
  // Mouse fire button, tracked independently of every key above.
  shooting: false,
  // Player 2's own trigger.
  shootingP2: false,
  // Held to collect supply crates; shared by both local players.
  interact: false,
  // Per-player retrieve keys, which ride along with the ability binding.
  interactP1: false,
  interactP2: false,
}

export type MovementKey = 'w' | 'a' | 's' | 'd' | 'up' | 'down' | 'left' | 'right'

/** Player 1's movement flags, in binding order. */
const P1_MOVEMENT: Record<'up' | 'down' | 'left' | 'right', MovementKey> = {
  up: 'w',
  down: 's',
  left: 'a',
  right: 'd',
}

const SCROLL_CODES = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'space']

/** Extra player 2 triggers kept alongside whatever shoot key is bound. */
const P2_EXTRA_TRIGGERS = ['numpad0', 'controlright']

/** One-shot key presses; movement is never routed through these. */
export interface InputActions {
  reload: () => void
  p2Reload: () => void
  p1Ability: () => void
  p2Ability: () => void
  p1Barricade: () => void
  p2Barricade: () => void
  /** Swap between the primary and secondary weapon slots. */
  p1Switch: () => void
  p2Switch: () => void
  /** Fired once per press so a very short click still sends a bullet. */
  p1Shot: () => void
  p2Shot: () => void
  /** Mouse position in canvas space, updated on every move and press. */
  aim: (x: number, y: number) => void
  /** Right-click destination in canvas space, for click-to-move. */
  walkTo: (x: number, y: number) => void
  /** Presses outside a live mission must not arm the trigger. */
  canShoot: () => boolean
}

/** Which action, if any, this code is bound to for the given player. */
function actionFor(bindings: KeyBindings, code: string): BindableAction | undefined {
  for (const action of Object.keys(bindings) as BindableAction[]) {
    if (bindings[action] === code) return action
  }
  return undefined
}

export function clearInput() {
  for (const key of Object.keys(keysPressed) as (keyof typeof keysPressed)[]) {
    keysPressed[key] = false
  }
}

export function bindInput(canvas: HTMLCanvasElement, actions: InputActions) {
  /** True while player 1 fires from a key rather than the mouse button. */
  const keyFire = () => settings().fireBinding === 'key'

  const isP2Trigger = (code: string) =>
    code === settings().p2.shoot || P2_EXTRA_TRIGGERS.includes(code)

  window.addEventListener('keydown', (e) => {
    const code = eventCode(e)
    const s = settings()
    const p1 = actionFor(s.p1, code)
    const p2 = actionFor(s.p2, code)

    if (SCROLL_CODES.includes(code)) e.preventDefault()

    // Held states are set before the repeat guard so auto-repeat cannot
    // cancel a direction, a trigger or a retrieve that is being held down.
    if (p1 && p1 in P1_MOVEMENT) keysPressed[P1_MOVEMENT[p1 as 'up' | 'down' | 'left' | 'right']] = true
    if (p2 && p2 in P1_MOVEMENT) keysPressed[p2 as MovementKey] = true
    if (p1 === 'ability') keysPressed.interactP1 = true
    if (p2 === 'ability') keysPressed.interactP2 = true
    if (p1 === 'shoot' && keyFire()) keysPressed.shooting = true
    if (isP2Trigger(code)) keysPressed.shootingP2 = true
    if (code === 'space') keysPressed.interact = true

    if (e.repeat) return
    if (p1 === 'shoot' && keyFire()) actions.p1Shot()
    if (isP2Trigger(code)) actions.p2Shot()
    if (p1 === 'reload') actions.reload()
    if (p1 === 'ability') actions.p1Ability()
    if (p1 === 'swap') actions.p1Switch()
    if (p2 === 'reload') actions.p2Reload()
    if (p2 === 'ability') actions.p2Ability()
    if (p2 === 'swap') actions.p2Switch()
    if (code === 'keyf') actions.p1Barricade()
    if (code === 'keyl') actions.p2Barricade()
  })

  window.addEventListener('keyup', (e) => {
    const code = eventCode(e)
    const s = settings()
    const p1 = actionFor(s.p1, code)
    const p2 = actionFor(s.p2, code)
    if (p1 && p1 in P1_MOVEMENT) keysPressed[P1_MOVEMENT[p1 as 'up' | 'down' | 'left' | 'right']] = false
    if (p2 && p2 in P1_MOVEMENT) keysPressed[p2 as MovementKey] = false
    if (p1 === 'ability') keysPressed.interactP1 = false
    if (p2 === 'ability') keysPressed.interactP2 = false
    if (p1 === 'shoot') keysPressed.shooting = false
    if (isP2Trigger(code)) keysPressed.shootingP2 = false
    if (code === 'space') keysPressed.interact = false
  })

  // A window that loses focus stops receiving keyup, so drop everything.
  window.addEventListener('blur', clearInput)

  const canvasPoint = (e: MouseEvent | PointerEvent) => {
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const aimAt = (e: MouseEvent | PointerEvent) => {
    const point = canvasPoint(e)
    actions.aim(point.x, point.y)
  }
  window.addEventListener('mousemove', aimAt)
  window.addEventListener('pointerdown', (e) => {
    if (e.button === 2 && settings().movementMode === 'click') {
      const point = canvasPoint(e)
      actions.walkTo(point.x, point.y)
      return
    }
    if (e.button !== 0 || !actions.canShoot()) return
    aimAt(e)
    if (keyFire()) return
    keysPressed.shooting = true
    actions.p1Shot()
  })
  window.addEventListener('pointerup', (e) => {
    if (e.button === 0 && !keyFire()) keysPressed.shooting = false
  })
  window.addEventListener('pointercancel', () => {
    if (!keyFire()) keysPressed.shooting = false
  })
  // Canvas drags and text selection make Chrome swallow keydown while the
  // button is held, which looks exactly like frozen movement.
  canvas.addEventListener('dragstart', (e) => e.preventDefault())
  canvas.addEventListener('selectstart', (e) => e.preventDefault())
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())

  if (isTouchDevice()) mountTouchControls(actions)
}
