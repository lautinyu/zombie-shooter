/**
 * ENDLESS HORDE SURVIVAL — a standalone arcade cabinet: pick a class, then hold
 * a city block against a horde that never stops. Spawns ramp every 30 s, an
 * upgrade draft opens every 60 s and a mini-boss joins the wave every 90 s.
 *
 * Like the other cabinets it owns its overlay, canvas, loop, input and storage,
 * so campaign state is never touched. Player aim is fully manual (mouse, Q/E,
 * touch); only the Technician's deployed drone picks its own targets.
 */

import { playMusic, playSfx, stopMusic } from './audio'
import { highScore, recordPlay, submitScore } from './arcadeStats'

const VIEW_W = 960
const VIEW_H = 560
const ARENA_W = 2800
const ARENA_H = 1800

const PLAYER_RADIUS = 14
const BASE_MAX_HP = 100
const BASE_SPEED = 230
const KEY_AIM_TURN = 3.6
const MAX_EXTRA_PELLETS = 4

const BASE_SPAWN_INTERVAL = 1.2
const MIN_SPAWN_INTERVAL = 0.11
const SPAWN_STEP_SECONDS = 30
/** Each 30 s step adds this much to the spawn rate multiplier. */
const SPAWN_RATE_STEP = 0.22
const UPGRADE_SECONDS = 60
const MINIBOSS_SECONDS = 90
const MAX_ZOMBIES = 170

const DRONE_DURATION = 20
const DRONE_COOLDOWN = 30
const DRONE_RANGE = 440

const STREET_COLOR = '#23262a'
const BUILDING_COLOR = '#8b5a2b'
const BUILDING_EDGE = '#5c3a1c'

type Phase = 'select' | 'playing' | 'upgrade' | 'over'
type ZombieKind = 'walker' | 'runner' | 'brute' | 'miniboss'
type ClassId = 'swat' | 'assassin' | 'technician' | 'marksman'

interface WeaponDef {
  name: string
  damage: number
  fireInterval: number
  magazine: number
  reload: number
  bulletSpeed: number
  spread: number
  pierce: number
  /** Melee weapons hit everything inside `range` within `arc` of the aim. */
  melee?: { range: number; arc: number }
}

interface ClassDef {
  id: ClassId
  name: string
  icon: string
  color: string
  ring: string
  blurb: string
  weapons: WeaponDef[]
  drone: boolean
}

const AR: WeaponDef = { name: 'Assault Rifle', damage: 30, fireInterval: 0.12, magazine: 30, reload: 1.6, bulletSpeed: 1000, spread: 0.04, pierce: 0 }
const REVOLVER: WeaponDef = { name: 'Revolver', damage: 78, fireInterval: 0.55, magazine: 6, reload: 1.8, bulletSpeed: 1150, spread: 0, pierce: 1 }
const UZI: WeaponDef = { name: 'Uzi', damage: 15, fireInterval: 0.06, magazine: 40, reload: 1.3, bulletSpeed: 950, spread: 0.1, pierce: 0 }
const KATANA: WeaponDef = { name: 'Katana', damage: 62, fireInterval: 0.42, magazine: 0, reload: 0, bulletSpeed: 0, spread: 0, pierce: 0, melee: { range: 74, arc: 1.7 } }
const RIFLE: WeaponDef = { name: 'Battle Rifle', damage: 62, fireInterval: 0.24, magazine: 20, reload: 1.7, bulletSpeed: 1200, spread: 0.015, pierce: 1 }
const SNIPER: WeaponDef = { name: 'Sniper Rifle', damage: 190, fireInterval: 1.0, magazine: 5, reload: 2.2, bulletSpeed: 1700, spread: 0, pierce: 3 }
const GLOCK: WeaponDef = { name: 'Glock', damage: 32, fireInterval: 0.28, magazine: 15, reload: 1.2, bulletSpeed: 1000, spread: 0.03, pierce: 0 }
/** Slightly below the Uzi's damage, at the assault rifle's cadence. */
const DRONE_DAMAGE = 13
const DRONE_FIRE_INTERVAL = AR.fireInterval

const CLASSES: ClassDef[] = [
  { id: 'swat', name: 'SWAT', icon: '🛡️', color: '#3b82f6', ring: 'ring-sky-500/60 hover:ring-sky-300', blurb: 'Steady all-rounder.', weapons: [AR, REVOLVER], drone: false },
  { id: 'assassin', name: 'Assassin', icon: '🗡️', color: '#a855f7', ring: 'ring-violet-500/60 hover:ring-violet-300', blurb: 'Spray close, finish with steel.', weapons: [UZI, KATANA], drone: false },
  { id: 'technician', name: 'Technician', icon: '🛠️', color: '#f59e0b', ring: 'ring-amber-500/60 hover:ring-amber-300', blurb: 'Hard-hitting rifle plus a gun drone.', weapons: [RIFLE], drone: true },
  { id: 'marksman', name: 'Marksman', icon: '🎯', color: '#10b981', ring: 'ring-emerald-500/60 hover:ring-emerald-300', blurb: 'Line them up, punch through.', weapons: [SNIPER, GLOCK], drone: false },
]

const RATING = (w: WeaponDef): string => {
  if (w.melee) return 'Melee · moderate damage · moderate swing'
  const dmg = w.damage >= 150 ? 'very high' : w.damage >= 55 ? 'high' : w.damage >= 28 ? 'moderate' : 'low'
  const rate = w.fireInterval <= 0.08 ? 'very fast' : w.fireInterval <= 0.15 ? 'fast' : w.fireInterval <= 0.3 ? 'moderate' : 'slow'
  return `${dmg} damage · ${rate} fire`
}

interface Zombie {
  x: number
  y: number
  r: number
  hp: number
  maxHp: number
  speed: number
  damage: number
  kind: ZombieKind
  attackCd: number
  hitFlash: number
  wobble: number
  /** Short sidestep used to slide around building corners. */
  detour: number
  detourX: number
  detourY: number
  chargeTimer: number
  telegraph: number
  dashTime: number
  dashVx: number
  dashVy: number
  bossIndex: number
}

interface Bullet {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  damage: number
  pierce: number
  drone: boolean
  hit: Set<Zombie>
}

interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  color: string
}

