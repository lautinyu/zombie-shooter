/**
 * ENDLESS HORDE SURVIVAL — a standalone arcade cabinet: one survivor, a wide
 * walled arena and a horde that never stops. Spawns ramp every 30 s, an upgrade
 * draft opens every 60 s and a mini-boss joins the wave every 90 s.
 *
 * Like the other cabinets it owns its overlay, canvas, loop, input and storage,
 * so campaign state is never touched. Aim is fully manual (mouse, Q/E, touch).
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
const BASE_DAMAGE = 34
const BASE_FIRE_INTERVAL = 0.16
const BASE_MAGAZINE = 24
const BASE_RELOAD = 1.5
const BULLET_SPEED = 980
const KEY_AIM_TURN = 3.6
const MAX_PELLETS = 5

const BASE_SPAWN_INTERVAL = 1.2
const MIN_SPAWN_INTERVAL = 0.11
const SPAWN_STEP_SECONDS = 30
/** Each 30 s step adds this much to the spawn rate multiplier. */
const SPAWN_RATE_STEP = 0.22
const UPGRADE_SECONDS = 60
const MINIBOSS_SECONDS = 90
const MAX_ZOMBIES = 170

type Phase = 'attract' | 'playing' | 'upgrade' | 'over'
type ZombieKind = 'walker' | 'runner' | 'brute' | 'miniboss'

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
  /** Mini-boss charge cycle: counts down to a telegraph, then a dash. */
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
  id: string
  icon: string
  title: string
  desc: () => string
  apply: () => void
}

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const mm = Math.floor(total / 60)
  const ss = total % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Pillars and wreck piles laid out on a fixed grid, keeping the centre clear. */
