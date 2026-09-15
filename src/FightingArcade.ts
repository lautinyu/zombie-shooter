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
type Phase = 'attract' | 'fight' | 'round-over' | 'match-over'
type ActionId = 'left' | 'right' | 'jump' | 'light' | 'heavy' | 'special' | 'block'

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

interface Opponent {
  name: string
  tint: string
  dark: string
  /** Scales CPU reaction speed and aggression; 1 is the opening fight. */
  skill: number
  /** Round-win bonus awarded for beating this opponent. */
  bounty: number
}

const OPPONENTS: Opponent[] = [
  { name: 'Shambler', tint: '#4ade80', dark: '#166534', skill: 0.7, bounty: 1200 },
  { name: 'Runner', tint: '#38bdf8', dark: '#075985', skill: 1, bounty: 1800 },
  { name: 'Brute', tint: '#f97316', dark: '#7c2d12', skill: 1.3, bounty: 2600 },
  { name: 'Cryo-Stalker', tint: '#e0f2fe', dark: '#0e7490', skill: 1.6, bounty: 3600 },
  { name: 'Canopy Leviathan', tint: '#a855f7', dark: '#4c1d95', skill: 2, bounty: 6000 },
]

interface Fighter {
  id: 1 | 2
  name: string
  tint: string
  dark: string
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
    block: [' ', 'i', 's'],
    light: ['j'],
    heavy: ['k'],
    special: ['l'],
  },
  2: {
    left: ['arrowleft'],
    right: ['arrowright'],
    jump: ['arrowup'],
    block: ['arrowdown', '0'],
    light: ['1'],
    heavy: ['2'],
    special: ['3'],
  },
}

