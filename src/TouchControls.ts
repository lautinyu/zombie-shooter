/**
 * On-screen controls for phones and tablets: an analogue thumbstick on the
 * left for movement, a manual aim stick plus action buttons on the right.
 * The sticks write into `touchStick` / `touchAim`, which the game reads
 * instead of the movement keys and the mouse, and the buttons drive the same
 * action callbacks the keyboard uses. Aiming is never assisted.
 */

import type { InputActions } from './input'
import { keysPressed } from './input'

/**
 * Live movement pad state. `x`/`y` are clamped to a unit circle; `engaged`
 * stays true once the pad has been touched so the game stops falling back to
 * the mouse, which a touchscreen does not have.
 */
export const touchStick = { active: false, engaged: false, visible: false, x: 0, y: 0 }

/**
 * Manual aim state written by the right-hand stick. `angle` is a world-space
 * heading in radians and only ever comes from the player's thumb, so there is
 * no aim assist of any kind. Pushing the stick past the dead zone also holds
 * the trigger, which is what makes twin-stick play work without a third thumb.
 */
export const touchAim = { active: false, engaged: false, angle: 0 }

/** Radius of the stick well in CSS pixels; a full push sits on the edge. */
const STICK_RADIUS = 64
/** Deflection below this is treated as a resting thumb. */
const DEAD_ZONE = 0.16

/** True on devices whose primary pointer cannot hover, i.e. touchscreens. */
export function isTouchDevice(): boolean {
  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia('(pointer: coarse)').matches
  )
}

const BUTTON_CLASS =
  'pointer-events-auto flex touch-none select-none items-center justify-center rounded-full bg-white/10 font-black uppercase text-white ring-2 ring-white/25 backdrop-blur-sm active:bg-emerald-500/50 active:ring-emerald-300/80'

function button(id: string, label: string, size: string, text: string): string {
  return `<button id="${id}" type="button" class="${BUTTON_CLASS} ${size} ${text}">${label}</button>`
}

/** Press and release handlers for a pad button, with the tap default eaten. */
function hold(el: HTMLElement, down: () => void, up?: () => void): void {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    el.setPointerCapture(e.pointerId)
    down()
  })
  const end = (e: PointerEvent) => {
    e.preventDefault()
    up?.()
  }
  el.addEventListener('pointerup', end)
  el.addEventListener('pointercancel', end)
}

