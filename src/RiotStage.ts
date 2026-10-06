/**
 * RIOT FIGHTER: STAGE RUN — a belt-scrolling brawler built on the Rot Fighter
 * roster. The run crosses six connected sectors of one long street; each
 * sector locks the camera until its swarm of Shamblers and Runners is down.
 * The Cryo Stalker holds the midway sector and the Canopy Leviathan the far
 * end. Facing follows movement only, so every swing is aimed by the player.
 */

import { playSfx, resumeAudio } from './audio'
import { highScore, recordPlay, submitScore } from './arcadeStats'
import { type Character, PLAYER_BASE_HP, ROSTER } from './FightingArcade'
import { formatClock } from './EndlessHorde'
import { drawLowHealthVignette, lowHealthSeverity } from './lowHealth'
import { isTouchDevice } from './TouchControls'

const VIEW_W = 900
const VIEW_H = 480
const ROAD_TOP = 250
const ROAD_BOTTOM = 462
const SECTOR_W = 1200
const PLAYER_SPEED = 230
/** Walking up or down the street is slower than along it. */
const DEPTH_SCALE = 0.7
const HURT_IFRAMES = 0.4

const KILL_POINTS = 100
/** Clearing under par earns this many points for every second saved. */
const PAR_SECONDS = 600
const TIME_POINTS = 25

type Phase = 'select' | 'playing' | 'over'
type MobKind = 'shambler' | 'runner'
type BossKind = 'cryo' | 'leviathan'
type Theme = 'city' | 'ice' | 'jungle'

interface SectorDef {
  name: string
  quota: number
  runnerShare: number
  maxAlive: number
  boss: BossKind | null
  theme: Theme
}

const SECTORS: SectorDef[] = [
  { name: 'Riot Gate', quota: 10, runnerShare: 0.15, maxAlive: 5, boss: null, theme: 'city' },
  { name: 'Market Row', quota: 14, runnerShare: 0.25, maxAlive: 6, boss: null, theme: 'city' },
  { name: 'Frozen Depot', quota: 12, runnerShare: 0.3, maxAlive: 6, boss: 'cryo', theme: 'ice' },
  { name: 'Collapsed Overpass', quota: 18, runnerShare: 0.4, maxAlive: 7, boss: null, theme: 'city' },
  { name: 'Overgrown Mall', quota: 20, runnerShare: 0.45, maxAlive: 8, boss: null, theme: 'jungle' },
  { name: 'Canopy Heart', quota: 8, runnerShare: 0.5, maxAlive: 5, boss: 'leviathan', theme: 'jungle' },
]
const STAGE_W = SECTORS.length * SECTOR_W

const MOB_STATS: Record<MobKind, { hp: number; speed: number; damage: number; r: number; windup: number; cooldown: number }> = {
  shambler: { hp: 46, speed: 62, damage: 9, r: 16, windup: 0.55, cooldown: 1.3 },
  runner: { hp: 26, speed: 165, damage: 6, r: 13, windup: 0.28, cooldown: 0.9 },
}

type MoveKind = 'light' | 'heavy'
const MOVES: Record<MoveKind, { startup: number; active: number; recover: number; damage: number; reach: number; depth: number; knock: number; stun: number }> = {
  light: { startup: 0.07, active: 0.08, recover: 0.12, damage: 14, reach: 64, depth: 28, knock: 140, stun: 0.12 },
  heavy: { startup: 0.2, active: 0.1, recover: 0.26, damage: 32, reach: 82, depth: 32, knock: 340, stun: 0.35 },
}

type SkillId = 'soul-scythe' | 'death-blossom' | 'cloak' | 'decoy' | 'fortify' | 'shockwave' | 'toxic-spew' | 'frenzy'

interface Skill {
  name: string
  cooldown: number
  /** Seconds the effect stays up; 0 for instant skills. */
  duration: number
  color: string
  desc: string
}

const SKILLS: Record<SkillId, Skill> = {
  'soul-scythe': { name: 'Soul Scythe', cooldown: 7, duration: 0, color: '#fb7185', desc: 'Heavy 360° cleave around you' },
  'death-blossom': { name: 'Death Blossom', cooldown: 16, duration: 5, color: '#f43f5e', desc: 'Life-steal aura drains everything close' },
  cloak: { name: 'Cloak', cooldown: 12, duration: 3.5, color: '#c4b5fd', desc: 'Vanish, +50% speed, next hit deals double' },
  decoy: { name: 'Decoy Clone', cooldown: 15, duration: 5, color: '#a5b4fc', desc: 'Clone draws the swarm, then detonates' },
  fortify: { name: 'Fortify', cooldown: 12, duration: 4, color: '#38bdf8', desc: 'Shield absorbs the next 120 damage' },
  shockwave: { name: 'Shockwave Stun', cooldown: 10, duration: 0, color: '#f59e0b', desc: 'Ground slam stuns everything nearby' },
  'toxic-spew': { name: 'Toxic Spew', cooldown: 9, duration: 0, color: '#4ade80', desc: 'Poison cloud ahead decays the horde' },
  frenzy: { name: 'Frenzy Sprint', cooldown: 14, duration: 4.5, color: '#86efac', desc: '+60% speed, +40% attack speed, life steal' },
}

/** Base ability, then the new secondary ability, per class. */
const KITS: Record<string, [SkillId, SkillId]> = {
  Reaper: ['soul-scythe', 'death-blossom'],
  Ghost: ['cloak', 'decoy'],
  Warden: ['fortify', 'shockwave'],
  Shambler: ['toxic-spew', 'frenzy'],
}

const SCYTHE_RADIUS = 120
const SCYTHE_DAMAGE = 55
const BLOSSOM_RADIUS = 110
const BLOSSOM_DPS = 18
const BLOSSOM_HEAL = 0.4
const DECOY_HP = 60
const DECOY_BLAST = 90
const DECOY_DAMAGE = 40
const FORTIFY_SHIELD = 120
const SHOCK_RADIUS = 150
const SHOCK_DAMAGE = 25
const SHOCK_STUN = 2
const SPEW_RADIUS = 85
const SPEW_DPS = 16
const SPEW_LIFE = 3.5

interface Mob {
  kind: MobKind
  x: number
  y: number
  hp: number
  maxHp: number
  speed: number
  damage: number
  r: number
  cd: number
  windup: number
  flash: number
  stun: number
  poison: number
  kx: number
  facing: 1 | -1
  walk: number
  /** Boss summons do not count against the sector quota. */
  summoned: boolean
}

interface BossAction {
  id: 'frost-wave' | 'icicles' | 'lunge' | 'vine-lash' | 'spores' | 'summon'
  t: number
  dx: number
  dy: number
}

interface Boss {
  kind: BossKind
  name: string
  x: number
  y: number
  hp: number
  maxHp: number
  r: number
  speed: number
  facing: 1 | -1
  flash: number
  timer: number
  action: BossAction | null
  contactCd: number
  poison: number
  walk: number
}

interface Ring {
  x: number
  y: number
  r: number
  max: number
  hit: boolean
}

interface Shard {
  x: number
  y: number
  vx: number
  vy: number
  life: number
}

interface Lash {
  y: number
  x: number
  t: number
  strike: number
  hit: boolean
}

interface Pod {
  x: number
  y: number
  t: number
}

interface Cloud {
  x: number
  y: number
  life: number
}

interface Pop {
  x: number
  y: number
  text: string
  life: number
  color: string
}

interface Flash {
  x: number
  y: number
  r: number
  life: number
  color: string
}

interface Hero {
  cls: Character
  kit: [SkillId, SkillId]
  x: number
  y: number
  hp: number
  maxHp: number
  facing: 1 | -1
  walk: number
  attack: { kind: MoveKind; t: number; hit: boolean } | null
  hurt: number
  slow: number
  poison: number
  cd: [number, number]
  timer: [number, number]
  shield: number
}

export interface RiotStageCabinet {
  open: () => void
  close: () => void
  isOpen: () => boolean
}

const KEYMAP: Record<string, string> = {
  a: 'left',
  arrowleft: 'left',
  d: 'right',
  arrowright: 'right',
  w: 'up',
  arrowup: 'up',
  s: 'down',
  arrowdown: 'down',
  j: 'light',
  ' ': 'light',
  k: 'heavy',
  e: 'skill1',
  l: 'skill1',
  q: 'skill2',
  i: 'skill2',
}

const hash = (n: number): number => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return v - Math.floor(v)
}

