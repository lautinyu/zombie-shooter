/**
 * ROT FIGHTER — a standalone Street Fighter style 1v1 cabinet. It runs on its
 * own overlay, canvas, loop and input, so the campaign state is never touched.
 *
 * Combat is frame-data driven: every attack has startup, active and recovery
 * windows, a reach measured from the fighter's front edge, and its own hitstun
 * and knockback. Blocking is a held stance that cuts damage and knockback but
 * leaks chip damage, so trading blindly loses to spacing and punishes.
 */

import { playSfx, resumeAudio } from './audio'
import { recordPlay, submitScore } from './arcadeStats'
import { isTouchDevice } from './TouchControls'

const VIEW_W = 900
const VIEW_H = 480
/** Ground line the fighters stand on. */
const FLOOR = 396
const WALL = 46

const FIGHTER_W = 58
const FIGHTER_H = 108
const WALK_SPEED = 205
const BACK_SPEED = 150
const JUMP_VELOCITY = -640
const GRAVITY = 1750

const MAX_HP = 200
const ROUND_TIME = 70
const ROUNDS_TO_WIN = 2

/** Fraction of an attack's damage that still lands through a guard. */
const CHIP_RATIO = 0.18
const BLOCK_KNOCKBACK = 0.35
/** Guard is only honoured when the defender faces the incoming blow. */
const BLOCK_WALK_SPEED = 70
/** How fast knockback velocity decays, in px/s². */
const KNOCKBACK_DRAG = 700
/** Seconds an attack input waits for the fighter to become actionable. */
const INPUT_BUFFER = 0.25

type MoveId = 'light' | 'heavy' | 'special'
type Phase = 'attract' | 'select' | 'fight' | 'round-over' | 'match-over'
type ActionId =
  | 'left'
  | 'right'
  | 'jump'
  | 'light'
  | 'heavy'
  | 'special'
  | 'block'
  | 'ability'

/** Active class ability, one per playable fighter, on its own cooldown. */
type AbilityId = 'shadow-dash' | 'riot-shield' | 'toxic-enrage' | 'phase-shift'

interface AbilityData {
  name: string
  /** Short HUD tag. */
  tag: string
  cooldown: number
  /** Seconds the effect stays up. */
  duration: number
  color: string
}

const ABILITIES: Record<AbilityId, AbilityData> = {
  'shadow-dash': {
    name: 'Shadow Dash',
    tag: 'SHADOW DASH',
    cooldown: 9,
    duration: 0.36,
    color: '#fb7185',
  },
  'riot-shield': {
    name: 'Riot Shield',
    tag: 'RIOT SHIELD',
    cooldown: 12,
    duration: 3,
    color: '#38bdf8',
  },
  'toxic-enrage': {
    name: 'Toxic Enrage',
    tag: 'TOXIC ENRAGE',
    cooldown: 13,
    duration: 4,
    color: '#15803d',
  },
  'phase-shift': {
    name: 'Phase Shift',
    tag: 'PHASE SHIFT',
    cooldown: 11,
    duration: 2,
    color: '#c4b5fd',
  },
}

/** Toxic Enrage: damage soaked, damage added and share of damage leeched. */
const ENRAGE_SOAK = 0.4
const ENRAGE_POWER = 1.15
const ENRAGE_LEECH = 0.15

/** Attacks that keep the Phase Shift afterglow once the 2s window closes. */
const PHASE_ECHO_HITS = 2
/** Dodge chance added on top of the base rate during the afterglow. */
const PHASE_ECHO_DODGE = 0.3

/** Speed the Reaper crosses the pit at during Shadow Dash, in px/s. */
const DASH_SPEED = 780
/** Fire left in the dash's wake: damage per patch and how long it burns. */
const FLAME_DAMAGE = 9
const FLAME_LIFE = 2.2
const FLAME_SPACING = 0.05
/** Share of a blocked blow the Riot Shield throws back at the attacker. */
const SHIELD_REFLECT = 0.6

/** A patch of fire dropped by Shadow Dash. */
interface Flame {
  x: number
  life: number
  owner: 1 | 2
  /** One patch burns a given fighter once. */
  spent: boolean
}

interface MoveData {
  /** Seconds before the hitbox exists — the punish window. */
  startup: number
  /** Seconds the hitbox is live. */
  active: number
  /** Seconds of helplessness after the active frames. */
  recovery: number
  damage: number
  /** Distance the hitbox extends past the fighter's front edge. */
  reach: number
  /** Vertical centre of the hitbox, measured up from the feet. */
  height: number
  hitstun: number
  knockback: number
  /** Seconds before the move can be used again; 0 for normals. */
  cooldown: number
  /** Self-movement applied while the move is active (special is a dash). */
  lunge: number
  color: string
}

/**
 * Frame data is tuned so the light jab is safe on block (recovery shorter than
 * the opponent's fastest startup + blockstun) while the heavy is punishable,
 * and the special trades reach for a long cooldown.
 */
const MOVES: Record<MoveId, MoveData> = {
  light: {
    startup: 0.07,
    active: 0.06,
    recovery: 0.15,
    damage: 7,
    reach: 52,
    height: 74,
    hitstun: 0.2,
    knockback: 205,
    cooldown: 0,
    lunge: 0,
    color: '#fde68a',
  },
  heavy: {
    startup: 0.21,
    active: 0.09,
    recovery: 0.38,
    damage: 17,
    reach: 74,
    height: 62,
    hitstun: 0.36,
    knockback: 330,
    cooldown: 0,
    lunge: 40,
    color: '#fb923c',
  },
  special: {
    startup: 0.26,
    active: 0.18,
    recovery: 0.42,
    damage: 26,
    reach: 96,
    height: 68,
    hitstun: 0.45,
    knockback: 420,
    cooldown: 7,
    lunge: 190,
    color: '#a855f7',
  },
}

/**
 * A playable fighter. Passives are deliberately small multipliers so the
 * roster stays readable: every pick trades one edge for a matching weakness
 * rather than raising the damage ceiling.
 */
interface Character {
  name: string
  tint: string
  dark: string
  accent: string
  /** Share of damage dealt that heals the attacker. */
  lifesteal: number
  /** Multiplier on outgoing damage. */
  power: number
  /** Multiplier on walk, backdash and dash speed. */
  speed: number
  /** Multiplier on how fast move frames advance. */
  attackSpeed: number
  /** Multiplier on the health pool. */
  hpScale: number
  /** Chance an incoming hit is evaded outright. */
  dodge: number
  /** One-line passive summary shown on the select screen. */
  trait: string
  /** Active ability on a cooldown, or null for passive-only fighters. */
  ability: AbilityId | null
}

const ROSTER: Character[] = [
  {
    name: 'Warden',
    tint: '#e2e8f0',
    dark: '#334155',
    accent: '#f59e0b',
    lifesteal: 0,
    power: 1.1,
    speed: 1,
    attackSpeed: 1,
    hpScale: 1,
    dodge: 0,
    trait: '+10% DAMAGE ON EVERY ATTACK',
    ability: 'riot-shield',
  },
  {
    name: 'Reaper',
    tint: '#f43f5e',
    dark: '#4c0519',
    accent: '#fecdd3',
    lifesteal: 0.05,
    power: 1,
    speed: 1,
    attackSpeed: 1,
    hpScale: 1,
    dodge: 0,
    trait: '5% LIFESTEAL ON EVERY HIT',
    ability: 'shadow-dash',
  },
  {
    name: 'Shambler',
    tint: '#4ade80',
    dark: '#14532d',
    accent: '#bbf7d0',
    lifesteal: 0,
    power: 1,
    speed: 1.1,
    attackSpeed: 1.1,
    hpScale: 0.95,
    dodge: 0,
    trait: '+10% SPEED & ATTACK SPEED · -5% HP',
    ability: 'toxic-enrage',
  },
  {
    name: 'Ghost',
    tint: '#c4b5fd',
    dark: '#3730a3',
    accent: '#e0e7ff',
    lifesteal: 0,
    power: 1,
    speed: 1,
    attackSpeed: 1,
    hpScale: 1,
    dodge: 0.15,
    trait: '15% CHANCE TO EVADE A HIT',
    ability: 'phase-shift',
  },
]