interface Decal {
  x: number
  y: number
  r: number
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface Upgrade {
  icon: string
  title: string
  desc: () => string
  apply: () => void
}

interface WeaponState {
  def: WeaponDef
  ammo: number
  reloading: number
}

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const mm = Math.floor(total / 60)
  const ss = total % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

const BLOCK_XS = [180, 760, 1340, 1920, 2440]
const BLOCK_W = [320, 320, 320, 260, 200]
const BLOCK_YS = [150, 690, 1250]
const BLOCK_H = 340
/** Street centre lines between the blocks, used for lane markings. */
const AVENUES_X = [630, 1210, 1790, 2310]
const AVENUES_Y = [570, 1120]

/** City blocks on a street grid, with an open plaza in the middle. */
function buildCity(): Rect[] {
  const out: Rect[] = []
  BLOCK_XS.forEach((bx, i) => {
    BLOCK_YS.forEach((by, j) => {
      if (i === 2 && j === 1) return
      const w = BLOCK_W[i]
      if ((i + j) % 3 === 0) {
        // Two buildings with an alley between them.
        const half = (BLOCK_H - 50) / 2
        out.push({ x: bx, y: by, w, h: half })
        out.push({ x: bx, y: by + half + 50, w, h: half })
      } else if ((i + j) % 3 === 1) {
        out.push({ x: bx, y: by + 30, w, h: BLOCK_H - 60 })
      } else {
        const half = (w - 50) / 2
        out.push({ x: bx, y: by, w: half, h: BLOCK_H })
        out.push({ x: bx + half + 50, y: by + 40, w: half, h: BLOCK_H - 80 })
      }
    })
  })
  return out
}

export interface HordeCabinet {
  open: () => void
  close: () => void
  isOpen: () => boolean
}

export function mountEndlessHorde(onQuit: () => void, onMainMenu: () => void): HordeCabinet {
  const overlay = document.createElement('div')
  overlay.className = 'fixed inset-0 z-40 hidden flex-col items-center justify-center bg-black/98 p-4'
  overlay.innerHTML = `
    <div class="flex w-full max-w-[1000px] items-center justify-between pb-2">
      <div class="text-xs font-black uppercase tracking-[0.35em] text-emerald-400">Endless Horde Survival</div>
      <button id="horde-quit" class="rounded-lg bg-emerald-500/20 px-4 py-1.5 text-xs font-black uppercase tracking-widest text-emerald-200 ring-1 ring-emerald-400/60 hover:bg-emerald-500/35">Back to Arcade</button>
    </div>
  `

  const frame = document.createElement('div')
  frame.className = 'relative rounded-2xl bg-slate-950 p-3 ring-2 ring-emerald-500/50 shadow-[0_0_60px_rgba(16,185,129,0.3)]'
  const canvas = document.createElement('canvas')
  canvas.width = VIEW_W
  canvas.height = VIEW_H
  canvas.className = 'block w-[min(92vw,1000px)] touch-none select-none rounded-lg bg-black'
  frame.appendChild(canvas)

  // Campaign-style HUD cards.
  const hud = document.createElement('div')
  hud.className = 'pointer-events-none absolute inset-3 hidden select-none text-white'
  hud.innerHTML = `
    <div class="absolute left-2 top-2 w-48 space-y-2 sm:left-3 sm:top-3 sm:w-64">
      <div class="rounded-lg bg-black/60 p-2 ring-1 ring-white/10 sm:p-3">
        <div class="flex items-center justify-between text-xs font-bold uppercase tracking-wider">
          <span class="flex items-center gap-2">
            <span id="horde-dot" class="inline-block h-2.5 w-2.5 rounded-full"></span>
            <span>Health</span>
            <span id="horde-class" class="font-normal normal-case text-slate-400"></span>
          </span>
          <span id="horde-hp" class="text-emerald-300"></span>
        </div>
        <div class="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-white/10">
          <div id="horde-hp-bar" class="h-full w-full rounded-full bg-emerald-500"></div>
        </div>
        <div class="mt-2 flex items-baseline justify-between">
          <span id="horde-weapon" class="text-[11px] font-semibold uppercase tracking-wider text-amber-300"></span>
          <span id="horde-ammo" class="font-mono text-base font-bold text-amber-200"></span>
        </div>
        <div id="horde-stowed" class="text-[11px] font-semibold text-slate-400"></div>
        <div id="horde-reload" class="hidden text-[11px] font-semibold text-amber-400">RELOADING…</div>
        <div id="horde-ability" class="mt-2 hidden rounded-md bg-white/5 px-2 py-1.5">
          <div class="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider">
            <span class="text-violet-300">Drone [F]</span>
            <span id="horde-ability-state" class="font-mono text-slate-300"></span>
          </div>
          <div class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div id="horde-ability-bar" class="h-full w-full rounded-full bg-violet-400"></div>
          </div>
        </div>
      </div>
    </div>
    <div class="absolute right-2 top-2 w-40 rounded-lg bg-black/60 p-2 ring-1 ring-white/10 sm:right-3 sm:top-3 sm:w-56 sm:p-3">
      <div class="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-300">
        <span>Survived</span><span id="horde-kills" class="font-mono text-rose-300">0 kills</span>
      </div>
      <div id="horde-time" class="font-mono text-2xl font-black text-white sm:text-3xl">00:00</div>
      <div class="mt-1 flex items-center justify-between text-[11px] text-slate-400">
        <span>Next upgrade</span><span id="horde-upgrade-in" class="font-mono"></span>
      </div>
      <div class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div id="horde-upgrade-bar" class="h-full w-0 rounded-full bg-emerald-500"></div>
      </div>
      <div id="horde-threat" class="mt-2 text-[11px] font-semibold text-orange-300"></div>
      <div id="horde-boss-in" class="text-[11px] font-semibold text-red-300"></div>
    </div>
  `
  frame.appendChild(hud)

  const touchButtons = document.createElement('div')
  touchButtons.className = 'absolute bottom-6 right-6 hidden gap-3'
  touchButtons.innerHTML = `
    <button id="horde-touch-swap" class="h-14 w-14 rounded-full bg-white/15 text-[11px] font-black uppercase text-white ring-2 ring-white/40">Swap</button>
    <button id="horde-touch-drone" class="h-14 w-14 rounded-full bg-violet-500/30 text-[11px] font-black uppercase text-violet-100 ring-2 ring-violet-300/60">Drone</button>
  `
  frame.appendChild(touchButtons)

  const selectPanel = document.createElement('div')
  selectPanel.className = 'absolute inset-3 hidden flex-col items-center justify-center gap-3 overflow-y-auto rounded-lg bg-black/85 p-4 text-center'
  selectPanel.innerHTML = `
    <div class="text-xs font-black uppercase tracking-[0.4em] text-emerald-300">Endless Horde</div>
    <div class="text-2xl font-black uppercase tracking-widest text-white">Choose your class</div>
    <div id="horde-class-cards" class="grid w-full max-w-[900px] gap-3 sm:grid-cols-2 lg:grid-cols-4"></div>
    <div id="horde-select-best" class="text-xs font-bold uppercase tracking-[0.3em] text-amber-300"></div>
    <div class="text-[11px] uppercase tracking-widest text-slate-400">Press 1 – 4 or click a class · Esc to leave</div>
  `
  frame.appendChild(selectPanel)

  const upgradePanel = document.createElement('div')
  upgradePanel.className = 'absolute inset-3 hidden flex-col items-center justify-center gap-3 rounded-lg bg-black/80 p-4 text-center'
  upgradePanel.innerHTML = `
    <div id="horde-upgrade-minute" class="text-xs font-black uppercase tracking-[0.4em] text-emerald-300"></div>
    <div class="text-2xl font-black uppercase tracking-widest text-white">Pick one upgrade</div>
    <div id="horde-upgrade-cards" class="grid w-full max-w-[780px] gap-3 sm:grid-cols-3"></div>
    <div class="text-[11px] uppercase tracking-widest text-slate-400">Press 1 · 2 · 3 or click a card</div>
  `
  frame.appendChild(upgradePanel)

  const overPanel = document.createElement('div')
  overPanel.className = 'absolute inset-3 hidden flex-col items-center justify-center gap-3 rounded-lg bg-black/85 p-4 text-center'
  overPanel.innerHTML = `
    <div class="text-3xl font-black uppercase tracking-widest text-red-500 sm:text-4xl">You Were Overrun</div>
    <div class="grid grid-cols-2 gap-3 pt-2 sm:gap-5">
      <div class="rounded-xl bg-white/5 px-6 py-4 ring-1 ring-emerald-400/30">
        <div class="text-[11px] font-bold uppercase tracking-[0.3em] text-slate-400">Time Survived</div>
        <div id="horde-over-time" class="pt-1 font-mono text-4xl font-black text-emerald-300">00:00</div>
      </div>
      <div class="rounded-xl bg-white/5 px-6 py-4 ring-1 ring-rose-400/30">
        <div class="text-[11px] font-bold uppercase tracking-[0.3em] text-slate-400">Total Kills</div>
        <div id="horde-over-kills" class="pt-1 font-mono text-4xl font-black text-rose-300">0</div>
      </div>
    </div>
    <div id="horde-over-best" class="text-xs font-bold uppercase tracking-[0.3em] text-amber-300"></div>
    <div class="flex flex-wrap justify-center gap-3 pt-3">
      <button id="horde-retry" class="rounded-lg bg-emerald-500 px-8 py-2.5 text-sm font-black uppercase tracking-widest text-black hover:bg-emerald-400">Retry</button>
      <button id="horde-change" class="rounded-lg bg-white/10 px-6 py-2.5 text-sm font-black uppercase tracking-widest text-slate-100 ring-1 ring-white/30 hover:bg-white/20">Change Class</button>
      <button id="horde-menu" class="rounded-lg bg-white/10 px-8 py-2.5 text-sm font-black uppercase tracking-widest text-slate-100 ring-1 ring-white/30 hover:bg-white/20">Main Menu</button>
    </div>
    <div class="text-[10px] uppercase tracking-widest text-slate-500">Enter to retry · Esc for the arcade</div>
  `
  frame.appendChild(overPanel)
  overlay.appendChild(frame)

  const legend = document.createElement('div')
  legend.className = 'pt-3 text-center text-[11px] uppercase tracking-[0.25em] text-slate-500'
  legend.textContent =
    'WASD / arrows move · mouse aims (Q / E turn aim) · click or space fires · R reloads · X / wheel swaps · F deploys drone'
  overlay.appendChild(legend)
  document.body.appendChild(overlay)

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('endless horde canvas context unavailable')
  const el = <T extends HTMLElement>(sel: string): T => {
    const node = overlay.querySelector<T>(sel)
    if (!node) throw new Error(`endless horde element ${sel} missing`)
    return node
  }
  const classCards = el<HTMLDivElement>('#horde-class-cards')
  const selectBest = el<HTMLDivElement>('#horde-select-best')
  const upgradeCards = el<HTMLDivElement>('#horde-upgrade-cards')
  const upgradeMinute = el<HTMLDivElement>('#horde-upgrade-minute')
  const overTime = el<HTMLDivElement>('#horde-over-time')
  const overKills = el<HTMLDivElement>('#horde-over-kills')
  const overBest = el<HTMLDivElement>('#horde-over-best')
  const hudDot = el<HTMLSpanElement>('#horde-dot')
  const hudClass = el<HTMLSpanElement>('#horde-class')
  const hudHp = el<HTMLSpanElement>('#horde-hp')
  const hudHpBar = el<HTMLDivElement>('#horde-hp-bar')
  const hudWeapon = el<HTMLSpanElement>('#horde-weapon')
  const hudAmmo = el<HTMLSpanElement>('#horde-ammo')
  const hudStowed = el<HTMLDivElement>('#horde-stowed')
  const hudReload = el<HTMLDivElement>('#horde-reload')
  const hudAbility = el<HTMLDivElement>('#horde-ability')
  const hudAbilityState = el<HTMLSpanElement>('#horde-ability-state')
  const hudAbilityBar = el<HTMLDivElement>('#horde-ability-bar')
  const hudTime = el<HTMLDivElement>('#horde-time')
  const hudKills = el<HTMLSpanElement>('#horde-kills')
  const hudUpgradeIn = el<HTMLSpanElement>('#horde-upgrade-in')
  const hudUpgradeBar = el<HTMLDivElement>('#horde-upgrade-bar')
  const hudThreat = el<HTMLDivElement>('#horde-threat')
  const hudBossIn = el<HTMLDivElement>('#horde-boss-in')
  const touchDrone = el<HTMLButtonElement>('#horde-touch-drone')
  const isTouch = window.matchMedia('(pointer: coarse)').matches

  const buildings = buildCity()

  let open = false
  let phase: Phase = 'select'
  let raf = 0
  let last = 0
  let blink = 0
  let shake = 0

  let elapsed = 0
  let kills = 0
  let spawnTimer = BASE_SPAWN_INTERVAL
  let nextUpgradeAt = UPGRADE_SECONDS
  let nextBossAt = MINIBOSS_SECONDS
  let bossesSpawned = 0
  let upgradesTaken = 0
  let bossBanner = 0

  let cls: ClassDef = CLASSES[0]
  let weapons: WeaponState[] = []
  let active = 0
  const mods = { damage: 1, fireRate: 1, reload: 1, magazine: 1, pellets: 0, pierce: 0, speed: 1 }

  const player = { x: ARENA_W / 2, y: ARENA_H / 2, hp: BASE_MAX_HP, maxHp: BASE_MAX_HP, fireTimer: 0, angle: 0, hurt: 0, slash: 0 }
  const drone = { active: 0, cooldown: 0, x: 0, y: 0, angle: 0, orbit: 0, fireTimer: 0 }

  let zombies: Zombie[] = []
  let bullets: Bullet[] = []
  let sparks: Spark[] = []
  let decals: Decal[] = []
  let offered: Upgrade[] = []

  const held = new Set<string>()
  let pointer = { x: VIEW_W / 2 + 100, y: VIEW_H / 2 }
  let mouseAim = true
  let pointerDown = false
  let touchMoveId: number | null = null
  let touchMoveOrigin = { x: 0, y: 0 }
  let touchMoveVec = { x: 0, y: 0 }
  let touchAimId: number | null = null

  const cam = { x: 0, y: 0 }

  const magSize = (w: WeaponDef) => Math.max(1, Math.round(w.magazine * mods.magazine))
  const current = () => weapons[active]

  const UPGRADES: Upgrade[] = [
    {
      icon: '🔫',
      title: 'Weapon Upgrade',
      desc: () =>
        mods.pellets < MAX_EXTRA_PELLETS
          ? `Guns fire +1 projectile per shot (${mods.pellets + 1} → ${mods.pellets + 2})`
          : `Rounds pierce +1 more zombie`,
      apply: () => {
        if (mods.pellets < MAX_EXTRA_PELLETS) mods.pellets += 1
        else mods.pierce += 1
      },
    },
    { icon: '💥', title: 'Damage Buff', desc: () => '+25% damage on every weapon', apply: () => (mods.damage *= 1.25) },
    { icon: '👟', title: 'Movement Speed', desc: () => '+12% movement speed', apply: () => (mods.speed *= 1.12) },
    { icon: '⚡', title: 'Reload Speed', desc: () => '−25% reload time', apply: () => (mods.reload *= 0.75) },
    { icon: '🔥', title: 'Fire Rate', desc: () => '+15% fire and swing rate', apply: () => (mods.fireRate *= 1.15) },
    {
      icon: '📦',
      title: 'Extended Mags',
      desc: () => '+40% magazine size, instantly refilled',
      apply: () => {
        mods.magazine *= 1.4
        for (const w of weapons) w.ammo = magSize(w.def)
      },
    },
    {
      icon: '❤️',
      title: 'Vitality',
      desc: () => '+25 max HP and heal 50%',
      apply: () => {
        player.maxHp += 25
        player.hp = Math.min(player.maxHp, player.hp + player.maxHp * 0.5)
      },
    },
  ]

  const pushOut = (e: { x: number; y: number }, r: number) => {
    e.x = clamp(e.x, 24 + r, ARENA_W - 24 - r)
    e.y = clamp(e.y, 24 + r, ARENA_H - 24 - r)
    for (const o of buildings) {
      const cx = clamp(e.x, o.x, o.x + o.w)
      const cy = clamp(e.y, o.y, o.y + o.h)
      const dx = e.x - cx
      const dy = e.y - cy
      const d2 = dx * dx + dy * dy
      if (d2 >= r * r) continue
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2)
        e.x = cx + (dx / d) * r
        e.y = cy + (dy / d) * r
        continue
      }
      const left = e.x - o.x
      const right = o.x + o.w - e.x
      const top = e.y - o.y
      const bottom = o.y + o.h - e.y
      const m = Math.min(left, right, top, bottom)
      if (m === left) e.x = o.x - r
      else if (m === right) e.x = o.x + o.w + r
      else if (m === top) e.y = o.y - r
      else e.y = o.y + o.h + r
    }
  }

  const insideBuilding = (x: number, y: number, pad = 0) =>
    buildings.some((o) => x >= o.x - pad && x <= o.x + o.w + pad && y >= o.y - pad && y <= o.y + o.h + pad)

  const spawnSteps = () => Math.floor(elapsed / SPAWN_STEP_SECONDS)
  const spawnRateMult = () => 1 + SPAWN_RATE_STEP * spawnSteps()

  const hidePanels = () => {
    for (const panel of [selectPanel, upgradePanel, overPanel]) {
      panel.classList.add('hidden')
      panel.classList.remove('flex')
    }
  }

  const showPanel = (panel: HTMLDivElement) => {
    panel.classList.remove('hidden')
    panel.classList.add('flex')
  }

  const setHudVisible = (visible: boolean) => {
    hud.classList.toggle('hidden', !visible)
    const touch = visible && isTouch
    touchButtons.classList.toggle('hidden', !touch)
    touchButtons.classList.toggle('flex', touch)
  }

  const reset = () => {
    elapsed = 0
    kills = 0
    spawnTimer = 1.5
    nextUpgradeAt = UPGRADE_SECONDS
    nextBossAt = MINIBOSS_SECONDS
    bossesSpawned = 0
    upgradesTaken = 0
    bossBanner = 0
    shake = 0
    Object.assign(mods, { damage: 1, fireRate: 1, reload: 1, magazine: 1, pellets: 0, pierce: 0, speed: 1 })
    Object.assign(player, { x: ARENA_W / 2, y: ARENA_H / 2, hp: BASE_MAX_HP, maxHp: BASE_MAX_HP, fireTimer: 0, angle: 0, hurt: 0, slash: 0 })
    Object.assign(drone, { active: 0, cooldown: 0, x: player.x, y: player.y, angle: 0, orbit: 0, fireTimer: 0 })
    weapons = cls.weapons.map((def) => ({ def, ammo: def.magazine, reloading: 0 }))
    active = 0
    zombies = []
    bullets = []
    sparks = []
    decals = []
    offered = []
    hidePanels()
    cam.x = clamp(player.x - VIEW_W / 2, 0, ARENA_W - VIEW_W)
    cam.y = clamp(player.y - VIEW_H / 2, 0, ARENA_H - VIEW_H)
  }

  const showSelect = () => {
    phase = 'select'
    reset()
    setHudVisible(false)
    stopMusic()
    const best = highScore('endless-horde')
    selectBest.textContent = best > 0 ? `Best time ${formatClock(best)}` : ''
    showPanel(selectPanel)
  }

  const renderClassCards = () => {
    classCards.innerHTML = ''
    CLASSES.forEach((c, i) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = `flex flex-col gap-2 rounded-xl bg-slate-900/80 p-4 text-left ring-2 transition hover:-translate-y-0.5 ${c.ring}`
      const lines = c.weapons
        .map(
          (w, wi) => `
          <div>
            <div class="text-[10px] font-bold uppercase tracking-widest text-slate-500">${c.drone ? 'Weapon' : wi === 0 ? 'Primary' : 'Secondary'}</div>
            <div class="text-sm font-bold text-white">${w.name}</div>
            <div class="text-[11px] text-slate-400">${RATING(w)}</div>
          </div>`,
        )
        .join('')
      const ability = c.drone
        ? `<div>
            <div class="text-[10px] font-bold uppercase tracking-widest text-slate-500">Special [F]</div>
            <div class="text-sm font-bold text-white">Deployable Drone</div>
            <div class="text-[11px] text-slate-400">Lasts ${DRONE_DURATION}s · ${DRONE_COOLDOWN}s cooldown · fires at AR speed</div>
          </div>`
        : ''
      btn.innerHTML = `
        <div class="flex items-center justify-between">
          <span class="text-3xl">${c.icon}</span>
          <span class="text-[10px] font-black uppercase tracking-widest text-slate-500">[${i + 1}]</span>
        </div>
        <div class="text-lg font-black uppercase tracking-wider" style="color:${c.color}">${c.name}</div>
        <div class="text-xs text-slate-300">${c.blurb}</div>
        ${lines}${ability}
      `
      btn.addEventListener('click', () => chooseClass(i))
      classCards.appendChild(btn)
    })
  }
  renderClassCards()

  const start = () => {
    reset()
    phase = 'playing'
    setHudVisible(true)
    touchDrone.classList.toggle('hidden', !cls.drone)
    recordPlay('endless-horde')
    playMusic('battle')
  }

  const chooseClass = (index: number) => {
    if (phase !== 'select') return
    const pick = CLASSES[index]
    if (!pick) return
    cls = pick
    playSfx('swap')
    start()
  }

  const spawnPoint = (margin: number): { x: number; y: number } => {
    for (let attempt = 0; attempt < 14; attempt++) {
      const side = Math.floor(Math.random() * 4)
      let x = 0
      let y = 0
      if (side === 0) {
        x = cam.x + Math.random() * VIEW_W
        y = cam.y - margin
      } else if (side === 1) {
        x = cam.x + Math.random() * VIEW_W
        y = cam.y + VIEW_H + margin
      } else if (side === 2) {
        x = cam.x - margin
        y = cam.y + Math.random() * VIEW_H
      } else {
        x = cam.x + VIEW_W + margin
        y = cam.y + Math.random() * VIEW_H
      }
      x = clamp(x, 40 + margin, ARENA_W - 40 - margin)
      y = clamp(y, 40 + margin, ARENA_H - 40 - margin)
      const offScreen = x < cam.x - 10 || x > cam.x + VIEW_W + 10 || y < cam.y - 10 || y > cam.y + VIEW_H + 10
      if (!insideBuilding(x, y, margin) && (offScreen || attempt > 10)) return { x, y }
    }
    return { x: ARENA_W / 2, y: 60 }
  }

  const makeZombie = (kind: ZombieKind, x: number, y: number): Zombie => {
    const minutes = elapsed / 60
    const base = {
      walker: { r: 13, hp: 60, speed: 78, damage: 10 },
      runner: { r: 11, hp: 38, speed: 150, damage: 8 },
      brute: { r: 20, hp: 230, speed: 62, damage: 20 },
      miniboss: { r: 36, hp: 1600, speed: 92, damage: 28 },
    }[kind]
    const hp = kind === 'miniboss' ? base.hp * (1 + 0.6 * bossesSpawned) * (1 + 0.04 * minutes) : base.hp * (1 + 0.08 * minutes)
    return {
      x,
      y,
      r: base.r,
      hp,
      maxHp: hp,
      speed: base.speed * (1 + Math.min(0.35, 0.025 * minutes)) * (0.9 + Math.random() * 0.2),
      damage: base.damage,
      kind,
      attackCd: 0,
      hitFlash: 0,
      wobble: Math.random() * Math.PI * 2,
      detour: 0,
      detourX: 0,
      detourY: 0,
      chargeTimer: 3.5,
      telegraph: 0,
      dashTime: 0,
      dashVx: 0,
      dashVy: 0,
      bossIndex: bossesSpawned,
    }
  }

  const spawnZombie = () => {
    if (zombies.length >= MAX_ZOMBIES) return
    const roll = Math.random()
    let kind: ZombieKind = 'walker'
    if (elapsed > 150 && roll < 0.1) kind = 'brute'
    else if (elapsed > 45 && roll < 0.35) kind = 'runner'
    const { x, y } = spawnPoint(30)
    zombies.push(makeZombie(kind, x, y))
  }

  const spawnMiniBoss = () => {
    bossesSpawned += 1
    const { x, y } = spawnPoint(60)
    zombies.push(makeZombie('miniboss', x, y))
    for (let i = 0; i < 6; i++) spawnZombie()
    bossBanner = 2.6
    shake = Math.max(shake, 10)
    playSfx('boss-roar')
  }

  const openUpgrade = () => {
    phase = 'upgrade'
    upgradesTaken += 1
    pointerDown = false
    const pool = [...UPGRADES]
    offered = []
    while (offered.length < 3 && pool.length) offered.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0])
    upgradeMinute.textContent = `Minute ${upgradesTaken} survived · horde paused`
    upgradeCards.innerHTML = ''
    offered.forEach((up, i) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className =
        'flex flex-col items-center gap-1 rounded-xl bg-emerald-950/60 p-4 text-center ring-2 ring-emerald-500/40 transition hover:-translate-y-0.5 hover:bg-emerald-900/70 hover:ring-emerald-300'
      btn.innerHTML = `
        <div class="text-[10px] font-black uppercase tracking-widest text-emerald-400">[${i + 1}]</div>
        <div class="text-3xl">${up.icon}</div>
        <div class="text-sm font-black uppercase tracking-wider text-white">${up.title}</div>
        <div class="text-xs text-slate-300">${up.desc()}</div>
      `
      btn.addEventListener('click', () => pickUpgrade(i))
      upgradeCards.appendChild(btn)
    })
    showPanel(upgradePanel)
    playSfx('overdrive')
  }

  const pickUpgrade = (index: number) => {
    if (phase !== 'upgrade') return
    const up = offered[index]
    if (!up) return
    up.apply()
    playSfx('medkit')
    hidePanels()
    phase = 'playing'
    last = performance.now()
  }

  const die = () => {
    phase = 'over'
    pointerDown = false
    setHudVisible(false)
    const seconds = Math.floor(elapsed)
    const previousBest = highScore('endless-horde')
    const record = submitScore('endless-horde', seconds)
    overTime.textContent = formatClock(seconds)
    overKills.textContent = `${kills}`
    overBest.textContent = record
      ? `New personal best!${previousBest > 0 ? ` (old ${formatClock(previousBest)})` : ''}`
      : `Personal best ${formatClock(previousBest)}`
    showPanel(overPanel)
    stopMusic()
    playMusic('gameover')
    playSfx('explosion')
  }

  const burst = (x: number, y: number, color: string, count: number, speed = 180) => {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const s = speed * (0.3 + Math.random())
      sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.3 + Math.random() * 0.4, color })
    }
    if (sparks.length > 600) sparks.splice(0, sparks.length - 600)
  }

  const killZombie = (z: Zombie) => {
    kills += 1
    decals.push({ x: z.x, y: z.y, r: z.r * (1 + Math.random() * 0.6) })
    if (decals.length > 260) decals.shift()
    if (z.kind === 'miniboss') {
      burst(z.x, z.y, '#f97316', 70, 320)
      shake = Math.max(shake, 14)
      playSfx('explosion')
      player.hp = Math.min(player.maxHp, player.hp + 20)
    } else {
      burst(z.x, z.y, '#b91c1c', 10)
      if (Math.random() < 0.08) playSfx('groan')
    }
  }

  const damageZombie = (z: Zombie, amount: number, knockX: number, knockY: number) => {
    z.hp -= amount
    z.hitFlash = 0.08
    const knock = z.kind === 'miniboss' ? 2 : z.kind === 'brute' ? 5 : 10
    z.x += knockX * knock
    z.y += knockY * knock
    if (z.hp <= 0) killZombie(z)
  }

  const startReload = (w: WeaponState) => {
    if (w.def.melee || w.reloading > 0 || w.ammo >= magSize(w.def)) return
    w.reloading = w.def.reload * mods.reload
  }

  const swapWeapon = () => {
    if (phase !== 'playing' || weapons.length < 2) return
    active = (active + 1) % weapons.length
    player.fireTimer = Math.max(player.fireTimer, 0.15)
    playSfx('swap')
  }

  const deployDrone = () => {
    if (phase !== 'playing' || !cls.drone || drone.cooldown > 0) return
    drone.active = DRONE_DURATION
    drone.cooldown = DRONE_COOLDOWN
    drone.x = player.x
    drone.y = player.y
    playSfx('turret')
  }

  const swing = (def: WeaponDef) => {
    const melee = def.melee
    if (!melee) return
    player.slash = 0.18
    playSfx('boss-dash')
    for (const z of zombies) {
      if (z.hp <= 0) continue
      const dx = z.x - player.x
      const dy = z.y - player.y
      const dist = Math.hypot(dx, dy)
      if (dist > melee.range + z.r) continue
      let diff = Math.atan2(dy, dx) - player.angle
      diff = Math.atan2(Math.sin(diff), Math.cos(diff))
      if (Math.abs(diff) > melee.arc / 2 && dist > z.r + PLAYER_RADIUS) continue
      damageZombie(z, def.damage * mods.damage, dx / (dist || 1), dy / (dist || 1))
      burst(z.x, z.y, '#e9d5ff', 4, 140)
    }
  }

  const fire = () => {
    const w = current()
    if (!w || player.fireTimer > 0) return
    const def = w.def
    if (def.melee) {
      player.fireTimer = def.fireInterval / mods.fireRate
      swing(def)
      return
    }
    if (w.reloading > 0) return
    if (w.ammo <= 0) {
      startReload(w)
      return
    }
    player.fireTimer = def.fireInterval / mods.fireRate
    w.ammo -= 1
    const pellets = 1 + mods.pellets
    const fan = 0.1
    for (let i = 0; i < pellets; i++) {
      const offset = (i - (pellets - 1) / 2) * fan + (Math.random() - 0.5) * def.spread
      const a = player.angle + offset
      bullets.push({
        x: player.x + Math.cos(a) * 20,
        y: player.y + Math.sin(a) * 20,
        vx: Math.cos(a) * def.bulletSpeed,
        vy: Math.sin(a) * def.bulletSpeed,
        life: 1.1,
        damage: def.damage * mods.damage,
        pierce: def.pierce + mods.pierce,
        drone: false,
        hit: new Set(),
      })
    }
    playSfx(def.damage >= 150 ? 'barricade' : 'swap')
    if (w.ammo <= 0) startReload(w)
  }

  const updateDrone = (dt: number) => {
    drone.cooldown = Math.max(0, drone.cooldown - dt)
    if (drone.active <= 0) return
    drone.active -= dt
    drone.orbit += dt * 1.6
    const tx = player.x + Math.cos(drone.orbit) * 46
    const ty = player.y + Math.sin(drone.orbit) * 46 - 10
    drone.x += (tx - drone.x) * Math.min(1, dt * 6)
    drone.y += (ty - drone.y) * Math.min(1, dt * 6)
    drone.fireTimer = Math.max(0, drone.fireTimer - dt)
    let target: Zombie | null = null
    let best = DRONE_RANGE * DRONE_RANGE
    for (const z of zombies) {
      const d2 = (z.x - drone.x) ** 2 + (z.y - drone.y) ** 2
      if (d2 < best) {
        best = d2
        target = z
      }
    }
    if (!target) return
    drone.angle = Math.atan2(target.y - drone.y, target.x - drone.x)
    if (drone.fireTimer > 0) return
    drone.fireTimer = DRONE_FIRE_INTERVAL
    const speed = 950
    bullets.push({
      x: drone.x,
      y: drone.y,
      vx: Math.cos(drone.angle) * speed,
      vy: Math.sin(drone.angle) * speed,
      life: 0.7,
      damage: DRONE_DAMAGE * mods.damage,
      pierce: 0,
      drone: true,
      hit: new Set(),
    })
  }

  const moveZombie = (z: Zombie, vx: number, vy: number, dt: number) => {
    const px = z.x
    const py = z.y
    if (z.detour > 0) {
      z.detour -= dt
      vx = vx * 0.35 + z.detourX * z.speed
      vy = vy * 0.35 + z.detourY * z.speed
    }
    z.x += vx * dt
    z.y += vy * dt
    pushOut(z, z.r)
    const intended = Math.hypot(vx, vy) * dt
    const moved = Math.hypot(z.x - px, z.y - py)
    if (z.detour <= 0 && intended > 0.5 && moved < intended * 0.3) {
      // Wedged on a wall: slide along it, picking the side that heads toward the player.
      const len = Math.hypot(vx, vy) || 1
      const side = (player.x - z.x) * -vy + (player.y - z.y) * vx >= 0 ? 1 : -1
      z.detourX = (-vy / len) * side
      z.detourY = (vx / len) * side
      z.detour = 0.7
    }
  }

  const update = (dt: number) => {
    blink += dt
    shake = Math.max(0, shake - dt * 30)
    bossBanner = Math.max(0, bossBanner - dt)
    player.slash = Math.max(0, player.slash - dt)
    for (const s of sparks) {
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.vx *= 0.9
      s.vy *= 0.9
      s.life -= dt
    }
    sparks = sparks.filter((s) => s.life > 0)
    if (phase !== 'playing') return

    elapsed += dt

    let mx = 0
    let my = 0
    if (held.has('a') || held.has('arrowleft')) mx -= 1
    if (held.has('d') || held.has('arrowright')) mx += 1
    if (held.has('w') || held.has('arrowup')) my -= 1
    if (held.has('s') || held.has('arrowdown')) my += 1
    if (touchMoveId !== null) {
      mx += touchMoveVec.x
      my += touchMoveVec.y
    }
    const mag = Math.hypot(mx, my)
    if (mag > 0) {
      const scale = Math.min(1, mag) / mag
      player.x += mx * scale * BASE_SPEED * mods.speed * dt
      player.y += my * scale * BASE_SPEED * mods.speed * dt
    }
    pushOut(player, PLAYER_RADIUS)

    cam.x = clamp(player.x - VIEW_W / 2, 0, ARENA_W - VIEW_W)
    cam.y = clamp(player.y - VIEW_H / 2, 0, ARENA_H - VIEW_H)

    const turn = (held.has('e') ? 1 : 0) - (held.has('q') ? 1 : 0)
    if (turn !== 0) {
      mouseAim = false
      player.angle += turn * KEY_AIM_TURN * dt
    } else if (mouseAim) {
      player.angle = Math.atan2(pointer.y + cam.y - player.y, pointer.x + cam.x - player.x)
    }

    player.fireTimer = Math.max(0, player.fireTimer - dt)
    player.hurt = Math.max(0, player.hurt - dt)
    for (const w of weapons) {
      if (w.reloading <= 0) continue
      w.reloading -= dt
      if (w.reloading <= 0) {
        w.reloading = 0
        w.ammo = magSize(w.def)
      }
    }
    if (pointerDown || held.has(' ') || touchAimId !== null) fire()
    updateDrone(dt)

    spawnTimer -= dt
    const interval = Math.max(MIN_SPAWN_INTERVAL, BASE_SPAWN_INTERVAL / spawnRateMult())
    while (spawnTimer <= 0) {
      spawnZombie()
      spawnTimer += interval
    }
    if (elapsed >= nextBossAt) {
      nextBossAt += MINIBOSS_SECONDS
      spawnMiniBoss()
    }

    for (const b of bullets) {
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.life -= dt
      if (b.x < 0 || b.y < 0 || b.x > ARENA_W || b.y > ARENA_H || insideBuilding(b.x, b.y)) {
        b.life = 0
        burst(b.x, b.y, '#fde68a', 3, 120)
        continue
      }
      for (const z of zombies) {
        if (z.hp <= 0 || b.hit.has(z)) continue
        const dx = z.x - b.x
        const dy = z.y - b.y
        if (dx * dx + dy * dy > (z.r + 3) * (z.r + 3)) continue
        b.hit.add(z)
        const speed = Math.hypot(b.vx, b.vy) || 1
        damageZombie(z, b.damage, b.vx / speed, b.vy / speed)
        burst(b.x, b.y, '#dc2626', 2, 90)
        if (b.pierce <= 0) {
          b.life = 0
          break
        }
        b.pierce -= 1
      }
    }
    bullets = bullets.filter((b) => b.life > 0)

    for (const z of zombies) {
      if (z.hp <= 0) continue
      z.hitFlash = Math.max(0, z.hitFlash - dt)
      z.attackCd = Math.max(0, z.attackCd - dt)
      z.wobble += dt * 6
      const dx = player.x - z.x
      const dy = player.y - z.y
      const dist = Math.hypot(dx, dy) || 1
      if (z.kind === 'miniboss') {
        if (z.dashTime > 0) {
          z.dashTime -= dt
          z.x += z.dashVx * dt
          z.y += z.dashVy * dt
          pushOut(z, z.r)
        } else if (z.telegraph > 0) {
          z.telegraph -= dt
          if (z.telegraph <= 0) {
            z.dashTime = 0.55
            z.dashVx = (dx / dist) * 560
            z.dashVy = (dy / dist) * 560
            playSfx('boss-dash')
          }
        } else {
          z.chargeTimer -= dt
          moveZombie(z, (dx / dist) * z.speed, (dy / dist) * z.speed, dt)
          if (z.chargeTimer <= 0 && dist < 520) {
            z.chargeTimer = 3.8 + Math.random() * 1.5
            z.telegraph = 0.65
          }
        }
      } else {
        moveZombie(z, (dx / dist) * z.speed, (dy / dist) * z.speed, dt)
      }
      if (dist < z.r + PLAYER_RADIUS && z.attackCd <= 0) {
        z.attackCd = z.kind === 'miniboss' ? 0.9 : 0.75
        player.hp -= z.damage
        player.hurt = 0.25
        shake = Math.max(shake, z.kind === 'miniboss' ? 9 : 4)
        playSfx('sting')
      }
    }
    zombies = zombies.filter((z) => z.hp > 0)

    for (let i = 0; i < zombies.length; i++) {
      const a = zombies[i]
      for (let j = i + 1; j < zombies.length; j++) {
        const b = zombies[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const min = a.r + b.r
        const d2 = dx * dx + dy * dy
        if (d2 >= min * min || d2 === 0) continue
        const d = Math.sqrt(d2)
        const push = (min - d) / 2
        const wa = a.kind === 'miniboss' ? 0.1 : 1
        const wb = b.kind === 'miniboss' ? 0.1 : 1
        a.x -= (dx / d) * push * wa
        a.y -= (dy / d) * push * wa
        b.x += (dx / d) * push * wb
        b.y += (dy / d) * push * wb
      }
    }

    if (player.hp <= 0) {
      player.hp = 0
      die()
      return
    }

    if (elapsed >= nextUpgradeAt) {
      nextUpgradeAt += UPGRADE_SECONDS
      openUpgrade()
    }
  }

  const drawStreets = () => {
    ctx.fillStyle = STREET_COLOR
    ctx.fillRect(0, 0, ARENA_W, ARENA_H)
    const x0 = Math.max(0, cam.x - 100)
    const y0 = Math.max(0, cam.y - 100)
    const x1 = Math.min(ARENA_W, cam.x + VIEW_W + 100)
    const y1 = Math.min(ARENA_H, cam.y + VIEW_H + 100)
    // Asphalt seams, matching the campaign streets.
    ctx.fillStyle = 'rgba(255,255,255,0.02)'
    for (let y = Math.floor(y0 / 60) * 60; y < y1; y += 60) {
      for (let x = Math.floor(x0 / 90) * 90; x < x1; x += 90) {
        ctx.fillRect(x + ((y / 60) % 2 ? 45 : 0), y, 86, 56)
      }
    }
    ctx.strokeStyle = 'rgba(240,220,120,0.18)'
    ctx.lineWidth = 6
    ctx.setLineDash([40, 34])
    for (const y of AVENUES_Y) {
      ctx.beginPath()
      ctx.moveTo(x0, y)
      ctx.lineTo(x1, y)
      ctx.stroke()
    }
    for (const x of AVENUES_X) {
      ctx.beginPath()
      ctx.moveTo(x, y0)
      ctx.lineTo(x, y1)
      ctx.stroke()
    }
    ctx.setLineDash([])
    // Crosswalks at the intersections.
    ctx.fillStyle = 'rgba(255,255,255,0.1)'
    for (const ax of AVENUES_X) {
      for (const ay of AVENUES_Y) {
        for (let k = -3; k <= 3; k++) {
          ctx.fillRect(ax - 70, ay + k * 14 - 4, 22, 8)
          ctx.fillRect(ax + 48, ay + k * 14 - 4, 22, 8)
        }
      }
    }
    // Plaza paving in the open centre block.
    const px = BLOCK_XS[2]
    const py = BLOCK_YS[1]
    ctx.fillStyle = 'rgba(148,163,184,0.06)'
    ctx.fillRect(px, py, BLOCK_W[2], BLOCK_H)
    ctx.strokeStyle = 'rgba(148,163,184,0.12)'
    ctx.lineWidth = 2
    for (let gx = px; gx <= px + BLOCK_W[2]; gx += 40) {
      ctx.beginPath()
      ctx.moveTo(gx, py)
      ctx.lineTo(gx, py + BLOCK_H)
      ctx.stroke()
    }
    for (let gy = py; gy <= py + BLOCK_H; gy += 40) {
      ctx.beginPath()
      ctx.moveTo(px, gy)
      ctx.lineTo(px + BLOCK_W[2], gy)
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(120,10,10,0.35)'
    for (const d of decals) {
      ctx.beginPath()
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
      ctx.fill()
    }
    // Sidewalk kerbs around every building.
    ctx.fillStyle = 'rgba(148,163,184,0.16)'
    for (const b of buildings) ctx.fillRect(b.x - 14, b.y - 14, b.w + 28, b.h + 28)
    // City edge barrier.
    ctx.fillStyle = '#3f3f46'
    ctx.fillRect(0, 0, ARENA_W, 24)
    ctx.fillRect(0, ARENA_H - 24, ARENA_W, 24)
    ctx.fillRect(0, 0, 24, ARENA_H)
    ctx.fillRect(ARENA_W - 24, 0, 24, ARENA_H)
  }

  /** Brick courses, window grid and rooftop lip, as on the campaign streets. */
  const drawBuilding = (w: Rect) => {
    if (w.x > cam.x + VIEW_W || w.x + w.w < cam.x || w.y > cam.y + VIEW_H || w.y + w.h < cam.y) return
    ctx.save()
    ctx.fillStyle = BUILDING_COLOR
    ctx.fillRect(w.x, w.y, w.w, w.h)
    ctx.beginPath()
    ctx.rect(w.x, w.y, w.w, w.h)
    ctx.clip()
    ctx.strokeStyle = 'rgba(0,0,0,0.22)'
    ctx.lineWidth = 1.5
    for (let y = w.y + 14; y < w.y + w.h; y += 14) {
      ctx.beginPath()
      ctx.moveTo(w.x, y)
      ctx.lineTo(w.x + w.w, y)
      ctx.stroke()
    }
    let row = 0
    for (let y = w.y; y < w.y + w.h; y += 14, row++) {
      for (let x = w.x + (row % 2 ? 0 : 14); x < w.x + w.w; x += 28) {
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x, y + 14)
        ctx.stroke()
      }
    }
    for (let y = w.y + 20; y < w.y + w.h - 22; y += 46) {
      for (let x = w.x + 18; x < w.x + w.w - 20; x += 42) {
        const lit = (x * 7 + y * 13) % 11 < 3
        ctx.fillStyle = lit ? 'rgba(255,212,121,0.5)' : 'rgba(15,23,32,0.72)'
        ctx.fillRect(x, y, 22, 24)
        ctx.strokeStyle = 'rgba(0,0,0,0.45)'
        ctx.lineWidth = 2
        ctx.strokeRect(x, y, 22, 24)
        ctx.beginPath()
        ctx.moveTo(x + 11, y)
        ctx.lineTo(x + 11, y + 24)
        ctx.moveTo(x, y + 12)
        ctx.lineTo(x + 22, y + 12)
        ctx.stroke()
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.fillRect(w.x, w.y, w.w, 10)
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    for (let x = w.x + 24; x < w.x + w.w - 20; x += 96) ctx.fillRect(x, w.y + 2, 26, 6)
    ctx.restore()
    ctx.strokeStyle = BUILDING_EDGE
    ctx.lineWidth = 3
    ctx.strokeRect(w.x, w.y, w.w, w.h)
  }

  const drawZombie = (z: Zombie) => {
    const a = Math.atan2(player.y - z.y, player.x - z.x)
    const palette: Record<ZombieKind, string> = { walker: '#4d7c0f', runner: '#65a30d', brute: '#3f6212', miniboss: '#7c2d12' }
    ctx.save()
    ctx.translate(z.x, z.y)
    ctx.rotate(a)
    if (z.kind === 'miniboss') {
      const glow = z.telegraph > 0 ? 0.6 + 0.4 * Math.sin(blink * 40) : 0.25
      ctx.fillStyle = `rgba(249,115,22,${glow})`
      ctx.beginPath()
      ctx.arc(0, 0, z.r + 10, 0, Math.PI * 2)
      ctx.fill()
    }
    const sway = Math.sin(z.wobble) * z.r * 0.25
    ctx.fillStyle = z.hitFlash > 0 ? '#fef2f2' : palette[z.kind]
    ctx.fillRect(z.r * 0.2, -z.r * 0.95 + sway * 0.3, z.r * 0.9, z.r * 0.32)
    ctx.fillRect(z.r * 0.2, z.r * 0.63 - sway * 0.3, z.r * 0.9, z.r * 0.32)
    ctx.beginPath()
    ctx.arc(0, 0, z.r, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = z.kind === 'miniboss' ? '#fde047' : '#fecaca'
    ctx.fillRect(z.r * 0.35, -z.r * 0.4, z.r * 0.2, z.r * 0.2)
    ctx.fillRect(z.r * 0.35, z.r * 0.2, z.r * 0.2, z.r * 0.2)
    ctx.restore()
    if (z.kind === 'brute' || (z.kind !== 'miniboss' && z.hp < z.maxHp)) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(z.x - z.r, z.y - z.r - 8, z.r * 2, 4)
      ctx.fillStyle = '#ef4444'
      ctx.fillRect(z.x - z.r, z.y - z.r - 8, z.r * 2 * Math.max(0, z.hp / z.maxHp), 4)
    }
  }

  const drawDrone = () => {
    if (drone.active <= 0) return
    ctx.save()
    ctx.translate(drone.x, drone.y)
    const fading = drone.active < 3 && Math.floor(blink * 8) % 2 === 0
    ctx.globalAlpha = fading ? 0.45 : 1
    ctx.strokeStyle = 'rgba(167,139,250,0.7)'
    ctx.lineWidth = 2
    for (let i = 0; i < 4; i++) {
      const a = (Math.PI / 2) * i + Math.PI / 4
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(Math.cos(a) * 12, Math.sin(a) * 12)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(Math.cos(a) * 12, Math.sin(a) * 12, 4, blink * 30, blink * 30 + Math.PI)
      ctx.stroke()
    }
    ctx.rotate(drone.angle)
    ctx.fillStyle = '#334155'
    ctx.fillRect(2, -2, 12, 4)
    ctx.fillStyle = '#a78bfa'
    ctx.beginPath()
    ctx.arc(0, 0, 6, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  const drawPlayer = () => {
    const def = current()?.def
    ctx.save()
    ctx.translate(player.x, player.y)
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([6, 8])
    ctx.beginPath()
    ctx.moveTo(Math.cos(player.angle) * 22, Math.sin(player.angle) * 22)
    ctx.lineTo(Math.cos(player.angle) * 160, Math.sin(player.angle) * 160)
    ctx.stroke()
    ctx.setLineDash([])
    if (player.slash > 0 && def?.melee) {
      ctx.strokeStyle = `rgba(233,213,255,${player.slash * 4})`
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.arc(0, 0, def.melee.range * 0.8, player.angle - def.melee.arc / 2, player.angle + def.melee.arc / 2)
      ctx.stroke()
    }
    ctx.rotate(player.angle)
    if (def?.melee) {
      ctx.fillStyle = '#e5e7eb'
      ctx.fillRect(8, -1.5, 34, 3)
      ctx.fillStyle = '#7c2d12'
      ctx.fillRect(4, -2.5, 8, 5)
    } else {
      ctx.fillStyle = '#1f2937'
      const len = def && def.damage >= 150 ? 34 : def && def.magazine <= 15 ? 16 : 24
      ctx.fillRect(6, -3.5, len, 7)
    }
    ctx.fillStyle = player.hurt > 0 ? '#fca5a5' : cls.color
    ctx.beginPath()
    ctx.arc(0, 0, PLAYER_RADIUS, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.beginPath()
    ctx.arc(-2, 0, PLAYER_RADIUS * 0.55, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  const bar = (x: number, y: number, w: number, h: number, frac: number, color: string) => {
    ctx.fillStyle = 'rgba(0,0,0,0.65)'
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = color
    ctx.fillRect(x + 1, y + 1, (w - 2) * clamp(frac, 0, 1), h - 2)
  }

  const drawMinimap = () => {
    const w = 168
    const h = (w * ARENA_H) / ARENA_W
    const x = VIEW_W - w - 14
    const y = VIEW_H - h - 14
    const sx = w / ARENA_W
    const sy = h / ARENA_H
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = 'rgba(139,90,43,0.7)'
    for (const o of buildings) ctx.fillRect(x + o.x * sx, y + o.y * sy, Math.max(2, o.w * sx), Math.max(2, o.h * sy))
    for (const z of zombies) {
      ctx.fillStyle = z.kind === 'miniboss' ? '#f97316' : '#ef4444'
      const s = z.kind === 'miniboss' ? 5 : 2
      ctx.fillRect(x + z.x * sx - s / 2, y + z.y * sy - s / 2, s, s)
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 1
    ctx.strokeRect(x + cam.x * sx, y + cam.y * sy, VIEW_W * sx, VIEW_H * sy)
    ctx.fillStyle = cls.color
    ctx.fillRect(x + player.x * sx - 2.5, y + player.y * sy - 2.5, 5, 5)
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
  }

  const updateHud = () => {
    const pct = (player.hp / player.maxHp) * 100
    hudDot.style.background = cls.color
    hudClass.textContent = cls.name
    hudHp.textContent = `${Math.ceil(player.hp)} / ${player.maxHp}`
    hudHpBar.style.width = `${pct}%`
    hudHpBar.className = `h-full rounded-full transition-[width] duration-150 ${
      pct > 50 ? 'bg-emerald-500' : pct > 25 ? 'bg-amber-500' : 'bg-red-500'
    }`
    const w = current()
    if (w) {
      hudWeapon.textContent = w.def.name
      hudAmmo.textContent = w.def.melee ? '∞' : `${w.ammo} / ${magSize(w.def)}`
      hudReload.classList.toggle('hidden', w.reloading <= 0)
    }
    const stowed = weapons.length > 1 ? weapons[(active + 1) % weapons.length].def.name : ''
    hudStowed.textContent = stowed ? `Swap [X]: ${stowed}` : ''
    hudAbility.classList.toggle('hidden', !cls.drone)
    if (cls.drone) {
      if (drone.active > 0) {
        hudAbilityState.textContent = `ACTIVE ${Math.ceil(drone.active)}s`
        hudAbilityBar.style.width = `${(drone.active / DRONE_DURATION) * 100}%`
      } else if (drone.cooldown > 0) {
        hudAbilityState.textContent = `${Math.ceil(drone.cooldown)}s`
        hudAbilityBar.style.width = `${(1 - drone.cooldown / DRONE_COOLDOWN) * 100}%`
      } else {
        hudAbilityState.textContent = 'READY'
        hudAbilityBar.style.width = '100%'
      }
    }
    hudTime.textContent = formatClock(elapsed)
    hudKills.textContent = `${kills} kills`
    const toUpgrade = Math.max(0, nextUpgradeAt - elapsed)
    hudUpgradeIn.textContent = `${Math.ceil(toUpgrade)}s`
    hudUpgradeBar.style.width = `${(1 - toUpgrade / UPGRADE_SECONDS) * 100}%`
    hudThreat.textContent = `Threat Lv ${spawnSteps() + 1} · spawns x${spawnRateMult().toFixed(2)}`
    hudBossIn.textContent = `Mini-boss in ${formatClock(nextBossAt - elapsed)}`
  }

  const drawCanvasHud = () => {
    const boss = zombies.find((z) => z.kind === 'miniboss')
    ctx.save()
    ctx.textAlign = 'center'
    if (boss) {
      ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif'
      ctx.fillStyle = '#fdba74'
      ctx.fillText(`Mini-Boss · Butcher Brute #${boss.bossIndex + 1}`, VIEW_W / 2, VIEW_H - 40)
      bar(VIEW_W / 2 - 200, VIEW_H - 32, 400, 12, boss.hp / boss.maxHp, '#ea580c')
    }
    if (bossBanner > 0) {
      ctx.globalAlpha = Math.min(1, bossBanner)
      ctx.font = '800 36px ui-sans-serif, system-ui, sans-serif'
      ctx.fillStyle = '#f97316'
      ctx.fillText('⚠ MINI-BOSS INCOMING ⚠', VIEW_W / 2, VIEW_H / 2 - 90)
    }
    ctx.restore()
    drawMinimap()
  }

  const draw = () => {
    ctx.save()
    ctx.clearRect(0, 0, VIEW_W, VIEW_H)
    const sx = shake > 0 ? (Math.random() - 0.5) * shake : 0
    const sy = shake > 0 ? (Math.random() - 0.5) * shake : 0
    ctx.translate(-cam.x + sx, -cam.y + sy)
    drawStreets()
    for (const b of bullets) {
      ctx.fillStyle = b.drone ? '#c4b5fd' : '#fde68a'
      ctx.beginPath()
      ctx.arc(b.x, b.y, b.drone ? 2.5 : 3, 0, Math.PI * 2)
      ctx.fill()
    }
    for (const z of zombies) drawZombie(z)
    drawPlayer()
    for (const b of buildings) drawBuilding(b)
    drawDrone()
    for (const s of sparks) {
      ctx.globalAlpha = clamp(s.life * 2, 0, 1)
      ctx.fillStyle = s.color
      ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3)
    }
    ctx.globalAlpha = 1
    ctx.restore()

    if (player.hurt > 0) {
      ctx.fillStyle = `rgba(220,38,38,${player.hurt * 0.8})`
      ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    }
    if (phase === 'select') {
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.fillRect(0, 0, VIEW_W, VIEW_H)
      return
    }
    if (phase === 'playing' || phase === 'upgrade') {
      updateHud()
      drawCanvasHud()
    }
  }

  const frameStep = (now: number) => {
    if (!open) return
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    update(dt)
    draw()
    raf = window.requestAnimationFrame(frameStep)
  }

  const toCanvas = (clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect()
    return { x: ((clientX - rect.left) / rect.width) * VIEW_W, y: ((clientY - rect.top) / rect.height) * VIEW_H }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) return
    const key = e.key.toLowerCase()
    e.stopPropagation()
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(key)) e.preventDefault()
    if (key === 'escape') {
      close()
      return
    }
    if (phase === 'select') {
      if (['1', '2', '3', '4'].includes(key)) chooseClass(Number(key) - 1)
      return
    }
    if (phase === 'upgrade') {
      if (key === '1' || key === '2' || key === '3') pickUpgrade(Number(key) - 1)
      return
    }
    if (phase === 'over') {
      if (key === 'enter') start()
      return
    }
    held.add(key)
    if (e.repeat) return
    if (key === 'r') {
      const w = current()
      if (w) startReload(w)
    }
    if (key === 'x') swapWeapon()
    if (key === 'f') deployDrone()
  }

  const onKeyUp = (e: KeyboardEvent) => {
    if (!open) return
    e.stopPropagation()
    held.delete(e.key.toLowerCase())
  }

  const onMouseMove = (e: MouseEvent) => {
    pointer = toCanvas(e.clientX, e.clientY)
    mouseAim = true
  }

  const onTouchStart = (e: TouchEvent) => {
    e.preventDefault()
    if (phase !== 'playing') return
    for (const t of Array.from(e.changedTouches)) {
      const p = toCanvas(t.clientX, t.clientY)
      if (p.x < VIEW_W / 2 && touchMoveId === null) {
        touchMoveId = t.identifier
        touchMoveOrigin = p
        touchMoveVec = { x: 0, y: 0 }
      } else if (touchAimId === null) {
        touchAimId = t.identifier
        pointer = p
        mouseAim = true
      }
    }
  }

  const onTouchMove = (e: TouchEvent) => {
    e.preventDefault()
    for (const t of Array.from(e.changedTouches)) {
      const p = toCanvas(t.clientX, t.clientY)
      if (t.identifier === touchMoveId) {
        const dx = p.x - touchMoveOrigin.x
        const dy = p.y - touchMoveOrigin.y
        const d = Math.hypot(dx, dy)
        const k = Math.min(1, d / 60)
        touchMoveVec = d > 6 ? { x: (dx / d) * k, y: (dy / d) * k } : { x: 0, y: 0 }
      } else if (t.identifier === touchAimId) {
        pointer = p
        mouseAim = true
      }
    }
  }

  const onTouchEnd = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === touchMoveId) {
        touchMoveId = null
        touchMoveVec = { x: 0, y: 0 }
      }
      if (t.identifier === touchAimId) touchAimId = null
    }
  }

  const releaseInput = () => {
    held.clear()
    pointerDown = false
    touchMoveId = null
    touchAimId = null
    touchMoveVec = { x: 0, y: 0 }
  }

  function hideOverlay() {
    open = false
    window.cancelAnimationFrame(raf)
    releaseInput()
    hidePanels()
    setHudVisible(false)
    stopMusic()
    overlay.classList.add('hidden')
    overlay.classList.remove('flex')
  }

  function close() {
    if (!open) return
    hideOverlay()
    onQuit()
  }

  el<HTMLButtonElement>('#horde-quit').addEventListener('click', () => close())
  el<HTMLButtonElement>('#horde-retry').addEventListener('click', () => start())
  el<HTMLButtonElement>('#horde-change').addEventListener('click', () => showSelect())
  el<HTMLButtonElement>('#horde-menu').addEventListener('click', () => {
    if (!open) return
    hideOverlay()
    onMainMenu()
  })
  el<HTMLButtonElement>('#horde-touch-swap').addEventListener('click', () => swapWeapon())
  touchDrone.addEventListener('click', () => deployDrone())
  canvas.addEventListener('mousemove', onMouseMove)
  canvas.addEventListener('mousedown', () => {
    if (phase === 'playing') pointerDown = true
  })
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (phase !== 'playing') return
      e.preventDefault()
      swapWeapon()
    },
    { passive: false },
  )
  window.addEventListener('mouseup', () => (pointerDown = false))
  canvas.addEventListener('touchstart', onTouchStart, { passive: false })
  canvas.addEventListener('touchmove', onTouchMove, { passive: false })
  canvas.addEventListener('touchend', onTouchEnd)
  canvas.addEventListener('touchcancel', onTouchEnd)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('keyup', onKeyUp, true)
  window.addEventListener('blur', releaseInput)

  return {
    open: () => {
      if (open) return
      open = true
      overlay.classList.remove('hidden')
      overlay.classList.add('flex')
      showSelect()
      last = performance.now()
      raf = window.requestAnimationFrame(frameStep)
    },
    close,
    isOpen: () => open,
  }
}