export function mountRiotStage(onQuit: () => void): RiotStageCabinet {
  const overlay = document.createElement('div')
  overlay.className = 'fixed inset-0 z-40 hidden flex-col items-center justify-center overflow-y-auto bg-black/98 p-3'
  overlay.innerHTML = `
    <div class="flex w-full max-w-[940px] items-center justify-between pb-2">
      <div class="text-xs font-black uppercase tracking-[0.35em] text-cyan-300">Riot Fighter · Stage Run</div>
      <button id="riot-quit" class="rounded-lg bg-cyan-500/20 px-4 py-1.5 text-xs font-black uppercase tracking-widest text-cyan-100 ring-1 ring-cyan-400/60 hover:bg-cyan-500/35">Quit to Main Menu</button>
    </div>
  `
  const frame = document.createElement('div')
  frame.className = 'relative rounded-2xl bg-slate-950 p-3 ring-2 ring-cyan-500/50 shadow-[0_0_60px_rgba(34,211,238,0.3)]'
  const canvas = document.createElement('canvas')
  canvas.width = VIEW_W
  canvas.height = VIEW_H
  canvas.className = 'block h-auto w-[min(92vw,900px)] rounded-lg bg-black'
  frame.appendChild(canvas)

  const selectPanel = document.createElement('div')
  selectPanel.className = 'absolute inset-3 hidden flex-col items-center justify-center gap-3 overflow-y-auto rounded-lg bg-black/85 p-4 text-center'
  selectPanel.innerHTML = `
    <div class="text-2xl font-black uppercase tracking-widest text-cyan-200">Choose your fighter</div>
    <div class="text-[11px] uppercase tracking-widest text-slate-400">Six sectors · Cryo Stalker midway · Canopy Leviathan at the end</div>
    <div id="riot-cards" class="grid w-full max-w-[860px] gap-3 sm:grid-cols-2 lg:grid-cols-4"></div>
    <div id="riot-best" class="text-xs font-bold uppercase tracking-[0.3em] text-amber-300"></div>
    <div class="text-[11px] uppercase tracking-widest text-slate-400">Press 1 – 4 or click · Esc to leave</div>
  `
  frame.appendChild(selectPanel)

  const overPanel = document.createElement('div')
  overPanel.className = 'absolute inset-3 hidden flex-col items-center justify-center gap-3 rounded-lg bg-black/85 p-4 text-center'
  overPanel.innerHTML = `
    <div id="riot-over-title" class="text-3xl font-black uppercase tracking-widest sm:text-4xl"></div>
    <div id="riot-over-sub" class="text-xs uppercase tracking-[0.3em] text-slate-400"></div>
    <div class="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-4">
      <div class="rounded-lg bg-white/5 px-4 py-2"><div class="text-[10px] uppercase tracking-widest text-slate-400">Kills</div><div id="riot-over-kills" class="text-xl font-black text-white"></div></div>
      <div class="rounded-lg bg-white/5 px-4 py-2"><div class="text-[10px] uppercase tracking-widest text-slate-400">Time</div><div id="riot-over-time" class="text-xl font-black text-white"></div></div>
      <div class="rounded-lg bg-white/5 px-4 py-2"><div class="text-[10px] uppercase tracking-widest text-slate-400">Time Bonus</div><div id="riot-over-bonus" class="text-xl font-black text-white"></div></div>
      <div class="rounded-lg bg-cyan-500/15 px-4 py-2 ring-1 ring-cyan-400/40"><div class="text-[10px] uppercase tracking-widest text-cyan-300">Score</div><div id="riot-over-score" class="text-xl font-black text-cyan-100"></div></div>
    </div>
    <div id="riot-over-best" class="text-xs font-bold uppercase tracking-[0.3em] text-amber-300"></div>
    <div class="flex gap-3 pt-1">
      <button id="riot-retry" type="button" class="rounded-lg bg-cyan-500/25 px-5 py-2 text-xs font-black uppercase tracking-widest text-cyan-100 ring-1 ring-cyan-400/60 hover:bg-cyan-500/40">Fight Again [Enter]</button>
      <button id="riot-over-quit" type="button" class="rounded-lg bg-white/10 px-5 py-2 text-xs font-black uppercase tracking-widest text-slate-200 ring-1 ring-white/20 hover:bg-white/20">Leave [Esc]</button>
    </div>
  `
  frame.appendChild(overPanel)
  overlay.appendChild(frame)

  const legend = document.createElement('div')
  legend.className = 'pt-3 text-center text-[11px] uppercase tracking-[0.2em] text-slate-500'
  legend.textContent = 'WASD / arrows move · J or Space light · K heavy · E ability · Q secondary ability · Esc quit'
  overlay.appendChild(legend)

  const touchPad = document.createElement('div')
  touchPad.className = 'hidden w-full max-w-[940px] items-end justify-between gap-4 pt-3'
  overlay.appendChild(touchPad)
  document.body.appendChild(overlay)

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('riot stage canvas context unavailable')

  const q = <T extends HTMLElement>(sel: string): T => {
    const node = overlay.querySelector<T>(sel)
    if (!node) throw new Error(`riot stage element ${sel} missing`)
    return node
  }
  const cardHost = q<HTMLDivElement>('#riot-cards')
  const bestLine = q<HTMLDivElement>('#riot-best')

  let open = false
  let phase: Phase = 'select'
  let raf = 0
  let last = 0
  let blink = 0
  let shake = 0
  let elapsed = 0
  let kills = 0
  let cam = 0
  let sector = 0
  let spawned = 0
  let spawnTimer = 0
  let bossSpawned = false
  let banner = ''
  let bannerLife = 0
  let goFlash = 0

  let mobs: Mob[] = []
  let boss: Boss | null = null
  let rings: Ring[] = []
  let shards: Shard[] = []
  let lashes: Lash[] = []
  let pods: Pod[] = []
  let clouds: Cloud[] = []
  let pops: Pop[] = []
  let flashes: Flash[] = []
  let decoy: { x: number; y: number; hp: number; life: number } | null = null

  const held = new Set<string>()
  const pressed = new Set<string>()

  const makeHero = (cls: Character): Hero => ({
    cls,
    kit: KITS[cls.name] ?? ['fortify', 'shockwave'],
    x: 140,
    y: (ROAD_TOP + ROAD_BOTTOM) / 2,
    hp: PLAYER_BASE_HP * cls.hpScale,
    maxHp: PLAYER_BASE_HP * cls.hpScale,
    facing: 1,
    walk: 0,
    attack: null,
    hurt: 0,
    slow: 0,
    poison: 0,
    cd: [0, 0],
    timer: [0, 0],
    shield: 0,
  })
  let hero = makeHero(ROSTER[0])

  const active = (id: SkillId): boolean => {
    const slot = hero.kit.indexOf(id)
    return slot >= 0 && hero.timer[slot] > 0
  }
  const cloaked = () => active('cloak')
  const frenzied = () => active('frenzy')

  const lock = () => (sector + 1) * SECTOR_W
  const sectorStart = () => sector * SECTOR_W

  const showBanner = (text: string, life = 2.4) => {
    banner = text
    bannerLife = life
  }

  const pop = (x: number, y: number, text: string, color: string) => {
    pops.push({ x, y, text, life: 0.7, color })
    if (pops.length > 60) pops.splice(0, pops.length - 60)
  }

  // ---------- panels ----------
  const showPanel = (panel: HTMLDivElement) => {
    for (const p of [selectPanel, overPanel]) {
      p.classList.toggle('hidden', p !== panel)
      p.classList.toggle('flex', p === panel)
    }
  }
  const hidePanels = () => {
    for (const p of [selectPanel, overPanel]) {
      p.classList.add('hidden')
      p.classList.remove('flex')
    }
  }

  const renderCards = () => {
    cardHost.innerHTML = ''
    ROSTER.forEach((cls, i) => {
      const kit = KITS[cls.name]
      if (!kit) return
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'flex flex-col gap-1 rounded-xl bg-slate-900/80 p-3 text-left ring-2 ring-white/15 transition hover:-translate-y-0.5 hover:ring-cyan-300'
      btn.innerHTML = `
        <div class="flex items-center justify-between">
          <span class="text-sm font-black uppercase tracking-wider" style="color:${cls.tint}">${cls.name}</span>
          <span class="rounded bg-white/10 px-1.5 text-[10px] font-black text-slate-300">${i + 1}</span>
        </div>
        <div class="text-[10px] uppercase tracking-wider text-slate-400">${Math.round(PLAYER_BASE_HP * cls.hpScale)} HP · ${cls.trait}</div>
        <div class="pt-1 text-xs text-slate-200"><span class="font-black" style="color:${SKILLS[kit[0]].color}">[E] ${SKILLS[kit[0]].name}</span> — ${SKILLS[kit[0]].desc}</div>
        <div class="text-xs text-slate-200"><span class="font-black" style="color:${SKILLS[kit[1]].color}">[Q] ${SKILLS[kit[1]].name}</span> — ${SKILLS[kit[1]].desc}</div>
      `
      btn.addEventListener('click', () => start(i))
      cardHost.appendChild(btn)
    })
    const best = highScore('riot-stage')
    bestLine.textContent = best > 0 ? `High score ${best}` : ''
  }

  const openSelect = () => {
    phase = 'select'
    held.clear()
    pressed.clear()
    renderCards()
    showPanel(selectPanel)
    syncTouch()
  }

  const start = (index: number) => {
    const cls = ROSTER[index]
    if (!cls || !KITS[cls.name]) return
    hero = makeHero(cls)
    mobs = []
    boss = null
    rings = []
    shards = []
    lashes = []
    pods = []
    clouds = []
    pops = []
    flashes = []
    decoy = null
    elapsed = 0
    kills = 0
    cam = 0
    sector = 0
    spawned = 0
    spawnTimer = 1
    bossSpawned = false
    goFlash = 0
    shake = 0
    showBanner(`Sector 1 · ${SECTORS[0].name}`)
    hidePanels()
    phase = 'playing'
    recordPlay('riot-stage')
    playSfx('overdrive')
    syncTouch()
    last = performance.now()
  }

  const finish = (won: boolean) => {
    phase = 'over'
    held.clear()
    const seconds = Math.floor(elapsed)
    const bonus = won ? Math.max(0, PAR_SECONDS - seconds) * TIME_POINTS : 0
    const score = kills * KILL_POINTS + bonus
    const previous = highScore('riot-stage')
    const record = submitScore('riot-stage', score)
    const title = q<HTMLDivElement>('#riot-over-title')
    title.textContent = won ? 'Stage Cleared' : 'Knocked Out'
    title.className = `text-3xl font-black uppercase tracking-widest sm:text-4xl ${won ? 'text-cyan-300' : 'text-red-500'}`
    q<HTMLDivElement>('#riot-over-sub').textContent = won
      ? `${hero.cls.name} felled the Canopy Leviathan`
      : `Fell in Sector ${sector + 1} · ${SECTORS[sector].name} · no time bonus`
    q<HTMLDivElement>('#riot-over-kills').textContent = `${kills} × ${KILL_POINTS}`
    q<HTMLDivElement>('#riot-over-time').textContent = formatClock(seconds)
    q<HTMLDivElement>('#riot-over-bonus').textContent = `+${bonus}`
    q<HTMLDivElement>('#riot-over-score').textContent = `${score}`
    q<HTMLDivElement>('#riot-over-best').textContent = record ? `New high score!${previous > 0 ? ` (old ${previous})` : ''}` : `High score ${previous}`
    showPanel(overPanel)
    syncTouch()
    playSfx(won ? 'medkit' : 'boss-roar')
  }

  // ---------- combat helpers ----------
  const killMob = (m: Mob) => {
    kills += 1
    flashes.push({ x: m.x, y: m.y - 30, r: m.r * 2, life: 0.25, color: '#dc2626' })
    if (Math.random() < 0.3) playSfx('groan')
  }


  const leech = (dealt: number) => {
    const steal = hero.cls.lifesteal + (frenzied() ? 0.1 : 0)
    if (steal > 0) hero.hp = Math.min(hero.maxHp, hero.hp + dealt * steal)
  }

  const hitMob = (m: Mob, dmg: number, dir: number, knock: number, stun: number, show = true) => {
    m.hp -= dmg
    m.flash = 0.1
    m.kx += dir * knock
    m.stun = Math.max(m.stun, stun)
    m.windup = stun > 0 ? 0 : m.windup
    if (show) pop(m.x, m.y - 70, `${Math.round(dmg)}`, '#fde68a')
    if (m.hp <= 0) killMob(m)
  }

  const hitBoss = (dmg: number, show = true) => {
    if (!boss) return
    boss.hp -= dmg
    boss.flash = 0.1
    if (show) pop(boss.x, boss.y - boss.r * 3, `${Math.round(dmg)}`, '#fde68a')
    if (boss.hp <= 0) defeatBoss()
  }

  /** Hits every mob and the boss whose body overlaps the test, dealing hero damage. */
  const strike = (test: (x: number, y: number, r: number) => boolean, base: number, knock: number, stun: number, dirFrom: number | null) => {
    let landed = false
    let total = 0
    const ambush = cloaked()
    const dmg = base * hero.cls.power * (ambush ? 2 : 1)
    for (const m of mobs) {
      if (m.hp <= 0 || !test(m.x, m.y, m.r)) continue
      const dir = dirFrom === null ? hero.facing : Math.sign(m.x - dirFrom) || hero.facing
      hitMob(m, dmg, dir, knock, stun)
      total += dmg
      landed = true
    }
    if (boss && test(boss.x, boss.y, boss.r)) {
      hitBoss(dmg)
      total += dmg
      landed = true
    }
    if (landed) {
      leech(total)
      if (ambush) hero.timer[hero.kit.indexOf('cloak')] = 0
    }
    return landed
  }

  const inRadius = (cx: number, cy: number, radius: number) => (x: number, y: number, r: number) =>
    Math.hypot(x - cx, (y - cy) / DEPTH_SCALE) < radius + r

  const hurtHero = (amount: number, dir: number, ignoreIframes = false) => {
    if (phase !== 'playing') return
    if (!ignoreIframes && hero.hurt > 0) return
    if (Math.random() < hero.cls.dodge) {
      pop(hero.x, hero.y - 80, 'EVADE', '#c4b5fd')
      hero.hurt = HURT_IFRAMES * 0.5
      return
    }
    let dmg = amount
    if (hero.shield > 0) {
      const soak = Math.min(hero.shield, dmg)
      hero.shield -= soak
      dmg -= soak
      if (hero.shield <= 0) hero.timer[hero.kit.indexOf('fortify')] = 0
    }
    hero.hurt = HURT_IFRAMES
    hero.x += dir * 14
    if (dmg <= 0) {
      pop(hero.x, hero.y - 80, 'BLOCK', '#38bdf8')
      return
    }
    hero.hp -= dmg
    pop(hero.x, hero.y - 80, `-${Math.round(dmg)}`, '#ef4444')
    shake = Math.max(shake, 5)
    if (hero.hp <= 0) {
      hero.hp = 0
      finish(false)
    }
  }

  // ---------- skills ----------
  const useSkill = (slot: 0 | 1) => {
    if (hero.cd[slot] > 0) return
    const id = hero.kit[slot]
    const skill = SKILLS[id]
    hero.cd[slot] = skill.cooldown
    hero.timer[slot] = skill.duration
    switch (id) {
      case 'soul-scythe':
        strike(inRadius(hero.x, hero.y, SCYTHE_RADIUS), SCYTHE_DAMAGE, 380, 0.4, hero.x)
        flashes.push({ x: hero.x, y: hero.y, r: SCYTHE_RADIUS, life: 0.3, color: skill.color })
        shake = Math.max(shake, 6)
        playSfx('katana')
        break
      case 'death-blossom':
        playSfx('overdrive')
        break
      case 'cloak':
        playSfx('cloak')
        break
      case 'decoy':
        decoy = { x: hero.x - hero.facing * 30, y: hero.y, hp: DECOY_HP, life: skill.duration }
        playSfx('swap')
        break
      case 'fortify':
        hero.shield = FORTIFY_SHIELD
        playSfx('barricade')
        break
      case 'shockwave':
        strike(inRadius(hero.x, hero.y, SHOCK_RADIUS), SHOCK_DAMAGE, 260, SHOCK_STUN, hero.x)
        flashes.push({ x: hero.x, y: hero.y, r: SHOCK_RADIUS, life: 0.4, color: skill.color })
        shake = Math.max(shake, 8)
        playSfx('explosion')
        break
      case 'toxic-spew':
        clouds.push({ x: hero.x + hero.facing * 80, y: hero.y, life: SPEW_LIFE })
        playSfx('acid-spit')
        break
      case 'frenzy':
        playSfx('overdrive')
        break
    }
  }

  const detonateDecoy = () => {
    if (!decoy) return
    const d = decoy
    decoy = null
    strike(inRadius(d.x, d.y, DECOY_BLAST), DECOY_DAMAGE, 220, 0.3, d.x)
    flashes.push({ x: d.x, y: d.y, r: DECOY_BLAST, life: 0.35, color: '#a5b4fc' })
    playSfx('explosion')
  }

  // ---------- spawning ----------
  const spawnMob = (kind: MobKind, summoned = false) => {
    const s = MOB_STATS[kind]
    const scale = 1 + 0.12 * sector
    const fromLeft = Math.random() < 0.3 && hero.x - cam > 200
    mobs.push({
      kind,
      x: fromLeft ? cam - 40 : cam + VIEW_W + 40,
      y: ROAD_TOP + 10 + Math.random() * (ROAD_BOTTOM - ROAD_TOP - 20),
      hp: s.hp * scale,
      maxHp: s.hp * scale,
      speed: s.speed * (0.9 + Math.random() * 0.2),
      damage: s.damage * (1 + 0.08 * sector),
      r: s.r,
      cd: 0.6,
      windup: 0,
      flash: 0,
      stun: 0,
      poison: 0,
      kx: 0,
      facing: fromLeft ? 1 : -1,
      walk: Math.random() * 6,
      summoned,
    })
  }

  const spawnBoss = (kind: BossKind) => {
    bossSpawned = true
    const cryo = kind === 'cryo'
    const hp = cryo ? 1400 : 3200
    boss = {
      kind,
      name: cryo ? 'Cryo Stalker' : 'Canopy Leviathan',
      x: lock() - (cryo ? 200 : 150),
      y: (ROAD_TOP + ROAD_BOTTOM) / 2,
      hp,
      maxHp: hp,
      r: cryo ? 30 : 46,
      speed: cryo ? 95 : 45,
      facing: -1,
      flash: 0,
      timer: 2,
      action: null,
      contactCd: 0,
      poison: 0,
      walk: 0,
    }
    showBanner(cryo ? '⚠ CRYO STALKER — watch the frost' : '⚠ CANOPY LEVIATHAN — final boss', 3)
    shake = Math.max(shake, 12)
    playSfx('boss-roar')
  }

  const defeatBoss = () => {
    if (!boss) return
    const b = boss
    boss = null
    kills += 1
    rings = []
    shards = []
    lashes = []
    pods = []
    flashes.push({ x: b.x, y: b.y, r: b.r * 4, life: 0.6, color: b.kind === 'cryo' ? '#bae6fd' : '#4ade80' })
    shake = Math.max(shake, 16)
    playSfx('explosion')
    if (b.kind === 'leviathan') {
      finish(true)
      return
    }
    showBanner(`${b.name} down!`, 2.4)
  }

  const updateSector = (dt: number) => {
    const def = SECTORS[sector]
    const alive = mobs.length
    if (hero.x > sectorStart() + 120 && spawned < def.quota) {
      spawnTimer -= dt
      if (spawnTimer <= 0 && alive < def.maxAlive) {
        spawnMob(Math.random() < def.runnerShare ? 'runner' : 'shambler')
        spawned += 1
        spawnTimer = Math.max(0.4, 0.95 - 0.06 * sector)
      }
    }
    const swarmDown = spawned >= def.quota && mobs.every((m) => m.summoned)
    if (!swarmDown) return
    if (def.boss && !bossSpawned) {
      spawnBoss(def.boss)
      return
    }
    if (boss || mobs.length > 0) return
    if (sector >= SECTORS.length - 1) return
    sector += 1
    spawned = 0
    spawnTimer = 0.8
    bossSpawned = false
    goFlash = 3
    showBanner(`Sector ${sector + 1} · ${SECTORS[sector].name}`)
    playSfx('pickup-weapon')
  }

  // ---------- boss behaviour ----------
  const bossAct = (b: Boss) => {
    const enraged = b.hp < b.maxHp / 2
    const options: BossAction['id'][] = b.kind === 'cryo' ? ['frost-wave', 'icicles', 'lunge'] : ['vine-lash', 'spores', 'summon']
    const id = options[Math.floor(Math.random() * options.length)]
    const dx = hero.x - b.x
    const dy = hero.y - b.y
    const d = Math.hypot(dx, dy) || 1
    b.action = { id, t: 0, dx: dx / d, dy: dy / d }
    b.timer = enraged ? 1.7 : 2.6
    if (id === 'vine-lash') {
      lashes.push({ y: hero.y, x: b.x, t: 0.9, strike: 0.25, hit: false })
      if (enraged) lashes.push({ y: ROAD_TOP + 20 + Math.random() * (ROAD_BOTTOM - ROAD_TOP - 40), x: b.x, t: 1.1, strike: 0.25, hit: false })
    }
    if (id === 'spores') {
      pods.push({ x: hero.x, y: hero.y, t: 1.1 })
      for (let i = 0; i < (enraged ? 4 : 3); i++) {
        pods.push({
          x: hero.x + (Math.random() - 0.5) * 240,
          y: Math.min(ROAD_BOTTOM, Math.max(ROAD_TOP, hero.y + (Math.random() - 0.5) * 140)),
          t: 1.1 + Math.random() * 0.4,
        })
      }
    }
    if (id === 'summon') {
      for (let i = 0; i < (enraged ? 4 : 3); i++) spawnMob('runner', true)
      playSfx('boss-roar')
    }
  }

  const updateBoss = (dt: number) => {
    const b = boss
    if (!b) return
    b.flash = Math.max(0, b.flash - dt)
    b.contactCd = Math.max(0, b.contactCd - dt)
    if (b.poison > 0) {
      b.poison -= dt
      hitBoss(SPEW_DPS * 0.4 * dt, false)
      if (!boss) return
    }
    const dx = hero.x - b.x
    const dy = hero.y - b.y
    b.facing = dx < 0 ? -1 : 1
    const act = b.action
    if (act) {
      act.t += dt
      if (act.id === 'frost-wave' && act.t >= 0.8) {
        rings.push({ x: b.x, y: b.y, r: 0, max: 230, hit: false })
        shake = Math.max(shake, 6)
        playSfx('boss-dash')
        b.action = null
      } else if (act.id === 'icicles' && act.t >= 0.5) {
        const base = Math.atan2(dy, dx)
        for (let i = -2; i <= 2; i++) {
          const a = base + i * 0.16
          shards.push({ x: b.x, y: b.y, vx: Math.cos(a) * 380, vy: Math.sin(a) * 380 * DEPTH_SCALE, life: 2.4 })
        }
        playSfx('sting')
        b.action = null
      } else if (act.id === 'lunge') {
        if (act.t > 0.35) {
          b.x += act.dx * 560 * dt
          b.y += act.dy * 560 * dt * DEPTH_SCALE
          if (b.contactCd <= 0 && Math.abs(dx) < b.r + 20 && Math.abs(dy) < 26) {
            hurtHero(16, Math.sign(dx) || 1)
            hero.slow = Math.max(hero.slow, 1.2)
            b.contactCd = 0.8
          }
        }
        if (act.t > 0.8) b.action = null
      } else if (act.t > 0.6) {
        b.action = null
      }
    } else {
      b.timer -= dt
      if (b.kind === 'cryo') {
        const d = Math.hypot(dx, dy)
        if (d > 130) {
          b.x += (dx / d) * b.speed * dt
          b.y += (dy / d) * b.speed * dt * DEPTH_SCALE
          b.walk += dt * 6
        }
      } else {
        b.y += Math.sign(dy) * Math.min(Math.abs(dy), b.speed * dt)
        b.walk += dt * 2
      }
      if (b.timer <= 0) bossAct(b)
    }
    b.x = Math.min(lock() - 40, Math.max(cam + 40, b.x))
    b.y = Math.min(ROAD_BOTTOM, Math.max(ROAD_TOP, b.y))
    if (b.contactCd <= 0 && Math.abs(dx) < b.r + 14 && Math.abs(dy) < 22) {
      hurtHero(10, Math.sign(dx) || 1)
      b.contactCd = 0.8
    }
  }

  const updateHazards = (dt: number) => {
    for (const r of rings) {
      r.r += 520 * dt
      const d = Math.hypot(hero.x - r.x, (hero.y - r.y) / DEPTH_SCALE)
      if (!r.hit && Math.abs(d - r.r) < 20) {
        r.hit = true
        hurtHero(16, Math.sign(hero.x - r.x) || 1, true)
        hero.slow = Math.max(hero.slow, 2.5)
        pop(hero.x, hero.y - 96, 'FROZEN', '#bae6fd')
      }
    }
    rings = rings.filter((r) => r.r < r.max)
    for (const s of shards) {
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.life -= dt
      if (Math.abs(s.x - hero.x) < 16 && Math.abs(s.y - hero.y) < 18) {
        s.life = 0
        hurtHero(10, Math.sign(s.vx) || 1)
        hero.slow = Math.max(hero.slow, 1.5)
      }
    }
    shards = shards.filter((s) => s.life > 0 && s.x > cam - 50 && s.x < cam + VIEW_W + 50)
    for (const l of lashes) {
      if (l.t > 0) {
        l.t -= dt
        if (l.t <= 0) {
          shake = Math.max(shake, 7)
          playSfx('katana')
        }
        continue
      }
      l.strike -= dt
      if (!l.hit && Math.abs(hero.y - l.y) < 22 && hero.x < l.x) {
        l.hit = true
        hurtHero(22, -1, true)
      }
    }
    lashes = lashes.filter((l) => l.t > 0 || l.strike > 0)
    for (const p of pods) {
      p.t -= dt
      if (p.t > 0) continue
      flashes.push({ x: p.x, y: p.y, r: 55, life: 0.3, color: '#a3e635' })
      if (Math.hypot(hero.x - p.x, (hero.y - p.y) / DEPTH_SCALE) < 60) {
        hurtHero(16, Math.sign(hero.x - p.x) || 1, true)
        hero.poison = Math.max(hero.poison, 3)
      }
    }
    if (pods.some((p) => p.t <= 0)) playSfx('acid-spit')
    pods = pods.filter((p) => p.t > 0)
    for (const c of clouds) {
      c.life -= dt
      const inside = inRadius(c.x, c.y, SPEW_RADIUS)
      let dealt = 0
      for (const m of mobs) {
        if (m.hp > 0 && inside(m.x, m.y, m.r)) {
          m.poison = 3
          hitMob(m, SPEW_DPS * hero.cls.power * dt, 0, 0, 0, false)
          dealt += SPEW_DPS * dt
        }
      }
      if (boss && inside(boss.x, boss.y, boss.r)) {
        boss.poison = 3
        hitBoss(SPEW_DPS * hero.cls.power * dt, false)
        dealt += SPEW_DPS * dt
      }
      leech(dealt)
    }
    clouds = clouds.filter((c) => c.life > 0)
  }

  // ---------- update ----------
  const updateHero = (dt: number) => {
    const h = hero
    for (const slot of [0, 1] as const) {
      h.cd[slot] = Math.max(0, h.cd[slot] - dt)
      if (h.timer[slot] > 0) {
        h.timer[slot] = Math.max(0, h.timer[slot] - dt)
        if (h.timer[slot] === 0 && h.kit[slot] === 'fortify') h.shield = 0
      }
    }
    h.hurt = Math.max(0, h.hurt - dt)
    h.slow = Math.max(0, h.slow - dt)
    if (h.poison > 0) {
      h.poison -= dt
      h.hp -= 5 * dt
      if (h.hp <= 0) {
        h.hp = 0
        finish(false)
        return
      }
    }

    if (active('death-blossom')) {
      const inside = inRadius(h.x, h.y, BLOSSOM_RADIUS)
      let dealt = 0
      for (const m of mobs) {
        if (m.hp > 0 && inside(m.x, m.y, m.r)) {
          hitMob(m, BLOSSOM_DPS * h.cls.power * dt, 0, 0, 0, false)
          dealt += BLOSSOM_DPS * dt
        }
      }
      if (boss && inside(boss.x, boss.y, boss.r)) {
        hitBoss(BLOSSOM_DPS * h.cls.power * dt, false)
        dealt += BLOSSOM_DPS * dt
      }
      h.hp = Math.min(h.maxHp, h.hp + dealt * BLOSSOM_HEAL)
    }

    const attackSpeed = h.cls.attackSpeed * (frenzied() ? 1.4 : 1)
    if (h.attack) {
      const move = MOVES[h.attack.kind]
      h.attack.t += dt * attackSpeed
      if (!h.attack.hit && h.attack.t >= move.startup) {
        h.attack.hit = true
        const fx = h.x
        const facing = h.facing
        const landed = strike(
          (x, y, r) => {
            const ahead = (x - fx) * facing
            return ahead > -10 && ahead < move.reach + r && Math.abs(y - h.y) < move.depth + r * 0.5
          },
          move.damage,
          move.knock,
          move.stun,
          null,
        )
        playSfx(landed ? (h.attack.kind === 'heavy' ? 'barricade' : 'swap') : 'katana')
        if (landed && h.attack.kind === 'heavy') shake = Math.max(shake, 4)
      }
      if (h.attack.t >= move.startup + move.active + move.recover) h.attack = null
    }

    if (pressed.has('skill1')) useSkill(0)
    if (pressed.has('skill2')) useSkill(1)
    if (!h.attack) {
      if (pressed.has('heavy')) h.attack = { kind: 'heavy', t: 0, hit: false }
      else if (pressed.has('light')) h.attack = { kind: 'light', t: 0, hit: false }
    }

    let mx = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0)
    let my = (held.has('down') ? 1 : 0) - (held.has('up') ? 1 : 0)
    const attacking = h.attack !== null
    if (attacking) {
      mx *= 0.25
      my *= 0.25
    } else if (mx !== 0) {
      h.facing = mx > 0 ? 1 : -1
    }
    const speed =
      PLAYER_SPEED * h.cls.speed * (cloaked() ? 1.5 : 1) * (frenzied() ? 1.6 : 1) * (h.slow > 0 ? 0.5 : 1)
    if (mx !== 0 || my !== 0) h.walk += dt * 10
    h.x += mx * speed * dt
    h.y += my * speed * DEPTH_SCALE * dt
    h.x = Math.min(lock() - 24, Math.max(cam + 24, h.x))
    h.y = Math.min(ROAD_BOTTOM, Math.max(ROAD_TOP, h.y))
  }

  const updateMobs = (dt: number) => {
    const target = decoy ?? (cloaked() ? null : hero)
    for (const m of mobs) {
      if (m.hp <= 0) continue
      m.flash = Math.max(0, m.flash - dt)
      m.cd = Math.max(0, m.cd - dt)
      if (m.poison > 0) {
        m.poison -= dt
        hitMob(m, 4 * dt, 0, 0, 0, false)
        if (m.hp <= 0) continue
      }
      m.x += m.kx * dt
      m.kx *= Math.exp(-7 * dt)
      if (m.stun > 0) {
        m.stun -= dt
        continue
      }
      if (!target) {
        m.walk += dt * 2
        m.x += m.facing * m.speed * 0.2 * dt
        m.windup = 0
        continue
      }
      const dx = target.x - m.x
      const dy = target.y - m.y
      if (Math.abs(dx) > 2) m.facing = dx > 0 ? 1 : -1
      const reach = Math.abs(dx) < m.r + 34 && Math.abs(dy) < 18
      if (m.windup > 0) {
        m.windup -= dt
        if (m.windup <= 0) {
          m.cd = MOB_STATS[m.kind].cooldown
          if (reach) {
            if (decoy && target === decoy) {
              decoy.hp -= m.damage
              if (decoy.hp <= 0) detonateDecoy()
            } else {
              hurtHero(m.damage, m.facing)
            }
          }
        }
        continue
      }
      if (reach && m.cd <= 0) {
        m.windup = MOB_STATS[m.kind].windup
        continue
      }
      const standX = target.x - m.facing * (m.r + 22)
      const ddx = standX - m.x
      if (Math.abs(ddx) > 4) m.x += Math.sign(ddx) * Math.min(Math.abs(ddx), m.speed * dt)
      if (Math.abs(dy) > 4) m.y += Math.sign(dy) * Math.min(Math.abs(dy), m.speed * DEPTH_SCALE * dt)
      m.walk += dt * (m.kind === 'runner' ? 12 : 6)
    }
    for (let i = 0; i < mobs.length; i++) {
      for (let j = i + 1; j < mobs.length; j++) {
        const a = mobs[i]
        const b = mobs[j]
        const dx = b.x - a.x
        const dy = (b.y - a.y) / DEPTH_SCALE
        const d = Math.hypot(dx, dy)
        const min = a.r + b.r
        if (d > 0 && d < min) {
          const push = (min - d) / 2
          a.x -= (dx / d) * push
          b.x += (dx / d) * push
          a.y -= (dy / d) * push * DEPTH_SCALE
          b.y += (dy / d) * push * DEPTH_SCALE
        }
      }
    }
    for (const m of mobs) {
      m.y = Math.min(ROAD_BOTTOM, Math.max(ROAD_TOP, m.y))
      m.x = Math.min(cam + VIEW_W + 80, Math.max(cam - 80, m.x))
    }
    mobs = mobs.filter((m) => m.hp > 0)
  }

  const update = (dt: number) => {
    blink += dt
    shake = Math.max(0, shake - dt * 30)
    bannerLife = Math.max(0, bannerLife - dt)
    goFlash = Math.max(0, goFlash - dt)
    for (const p of pops) {
      p.life -= dt
      p.y -= 40 * dt
    }
    pops = pops.filter((p) => p.life > 0)
    for (const f of flashes) f.life -= dt
    flashes = flashes.filter((f) => f.life > 0)
    if (phase !== 'playing') {
      pressed.clear()
      return
    }
    elapsed += dt
    updateHero(dt)
    if (phase !== 'playing') return
    if (decoy) {
      decoy.life -= dt
      if (decoy.life <= 0) detonateDecoy()
    }
    updateMobs(dt)
    if (phase !== 'playing') return
    updateBoss(dt)
    if (phase !== 'playing') return
    updateHazards(dt)
    if (phase !== 'playing') return
    updateSector(dt)
    const want = hero.x - VIEW_W * 0.4
    cam = Math.max(cam, Math.min(lock() - VIEW_W, want))
    cam = Math.min(STAGE_W - VIEW_W, Math.max(0, cam))
    pressed.clear()
  }

  // ---------- rendering ----------
  const themeAt = (worldX: number): Theme => SECTORS[Math.min(SECTORS.length - 1, Math.max(0, Math.floor(worldX / SECTOR_W)))].theme

  const drawBackground = () => {
    const theme = themeAt(cam + VIEW_W / 2)
    const sky = ctx.createLinearGradient(0, 0, 0, ROAD_TOP)
    if (theme === 'ice') {
      sky.addColorStop(0, '#0c4a6e')
      sky.addColorStop(1, '#bae6fd')
    } else if (theme === 'jungle') {
      sky.addColorStop(0, '#052e16')
      sky.addColorStop(1, '#3f6212')
    } else {
      sky.addColorStop(0, '#1e1b4b')
      sky.addColorStop(1, '#9a3412')
    }
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, VIEW_W, ROAD_TOP)

    const par = cam * 0.45
    const first = Math.floor(par / 150) - 1
    for (let i = first; i < first + VIEW_W / 150 + 3; i++) {
      const x = i * 150 - par
      const worldX = (i * 150) / 0.45
      const t = themeAt(worldX)
      const h = 70 + hash(i) * 120
      if (t === 'jungle') {
        ctx.fillStyle = '#14532d'
        ctx.fillRect(x + 60, ROAD_TOP - h, 18, h)
        ctx.fillStyle = hash(i + 7) > 0.5 ? '#166534' : '#15803d'
        ctx.beginPath()
        ctx.arc(x + 69, ROAD_TOP - h, 48 + hash(i + 3) * 20, 0, Math.PI * 2)
        ctx.fill()
        continue
      }
      ctx.fillStyle = t === 'ice' ? '#cbd5e1' : '#1f2937'
      ctx.fillRect(x, ROAD_TOP - h, 120, h)
      ctx.fillStyle = t === 'ice' ? 'rgba(14,116,144,0.5)' : 'rgba(251,191,36,0.55)'
      for (let wy = ROAD_TOP - h + 12; wy < ROAD_TOP - 14; wy += 22) {
        for (let wx = x + 12; wx < x + 108; wx += 26) {
          if (hash(i * 31 + wx + wy) > 0.45) ctx.fillRect(wx, wy, 12, 10)
        }
      }
      if (t === 'ice') {
        ctx.fillStyle = '#e0f2fe'
        for (let k = 0; k < 6; k++) {
          ctx.beginPath()
          ctx.moveTo(x + k * 20, ROAD_TOP - h)
          ctx.lineTo(x + k * 20 + 6, ROAD_TOP - h + 12 + hash(i + k) * 10)
          ctx.lineTo(x + k * 20 + 12, ROAD_TOP - h)
          ctx.fill()
        }
      }
    }

    ctx.fillStyle = theme === 'ice' ? '#475569' : theme === 'jungle' ? '#292524' : '#27272a'
    ctx.fillRect(0, ROAD_TOP - 12, VIEW_W, VIEW_H - ROAD_TOP + 12)
    ctx.fillStyle = theme === 'ice' ? '#e2e8f0' : '#52525b'
    ctx.fillRect(0, ROAD_TOP - 14, VIEW_W, 4)
    ctx.fillStyle = 'rgba(250,204,21,0.5)'
    const laneY = (ROAD_TOP + ROAD_BOTTOM) / 2 + 6
    for (let x = -(cam % 90); x < VIEW_W; x += 90) ctx.fillRect(x, laneY, 44, 4)

    for (let k = 1; k < SECTORS.length; k++) {
      const gx = k * SECTOR_W - cam
      if (gx < -60 || gx > VIEW_W + 60) continue
      ctx.fillStyle = '#0f172a'
      ctx.fillRect(gx - 4, ROAD_TOP - 110, 8, 100)
      ctx.fillStyle = '#0891b2'
      ctx.fillRect(gx - 70, ROAD_TOP - 132, 140, 26)
      ctx.fillStyle = '#ecfeff'
      ctx.font = '800 12px ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(`SECTOR ${k + 1}`, gx, ROAD_TOP - 114)
      if (k === sector + 1) {
        for (let y = ROAD_TOP - 8; y < ROAD_BOTTOM + 14; y += 18) {
          ctx.fillStyle = Math.floor(y / 18) % 2 ? '#dc2626' : '#fafafa'
          ctx.fillRect(gx - 6, y, 12, 14)
        }
      }
    }
    for (const sx of [STAGE_W / 2, STAGE_W - 60]) {
      const mx = sx - cam
      if (mx < -40 || mx > VIEW_W + 40) continue
      ctx.font = '22px ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(sx === STAGE_W / 2 ? '❄️' : '🌿', mx, ROAD_TOP - 140)
    }
  }

  interface BodyOpts {
    tint: string
    dark: string
    accent: string
    scale: number
    walk: number
    facing: 1 | -1
    hunch: number
    flash: boolean
    alpha: number
    reach: number
  }

  const drawBody = (x: number, y: number, o: BodyOpts) => {
    const s = o.scale
    ctx.save()
    ctx.globalAlpha = o.alpha * 0.35
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.ellipse(x, y, 20 * s, 6 * s, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = o.alpha
    const step = Math.sin(o.walk) * 6 * s
    ctx.fillStyle = o.dark
    ctx.fillRect(x - 9 * s + step * 0.5, y - 30 * s, 7 * s, 30 * s)
    ctx.fillRect(x + 2 * s - step * 0.5, y - 30 * s, 7 * s, 30 * s)
    ctx.translate(x, y - 30 * s)
    ctx.rotate(o.hunch * o.facing)
    ctx.fillStyle = o.flash ? '#ffffff' : o.tint
    ctx.fillRect(-12 * s, -32 * s, 24 * s, 34 * s)
    ctx.fillStyle = o.accent
    ctx.fillRect(-12 * s, -6 * s, 24 * s, 4 * s)
    ctx.fillStyle = o.dark
    ctx.fillRect(o.facing > 0 ? 4 * s : -4 * s - (14 + o.reach) * s, -26 * s, (14 + o.reach) * s, 6 * s)
    ctx.fillStyle = o.flash ? '#ffffff' : o.tint
    ctx.beginPath()
    ctx.arc(0, -42 * s, 10 * s, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = o.accent
    ctx.fillRect(o.facing > 0 ? 1 * s : -9 * s, -45 * s, 8 * s, 3 * s)
    ctx.restore()
  }

  const drawHero = () => {
    const h = hero
    const x = h.x - cam
    const alpha = cloaked() ? 0.35 : h.hurt > 0 && Math.floor(blink * 20) % 2 ? 0.6 : 1
    if (active('death-blossom')) {
      ctx.save()
      ctx.globalAlpha = 0.18 + 0.06 * Math.sin(blink * 8)
      ctx.fillStyle = SKILLS['death-blossom'].color
      ctx.beginPath()
      ctx.ellipse(x, h.y, BLOSSOM_RADIUS, BLOSSOM_RADIUS * DEPTH_SCALE, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    const attack = h.attack
    const move = attack ? MOVES[attack.kind] : null
    const live = attack && move && attack.t >= move.startup && attack.t < move.startup + move.active + 0.06
    drawBody(x, h.y, {
      tint: h.cls.tint,
      dark: h.cls.dark,
      accent: h.cls.accent,
      scale: 1,
      walk: h.walk,
      facing: h.facing,
      hunch: attack ? 0.12 : 0,
      flash: false,
      alpha,
      reach: live ? 14 : 0,
    })
    if (live && move) {
      ctx.save()
      ctx.globalAlpha = 0.55
      ctx.strokeStyle = h.cls.accent
      ctx.lineWidth = attack.kind === 'heavy' ? 7 : 4
      ctx.beginPath()
      const cx = x + h.facing * 20
      const start = h.facing > 0 ? -1.1 : Math.PI + 1.1
      ctx.arc(cx, h.y - 48, move.reach * 0.7, start, start + h.facing * 2.2, h.facing < 0)
      ctx.stroke()
      ctx.restore()
    }
    if (h.shield > 0) {
      ctx.save()
      ctx.globalAlpha = 0.25 + 0.4 * (h.shield / FORTIFY_SHIELD)
      ctx.strokeStyle = '#38bdf8'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.ellipse(x, h.y - 40, 30, 46, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
    if (frenzied()) {
      ctx.fillStyle = 'rgba(134,239,172,0.5)'
      ctx.fillRect(x - h.facing * 26, h.y - 60, 4, 30)
      ctx.fillRect(x - h.facing * 34, h.y - 50, 4, 22)
    }
  }

  const drawMob = (m: Mob) => {
    const runner = m.kind === 'runner'
    const x = m.x - cam
    drawBody(x, m.y, {
      tint: runner ? '#b45309' : '#65a30d',
      dark: runner ? '#451a03' : '#365314',
      accent: m.poison > 0 ? '#4ade80' : runner ? '#fca5a5' : '#d9f99d',
      scale: runner ? 0.85 : 1,
      walk: m.walk,
      facing: m.facing,
      hunch: runner ? 0.35 : 0.2,
      flash: m.flash > 0,
      alpha: 1,
      reach: m.windup > 0 ? 10 : 4,
    })
    if (m.windup > 0) {
      ctx.fillStyle = '#ef4444'
      ctx.font = '900 14px ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('!', x, m.y - 82)
    }
    if (m.stun > 0) {
      ctx.fillStyle = '#fde047'
      ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('✦ ✦', x, m.y - 80)
    }
    if (m.hp < m.maxHp) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(x - 16, m.y - 92, 32, 4)
      ctx.fillStyle = '#ef4444'
      ctx.fillRect(x - 16, m.y - 92, 32 * Math.max(0, m.hp / m.maxHp), 4)
    }
  }

  const drawBoss = (b: Boss) => {
    const x = b.x - cam
    const cryo = b.kind === 'cryo'
    const charging = b.action && b.action.t < 0.8
    drawBody(x, b.y, {
      tint: cryo ? '#7dd3fc' : '#166534',
      dark: cryo ? '#0c4a6e' : '#052e16',
      accent: cryo ? '#f0f9ff' : '#a3e635',
      scale: cryo ? 1.6 : 2.3,
      walk: b.walk,
      facing: b.facing,
      hunch: cryo ? 0.25 : 0.1,
      flash: b.flash > 0,
      alpha: 1,
      reach: cryo ? 12 : 4,
    })
    if (!cryo) {
      ctx.strokeStyle = '#4d7c0f'
      ctx.lineWidth = 6
      for (let i = 0; i < 4; i++) {
        ctx.beginPath()
        ctx.moveTo(x, b.y - 120)
        ctx.quadraticCurveTo(x + Math.sin(blink * 2 + i) * 60, b.y - 190, x + (i - 1.5) * 50, b.y - 220 + Math.cos(blink + i) * 10)
        ctx.stroke()
      }
    }
    if (charging) {
      ctx.save()
      ctx.globalAlpha = 0.3 + 0.3 * Math.sin(blink * 30)
      ctx.fillStyle = cryo ? '#e0f2fe' : '#bef264'
      ctx.beginPath()
      ctx.arc(x, b.y - b.r * 2.4, b.r * 1.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  const drawHazardsBelow = () => {
    for (const c of clouds) {
      ctx.save()
      ctx.globalAlpha = 0.35 * Math.min(1, c.life)
      ctx.fillStyle = '#4ade80'
      ctx.beginPath()
      ctx.ellipse(c.x - cam, c.y, SPEW_RADIUS, SPEW_RADIUS * DEPTH_SCALE, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    for (const p of pods) {
      ctx.save()
      ctx.globalAlpha = 0.25 + 0.35 * (1 - Math.min(1, p.t))
      ctx.strokeStyle = '#a3e635'
      ctx.fillStyle = 'rgba(163,230,53,0.25)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.ellipse(p.x - cam, p.y, 55, 55 * DEPTH_SCALE, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }
    for (const l of lashes) {
      const left = cam
      ctx.save()
      if (l.t > 0) {
        ctx.globalAlpha = 0.25 + 0.25 * Math.sin(blink * 25)
        ctx.fillStyle = '#ef4444'
      } else {
        ctx.globalAlpha = 0.9
        ctx.fillStyle = '#4d7c0f'
      }
      ctx.fillRect(0, l.y - 16, l.x - left, 32)
      ctx.restore()
    }
    for (const r of rings) {
      ctx.save()
      ctx.globalAlpha = 0.8 * (1 - r.r / r.max)
      ctx.strokeStyle = '#e0f2fe'
      ctx.lineWidth = 8
      ctx.beginPath()
      ctx.ellipse(r.x - cam, r.y, r.r, r.r * DEPTH_SCALE, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
    if (boss?.action?.id === 'frost-wave') {
      ctx.save()
      ctx.globalAlpha = 0.25
      ctx.fillStyle = '#bae6fd'
      ctx.beginPath()
      ctx.ellipse(boss.x - cam, boss.y, 230, 230 * DEPTH_SCALE, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  const drawHud = () => {
    const h = hero
    ctx.fillStyle = 'rgba(2,6,23,0.75)'
    ctx.fillRect(10, 10, 250, 74)
    ctx.fillStyle = h.cls.tint
    ctx.font = '900 13px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(h.cls.name.toUpperCase(), 20, 28)
    ctx.fillStyle = '#cbd5e1'
    ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(`${Math.ceil(h.hp)} / ${Math.round(h.maxHp)}`, 180, 28)
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(20, 34, 230, 10)
    const pct = h.hp / h.maxHp
    ctx.fillStyle = pct > 0.5 ? '#22c55e' : pct > 0.25 ? '#f59e0b' : '#ef4444'
    ctx.fillRect(20, 34, 230 * pct, 10)
    if (h.shield > 0) {
      ctx.fillStyle = 'rgba(56,189,248,0.8)'
      ctx.fillRect(20, 34, 230 * (h.shield / FORTIFY_SHIELD), 4)
    }
    h.kit.forEach((id, slot) => {
      const skill = SKILLS[id]
      const x = 20 + slot * 116
      ctx.fillStyle = '#0f172a'
      ctx.fillRect(x, 52, 110, 24)
      const ready = h.cd[slot] <= 0
      ctx.fillStyle = ready ? skill.color : 'rgba(148,163,184,0.35)'
      ctx.fillRect(x, 52, 110 * (ready ? 1 : 1 - h.cd[slot] / skill.cooldown), 24)
      ctx.fillStyle = ready ? '#020617' : '#e2e8f0'
      ctx.font = '800 10px ui-sans-serif, system-ui, sans-serif'
      ctx.fillText(`[${slot === 0 ? 'E' : 'Q'}] ${skill.name}`, x + 5, 68)
    })

    ctx.textAlign = 'right'
    ctx.fillStyle = 'rgba(2,6,23,0.75)'
    ctx.fillRect(VIEW_W - 230, 10, 220, 58)
    ctx.fillStyle = '#67e8f9'
    ctx.font = '800 12px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(`SECTOR ${sector + 1}/${SECTORS.length} · ${SECTORS[sector].name}`, VIEW_W - 20, 28)
    ctx.fillStyle = '#e2e8f0'
    ctx.fillText(`KILLS ${kills}   TIME ${formatClock(Math.floor(elapsed))}`, VIEW_W - 20, 46)
    ctx.fillStyle = '#94a3b8'
    ctx.font = '700 10px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(`Left in sector ${Math.max(0, SECTORS[sector].quota - spawned) + mobs.filter((m) => !m.summoned).length}`, VIEW_W - 20, 62)

    const barX = VIEW_W / 2 - 150
    ctx.fillStyle = 'rgba(2,6,23,0.75)'
    ctx.fillRect(barX - 6, 12, 312, 20)
    ctx.fillStyle = '#334155'
    ctx.fillRect(barX, 20, 300, 4)
    ctx.fillStyle = '#22d3ee'
    ctx.fillRect(barX, 20, 300 * (hero.x / STAGE_W), 4)
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('❄️', barX + 150, 28)
    ctx.fillText('🌿', barX + 300, 28)
    ctx.fillStyle = hero.cls.tint
    ctx.beginPath()
    ctx.arc(barX + 300 * (hero.x / STAGE_W), 22, 5, 0, Math.PI * 2)
    ctx.fill()

    if (boss) {
      const bw = 420
      ctx.fillStyle = 'rgba(2,6,23,0.8)'
      ctx.fillRect(VIEW_W / 2 - bw / 2 - 6, VIEW_H - 40, bw + 12, 30)
      ctx.fillStyle = '#1e293b'
      ctx.fillRect(VIEW_W / 2 - bw / 2, VIEW_H - 22, bw, 8)
      ctx.fillStyle = boss.kind === 'cryo' ? '#38bdf8' : '#84cc16'
      ctx.fillRect(VIEW_W / 2 - bw / 2, VIEW_H - 22, bw * Math.max(0, boss.hp / boss.maxHp), 8)
      ctx.fillStyle = '#f8fafc'
      ctx.font = '900 11px ui-sans-serif, system-ui, sans-serif'
      ctx.fillText(boss.name.toUpperCase(), VIEW_W / 2, VIEW_H - 27)
    }

    if (bannerLife > 0) {
      ctx.save()
      ctx.globalAlpha = Math.min(1, bannerLife / 0.4)
      ctx.fillStyle = 'rgba(2,6,23,0.75)'
      ctx.fillRect(VIEW_W / 2 - 220, 110, 440, 40)
      ctx.fillStyle = '#ecfeff'
      ctx.font = '900 18px ui-sans-serif, system-ui, sans-serif'
      ctx.fillText(banner, VIEW_W / 2, 137)
      ctx.restore()
    }
    if (goFlash > 0 && Math.floor(blink * 3) % 2 === 0) {
      ctx.fillStyle = '#fde047'
      ctx.font = '900 34px ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText('GO ➜', VIEW_W - 30, 200)
    }
  }

  const render = () => {
    ctx.save()
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake)
    drawBackground()
    if (phase === 'select') {
      ctx.restore()
      ctx.fillStyle = 'rgba(0,0,0,0.4)'
      ctx.fillRect(0, 0, VIEW_W, VIEW_H)
      return
    }
    drawHazardsBelow()
    const drawables: { y: number; draw: () => void }[] = []
    for (const m of mobs) drawables.push({ y: m.y, draw: () => drawMob(m) })
    if (boss) {
      const b = boss
      drawables.push({ y: b.y, draw: () => drawBoss(b) })
    }
    if (decoy) {
      const d = decoy
      drawables.push({
        y: d.y,
        draw: () =>
          drawBody(d.x - cam, d.y, {
            tint: hero.cls.tint,
            dark: hero.cls.dark,
            accent: hero.cls.accent,
            scale: 1,
            walk: blink * 4,
            facing: hero.facing,
            hunch: 0,
            flash: false,
            alpha: 0.55 + 0.2 * Math.sin(blink * 10),
            reach: 0,
          }),
      })
    }
    drawables.push({ y: hero.y, draw: drawHero })
    drawables.sort((a, b) => a.y - b.y)
    for (const d of drawables) d.draw()

    for (const s of shards) {
      ctx.fillStyle = '#e0f2fe'
      ctx.beginPath()
      ctx.moveTo(s.x - cam + Math.sign(s.vx) * 10, s.y - 30)
      ctx.lineTo(s.x - cam - Math.sign(s.vx) * 6, s.y - 35)
      ctx.lineTo(s.x - cam - Math.sign(s.vx) * 6, s.y - 25)
      ctx.fill()
    }
    for (const f of flashes) {
      ctx.save()
      ctx.globalAlpha = Math.min(0.6, f.life * 2)
      ctx.strokeStyle = f.color
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.ellipse(f.x - cam, f.y, f.r, f.r * DEPTH_SCALE, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
    ctx.textAlign = 'center'
    ctx.font = '800 13px ui-sans-serif, system-ui, sans-serif'
    for (const p of pops) {
      ctx.globalAlpha = Math.min(1, p.life * 2)
      ctx.fillStyle = p.color
      ctx.fillText(p.text, p.x - cam, p.y)
    }
    ctx.globalAlpha = 1
    ctx.restore()
    if (hero.slow > 0) {
      ctx.fillStyle = 'rgba(186,230,253,0.12)'
      ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    }
    if (phase === 'playing') drawLowHealthVignette(ctx, VIEW_W, VIEW_H, elapsed, lowHealthSeverity(hero.hp, hero.maxHp))
    drawHud()
  }

  const frameStep = (now: number) => {
    if (!open) return
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    update(dt)
    render()
    raf = window.requestAnimationFrame(frameStep)
  }

  // ---------- input ----------
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
      if (['1', '2', '3', '4'].includes(key)) start(Number(key) - 1)
      return
    }
    if (phase === 'over') {
      if (key === 'enter') openSelect()
      return
    }
    const action = KEYMAP[key]
    if (!action) return
    held.add(action)
    if (!e.repeat) pressed.add(action)
  }

  const onKeyUp = (e: KeyboardEvent) => {
    if (!open) return
    const action = KEYMAP[e.key.toLowerCase()]
    if (action) held.delete(action)
  }

  const padButton = (label: string, action: string, cls: string) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.className = `flex touch-none select-none items-center justify-center rounded-full bg-white/10 font-black uppercase text-white ring-2 ring-white/25 active:bg-cyan-500/50 ${cls}`
    const release = () => held.delete(action)
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      held.add(action)
      pressed.add(action)
    })
    b.addEventListener('pointerup', release)
    b.addEventListener('pointercancel', release)
    b.addEventListener('pointerleave', release)
    return b
  }

  const dpad = document.createElement('div')
  dpad.className = 'grid grid-cols-3 gap-1'
  const blank = () => document.createElement('div')
  dpad.append(
    blank(),
    padButton('▲', 'up', 'h-12 w-12 text-lg'),
    blank(),
    padButton('◀', 'left', 'h-12 w-12 text-lg'),
    blank(),
    padButton('▶', 'right', 'h-12 w-12 text-lg'),
    blank(),
    padButton('▼', 'down', 'h-12 w-12 text-lg'),
    blank(),
  )
  const actions = document.createElement('div')
  actions.className = 'grid grid-cols-2 gap-2'
  actions.append(
    padButton('Q', 'skill2', 'h-12 w-12 text-sm'),
    padButton('E', 'skill1', 'h-12 w-12 text-sm'),
    padButton('Hvy', 'heavy', 'h-14 w-14 text-xs'),
    padButton('Atk', 'light', 'h-14 w-14 text-xs'),
  )
  touchPad.append(dpad, actions)

  function syncTouch() {
    const show = isTouchDevice() && phase === 'playing'
    touchPad.classList.toggle('hidden', !show)
    touchPad.classList.toggle('flex', show)
    legend.classList.toggle('hidden', isTouchDevice())
  }

  function close() {
    if (!open) return
    open = false
    window.cancelAnimationFrame(raf)
    held.clear()
    pressed.clear()
    overlay.classList.add('hidden')
    overlay.classList.remove('flex')
    onQuit()
  }

  q<HTMLButtonElement>('#riot-quit').addEventListener('click', () => close())
  q<HTMLButtonElement>('#riot-over-quit').addEventListener('click', () => close())
  q<HTMLButtonElement>('#riot-retry').addEventListener('click', () => openSelect())
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('keyup', onKeyUp, true)

  return {
    open: () => {
      if (open) return
      open = true
      resumeAudio()
      cam = 0
      hero = makeHero(ROSTER[0])
      openSelect()
      overlay.classList.remove('hidden')
      overlay.classList.add('flex')
      last = performance.now()
      raf = window.requestAnimationFrame(frameStep)
    },
    close,
    isOpen: () => open,
  }
}