interface Opponent {
  name: string
  tint: string
  dark: string
  /** Trim colour for visor, belt and strike trails. */
  accent: string
  /** Scales CPU reaction speed and aggression; 1 is the opening fight. */
  skill: number
  /** Health pool as a multiple of the player's. */
  hpScale: number
  /** Walk and dash speed as a multiple of the player's. */
  speed: number
  /** Round-win bonus awarded for beating this opponent. */
  bounty: number
  /** Bosses are larger, crowned and hit harder. */
  boss?: boolean
}

const OPPONENTS: Opponent[] = [
  {
    name: 'Shambler',
    tint: '#4ade80',
    dark: '#14532d',
    accent: '#bbf7d0',
    skill: 0.7,
    hpScale: 0.9,
    speed: 0.85,
    bounty: 1200,
  },
  {
    name: 'Runner',
    tint: '#38bdf8',
    dark: '#0c4a6e',
    accent: '#e0f2fe',
    skill: 1,
    hpScale: 1,
    speed: 1.15,
    bounty: 1800,
  },
  {
    name: 'Brute',
    tint: '#f97316',
    dark: '#7c2d12',
    accent: '#fed7aa',
    skill: 1.3,
    hpScale: 1.25,
    speed: 0.95,
    bounty: 2600,
  },
  {
    name: 'Cryo-Stalker',
    tint: '#bae6fd',
    dark: '#155e75',
    accent: '#67e8f9',
    skill: 1.6,
    hpScale: 1.3,
    speed: 1.2,
    bounty: 3600,
  },
  {
    name: 'Canopy Leviathan',
    tint: '#a855f7',
    dark: '#4c1d95',
    accent: '#f0abfc',
    skill: 2,
    hpScale: 1.45,
    speed: 1.1,
    bounty: 6000,
    boss: true,
  },
  {
    // Final stage: relentless pressure, a deep health pool and almost no
    // whiffing, so only clean blocking and punishes get through.
    name: 'Rot Sovereign',
    tint: '#f43f5e',
    dark: '#4c0519',
    accent: '#fde047',
    skill: 2.8,
    hpScale: 1.75,
    speed: 1.3,
    bounty: 12000,
    boss: true,
  },
]

interface Fighter {
  id: 1 | 2
  name: string
  tint: string
  dark: string
  accent: string
  /** Full health pool; opponents deeper in the ladder carry more. */
  maxHp: number
  /** Movement multiplier applied to walk, backdash and CPU approach. */
  speed: number
  /** Passive multipliers; CPU opponents run the neutral 1.0 set. */
  power: number
  attackSpeed: number
  lifesteal: number
  dodge: number
  boss: boolean
  /** Set briefly when a dodge eats an attack, so the miss reads on screen. */
  evadeFlash: number
  /** Advances while walking so the legs animate. */
  walkPhase: number
  x: number
  y: number
  /** Knockback velocity, bled off by friction. */
  vx: number
  vy: number
  facing: 1 | -1
  hp: number
  /** Active move, or null while free to act. */
  move: MoveId | null
  moveTimer: number
  /** Set once an active move has connected, so it cannot hit twice. */
  moveHit: boolean
  blocking: boolean
  /** Seconds left of hit or block stun; the fighter cannot act. */
  stun: number
  specialCd: number
  /** Class ability, its cooldown and the seconds of effect still running. */
  ability: AbilityId | null
  abilityCd: number
  abilityTimer: number
  /** Counts down to the next fire patch while Shadow Dash is running. */
  flameTimer: number
  /** Incoming attacks still carrying the Phase Shift dodge bonus. */
  phaseEcho: number
  /** Fading ghost afterimages left by Phase Shift. */
  echoes: { x: number; life: number }[]
  hitFlash: number
  /** Damage dealt this match, the basis of the arcade score. */
  dealt: number
}

export interface FightingCabinet {
  open: () => void
  close: () => void
  isOpen: () => boolean
}

const KEYS: Record<1 | 2, Record<ActionId, string[]>> = {
  1: {
    left: ['a'],
    right: ['d'],
    jump: ['w'],
    block: ['4', 's'],
    light: ['1'],
    heavy: ['2'],
    special: ['3'],
    ability: ['e'],
  },
  2: {
    left: ['arrowleft'],
    right: ['arrowright'],
    jump: ['arrowup'],
    block: [';', 'arrowdown'],
    light: ['j'],
    heavy: ['k'],
    special: ['l'],
    // 'k' is already player 2's heavy, so the ability sits on the numpad with
    // 'u' as a laptop-friendly stand-in.
    ability: ['numpad1', 'u'],
  },
}