export function mountTouchControls(actions: InputActions): void {
  if (document.getElementById('touch-controls')) return

  const root = document.createElement('div')
  root.id = 'touch-controls'
  root.className = 'pointer-events-none fixed inset-0 z-[55] hidden touch-none select-none'
  root.innerHTML = `
    <div id="touch-stick" style="bottom: max(1.5rem, env(safe-area-inset-bottom))" class="pointer-events-auto absolute left-6 h-36 w-36 touch-none rounded-full bg-white/10 ring-2 ring-white/25 backdrop-blur-sm">
      <div id="touch-nub" class="pointer-events-none absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-400/50 ring-2 ring-emerald-200/70"></div>
    </div>
    <div style="bottom: max(1.5rem, env(safe-area-inset-bottom))" class="absolute right-6 flex items-end gap-3">
      <div class="flex flex-col gap-3">
        ${button('touch-swap', '⇄', 'h-14 w-14', 'text-xl')}
        ${button('touch-reload', '⟳', 'h-14 w-14', 'text-xl')}
        ${button('touch-ability', 'ABL', 'h-14 w-14', 'text-[11px]')}
        ${button('touch-fire', 'FIRE', 'h-16 w-16', 'text-xs')}
      </div>
      <div id="touch-aim" class="pointer-events-auto relative h-36 w-36 touch-none rounded-full bg-white/10 ring-2 ring-white/25 backdrop-blur-sm">
        <div class="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-black uppercase tracking-wider text-white/40">Aim</div>
        <div id="touch-aim-nub" class="pointer-events-none absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-rose-400/50 ring-2 ring-rose-200/70"></div>
      </div>
    </div>`
  document.body.appendChild(root)

  const stick = root.querySelector<HTMLElement>('#touch-stick')
  const nub = root.querySelector<HTMLElement>('#touch-nub')
  const aim = root.querySelector<HTMLElement>('#touch-aim')
  const aimNub = root.querySelector<HTMLElement>('#touch-aim-nub')
  const fire = root.querySelector<HTMLElement>('#touch-fire')
  const ability = root.querySelector<HTMLElement>('#touch-ability')
  const reload = root.querySelector<HTMLElement>('#touch-reload')
  const swap = root.querySelector<HTMLElement>('#touch-swap')
  if (!stick || !nub || !aim || !aimNub || !fire || !ability || !reload || !swap) return

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
    const pull = Math.min(1, len / STICK_RADIUS)
    const ux = len > 0 ? dx / len : 0
    const uy = len > 0 ? dy / len : 0
    setNub(ux * pull * STICK_RADIUS, uy * pull * STICK_RADIUS)
    touchStick.active = pull >= DEAD_ZONE
    touchStick.x = touchStick.active ? ux * pull : 0
    touchStick.y = touchStick.active ? uy * pull : 0
  }

  stick.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    stickPointer = e.pointerId
    touchStick.engaged = true
    // Capture keeps the drag alive once the thumb slides past the well.
    stick.setPointerCapture(e.pointerId)
    drag(e)
  })
  stick.addEventListener('pointermove', (e) => {
    if (stickPointer !== e.pointerId) return
    e.preventDefault()
    drag(e)
  })
  // No pointerleave here: capture already routes the drag, and a leave while
  // captured would drop the stick the moment the thumb crosses the ring.
  stick.addEventListener('pointerup', release)
  stick.addEventListener('pointercancel', release)
  stick.addEventListener('lostpointercapture', release)

  let aimPointer: number | null = null

  const setAimNub = (dx: number, dy: number) => {
    aimNub.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
  }

  const releaseAim = () => {
    aimPointer = null
    // The muzzle keeps its last heading; only the trigger lets go.
    touchAim.active = false
    keysPressed.shooting = false
    setAimNub(0, 0)
  }

  const dragAim = (e: PointerEvent) => {
    const rect = aim.getBoundingClientRect()
    const dx = e.clientX - (rect.left + rect.width / 2)
    const dy = e.clientY - (rect.top + rect.height / 2)
    const len = Math.hypot(dx, dy)
    const pull = Math.min(1, len / STICK_RADIUS)
    const ux = len > 0 ? dx / len : 0
    const uy = len > 0 ? dy / len : 0
    setAimNub(ux * pull * STICK_RADIUS, uy * pull * STICK_RADIUS)
    if (pull < DEAD_ZONE) {
      touchAim.active = false
      keysPressed.shooting = false
      return
    }
    touchAim.active = true
    touchAim.angle = Math.atan2(uy, ux)
    keysPressed.shooting = true
  }

  aim.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    aimPointer = e.pointerId
    touchStick.engaged = true
    touchAim.engaged = true
    aim.setPointerCapture(e.pointerId)
    dragAim(e)
  })
  aim.addEventListener('pointermove', (e) => {
    if (aimPointer !== e.pointerId) return
    e.preventDefault()
    dragAim(e)
  })
  aim.addEventListener('pointerup', releaseAim)
  aim.addEventListener('pointercancel', releaseAim)
  aim.addEventListener('lostpointercapture', releaseAim)

  hold(
    fire,
    () => {
      touchStick.engaged = true
      touchAim.engaged = true
      keysPressed.shooting = true
      actions.p1Shot()
    },
    () => {
      // The aim stick may still be pushed, so only it can clear its own hold.
      if (!touchAim.active) keysPressed.shooting = false
    },
  )
  hold(
    ability,
    () => {
      touchStick.engaged = true
      // Held while pressed so the button doubles as the crate retrieve.
      keysPressed.interactP1 = true
      keysPressed.interact = true
      actions.p1Ability()
    },
    () => {
      keysPressed.interactP1 = false
      keysPressed.interact = false
    },
  )
  hold(reload, () => actions.reload())
  hold(swap, () => actions.p1Switch())

  // Shown whenever a mission is live on a device that can be touched; a
  // ?touch=1 query forces it on for desktop checks.
  const forced = new URLSearchParams(window.location.search).has('touch')
  const wanted = () => (forced || isTouchDevice()) && actions.canShoot()
  const sync = () => {
    const show = wanted()
    if (show === !root.classList.contains('hidden')) return
    root.classList.toggle('hidden', !show)
    touchStick.visible = show
    // The keyboard hint strip sits exactly under the thumbstick.
    document.getElementById('hud-controls')?.classList.toggle('hidden', show)
    if (!show) {
      release()
      releaseAim()
      keysPressed.shooting = false
      keysPressed.interactP1 = false
      keysPressed.interact = false
    }
  }
  sync()
  window.setInterval(sync, 200)
}
