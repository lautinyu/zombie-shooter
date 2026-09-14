/**
 * On-screen controls for phones and tablets: an analogue thumbstick on the
 * left for movement and action buttons on the right. The stick writes into
 * `touchStick`, which the game reads instead of the movement keys, and the
 * buttons drive the same action callbacks the keyboard uses.
 */

import type { InputActions } from './input'
import { keysPressed } from './input'

/** Live thumbstick vector; `x`/`y` are already clamped to a unit circle. */
export const touchStick = { active: false, x: 0, y: 0 }

/** Radius of the stick well in CSS pixels; a full push sits on the edge. */
const STICK_RADIUS = 56
/** Deflection below this is treated as a resting thumb. */
const DEAD_ZONE = 0.18

/** True on devices whose primary pointer cannot hover, i.e. touchscreens. */
export function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0
}

const BUTTON_CLASS =
  'pointer-events-auto flex items-center justify-center rounded-full bg-white/10 font-black uppercase text-white ring-2 ring-white/25 active:bg-emerald-500/40 active:ring-emerald-300/70'

function button(id: string, label: string, size: string, text: string): string {
  return `<button id="${id}" class="${BUTTON_CLASS} ${size} ${text}">${label}</button>`
}

export function mountTouchControls(actions: InputActions): void {
  const root = document.createElement('div')
  root.id = 'touch-controls'
  root.className =
    'pointer-events-none fixed inset-0 z-40 hidden touch-none select-none [touch-action:none]'
  root.innerHTML = `
    <div id="touch-stick" class="pointer-events-auto absolute bottom-8 left-8 h-32 w-32 rounded-full bg-white/5 ring-2 ring-white/20">
      <div id="touch-nub" class="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-400/40 ring-2 ring-emerald-300/60"></div>
    </div>
    <div class="absolute bottom-8 right-8 flex items-end gap-4">
      <div class="flex flex-col gap-3">
        ${button('touch-reload', '⟳', 'h-14 w-14', 'text-xl')}
        ${button('touch-swap', '⇄', 'h-14 w-14', 'text-xl')}
      </div>
      <div class="flex flex-col gap-3">
        ${button('touch-ability', 'ABL', 'h-16 w-16', 'text-xs')}
        ${button('touch-fire', 'FIRE', 'h-24 w-24', 'text-sm')}
      </div>
    </div>`
  document.body.appendChild(root)

  const stick = root.querySelector<HTMLElement>('#touch-stick')
  const nub = root.querySelector<HTMLElement>('#touch-nub')
  if (!stick || !nub) return

  let stickPointer: number | null = null

  const setNub = (dx: number, dy: number) => {
    nub.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
  }

  const release = () => {
    stickPointer = null
    touchStick.active = false
    touchStick.x = 0
    touchStick.y = 0
    setNub(0, 0)
  }

  const drag = (e: PointerEvent) => {
    const rect = stick.getBoundingClientRect()
    const dx = e.clientX - (rect.left + rect.width / 2)
    const dy = e.clientY - (rect.top + rect.height / 2)
    const len = Math.hypot(dx, dy)
    const clamped = Math.min(1, len / STICK_RADIUS)
    const ux = len > 0 ? dx / len : 0
    const uy = len > 0 ? dy / len : 0
    setNub(ux * clamped * STICK_RADIUS, uy * clamped * STICK_RADIUS)
    if (clamped < DEAD_ZONE) {
      touchStick.active = false
      touchStick.x = 0
      touchStick.y = 0
      return
    }
    touchStick.active = true
    touchStick.x = ux * clamped
    touchStick.y = uy * clamped
  }

  stick.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    stickPointer = e.pointerId
    stick.setPointerCapture(e.pointerId)
    drag(e)
  })
  stick.addEventListener('pointermove', (e) => {
    if (stickPointer !== e.pointerId) return
    e.preventDefault()
    drag(e)
  })
  for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
    stick.addEventListener(type, (e) => {
      if (stickPointer !== e.pointerId) return
      release()
    })
  }

  const fire = root.querySelector<HTMLElement>('#touch-fire')
  fire?.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    if (!actions.canShoot()) return
    keysPressed.shooting = true
    actions.p1Shot()
  })
  for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
    fire?.addEventListener(type, () => {
      keysPressed.shooting = false
    })
  }

  const tap = (id: string, run: () => void) => {
    root.querySelector<HTMLElement>(`#${id}`)?.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      run()
    })
  }
  tap('touch-ability', () => {
    // Held while pressed so the ability button doubles as the crate retrieve.
    keysPressed.interactP1 = true
    actions.p1Ability()
  })
  for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
    root.querySelector<HTMLElement>('#touch-ability')?.addEventListener(type, () => {
      keysPressed.interactP1 = false
    })
  }
  tap('touch-reload', () => actions.reload())
  tap('touch-swap', () => actions.p1Switch())

  // Only a mission needs the pad; menus and cabinets keep the screen clear.
  const sync = () => {
    const playing = actions.canShoot()
    root.classList.toggle('hidden', !playing)
    if (!playing) release()
  }
  sync()
  window.setInterval(sync, 250)
}