export function mountFightingArcade(onQuit: () => void): FightingCabinet {
  const overlay = document.createElement('div')
  overlay.className =
    'fighter-overlay fixed inset-0 z-40 hidden flex-col items-center justify-center overflow-y-auto bg-black/98 p-3'
  overlay.innerHTML = `
    <div class="flex w-full max-w-[940px] items-center justify-between pb-2">
      <div class="text-xs font-black uppercase tracking-[0.35em] text-lime-400">Rot Fighter</div>
      <button id="fighter-quit" class="rounded-lg bg-lime-500/20 px-4 py-1.5 text-xs font-black uppercase tracking-widest text-lime-200 ring-1 ring-lime-400/60 hover:bg-lime-500/35">Quit to Main Menu</button>
    </div>
  `

  const frame = document.createElement('div')
  frame.className =
    'relative rounded-2xl bg-slate-950 p-3 ring-2 ring-lime-500/50 shadow-[0_0_60px_rgba(132,204,22,0.3)]'
  const canvas = document.createElement('canvas')
  canvas.width = VIEW_W
  canvas.height = VIEW_H
  canvas.className = 'block h-auto w-[min(92vw,900px)] rounded-lg bg-black'
  frame.appendChild(canvas)
  overlay.appendChild(frame)

  const legend = document.createElement('div')
  legend.className =
    'fighter-legend pt-3 text-center text-[11px] uppercase tracking-[0.2em] text-slate-500'
  legend.textContent =
    'P1 WASD · 1/2/3 attacks · 4 block · E ability   ·   P2 arrows · J/K/L attacks · ; block · Numpad1 or U ability'
  overlay.appendChild(legend)

  const pad = buildTouchPad()
  overlay.appendChild(pad.root)

  document.body.appendChild(overlay)

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('fighting arcade canvas context unavailable')

  let open = false
  let phase: Phase = 'attract'
  let versus = false
  let raf = 0
  let last = 0
  let blink = 0
  let shake = 0
  let phaseTimer = 0
  let clock = ROUND_TIME
  let score = 0
  let stage = 0
  let wins: [number, number] = [0, 0]
  let banner = ''

  const held = new Set<string>()
  /** Edge-triggered presses, so a held attack key does not auto-repeat. */
  const pressed = new Set<string>()
  /**
   * Attack taps survive a short window so a press made during hitstun still
   * comes out the instant the fighter recovers, instead of being swallowed.
   */
  const buffer = new Map<string, number>()

  const makeFighter = (id: 1 | 2, from: Opponent | null, char: Character): Fighter => ({
    id,
    name: from ? from.name : char.name,
    tint: from ? from.tint : char.tint,
    dark: from ? from.dark : char.dark,
    accent: from ? from.accent : char.accent,
    maxHp: MAX_HP * (from ? from.hpScale : char.hpScale),
    speed: from ? from.speed : char.speed,
    power: from ? 1 : char.power,
    attackSpeed: from ? 1 : char.attackSpeed,
    lifesteal: from ? 0 : char.lifesteal,
    dodge: from ? 0 : char.dodge,
    boss: Boolean(from?.boss),
    evadeFlash: 0,
    walkPhase: 0,
    x: id === 1 ? VIEW_W * 0.32 : VIEW_W * 0.68,
    y: FLOOR,
    vx: 0,
    vy: 0,
    facing: id === 1 ? 1 : -1,
    hp: MAX_HP * (from ? from.hpScale : char.hpScale),
    move: null,
    moveTimer: 0,
    moveHit: false,
    blocking: false,
    stun: 0,
    specialCd: 0,
    ability: from ? null : char.ability,
    abilityCd: 0,
    abilityTimer: 0,
    flameTimer: 0,
    phaseEcho: 0,
    echoes: [],
    hitFlash: 0,
    dealt: 0,
  })

  /** Fire patches left behind by Shadow Dash, cleared between rounds. */
  let flames: Flame[] = []

  const dashing = (f: Fighter): boolean =>
    f.ability === 'shadow-dash' && f.abilityTimer > 0
  const shielded = (f: Fighter): boolean =>
    f.ability === 'riot-shield' && f.abilityTimer > 0
  const enraged = (f: Fighter): boolean =>
    f.ability === 'toxic-enrage' && f.abilityTimer > 0
  const phased = (f: Fighter): boolean =>
    f.ability === 'phase-shift' && f.abilityTimer > 0

  /** Roster index each player has highlighted on the select screen. */
  let picks: [number, number] = [0, 1]
  let locked: [boolean, boolean] = [false, false]

  let p1 = makeFighter(1, null, ROSTER[0])
  let p2 = makeFighter(2, OPPONENTS[0], ROSTER[1])

  /** CPU decision clock: it commits to one intent at a time, like a player. */
  let cpuThink = 0
  let cpuIntent: 'approach' | 'retreat' | 'attack' | 'guard' = 'approach'
  /** Enforced gap between CPU swings; the CPU's stand-in for human hands. */
  let cpuPause = 0

  const opponent = (): Opponent => OPPONENTS[Math.min(stage, OPPONENTS.length - 1)]

  const resetRound = () => {
    const facing2: 1 | -1 = -1
    p1 = makeFighter(1, null, ROSTER[picks[0]])
    p2 = makeFighter(2, versus ? null : opponent(), ROSTER[picks[1]])
    p2.facing = facing2
    clock = ROUND_TIME
    flames = []
    shake = 0
    cpuThink = 0
    cpuPause = 0.8
  }

  /** Character select sits between the attract screen and the first round. */
  const startSelect = (pvp: boolean) => {
    versus = pvp
    locked = [false, false]
    // The keypress that opened select must not also count as a lock-in.
    pressed.clear()
    pad.clearTaps()
    phase = 'select'
    phaseTimer = 0
    playSfx('swap')
  }

  const startMatch = (pvp: boolean) => {
    versus = pvp
    stage = 0
    wins = [0, 0]
    score = 0
    banner = ''
    resetRound()
    phase = 'fight'
    phaseTimer = 0
    recordPlay('rot-fighter')
    playSfx('boss-roar')
  }

  const held2 = (id: 1 | 2, action: ActionId): boolean => {
    if (pad.isHeld(id, action)) return true
    return KEYS[id][action].some((k) => held.has(k))
  }

  const tapped = (id: 1 | 2, action: ActionId): boolean => {
    if (pad.consumeTap(id, action)) return true
    return KEYS[id][action].some((k) => pressed.has(k))
  }

  const bufferKey = (id: 1 | 2, action: ActionId) => `${id}:${action}`

  /** Records a tap and reports whether one is pending within the window. */
  const buffered = (id: 1 | 2, action: ActionId, ready: boolean): boolean => {
    const k = bufferKey(id, action)
    if (tapped(id, action)) buffer.set(k, INPUT_BUFFER)
    if (!ready || !buffer.has(k)) return false
    buffer.delete(k)
    return true
  }

  const busy = (f: Fighter): boolean =>
    f.move !== null || f.stun > 0 || dashing(f)

  /** Fires the fighter's class ability if it is off cooldown. */
  const startAbility = (f: Fighter) => {
    if (!f.ability || f.abilityCd > 0 || f.abilityTimer > 0 || busy(f)) return
    const data = ABILITIES[f.ability]
    f.abilityCd = data.cooldown
    f.abilityTimer = data.duration
    f.blocking = false
    f.move = null
    f.moveTimer = 0
    if (f.ability === 'shadow-dash') {
      f.flameTimer = 0
      playSfx('boss-dash')
    } else {
      // Phase Shift banks its afterglow up front: the guaranteed window runs
      // first, then the next couple of attacks are still hard to land.
      if (f.ability === 'phase-shift') {
        f.phaseEcho = PHASE_ECHO_HITS
        f.echoes = []
      }
      playSfx(f.ability === 'riot-shield' ? 'barricade' : 'boss-roar')
    }
  }

  const startMove = (f: Fighter, id: MoveId) => {
    if (busy(f)) return
    if (id === 'special' && f.specialCd > 0) return
    f.move = id
    f.moveTimer = 0
    f.moveHit = false
    f.blocking = false
    if (id === 'special') {
      f.specialCd = MOVES.special.cooldown
      playSfx('overdrive')
    } else {
      playSfx(id === 'heavy' ? 'boss-dash' : 'swap')
    }
  }

  /** Front edge of the fighter in the direction it is facing. */
  const frontEdge = (f: Fighter): number => f.x + f.facing * (FIGHTER_W / 2)

  const tryConnect = (attacker: Fighter, defender: Fighter) => {
    if (attacker.move === null || attacker.moveHit) return
    const data = MOVES[attacker.move]
    const elapsed = attacker.moveTimer
    if (elapsed < data.startup || elapsed > data.startup + data.active) return

    const tipX = frontEdge(attacker) + attacker.facing * data.reach
    const lowX = Math.min(frontEdge(attacker), tipX)
    const highX = Math.max(frontEdge(attacker), tipX)
    const defLow = defender.x - FIGHTER_W / 2
    const defHigh = defender.x + FIGHTER_W / 2
    if (highX < defLow || lowX > defHigh) return

    // Airborne defenders are only caught by hitboxes that reach their shins.
    const airGap = FLOOR - defender.y
    if (airGap > data.height) return

    attacker.moveHit = true
    // The Riot Shield eats the blow outright and throws part of it back.
    if (shielded(defender) && defender.facing !== attacker.facing) {
      let back = data.damage * SHIELD_REFLECT * defender.power
      if (enraged(attacker)) back *= 1 - ENRAGE_SOAK
      attacker.hp = Math.max(0, attacker.hp - back)
      defender.dealt += back
      attacker.stun = data.hitstun
      attacker.move = null
      attacker.hitFlash = 0.2
      attacker.vx = -attacker.facing * data.knockback * 0.8
      shake = Math.max(shake, 0.2)
      playSfx('barricade')
      return
    }
    // Evasion resolves before the guard: the blow simply misses. Phase Shift
    // makes that certain while it is up, and its afterglow tops up the next
    // couple of attacks.
    const guaranteed = phased(defender)
    let chance = defender.dodge
    if (!guaranteed && defender.phaseEcho > 0) {
      chance += PHASE_ECHO_DODGE
      defender.phaseEcho -= 1
    }
    if (guaranteed || (chance > 0 && Math.random() < chance)) {
      defender.evadeFlash = 0.6
      playSfx('swap')
      return
    }
    const guarding =
      defender.blocking && defender.facing !== attacker.facing && defender.y === FLOOR
    // Toxic Enrage swings both ways: the rager hits harder and drinks back a
    // slice of it, and soaks a chunk of whatever lands on it.
    const power = attacker.power * (enraged(attacker) ? ENRAGE_POWER : 1)
    let damage = (guarding ? data.damage * CHIP_RATIO : data.damage) * power
    if (enraged(defender)) damage *= 1 - ENRAGE_SOAK
    defender.hp = Math.max(0, defender.hp - damage)
    attacker.dealt += damage
    const leech = attacker.lifesteal + (enraged(attacker) ? ENRAGE_LEECH : 0)
    if (leech > 0) attacker.hp = Math.min(attacker.maxHp, attacker.hp + damage * leech)
    defender.stun = guarding ? data.hitstun * 0.6 : data.hitstun
    defender.move = null
    defender.hitFlash = guarding ? 0.1 : 0.22
    // Knockback is a velocity, so a clean hit buys real space and the trade
    // resets to neutral instead of letting the winner jab-lock the loser.
    const push = data.knockback * (guarding ? BLOCK_KNOCKBACK : 1)
    // A cornered defender has nowhere to go, so the attacker takes the recoil
    // instead; that keeps corner pressure from becoming an inescapable loop.
    const pinned =
      defender.x <= WALL + FIGHTER_W / 2 + 2 || defender.x >= VIEW_W - WALL - FIGHTER_W / 2 - 2
    if (pinned) attacker.vx = -attacker.facing * push
    else defender.vx = attacker.facing * push
    shake = Math.max(shake, guarding ? 0.12 : data.damage / 60)
    playSfx(guarding ? 'barricade' : data.damage >= 17 ? 'explosion' : 'sting')
  }

  const stepFighter = (f: Fighter, foe: Fighter, dt: number, controlled: boolean) => {
    const startX = f.x
    f.hitFlash = Math.max(0, f.hitFlash - dt)
    f.evadeFlash = Math.max(0, f.evadeFlash - dt)
    f.specialCd = Math.max(0, f.specialCd - dt)
    f.abilityCd = Math.max(0, f.abilityCd - dt)
    f.abilityTimer = Math.max(0, f.abilityTimer - dt)
    f.stun = Math.max(0, f.stun - dt)

    // Phase Shift leaves afterimages behind the fighter while it is up.
    for (let i = f.echoes.length - 1; i >= 0; i--) {
      f.echoes[i].life -= dt
      if (f.echoes[i].life <= 0) f.echoes.splice(i, 1)
    }
    if (phased(f) && (f.echoes.length === 0 || Math.abs(f.echoes[0].x - f.x) > 14))
      f.echoes.unshift({ x: f.x, life: 0.45 })

    if (dashing(f)) {
      // Shadow Dash: a straight sprint that passes through the opponent and
      // scatters fire behind it. Nothing else runs while it is up.
      f.x += f.facing * DASH_SPEED * dt
      f.flameTimer -= dt
      if (f.flameTimer <= 0) {
        f.flameTimer = FLAME_SPACING
        flames.push({ x: f.x, life: FLAME_LIFE, owner: f.id, spent: false })
      }
      f.x = Math.max(WALL + FIGHTER_W / 2, Math.min(VIEW_W - WALL - FIGHTER_W / 2, f.x))
      f.walkPhase += Math.abs(f.x - startX) * 0.06
      return
    }

    if (f.y === FLOOR && f.vy === 0) f.facing = foe.x >= f.x ? 1 : -1

    if (f.move !== null) {
      const data = MOVES[f.move]
      f.moveTimer += dt * f.attackSpeed
      if (f.moveTimer >= data.startup && f.moveTimer <= data.startup + data.active) {
        f.x += f.facing * data.lunge * dt
      }
      if (f.moveTimer >= data.startup + data.active + data.recovery) {
        f.move = null
        f.moveTimer = 0
      }
    }

    if (controlled) {
      const canAct = !busy(f)
      f.blocking = canAct && f.y === FLOOR && held2(f.id, 'block')
      const free = canAct && !f.blocking
      const light = buffered(f.id, 'light', free)
      const heavy = buffered(f.id, 'heavy', free)
      const special = buffered(f.id, 'special', free)
      const jump = buffered(f.id, 'jump', free && f.y === FLOOR)
      if (buffered(f.id, 'ability', free)) startAbility(f)
      if (light) startMove(f, 'light')
      else if (heavy) startMove(f, 'heavy')
      else if (special) startMove(f, 'special')
      if (jump) f.vy = JUMP_VELOCITY
      if (canAct) {
        const left = held2(f.id, 'left')
        const right = held2(f.id, 'right')
        if (left !== right) {
          const dir = right ? 1 : -1
          const forward = dir === f.facing
          const speed = f.blocking ? BLOCK_WALK_SPEED : forward ? WALK_SPEED : BACK_SPEED
          f.x += dir * speed * f.speed * dt
        }
      }
    }

    // Knockback slide, bled off quickly so it never becomes movement.
    if (f.vx !== 0) {
      f.x += f.vx * dt
      const drag = KNOCKBACK_DRAG * dt
      f.vx = Math.abs(f.vx) <= drag ? 0 : f.vx - Math.sign(f.vx) * drag
    }

    // Gravity and the floor.
    if (f.y < FLOOR || f.vy !== 0) {
      f.vy += GRAVITY * dt
      f.y += f.vy * dt
      if (f.y >= FLOOR) {
        f.y = FLOOR
        f.vy = 0
      }
    }

    f.x = Math.max(WALL + FIGHTER_W / 2, Math.min(VIEW_W - WALL - FIGHTER_W / 2, f.x))
    f.walkPhase += Math.abs(f.x - startX) * 0.06
  }

  /** Burns whoever walks into a fire patch, then ages the patches out. */
  const stepFlames = (dt: number) => {
    for (let i = flames.length - 1; i >= 0; i--) {
      const fl = flames[i]
      fl.life -= dt
      if (fl.life <= 0) {
        flames.splice(i, 1)
        continue
      }
      if (fl.spent) continue
      const victim = fl.owner === 1 ? p2 : p1
      if (phased(victim)) continue
      if (victim.y !== FLOOR || Math.abs(victim.x - fl.x) > FIGHTER_W / 2 + 8) continue
      fl.spent = true
      const burn = FLAME_DAMAGE * (enraged(victim) ? 1 - ENRAGE_SOAK : 1)
      victim.hp = Math.max(0, victim.hp - burn)
      victim.hitFlash = 0.16
      const burner = fl.owner === 1 ? p1 : p2
      burner.dealt += burn
      if (burner.lifesteal > 0)
        burner.hp = Math.min(burner.maxHp, burner.hp + burn * burner.lifesteal)
      playSfx('sting')
    }
  }

  /** Simple spacing-aware CPU: it respects range, whiff-punishes and guards. */
  const stepCpu = (f: Fighter, foe: Fighter, dt: number) => {
    const skill = versus ? 1 : opponent().skill
    const gap = Math.abs(foe.x - f.x) - FIGHTER_W
    const dir: 1 | -1 = foe.x >= f.x ? 1 : -1

    cpuThink -= dt
    if (cpuThink <= 0) {
      cpuThink = Math.max(0.12, 0.5 / skill) * (0.7 + Math.random() * 0.6)
      const foeAttacking = foe.move !== null
      const foeRecovering = foeAttacking && foe.moveHit
      if (foeRecovering && gap < MOVES.heavy.reach) cpuIntent = 'attack'
      else if (foeAttacking && gap < MOVES.heavy.reach + 20)
        cpuIntent = Math.random() < 0.35 + skill * 0.25 ? 'guard' : 'attack'
      else if (gap > MOVES.light.reach + 30) cpuIntent = 'approach'
      else if (gap < 18 && Math.random() < 0.25) cpuIntent = 'retreat'
      else cpuIntent = 'attack'
    }

    if (busy(f)) {
      f.blocking = false
      return
    }

    // Breathing room after every swing, so the CPU cannot jab-lock a player.
    cpuPause = Math.max(0, cpuPause - dt)
    f.blocking = cpuIntent === 'guard'
    if (f.blocking || cpuPause > 0) return

    const swing = (id: MoveId) => {
      startMove(f, id)
      // Bosses barely breathe between swings, so they pressure relentlessly.
      const rest = (1.5 - Math.min(skill, 2.8) * 0.4) * (f.boss ? 0.6 : 1)
      cpuPause = Math.max(0.22, rest) * (0.8 + Math.random() * 0.6)
    }

    // Early opponents misjudge spacing and swing from too far out, leaving the
    // whiff open to punishment; late ones only commit inside true range.
    const sloppy = 1 + Math.max(0, 1 - skill) * 0.7

    if (cpuIntent === 'approach') f.x += dir * WALK_SPEED * f.speed * 0.9 * dt
    else if (cpuIntent === 'retreat') f.x -= dir * BACK_SPEED * f.speed * dt
    else if (cpuIntent === 'attack') {
      if (
        f.specialCd === 0 &&
        gap < MOVES.special.reach * sloppy &&
        Math.random() < (f.boss ? 0.5 : 0.25)
      )
        swing('special')
      else if (gap < MOVES.heavy.reach * sloppy && Math.random() < 0.3) swing('heavy')
      else if (gap < MOVES.light.reach * sloppy) swing('light')
      else f.x += dir * WALK_SPEED * f.speed * 0.9 * dt
    }
  }

  const endRound = (winner: 0 | 1 | 2) => {
    phase = 'round-over'
    phaseTimer = 0
    if (winner !== 0) {
      wins[winner - 1] += 1
      score += 400
    }
    banner =
      winner === 0 ? 'DOUBLE K.O.' : winner === 1 ? 'PLAYER 1 WINS' : versus ? 'PLAYER 2 WINS' : 'YOU LOSE'
    playSfx(winner === 1 ? 'overdrive' : 'boss-roar')
  }

  const endMatch = (playerWon: boolean) => {
    phase = 'match-over'
    phaseTimer = 0
    score += Math.floor(p1.dealt * 6)
    if (playerWon) score += versus ? 1500 : opponent().bounty
    banner = playerWon ? (versus ? 'PLAYER 1 TAKES THE SET' : 'K.O. — OPPONENT DOWN') : 'CONTINUE?'
    submitScore('rot-fighter', score)
  }

  const update = (dt: number) => {
    blink += dt
    shake = Math.max(0, shake - dt * 2)

    if (phase === 'select') {
      phaseTimer += dt
      // Only the seats that actually play get a cursor: the ladder's CPU keeps
      // its own roster, so 1P select is P1 alone.
      const seats: (1 | 2)[] = versus ? [1, 2] : [1]
      for (const id of seats) {
        const i = id - 1
        if (tapped(id, 'block') && locked[i]) {
          locked[i] = false
          continue
        }
        if (locked[i]) continue
        if (tapped(id, 'left')) {
          picks[i] = (picks[i] + ROSTER.length - 1) % ROSTER.length
          playSfx('swap')
        }
        if (tapped(id, 'right')) {
          picks[i] = (picks[i] + 1) % ROSTER.length
          playSfx('swap')
        }
        if (tapped(id, 'light') || tapped(id, 'heavy') || tapped(id, 'special')) {
          locked[i] = true
          playSfx('overdrive')
        }
      }
      if (seats.every((id) => locked[id - 1])) startMatch(versus)
      return
    }

    if (phase === 'fight') {
      for (const [k, t] of buffer) {
        if (t - dt <= 0) buffer.delete(k)
        else buffer.set(k, t - dt)
      }
      stepFighter(p1, p2, dt, true)
      if (versus) stepFighter(p2, p1, dt, true)
      else {
        stepCpu(p2, p1, dt)
        stepFighter(p2, p1, dt, false)
      }

      stepFlames(dt)

      // Fighters cannot occupy the same space; push them apart evenly — but a
      // Shadow Dash runs straight through its target.
      const overlap = dashing(p1) || dashing(p2) ? 0 : FIGHTER_W - Math.abs(p1.x - p2.x)
      if (overlap > 0) {
        const dir = p1.x <= p2.x ? 1 : -1
        p1.x -= (dir * overlap) / 2
        p2.x += (dir * overlap) / 2
      }

      tryConnect(p1, p2)
      tryConnect(p2, p1)

      clock = Math.max(0, clock - dt)
      if (p1.hp === 0 || p2.hp === 0 || clock === 0) {
        const winner: 0 | 1 | 2 =
          p1.hp === p2.hp ? 0 : p1.hp > p2.hp ? 1 : 2
        endRound(winner)
      }
      return
    }

    phaseTimer += dt
    if (phase === 'round-over' && phaseTimer > 2.2) {
      if (wins[0] >= ROUNDS_TO_WIN) {
        endMatch(true)
      } else if (wins[1] >= ROUNDS_TO_WIN) {
        endMatch(false)
      } else {
        resetRound()
        phase = 'fight'
        phaseTimer = 0
      }
      return
    }
    if (phase === 'match-over' && phaseTimer > 2.6 && !versus && wins[0] >= ROUNDS_TO_WIN) {
      // Beat an opponent: climb the ladder and keep the run going.
      stage = Math.min(stage + 1, OPPONENTS.length - 1)
      wins = [0, 0]
      resetRound()
      phase = 'fight'
      phaseTimer = 0
    }
  }

  /** Rounded slab used for every body plate. */
  const plate = (x: number, y: number, w: number, h: number, r: number, fill: string) => {
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
    ctx.fill()
  }

  const limb = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    w: number,
    color: string,
  ) => {
    ctx.strokeStyle = color
    ctx.lineWidth = w
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }

  const drawFighter = (f: Fighter) => {
    const data = f.move === null ? null : MOVES[f.move]
    const striking =
      data !== null && f.moveTimer >= data.startup && f.moveTimer <= data.startup + data.active
    const windup = data !== null && f.moveTimer < data.startup
    const airborne = f.y < FLOOR
    const time = performance.now() / 1000

    const skin = f.hitFlash > 0 ? '#fee2e2' : f.tint
    const shade = f.hitFlash > 0 ? '#fca5a5' : f.dark
    const scale = f.boss ? 1.12 : 1

    ctx.save()
    ctx.translate(f.x, f.y)
    ctx.scale(f.facing * scale, scale)
    // The phase and the dash both smear the fighter; the rage stains it.
    if (phased(f)) ctx.globalAlpha = 0.5
    else if (dashing(f)) ctx.globalAlpha = 0.75
    if (enraged(f)) {
      ctx.shadowColor = ABILITIES['toxic-enrage'].color
      ctx.shadowBlur = 26
    }
    if (f.hitFlash > 0) {
      ctx.shadowColor = '#fca5a5'
      ctx.shadowBlur = 22
    }

    // Pose: guarding crouches, attacks lean into or away from the swing, and
    // the legs stride from the distance walked.
    const crouch = f.blocking ? 10 : 0
    const lean = striking ? 7 : windup ? -6 : 0
    const bob = airborne ? 0 : Math.sin(time * 2.6) * 1.5
    const stride = airborne || f.blocking ? 0 : Math.sin(f.walkPhase) * 15
    const hipY = -44 + crouch + bob
    const shoulderY = -FIGHTER_H + 14 + crouch + bob
    const headY = shoulderY - 16
    const tuck = airborne ? 15 : 0

    // Back leg, front leg and boots.
    limb(-5, hipY, -15 - stride, -tuck, 15, shade)
    limb(6, hipY, 15 - stride, -tuck, 16, skin)
    plate(-24 - stride, -tuck - 7, 20, 8, 3, '#0f172a')
    plate(6 - stride, -tuck - 7, 22, 8, 3, '#0f172a')

    // Back arm stays tight to the chest as a guard.
    limb(-8 + lean * 0.4, shoulderY + 8, -20 + lean, shoulderY + 30, 13, shade)

    // Torso, hip wrap, chest plate and belt.
    plate(-22 + lean * 0.5, shoulderY, 42, hipY - shoulderY + 14, 11, skin)
    plate(-20 + lean * 0.5, hipY - 4, 38, 18, 6, shade)
    plate(-12 + lean * 0.5, shoulderY + 10, 26, 22, 5, shade)
    plate(-20 + lean * 0.5, shoulderY + 38, 38, 6, 3, f.accent)
    // Shoulder pad on the striking side.
    plate(6 + lean * 0.6, shoulderY - 6, 22, 18, 7, shade)

    // Head, jaw and glowing visor.
    plate(-13 + lean * 0.7, headY - 26, 27, 28, 8, skin)
    plate(-13 + lean * 0.7, headY - 8, 27, 10, 4, shade)
    ctx.save()
    ctx.shadowColor = f.accent
    ctx.shadowBlur = 10
    plate(-4 + lean * 0.7, headY - 20, 17, 7, 3, f.accent)
    ctx.restore()

    if (f.boss) {
      // Crown of spines marks the ladder's boss fighters.
      ctx.fillStyle = f.accent
      for (let i = 0; i < 3; i++) {
        const sx = -10 + i * 11 + lean * 0.7
        ctx.beginPath()
        ctx.moveTo(sx, headY - 26)
        ctx.lineTo(sx + 5, headY - 42 - i * 3)
        ctx.lineTo(sx + 10, headY - 26)
        ctx.closePath()
        ctx.fill()
      }
    }

    if (f.blocking) {
      // Braced forearm plus a shimmering guard arc.
      plate(18, shoulderY + 6, 12, 58, 5, f.accent)
      ctx.strokeStyle = 'rgba(125,211,252,0.85)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(10, shoulderY + 34, 56, -0.9, 0.9)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(56,189,248,0.35)'
      ctx.lineWidth = 10
      ctx.stroke()
    }

    if (shielded(f)) {
      // Riot Shield: a solid slab of light braced across the front.
      const data = ABILITIES['riot-shield']
      ctx.save()
      ctx.shadowColor = data.color
      ctx.shadowBlur = 20
      ctx.globalAlpha = 0.85
      plate(22, -FIGHTER_H + 4, 16, FIGHTER_H - 4, 6, data.color)
      ctx.globalAlpha = 0.25
      ctx.fillStyle = data.color
      ctx.fillRect(22, -FIGHTER_H + 4, 40, FIGHTER_H - 4)
      ctx.restore()
    }

    // Front arm: it reaches exactly as far as the active hitbox.
    if (striking && data !== null) {
      const fistX = FIGHTER_W / 2 + data.reach - 10
      ctx.save()
      ctx.shadowColor = data.color
      ctx.shadowBlur = 18
      limb(4, shoulderY + 10, fistX, -data.height, 15, skin)
      plate(fistX - 9, -data.height - 10, 20, 20, 8, data.color)
      ctx.restore()
      // Swing trail across the active window.
      ctx.fillStyle = data.color
      ctx.globalAlpha = 0.3
      ctx.fillRect(FIGHTER_W / 2, -data.height - 13, data.reach, 26)
      ctx.globalAlpha = 1
    } else if (windup) {
      limb(0, shoulderY + 10, -22, shoulderY + 2, 15, skin)
      plate(-31, shoulderY - 8, 19, 19, 8, shade)
    } else if (data !== null) {
      limb(2, shoulderY + 10, 26, shoulderY + 34, 14, skin)
      plate(19, shoulderY + 26, 18, 18, 7, shade)
    } else {
      limb(2, shoulderY + 8, 22, shoulderY + 20, 14, skin)
      plate(15, shoulderY + 12, 18, 18, 7, shade)
    }
    ctx.restore()
  }

  const drawHealthBars = () => {
    const barW = 340
    const drawBar = (f: Fighter, left: number, flip: boolean) => {
      ctx.fillStyle = '#0f172a'
      ctx.fillRect(left, 28, barW, 22)
      ctx.strokeStyle = '#64748b'
      ctx.lineWidth = 2
      ctx.strokeRect(left, 28, barW, 22)
      const w = (f.hp / f.maxHp) * (barW - 6)
      ctx.fillStyle = f.hp / f.maxHp > 0.35 ? '#22c55e' : '#ef4444'
      ctx.fillRect(flip ? left + 3 + (barW - 6 - w) : left + 3, 31, w, 16)

      ctx.font = 'bold 14px ui-monospace, monospace'
      ctx.fillStyle = '#e2e8f0'
      ctx.textAlign = flip ? 'right' : 'left'
      ctx.fillText(f.name.toUpperCase(), flip ? left + barW : left, 20)

      // Special cooldown pip under the bar.
      ctx.fillStyle = '#1e293b'
      ctx.fillRect(left, 54, barW, 8)
      const ready = 1 - f.specialCd / MOVES.special.cooldown
      ctx.fillStyle = f.specialCd === 0 ? '#a855f7' : '#7e22ce'
      const cw = ready * barW
      ctx.fillRect(flip ? left + barW - cw : left, 54, cw, 8)

      // Class ability: its own bar, with the countdown spelled out.
      if (!f.ability) return
      const ab = ABILITIES[f.ability]
      ctx.fillStyle = '#1e293b'
      ctx.fillRect(left, 66, barW, 10)
      const charge = f.abilityTimer > 0 ? 1 : 1 - f.abilityCd / ab.cooldown
      const aw = charge * barW
      ctx.fillStyle = f.abilityTimer > 0 ? '#fef08a' : f.abilityCd === 0 ? ab.color : '#1d4ed8'
      ctx.fillRect(flip ? left + barW - aw : left, 66, aw, 10)
      ctx.font = 'bold 10px ui-monospace, monospace'
      ctx.fillStyle = '#e2e8f0'
      ctx.textAlign = flip ? 'right' : 'left'
      const state =
        f.abilityTimer > 0
          ? `ACTIVE ${f.abilityTimer.toFixed(1)}s`
          : f.phaseEcho > 0
            ? `ECHO x${f.phaseEcho} · ${f.abilityCd.toFixed(1)}s`
            : f.abilityCd > 0
              ? `${f.abilityCd.toFixed(1)}s`
              : 'READY'
      ctx.fillText(
        `${ab.tag} [${f.id === 1 ? 'E' : 'NUM1/U'}] ${state}`,
        flip ? left + barW : left,
        88,
      )
    }
    drawBar(p1, 30, false)
    drawBar(p2, VIEW_W - 30 - barW, true)

    ctx.textAlign = 'center'
    ctx.font = 'bold 34px ui-monospace, monospace'
    ctx.fillStyle = clock <= 10 ? '#f87171' : '#fcd34d'
    ctx.fillText(`${Math.ceil(clock)}`, VIEW_W / 2, 52)

    ctx.font = 'bold 12px ui-monospace, monospace'
    ctx.fillStyle = '#94a3b8'
    ctx.fillText(
      versus ? `SCORE ${score}` : `STAGE ${stage + 1}/${OPPONENTS.length} · SCORE ${score}`,
      VIEW_W / 2,
      74,
    )

    // Round pips.
    for (let i = 0; i < ROUNDS_TO_WIN; i++) {
      ctx.fillStyle = wins[0] > i ? '#fcd34d' : '#334155'
      ctx.beginPath()
      ctx.arc(VIEW_W / 2 - 40 - i * 18, 90, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = wins[1] > i ? '#fcd34d' : '#334155'
      ctx.beginPath()
      ctx.arc(VIEW_W / 2 + 40 + i * 18, 90, 6, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  /** Character select: one card per roster slot, plus each seat's cursor. */
  const drawSelect = () => {
    ctx.fillStyle = 'rgba(2,6,12,0.92)'
    ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    retroText('CHOOSE YOUR FIGHTER', 58, 34, '#a3e635')

    const cardW = 176
    const gap = 20
    const totalW = ROSTER.length * cardW + (ROSTER.length - 1) * gap
    const left = (VIEW_W - totalW) / 2

    ROSTER.forEach((c, i) => {
      const x = left + i * (cardW + gap)
      const y = 96
      const h = 246
      const p1Here = picks[0] === i
      const p2Here = versus && picks[1] === i
      ctx.fillStyle = '#0b1120'
      ctx.fillRect(x, y, cardW, h)
      ctx.lineWidth = p1Here || p2Here ? 3 : 1.5
      ctx.strokeStyle = p1Here ? '#fcd34d' : p2Here ? '#38bdf8' : '#334155'
      ctx.strokeRect(x, y, cardW, h)

      // Portrait: the fighter's own palette, so picks read at a glance.
      ctx.fillStyle = c.dark
      ctx.fillRect(x + 8, y + 8, cardW - 16, 118)
      ctx.fillStyle = c.tint
      ctx.fillRect(x + cardW / 2 - 26, y + 46, 52, 72)
      ctx.fillRect(x + cardW / 2 - 18, y + 20, 36, 30)
      ctx.fillStyle = c.accent
      ctx.fillRect(x + cardW / 2 - 12, y + 30, 24, 8)
      ctx.fillRect(x + cardW / 2 - 22, y + 84, 44, 7)

      ctx.textAlign = 'center'
      ctx.font = 'bold 18px ui-monospace, monospace'
      ctx.fillStyle = '#e2e8f0'
      ctx.fillText(c.name.toUpperCase(), x + cardW / 2, y + 152)

      ctx.font = 'bold 10px ui-monospace, monospace'
      ctx.fillStyle = '#94a3b8'
      const words = c.trait.split(' ')
      let line = ''
      let ty = y + 176
      for (const w of words) {
        const next = line ? `${line} ${w}` : w
        if (ctx.measureText(next).width > cardW - 20) {
          ctx.fillText(line, x + cardW / 2, ty)
          ty += 14
          line = w
        } else line = next
      }
      if (line) ctx.fillText(line, x + cardW / 2, ty)

      ctx.font = 'bold 10px ui-monospace, monospace'
      ctx.fillStyle = c.ability ? ABILITIES[c.ability].color : '#475569'
      ctx.fillText(
        c.ability ? `ABL · ${ABILITIES[c.ability].tag}` : 'NO ACTIVE ABILITY',
        x + cardW / 2,
        ty + 18,
      )

      ctx.font = 'bold 11px ui-monospace, monospace'
      if (p1Here) {
        ctx.fillStyle = locked[0] ? '#fcd34d' : '#fde68a'
        ctx.fillText(locked[0] ? 'P1 LOCKED' : 'P1', x + cardW / 2 - 34, y + h - 14)
      }
      if (p2Here) {
        ctx.fillStyle = locked[1] ? '#38bdf8' : '#bae6fd'
        ctx.fillText(locked[1] ? 'P2 LOCKED' : 'P2', x + cardW / 2 + 34, y + h - 14)
      }
    })

    retroText(
      versus ? 'P1 A/D + 1 TO LOCK  ·  P2 ←→ + J TO LOCK' : 'A/D TO MOVE  ·  1 OR ENTER TO LOCK IN',
      384,
      16,
      '#e2e8f0',
      true,
    )
    retroText('BLOCK UNLOCKS YOUR PICK · ESC QUITS', 412, 13, '#65a30d')
  }

  const retroText = (text: string, y: number, size: number, color: string, flashing = false) => {
    if (flashing && Math.floor(blink * 2) % 2 === 0) return
    ctx.save()
    ctx.textAlign = 'center'
    ctx.font = `bold ${size}px ui-monospace, monospace`
    ctx.fillStyle = color
    ctx.shadowColor = color
    ctx.shadowBlur = 16
    ctx.fillText(text, VIEW_W / 2, y)
    ctx.restore()
  }

  const render = () => {
    // Stage: sickly green dusk over a cracked concrete pit.
    const sky = ctx.createLinearGradient(0, 0, 0, FLOOR)
    sky.addColorStop(0, '#0b1120')
    sky.addColorStop(1, '#1f2937')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, VIEW_W, VIEW_H)

    ctx.save()
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 16, (Math.random() - 0.5) * shake * 16)

    ctx.fillStyle = '#111827'
    for (let i = 0; i < 9; i++) ctx.fillRect(70 + i * 92, 150, 54, FLOOR - 150)
    // The pit burns red once a boss takes the stage.
    ctx.fillStyle = p2.boss ? 'rgba(244,63,94,0.16)' : 'rgba(132,204,22,0.12)'
    ctx.beginPath()
    ctx.arc(VIEW_W / 2, FLOOR - 60, 220, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = '#334155'
    ctx.fillRect(0, FLOOR, VIEW_W, VIEW_H - FLOOR)
    ctx.fillStyle = '#1e293b'
    for (let x = 0; x < VIEW_W; x += 60) ctx.fillRect(x, FLOOR, 3, VIEW_H - FLOOR)

    // Shadows keep the jump height readable.
    for (const f of [p1, p2]) {
      const lift = (FLOOR - f.y) / 260
      ctx.fillStyle = `rgba(0,0,0,${0.45 - lift * 0.25})`
      ctx.beginPath()
      ctx.ellipse(f.x, FLOOR + 6, 30 - lift * 8, 8, 0, 0, Math.PI * 2)
      ctx.fill()
    }

    // Shadow Dash embers burn on the floor between the fighters.
    for (const fl of flames) {
      const life = fl.life / FLAME_LIFE
      ctx.save()
      ctx.globalAlpha = 0.25 + life * 0.6
      const fire = ctx.createLinearGradient(0, FLOOR - 34, 0, FLOOR)
      fire.addColorStop(0, 'rgba(253,224,71,0.1)')
      fire.addColorStop(0.5, '#f97316')
      fire.addColorStop(1, '#b91c1c')
      ctx.fillStyle = fire
      const h = 14 + life * 22 + Math.sin(blink * 14 + fl.x) * 4
      ctx.beginPath()
      ctx.moveTo(fl.x - 16, FLOOR)
      ctx.quadraticCurveTo(fl.x - 6, FLOOR - h, fl.x, FLOOR - h - 6)
      ctx.quadraticCurveTo(fl.x + 6, FLOOR - h, fl.x + 16, FLOOR)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }

    // Phase Shift afterimages, drawn under the fighters that cast them.
    for (const f of [p1, p2]) {
      for (const echo of f.echoes) {
        ctx.save()
        ctx.globalAlpha = echo.life * 0.5
        ctx.fillStyle = ABILITIES['phase-shift'].color
        ctx.shadowColor = ABILITIES['phase-shift'].color
        ctx.shadowBlur = 18
        ctx.fillRect(echo.x - FIGHTER_W / 2, FLOOR - FIGHTER_H, FIGHTER_W, FIGHTER_H)
        ctx.restore()
      }
    }

    // Toxic Enrage: a churning dark green haze wrapped round the rager.
    for (const f of [p1, p2]) {
      if (!enraged(f)) continue
      const pulse = 1 + Math.sin(performance.now() / 90) * 0.06
      ctx.save()
      ctx.globalAlpha = 0.34
      ctx.translate(f.x, f.y - FIGHTER_H / 2)
      ctx.scale(pulse, pulse)
      const glow = ctx.createRadialGradient(0, 0, 8, 0, 0, FIGHTER_H * 0.75)
      glow.addColorStop(0, 'rgba(74,222,128,0.85)')
      glow.addColorStop(0.55, 'rgba(21,128,61,0.55)')
      glow.addColorStop(1, 'rgba(20,83,45,0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.ellipse(0, 0, FIGHTER_W * 1.1, FIGHTER_H * 0.72, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    drawFighter(p1)
    drawFighter(p2)

    // Evade callout, so the 7% dodge is visible when it fires.
    for (const f of [p1, p2]) {
      if (f.evadeFlash <= 0) continue
      // Phase Shift's guaranteed window reads as a phase, not a lucky dodge.
      const label = phased(f) ? 'PHASED' : 'EVADE'
      ctx.save()
      ctx.textAlign = 'center'
      ctx.globalAlpha = Math.min(1, f.evadeFlash * 2)
      ctx.font = 'bold 18px ui-monospace, monospace'
      ctx.fillStyle = '#c4b5fd'
      ctx.fillText(label, f.x, f.y - FIGHTER_H - 24 - (0.6 - f.evadeFlash) * 20)
      ctx.restore()
    }
    ctx.restore()

    drawHealthBars()

    if (phase === 'attract') {
      ctx.fillStyle = 'rgba(2,6,12,0.86)'
      ctx.fillRect(0, 0, VIEW_W, VIEW_H)
      retroText('ROT FIGHTER', 130, 62, '#a3e635')
      retroText('INSERT COIN', 196, 28, '#fcd34d', true)
      retroText('[1] ARCADE — PLAYER VS CPU LADDER', 260, 22, '#e2e8f0')
      retroText('[2] VERSUS — LOCAL 2 PLAYER', 296, 22, '#e2e8f0')
      retroText('P1  WASD · 1 LIGHT · 2 HEAVY · 3 SPECIAL · 4 BLOCK · E ABILITY', 360, 15, '#94a3b8')
      retroText(
        'P2  ARROWS · J LIGHT · K HEAVY · L SPECIAL · ; BLOCK · NUM1/U ABILITY',
        384,
        15,
        '#94a3b8',
      )
      retroText(
        'ABILITIES: SHADOW DASH · RIOT SHIELD · TOXIC ENRAGE · PHASE SHIFT',
        418,
        14,
        '#65a30d',
      )
      retroText('6 STAGES — SURVIVE TO THE ROT SOVEREIGN', 442, 14, '#f43f5e')
    }

    if (phase === 'select') drawSelect()

    if (phase === 'round-over' || phase === 'match-over') {
      ctx.fillStyle = 'rgba(2,6,12,0.55)'
      ctx.fillRect(0, 0, VIEW_W, VIEW_H)
      retroText(banner, VIEW_H / 2 - 20, 46, '#f43f5e', true)
      if (phase === 'match-over') {
        retroText(`SCORE  ${score}`, VIEW_H / 2 + 30, 24, '#fcd34d')
        if (phaseTimer > 1.4)
          retroText('PRESS 1 / 2 FOR A NEW RUN · ESC QUITS', VIEW_H / 2 + 72, 16, '#e2e8f0', true)
      }
    }
  }

  const frameStep = (now: number) => {
    if (!open) return
    const dt = Math.min(0.045, (now - last) / 1000 || 0)
    last = now
    update(dt)
    render()
    pressed.clear()
    pad.clearTaps()
    raf = window.requestAnimationFrame(frameStep)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) return
    const key = e.key.toLowerCase()
    // The cabinet swallows its own controls so the campaign never sees them.
    e.stopPropagation()
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(key)) e.preventDefault()
    // Physical codes ride alongside the characters so numpad bindings work
    // regardless of Num Lock.
    const code = e.code.toLowerCase()
    if (!e.repeat) {
      pressed.add(key)
      pressed.add(code)
    }
    held.add(key)
    held.add(code)

    if (key === 'escape') {
      close()
      return
    }
    // 1/2 pick a mode on the attract screen; mid-match they are P2's attacks.
    const idle = phase === 'attract' || (phase === 'match-over' && phaseTimer > 1.4)
    if (idle && (key === '1' || key === '2')) startSelect(key === '2')
    if (idle && key === 'enter') startSelect(false)
    if (phase === 'select' && key === 'enter') locked[0] = true
  }

  const onKeyUp = (e: KeyboardEvent) => {
    if (!open) return
    e.stopPropagation()
    held.delete(e.key.toLowerCase())
    held.delete(e.code.toLowerCase())
  }

  function close() {
    if (!open) return
    open = false
    window.cancelAnimationFrame(raf)
    held.clear()
    pressed.clear()
    buffer.clear()
    pad.reset()
    overlay.classList.add('hidden')
    overlay.classList.remove('flex')
    onQuit()
  }

  pad.onStart((pvp) => {
    if (phase === 'attract' || (phase === 'match-over' && phaseTimer > 1.4)) startSelect(pvp)
  })

  overlay.querySelector<HTMLButtonElement>('#fighter-quit')?.addEventListener('click', () => close())
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('keyup', onKeyUp, true)

  return {
    open: () => {
      if (open) return
      open = true
      resumeAudio()
      phase = 'attract'
      stage = 0
      wins = [0, 0]
      score = 0
      resetRound()
      pad.sync()
      overlay.classList.remove('hidden')
      overlay.classList.add('flex')
      last = performance.now()
      raf = window.requestAnimationFrame(frameStep)
    },
    close,
    isOpen: () => open,
  }
}

interface TouchPad {
  root: HTMLDivElement
  isHeld: (id: 1 | 2, action: ActionId) => boolean
  consumeTap: (id: 1 | 2, action: ActionId) => boolean
  clearTaps: () => void
  reset: () => void
  sync: () => void
  onStart: (fn: (pvp: boolean) => void) => void
}

/**
 * On-screen pad so phones get the same four attack actions plus movement. Each
 * button maps one-to-one onto a keyboard action, and both players get a pad in
 * versus mode.
 */
function buildTouchPad(): TouchPad {
  const root = document.createElement('div')
  root.className = 'touch-pad w-full max-w-[940px] select-none pt-3 touch-none'

  const heldSet = new Set<string>()
  const tapSet = new Set<string>()
  let startFn: (pvp: boolean) => void = () => {}

  const key = (id: 1 | 2, action: ActionId) => `${id}:${action}`

  const button = (id: 1 | 2, action: ActionId, label: string, extra: string): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = `pointer-events-auto touch-none rounded-xl bg-white/10 px-3 py-3 text-[11px] font-black uppercase tracking-wider text-white/85 ring-2 ring-white/25 active:bg-white/30 ${extra}`
    b.textContent = label
    const press = (e: PointerEvent) => {
      e.preventDefault()
      b.setPointerCapture(e.pointerId)
      heldSet.add(key(id, action))
      tapSet.add(key(id, action))
    }
    const release = () => {
      heldSet.delete(key(id, action))
    }
    b.addEventListener('pointerdown', press)
    b.addEventListener('pointerup', release)
    b.addEventListener('pointercancel', release)
    b.addEventListener('lostpointercapture', release)
    return b
  }

  const side = (id: 1 | 2): HTMLDivElement => {
    const wrap = document.createElement('div')
    wrap.className = 'flex flex-1 items-end justify-between gap-2'
    const moveCol = document.createElement('div')
    moveCol.className = 'flex gap-2'
    moveCol.append(
      button(id, 'left', '◀', 'w-12'),
      button(id, 'jump', '▲', 'w-12'),
      button(id, 'right', '▶', 'w-12'),
    )
    const actionCol = document.createElement('div')
    actionCol.className = 'grid grid-cols-2 gap-2'
    actionCol.append(
      button(id, 'light', 'LP', 'w-14'),
      button(id, 'heavy', 'HP', 'w-14'),
      button(id, 'special', 'SP', 'w-14 text-fuchsia-200'),
      button(id, 'block', 'BLK', 'w-14 text-sky-200'),
      button(id, 'ability', 'ABL', 'w-14 col-span-2 text-lime-200'),
    )
    wrap.append(moveCol, actionCol)
    return wrap
  }

  const pads = document.createElement('div')
  pads.className = 'flex items-end justify-between gap-6'
  pads.append(side(1), side(2))

  const startRow = document.createElement('div')
  startRow.className = 'flex justify-center gap-3 pb-2'
  const mk = (label: string, pvp: boolean) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className =
      'rounded-lg bg-lime-500/20 px-4 py-2 text-[11px] font-black uppercase tracking-widest text-lime-200 ring-1 ring-lime-400/60'
    b.textContent = label
    b.addEventListener('click', () => startFn(pvp))
    return b
  }
  startRow.append(mk('1P Arcade', false), mk('2P Versus', true))

  root.append(startRow, pads)

  return {
    root,
    isHeld: (id, action) => heldSet.has(key(id, action)),
    consumeTap: (id, action) => {
      const k = key(id, action)
      if (!tapSet.has(k)) return false
      tapSet.delete(k)
      return true
    },
    clearTaps: () => tapSet.clear(),
    reset: () => {
      heldSet.clear()
      tapSet.clear()
    },
    sync: () => {
      // Visibility is owned by the .touch-pad media query; these flags only say
      // the cabinet is open, so the pad can never eat desktop screen space.
      const forced = new URLSearchParams(window.location.search).has('touch')
      root.classList.toggle('is-forced', forced)
      root.classList.toggle('is-active', isTouchDevice())
    },
    onStart: (fn) => {
      startFn = fn
    },
  }
}