export function mountFightingArcade(onQuit: () => void): FightingCabinet {
  const overlay = document.createElement('div')
  overlay.className =
    'fixed inset-0 z-40 hidden flex-col items-center justify-center bg-black/98 p-3'
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
  legend.className = 'pt-3 text-center text-[11px] uppercase tracking-[0.2em] text-slate-500'
  legend.textContent =
    'P1 A/D move · W jump · J light · K heavy · L special · Space/I block   ·   P2 ←→ · ↑ jump · 1 2 3 · ↓/0 block'
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

  const makeFighter = (id: 1 | 2, from: Opponent | null): Fighter => ({
    id,
    name: from ? from.name : 'Warden',
    tint: from ? from.tint : '#f43f5e',
    dark: from ? from.dark : '#881337',
    x: id === 1 ? VIEW_W * 0.32 : VIEW_W * 0.68,
    y: FLOOR,
    vx: 0,
    vy: 0,
    facing: id === 1 ? 1 : -1,
    hp: MAX_HP,
    move: null,
    moveTimer: 0,
    moveHit: false,
    blocking: false,
    stun: 0,
    specialCd: 0,
    hitFlash: 0,
    dealt: 0,
  })

  let p1 = makeFighter(1, null)
  let p2 = makeFighter(2, OPPONENTS[0])

  /** CPU decision clock: it commits to one intent at a time, like a player. */
  let cpuThink = 0
  let cpuIntent: 'approach' | 'retreat' | 'attack' | 'guard' = 'approach'
  /** Enforced gap between CPU swings; the CPU's stand-in for human hands. */
  let cpuPause = 0

  const opponent = (): Opponent => OPPONENTS[Math.min(stage, OPPONENTS.length - 1)]

  const resetRound = () => {
    const facing2: 1 | -1 = -1
    p1 = makeFighter(1, null)
    p2 = makeFighter(2, versus ? { ...OPPONENTS[1], name: 'Reaper' } : opponent())
    p2.facing = facing2
    clock = ROUND_TIME
    shake = 0
    cpuThink = 0
    cpuPause = 0.8
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

  const busy = (f: Fighter): boolean => f.move !== null || f.stun > 0

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
    const guarding =
      defender.blocking && defender.facing !== attacker.facing && defender.y === FLOOR
    const damage = guarding ? data.damage * CHIP_RATIO : data.damage
    defender.hp = Math.max(0, defender.hp - damage)
    attacker.dealt += damage
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
    f.hitFlash = Math.max(0, f.hitFlash - dt)
    f.specialCd = Math.max(0, f.specialCd - dt)
    f.stun = Math.max(0, f.stun - dt)

    if (f.y === FLOOR && f.vy === 0) f.facing = foe.x >= f.x ? 1 : -1

    if (f.move !== null) {
      const data = MOVES[f.move]
      f.moveTimer += dt
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
          f.x += dir * speed * dt
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
      cpuPause = (1.5 - skill * 0.4) * (0.8 + Math.random() * 0.6)
    }

    // Early opponents misjudge spacing and swing from too far out, leaving the
    // whiff open to punishment; late ones only commit inside true range.
    const sloppy = 1 + Math.max(0, 1 - skill) * 0.7

    if (cpuIntent === 'approach') f.x += dir * WALK_SPEED * 0.9 * dt
    else if (cpuIntent === 'retreat') f.x -= dir * BACK_SPEED * dt
    else if (cpuIntent === 'attack') {
      if (f.specialCd === 0 && gap < MOVES.special.reach * sloppy && Math.random() < 0.25)
        swing('special')
      else if (gap < MOVES.heavy.reach * sloppy && Math.random() < 0.3) swing('heavy')
      else if (gap < MOVES.light.reach * sloppy) swing('light')
      else f.x += dir * WALK_SPEED * 0.9 * dt
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

      // Fighters cannot occupy the same space; push them apart evenly.
      const overlap = FIGHTER_W - Math.abs(p1.x - p2.x)
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

  const drawFighter = (f: Fighter) => {
    const y = f.y
    ctx.save()
    ctx.translate(f.x, y)
    ctx.scale(f.facing, 1)

    if (f.hitFlash > 0) {
      ctx.shadowColor = '#fca5a5'
      ctx.shadowBlur = 24
    }

    const crouch = f.blocking ? 8 : 0
    // Legs.
    ctx.fillStyle = f.dark
    ctx.fillRect(-20, -34, 14, 34)
    ctx.fillRect(8, -34, 14, 34)
    // Torso.
    ctx.fillStyle = f.hitFlash > 0 ? '#fee2e2' : f.tint
    ctx.fillRect(-22, -FIGHTER_H + crouch, 44, FIGHTER_H - 34 - crouch)
    // Head.
    ctx.fillStyle = f.hitFlash > 0 ? '#fee2e2' : f.tint
    ctx.fillRect(-14, -FIGHTER_H - 26 + crouch, 28, 26)
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(2, -FIGHTER_H - 18 + crouch, 8, 6)

    if (f.blocking) {
      ctx.fillStyle = 'rgba(56,189,248,0.75)'
      ctx.fillRect(20, -FIGHTER_H + 12, 10, 64)
      ctx.strokeStyle = 'rgba(125,211,252,0.85)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(10, -56, 56, -0.9, 0.9)
      ctx.stroke()
    }

    // Arms — extended through the active window of the current move.
    const data = f.move === null ? null : MOVES[f.move]
    const striking =
      data !== null && f.moveTimer >= data.startup && f.moveTimer <= data.startup + data.active
    const windup = data !== null && f.moveTimer < data.startup
    ctx.fillStyle = f.dark
    if (striking && data !== null) {
      ctx.fillRect(18, -data.height - 8, FIGHTER_W / 2 + data.reach - 18, 16)
      ctx.fillStyle = data.color
      ctx.globalAlpha = 0.65
      ctx.fillRect(FIGHTER_W / 2, -data.height - 14, data.reach, 28)
      ctx.globalAlpha = 1
    } else if (windup) {
      ctx.fillRect(-6, -70, 22, 14)
    } else {
      ctx.fillRect(10, -74, 16, 13)
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
      const w = (f.hp / MAX_HP) * (barW - 6)
      ctx.fillStyle = f.hp / MAX_HP > 0.35 ? '#22c55e' : '#ef4444'
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
    }
    drawBar(p1, 30, false)
    drawBar(p2, VIEW_W - 30 - barW, true)

    ctx.textAlign = 'center'
    ctx.font = 'bold 34px ui-monospace, monospace'
    ctx.fillStyle = clock <= 10 ? '#f87171' : '#fcd34d'
    ctx.fillText(`${Math.ceil(clock)}`, VIEW_W / 2, 52)

    ctx.font = 'bold 12px ui-monospace, monospace'
    ctx.fillStyle = '#94a3b8'
    ctx.fillText(`SCORE ${score}`, VIEW_W / 2, 74)

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
    ctx.fillStyle = 'rgba(132,204,22,0.12)'
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

    drawFighter(p1)
    drawFighter(p2)
    ctx.restore()

    drawHealthBars()

    if (phase === 'attract') {
      ctx.fillStyle = 'rgba(2,6,12,0.86)'
      ctx.fillRect(0, 0, VIEW_W, VIEW_H)
      retroText('ROT FIGHTER', 130, 62, '#a3e635')
      retroText('INSERT COIN', 196, 28, '#fcd34d', true)
      retroText('[1] ARCADE — PLAYER VS CPU LADDER', 260, 22, '#e2e8f0')
      retroText('[2] VERSUS — LOCAL 2 PLAYER', 296, 22, '#e2e8f0')
      retroText('P1  A/D MOVE · W JUMP · J LIGHT · K HEAVY · L SPECIAL · SPACE/I BLOCK', 360, 15, '#94a3b8')
      retroText('P2  ARROWS MOVE/JUMP · 1 LIGHT · 2 HEAVY · 3 SPECIAL · ↓/0 BLOCK', 384, 15, '#94a3b8')
      retroText('BLOCK CUTS 82% OF DAMAGE — HEAVIES ARE PUNISHABLE ON BLOCK', 424, 14, '#65a30d')
    }

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
    if (!e.repeat) pressed.add(key)
    held.add(key)

    if (key === 'escape') {
      close()
      return
    }
    // 1/2 pick a mode on the attract screen; mid-match they are P2's attacks.
    const idle = phase === 'attract' || (phase === 'match-over' && phaseTimer > 1.4)
    if (idle && (key === '1' || key === '2')) startMatch(key === '2')
    if (idle && key === 'enter') startMatch(false)
  }

  const onKeyUp = (e: KeyboardEvent) => {
    if (!open) return
    e.stopPropagation()
    held.delete(e.key.toLowerCase())
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
    if (phase === 'attract' || (phase === 'match-over' && phaseTimer > 1.4)) startMatch(pvp)
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
  root.className = 'hidden w-full max-w-[940px] select-none pt-3 touch-none'

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
      const forced = new URLSearchParams(window.location.search).has('touch')
      root.classList.toggle('hidden', !(forced || isTouchDevice()))
    },
    onStart: (fn) => {
      startFn = fn
    },
  }
}