function buildObstacles(): Rect[] {
  const out: Rect[] = []
  const xs = [420, 980, 1540, 2100, 2500]
  const ys = [340, 900, 1460]
  xs.forEach((gx, i) => {
    ys.forEach((gy, j) => {
      if (Math.abs(gx - ARENA_W / 2) < 300 && Math.abs(gy - ARENA_H / 2) < 300) return
      const wide = (i + j) % 2 === 0
      const w = wide ? 170 : 80
      const h = wide ? 70 : 140
      out.push({ x: gx - w / 2 + ((j % 2) * 60 - 30), y: gy - h / 2, w, h })
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
  frame.className =
    'relative rounded-2xl bg-slate-950 p-3 ring-2 ring-emerald-500/50 shadow-[0_0_60px_rgba(16,185,129,0.3)]'
  const canvas = document.createElement('canvas')
  canvas.width = VIEW_W
  canvas.height = VIEW_H
  canvas.className = 'block w-[min(92vw,1000px)] touch-none select-none rounded-lg bg-black'
  frame.appendChild(canvas)

  const upgradePanel = document.createElement('div')
  upgradePanel.className =
    'absolute inset-3 hidden flex-col items-center justify-center gap-3 rounded-lg bg-black/80 p-4 text-center'
  upgradePanel.innerHTML = `
    <div id="horde-upgrade-minute" class="text-xs font-black uppercase tracking-[0.4em] text-emerald-300"></div>
    <div class="text-2xl font-black uppercase tracking-widest text-white">Pick one upgrade</div>
    <div id="horde-upgrade-cards" class="grid w-full max-w-[780px] gap-3 sm:grid-cols-3"></div>
    <div class="text-[11px] uppercase tracking-widest text-slate-400">Press 1 · 2 · 3 or click a card</div>
  `
  frame.appendChild(upgradePanel)

  const overPanel = document.createElement('div')
  overPanel.className =
    'absolute inset-3 hidden flex-col items-center justify-center gap-3 rounded-lg bg-black/85 p-4 text-center'
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
      <button id="horde-menu" class="rounded-lg bg-white/10 px-8 py-2.5 text-sm font-black uppercase tracking-widest text-slate-100 ring-1 ring-white/30 hover:bg-white/20">Main Menu</button>
    </div>
    <div class="text-[10px] uppercase tracking-widest text-slate-500">Enter to retry · Esc for the arcade</div>
  `
  frame.appendChild(overPanel)
  overlay.appendChild(frame)

  const legend = document.createElement('div')
  legend.className = 'pt-3 text-center text-[11px] uppercase tracking-[0.25em] text-slate-500'
  legend.textContent =
    'WASD / arrows move · mouse aims (Q / E turn aim) · click or space fires · R reloads · touch: left drag moves, right side aims + fires'
  overlay.appendChild(legend)
  document.body.appendChild(overlay)

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('endless horde canvas context unavailable')
  const el = <T extends HTMLElement>(sel: string): T => {
    const node = overlay.querySelector<T>(sel)
    if (!node) throw new Error(`endless horde element ${sel} missing`)
    return node
  }
  const upgradeCards = el<HTMLDivElement>('#horde-upgrade-cards')
  const upgradeMinute = el<HTMLDivElement>('#horde-upgrade-minute')
  const overTime = el<HTMLDivElement>('#horde-over-time')
  const overKills = el<HTMLDivElement>('#horde-over-kills')
  const overBest = el<HTMLDivElement>('#horde-over-best')

  const obstacles = buildObstacles()

  let open = false
  let phase: Phase = 'attract'
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

  const player = {
    x: ARENA_W / 2,
    y: ARENA_H / 2,
    hp: BASE_MAX_HP,
    maxHp: BASE_MAX_HP,
    speed: BASE_SPEED,
    damage: BASE_DAMAGE,
    fireInterval: BASE_FIRE_INTERVAL,
    magazine: BASE_MAGAZINE,
    ammo: BASE_MAGAZINE,
    reloadTime: BASE_RELOAD,
    reloading: 0,
    fireTimer: 0,
    pellets: 1,
    pierce: 0,
    angle: 0,
    hurt: 0,
  }

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

  const UPGRADES: Upgrade[] = [
    {
      id: 'weapon',
      icon: '🔫',
      title: 'Weapon Upgrade',
      desc: () =>
        player.pellets < MAX_PELLETS
          ? `+1 projectile per shot (${player.pellets} → ${player.pellets + 1})`
          : `Rounds pierce +1 more zombie (${player.pierce} → ${player.pierce + 1})`,
      apply: () => {
        if (player.pellets < MAX_PELLETS) player.pellets += 1
        else player.pierce += 1
      },
    },
    {
      id: 'damage',
      icon: '💥',
      title: 'Damage Buff',
      desc: () => '+25% damage per round',
      apply: () => (player.damage *= 1.25),
    },
    {
      id: 'speed',
      icon: '👟',
      title: 'Movement Speed',
      desc: () => '+12% movement speed',
      apply: () => (player.speed *= 1.12),
    },
    {
      id: 'reload',
      icon: '⚡',
      title: 'Reload Speed',
      desc: () => '−25% reload time',
      apply: () => (player.reloadTime *= 0.75),
    },
    {
      id: 'firerate',
      icon: '🔥',
      title: 'Fire Rate',
      desc: () => '+15% fire rate',
      apply: () => (player.fireInterval *= 0.87),
    },
    {
      id: 'magazine',
      icon: '📦',
      title: 'Extended Mag',
      desc: () => `+10 rounds per magazine (${player.magazine} → ${player.magazine + 10})`,
      apply: () => {
        player.magazine += 10
        player.ammo = player.magazine
      },
    },
    {
      id: 'vitality',
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
    e.x = clamp(e.x, r, ARENA_W - r)
    e.y = clamp(e.y, r, ARENA_H - r)
    for (const o of obstacles) {
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

  const insideObstacle = (x: number, y: number) =>
    obstacles.some((o) => x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h)

  const spawnSteps = () => Math.floor(elapsed / SPAWN_STEP_SECONDS)
  const spawnRateMult = () => 1 + SPAWN_RATE_STEP * spawnSteps()

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
    Object.assign(player, {
      x: ARENA_W / 2,
      y: ARENA_H / 2,
      hp: BASE_MAX_HP,
      maxHp: BASE_MAX_HP,
      speed: BASE_SPEED,
      damage: BASE_DAMAGE,
      fireInterval: BASE_FIRE_INTERVAL,
      magazine: BASE_MAGAZINE,
      ammo: BASE_MAGAZINE,
      reloadTime: BASE_RELOAD,
      reloading: 0,
      fireTimer: 0,
      pellets: 1,
      pierce: 0,
      angle: 0,
      hurt: 0,
    })
    zombies = []
    bullets = []
    sparks = []
    decals = []
    offered = []
    hidePanels()
  }

  const hidePanels = () => {
    for (const panel of [upgradePanel, overPanel]) {
      panel.classList.add('hidden')
      panel.classList.remove('flex')
    }
  }

  const showPanel = (panel: HTMLDivElement) => {
    panel.classList.remove('hidden')
    panel.classList.add('flex')
  }

  const start = () => {
    reset()
    phase = 'playing'
    recordPlay('endless-horde')
    playMusic('battle')
  }

  const spawnPoint = (margin: number): { x: number; y: number } => {
    for (let attempt = 0; attempt < 10; attempt++) {
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
      x = clamp(x, margin, ARENA_W - margin)
      y = clamp(y, margin, ARENA_H - margin)
      const offScreen = x < cam.x - 10 || x > cam.x + VIEW_W + 10 || y < cam.y - 10 || y > cam.y + VIEW_H + 10
      if (!insideObstacle(x, y) && (offScreen || attempt > 6)) return { x, y }
    }
    return { x: margin, y: margin }
  }

  const makeZombie = (kind: ZombieKind, x: number, y: number): Zombie => {
    const minutes = elapsed / 60
    const hpScale = 1 + 0.08 * minutes
    const base = {
      walker: { r: 13, hp: 60, speed: 78, damage: 10 },
      runner: { r: 11, hp: 38, speed: 150, damage: 8 },
      brute: { r: 20, hp: 230, speed: 62, damage: 20 },
      miniboss: { r: 36, hp: 1600, speed: 92, damage: 28 },
    }[kind]
    const hp = kind === 'miniboss' ? base.hp * (1 + 0.6 * bossesSpawned) * (1 + 0.04 * minutes) : base.hp * hpScale
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
    while (offered.length < 3 && pool.length) {
      offered.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0])
    }
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

  const fire = () => {
    if (player.reloading > 0 || player.fireTimer > 0) return
    if (player.ammo <= 0) {
      player.reloading = player.reloadTime
      return
    }
    player.fireTimer = player.fireInterval
    player.ammo -= 1
    const spread = 0.11
    for (let i = 0; i < player.pellets; i++) {
      const offset = (i - (player.pellets - 1) / 2) * spread
      const a = player.angle + offset
      bullets.push({
        x: player.x + Math.cos(a) * 18,
        y: player.y + Math.sin(a) * 18,
        vx: Math.cos(a) * BULLET_SPEED,
        vy: Math.sin(a) * BULLET_SPEED,
        life: 0.9,
        damage: player.damage,
        pierce: player.pierce,
        hit: new Set(),
      })
    }
    playSfx('swap')
    if (player.ammo <= 0) player.reloading = player.reloadTime
  }

  const update = (dt: number) => {
    blink += dt
    shake = Math.max(0, shake - dt * 30)
    bossBanner = Math.max(0, bossBanner - dt)
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

    // Movement
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
      player.x += mx * scale * player.speed * dt
      player.y += my * scale * player.speed * dt
    }
    pushOut(player, PLAYER_RADIUS)

    cam.x = clamp(player.x - VIEW_W / 2, 0, ARENA_W - VIEW_W)
    cam.y = clamp(player.y - VIEW_H / 2, 0, ARENA_H - VIEW_H)

    // Manual aim only: pointer position, Q/E rotation or the touch aim finger.
    const turn = (held.has('e') ? 1 : 0) - (held.has('q') ? 1 : 0)
    if (turn !== 0) {
      mouseAim = false
      player.angle += turn * KEY_AIM_TURN * dt
    } else if (mouseAim) {
      player.angle = Math.atan2(pointer.y + cam.y - player.y, pointer.x + cam.x - player.x)
    }

    player.fireTimer = Math.max(0, player.fireTimer - dt)
    player.hurt = Math.max(0, player.hurt - dt)
    if (player.reloading > 0) {
      player.reloading -= dt
      if (player.reloading <= 0) {
        player.reloading = 0
        player.ammo = player.magazine
      }
    }
    if (pointerDown || held.has(' ') || touchAimId !== null) fire()

    // Spawning ramps every 30 s.
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

    // Bullets
    for (const b of bullets) {
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.life -= dt
      if (b.x < 0 || b.y < 0 || b.x > ARENA_W || b.y > ARENA_H || insideObstacle(b.x, b.y)) {
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
        z.hp -= b.damage
        z.hitFlash = 0.08
        const knock = z.kind === 'miniboss' ? 2 : z.kind === 'brute' ? 5 : 10
        z.x += (b.vx / BULLET_SPEED) * knock
        z.y += (b.vy / BULLET_SPEED) * knock
        burst(b.x, b.y, '#dc2626', 2, 90)
        if (z.hp <= 0) killZombie(z)
        if (b.pierce <= 0) {
          b.life = 0
          break
        }
        b.pierce -= 1
      }
    }
    bullets = bullets.filter((b) => b.life > 0)

    // Zombies
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
          z.x += (dx / dist) * z.speed * dt
          z.y += (dy / dist) * z.speed * dt
          if (z.chargeTimer <= 0 && dist < 520) {
            z.chargeTimer = 3.8 + Math.random() * 1.5
            z.telegraph = 0.65
          }
        }
      } else {
        z.x += (dx / dist) * z.speed * dt
        z.y += (dy / dist) * z.speed * dt
      }
      pushOut(z, z.r)
      if (dist < z.r + PLAYER_RADIUS && z.attackCd <= 0) {
        z.attackCd = z.kind === 'miniboss' ? 0.9 : 0.75
        player.hp -= z.damage
        player.hurt = 0.25
        shake = Math.max(shake, z.kind === 'miniboss' ? 9 : 4)
        playSfx('sting')
      }
    }
    zombies = zombies.filter((z) => z.hp > 0)

    // Keep the horde from stacking into a single blob.
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

  const drawArena = () => {
    ctx.fillStyle = '#16130f'
    ctx.fillRect(0, 0, ARENA_W, ARENA_H)
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'
    ctx.lineWidth = 1
    const grid = 80
    const x0 = Math.floor(cam.x / grid) * grid
    const y0 = Math.floor(cam.y / grid) * grid
    for (let x = x0; x <= cam.x + VIEW_W; x += grid) {
      ctx.beginPath()
      ctx.moveTo(x, cam.y)
      ctx.lineTo(x, cam.y + VIEW_H)
      ctx.stroke()
    }
    for (let y = y0; y <= cam.y + VIEW_H; y += grid) {
      ctx.beginPath()
      ctx.moveTo(cam.x, y)
      ctx.lineTo(cam.x + VIEW_W, y)
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(120,10,10,0.35)'
    for (const d of decals) {
      ctx.beginPath()
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
      ctx.fill()
    }
    // Arena wall
    ctx.strokeStyle = '#78350f'
    ctx.lineWidth = 14
    ctx.strokeRect(7, 7, ARENA_W - 14, ARENA_H - 14)
    ctx.strokeStyle = '#fbbf24'
    ctx.setLineDash([24, 18])
    ctx.lineWidth = 3
    ctx.strokeRect(16, 16, ARENA_W - 32, ARENA_H - 32)
    ctx.setLineDash([])
    for (const o of obstacles) {
      ctx.fillStyle = '#334155'
      ctx.fillRect(o.x, o.y, o.w, o.h)
      ctx.fillStyle = '#475569'
      ctx.fillRect(o.x + 4, o.y + 4, o.w - 8, o.h - 12)
      ctx.strokeStyle = '#0f172a'
      ctx.lineWidth = 3
      ctx.strokeRect(o.x, o.y, o.w, o.h)
    }
  }

  const drawZombie = (z: Zombie) => {
    const a = Math.atan2(player.y - z.y, player.x - z.x)
    const palette: Record<ZombieKind, string> = {
      walker: '#4d7c0f',
      runner: '#65a30d',
      brute: '#3f6212',
      miniboss: '#7c2d12',
    }
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

  const drawPlayer = () => {
    ctx.save()
    ctx.translate(player.x, player.y)
    // Aim line is purely cosmetic and follows the player's own aim.
    ctx.strokeStyle = 'rgba(52,211,153,0.25)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([6, 8])
    ctx.beginPath()
    ctx.moveTo(Math.cos(player.angle) * 22, Math.sin(player.angle) * 22)
    ctx.lineTo(Math.cos(player.angle) * 160, Math.sin(player.angle) * 160)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.rotate(player.angle)
    ctx.fillStyle = '#1f2937'
    ctx.fillRect(6, -3.5, 22, 7)
    ctx.fillStyle = player.hurt > 0 ? '#fca5a5' : '#10b981'
    ctx.beginPath()
    ctx.arc(0, 0, PLAYER_RADIUS, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#064e3b'
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
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
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
    ctx.fillStyle = 'rgba(148,163,184,0.5)'
    for (const o of obstacles) ctx.fillRect(x + o.x * sx, y + o.y * sy, Math.max(2, o.w * sx), Math.max(2, o.h * sy))
    for (const z of zombies) {
      ctx.fillStyle = z.kind === 'miniboss' ? '#f97316' : '#ef4444'
      const s = z.kind === 'miniboss' ? 5 : 2
      ctx.fillRect(x + z.x * sx - s / 2, y + z.y * sy - s / 2, s, s)
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.strokeRect(x + cam.x * sx, y + cam.y * sy, VIEW_W * sx, VIEW_H * sy)
    ctx.fillStyle = '#34d399'
    ctx.fillRect(x + player.x * sx - 2.5, y + player.y * sy - 2.5, 5, 5)
    ctx.strokeStyle = 'rgba(52,211,153,0.6)'
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
  }

  const drawHud = () => {
    ctx.save()
    // Timer
    ctx.textAlign = 'center'
    ctx.font = 'bold 34px ui-monospace, monospace'
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(VIEW_W / 2 - 80, 8, 160, 44)
    ctx.fillStyle = '#ecfdf5'
    ctx.fillText(formatClock(elapsed), VIEW_W / 2, 42)
    ctx.font = 'bold 11px ui-monospace, monospace'
    ctx.fillStyle = '#6ee7b7'
    const toUpgrade = Math.max(0, nextUpgradeAt - elapsed)
    ctx.fillText(`UPGRADE IN ${Math.ceil(toUpgrade)}s`, VIEW_W / 2, 66)
    bar(VIEW_W / 2 - 80, 71, 160, 6, 1 - toUpgrade / UPGRADE_SECONDS, '#34d399')

    // Left: health + ammo
    ctx.textAlign = 'left'
    ctx.font = 'bold 14px ui-monospace, monospace'
    ctx.fillStyle = '#fca5a5'
    ctx.fillText(`HP ${Math.ceil(player.hp)} / ${player.maxHp}`, 16, 26)
    bar(16, 32, 240, 14, player.hp / player.maxHp, player.hp / player.maxHp < 0.3 ? '#dc2626' : '#22c55e')
    ctx.fillStyle = '#fde68a'
    const ammoText =
      player.reloading > 0 ? `RELOADING ${player.reloading.toFixed(1)}s` : `AMMO ${player.ammo} / ${player.magazine}`
    ctx.fillText(ammoText, 16, 66)
    if (player.reloading > 0) bar(16, 72, 160, 5, 1 - player.reloading / player.reloadTime, '#facc15')

    // Right: kills, threat, next boss
    ctx.textAlign = 'right'
    ctx.font = 'bold 22px ui-monospace, monospace'
    ctx.fillStyle = '#fda4af'
    ctx.fillText(`KILLS ${kills}`, VIEW_W - 16, 30)
    ctx.font = 'bold 12px ui-monospace, monospace'
    ctx.fillStyle = '#fdba74'
    ctx.fillText(`THREAT LV ${spawnSteps() + 1}  ·  SPAWN x${spawnRateMult().toFixed(2)}`, VIEW_W - 16, 50)
    ctx.fillStyle = '#fca5a5'
    ctx.fillText(`MINI-BOSS IN ${formatClock(nextBossAt - elapsed)}`, VIEW_W - 16, 68)
    ctx.restore()

    const boss = zombies.find((z) => z.kind === 'miniboss')
    if (boss) {
      ctx.save()
      ctx.textAlign = 'center'
      ctx.font = 'bold 12px ui-monospace, monospace'
      ctx.fillStyle = '#fdba74'
      ctx.fillText(`MINI-BOSS · BUTCHER BRUTE #${boss.bossIndex + 1}`, VIEW_W / 2, VIEW_H - 40)
      bar(VIEW_W / 2 - 200, VIEW_H - 32, 400, 14, boss.hp / boss.maxHp, '#ea580c')
      ctx.restore()
    }
    if (bossBanner > 0) {
      ctx.save()
      ctx.globalAlpha = Math.min(1, bossBanner)
      ctx.textAlign = 'center'
      ctx.font = 'bold 40px ui-monospace, monospace'
      ctx.fillStyle = '#f97316'
      ctx.fillText('⚠ MINI-BOSS INCOMING ⚠', VIEW_W / 2, VIEW_H / 2 - 90)
      ctx.restore()
    }
    drawMinimap()
  }

  const draw = () => {
    ctx.save()
    ctx.clearRect(0, 0, VIEW_W, VIEW_H)
    const sx = shake > 0 ? (Math.random() - 0.5) * shake : 0
    const sy = shake > 0 ? (Math.random() - 0.5) * shake : 0
    ctx.translate(-cam.x + sx, -cam.y + sy)
    drawArena()
    ctx.fillStyle = '#fde68a'
    for (const b of bullets) {
      ctx.beginPath()
      ctx.arc(b.x, b.y, 3, 0, Math.PI * 2)
      ctx.fill()
    }
    for (const z of zombies) drawZombie(z)
    drawPlayer()
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

    if (phase === 'attract') {
      ctx.fillStyle = 'rgba(0,0,0,0.72)'
      ctx.fillRect(0, 0, VIEW_W, VIEW_H)
      ctx.textAlign = 'center'
      ctx.fillStyle = '#34d399'
      ctx.font = 'bold 52px ui-monospace, monospace'
      ctx.fillText('ENDLESS HORDE', VIEW_W / 2, VIEW_H / 2 - 70)
      ctx.font = 'bold 18px ui-monospace, monospace'
      ctx.fillStyle = '#e2e8f0'
      ctx.fillText('Survive as long as you can. The horde never stops.', VIEW_W / 2, VIEW_H / 2 - 28)
      ctx.fillStyle = '#94a3b8'
      ctx.font = 'bold 13px ui-monospace, monospace'
      ctx.fillText('Spawns ramp every 30s · upgrade pick every 60s · mini-boss every 90s', VIEW_W / 2, VIEW_H / 2 + 4)
      const best = highScore('endless-horde')
      if (best > 0) {
        ctx.fillStyle = '#fcd34d'
        ctx.fillText(`BEST ${formatClock(best)}`, VIEW_W / 2, VIEW_H / 2 + 34)
      }
      if (Math.floor(blink * 2) % 2 === 0) {
        ctx.fillStyle = '#ecfdf5'
        ctx.font = 'bold 18px ui-monospace, monospace'
        ctx.fillText('PRESS ENTER OR TAP TO START', VIEW_W / 2, VIEW_H / 2 + 90)
      }
      return
    }
    drawHud()
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
    return {
      x: ((clientX - rect.left) / rect.width) * VIEW_W,
      y: ((clientY - rect.top) / rect.height) * VIEW_H,
    }
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
    if (phase === 'upgrade') {
      if (key === '1' || key === '2' || key === '3') pickUpgrade(Number(key) - 1)
      return
    }
    if (phase === 'attract' && (key === 'enter' || key === ' ')) {
      start()
      return
    }
    if (phase === 'over' && key === 'enter') {
      start()
      return
    }
    held.add(key)
    if (key === 'r' && phase === 'playing' && player.reloading <= 0 && player.ammo < player.magazine) {
      player.reloading = player.reloadTime
    }
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

  const onMouseDown = () => {
    if (phase === 'attract') {
      start()
      return
    }
    if (phase === 'playing') pointerDown = true
  }

  const onTouchStart = (e: TouchEvent) => {
    e.preventDefault()
    if (phase === 'attract') {
      start()
      return
    }
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
        const radius = 60
        touchMoveVec = d > 6 ? { x: (dx / d) * Math.min(1, d / radius), y: (dy / d) * Math.min(1, d / radius) } : { x: 0, y: 0 }
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
  el<HTMLButtonElement>('#horde-menu').addEventListener('click', () => {
    if (!open) return
    hideOverlay()
    onMainMenu()
  })
  canvas.addEventListener('mousemove', onMouseMove)
  canvas.addEventListener('mousedown', onMouseDown)
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
      phase = 'attract'
      reset()
      cam.x = clamp(player.x - VIEW_W / 2, 0, ARENA_W - VIEW_W)
      cam.y = clamp(player.y - VIEW_H / 2, 0, ARENA_H - VIEW_H)
      overlay.classList.remove('hidden')
      overlay.classList.add('flex')
      last = performance.now()
      raf = window.requestAnimationFrame(frameStep)
    },
    close,
    isOpen: () => open,
  }
}
