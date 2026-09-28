/**
 * Environmental hazards for the Chapter 4 rustlands: oil slicks that rob the
 * ground of friction, fuel barrels that go up when shot, and electrified floor
 * plates that pin the swarm in place. The manager owns placement, simulation
 * and drawing, and treats every registered body the same way, so both co-op
 * players and the infected are equally at its mercy.
 */

import type { GameMap } from './maps'
import { circleHitsWall } from './maps'

/** Fraction of normal ground friction removed while standing in oil. */
export const OIL_FRICTION_LOSS = 0.6
/** Seconds a player keeps sliding after touching a slick. */
export const OIL_SLIDE_TIME = 1.5

/** Damage a detonating barrel deals at its centre, falling off to the rim. */
export const BARREL_DAMAGE = 260
export const BARREL_BLAST_RADIUS = 190
/** Barrels are fragile: a couple of rounds pop one. */
export const BARREL_HP = 40
/** Seconds a shocked zombie stands rigid. */
export const SHOCK_STUN = 3
/** Plate cycle: idle, then a warning crackle, then a live discharge. */
const PLATE_IDLE = 5.5
const PLATE_WARN = 1
const PLATE_LIVE = 1.6

export interface OilSpill {
  x: number
  y: number
  r: number
  /** Drives the slow rainbow shimmer on the surface. */
  phase: number
}

/** A red fuel drum that detonates when its health is shot away. */
export interface Barrel {
  x: number
  y: number
  r: number
  hp: number
  /** Brief white flash after taking a hit. */
  hurt: number
}

/** A grated floor panel wired to the yard's generators. */
export interface ShockPlate {
  x: number
  y: number
  w: number
  h: number
  /** Seconds into the idle → warn → live cycle. */
  timer: number
  /** Drives the arcing animation. */
  phase: number
}

/** Anything a hazard can touch: both players and zombies qualify. */
export interface HazardBody {
  x: number
  y: number
  r: number
}

export interface HazardHooks {
  /** Every body a hazard may touch, with the damage sink for each. */
  bodies: { body: HazardBody; hurt: (amount: number) => void }[]
}

/** Deterministic per-map layout so a stage always has the same hazards. */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

function hashString(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export class HazardManager {
  readonly spills: OilSpill[] = []
  readonly barrels: Barrel[] = []
  readonly plates: ShockPlate[] = []

  constructor(map: GameMap, spillCount: number, barrelCount = 0, plateCount = 0) {
    const rng = seededRandom(hashString(map.id))
    const spawn = map.spawn ?? { x: -9999, y: -9999 }
    const place = (r: number): { x: number; y: number } | null => {
      for (let tries = 0; tries < 60; tries++) {
        const x = r + rng() * (map.width - r * 2)
        const y = r + rng() * (map.height - r * 2)
        if (circleHitsWall(map, x, y, r)) continue
        // Never drop a hazard on top of the insertion or extraction point.
        if (Math.hypot(x - spawn.x, y - spawn.y) < 320) continue
        if (Math.hypot(x - map.extraction.x, y - map.extraction.y) < 320) continue
        return { x, y }
      }
      return null
    }

    for (let i = 0; i < spillCount; i++) {
      const r = 70 + rng() * 60
      const spot = place(r)
      if (spot) this.spills.push({ x: spot.x, y: spot.y, r, phase: rng() * Math.PI * 2 })
    }

    for (let i = 0; i < barrelCount; i++) {
      const spot = place(22)
      // Two barrels touching would chain instantly and waste the pair.
      if (!spot) continue
      if (this.barrels.some((b) => Math.hypot(b.x - spot.x, b.y - spot.y) < 120)) continue
      this.barrels.push({ x: spot.x, y: spot.y, r: 18, hp: BARREL_HP, hurt: 0 })
    }

    for (let i = 0; i < plateCount; i++) {
      const spot = place(70)
      if (!spot) continue
      this.plates.push({
        x: spot.x - 62,
        y: spot.y - 62,
        w: 124,
        h: 124,
        // Stagger the cycles so the yard is never all live at once.
        timer: rng() * (PLATE_IDLE + PLATE_WARN + PLATE_LIVE),
        phase: rng() * Math.PI * 2,
      })
    }
  }

  /** True while this plate is discharging rather than idling or warning. */
  plateLive(p: ShockPlate): boolean {
    return p.timer >= PLATE_IDLE + PLATE_WARN
  }

  /** True while the plate is sparking up, a beat before it bites. */
  plateWarning(p: ShockPlate): boolean {
    return p.timer >= PLATE_IDLE && p.timer < PLATE_IDLE + PLATE_WARN
  }

  /** True when the circle is standing on a live plate. */
  shocking(x: number, y: number, r: number): boolean {
    return this.plates.some(
      (p) =>
        this.plateLive(p) &&
        x + r > p.x &&
        x - r < p.x + p.w &&
        y + r > p.y &&
        y - r < p.y + p.h
    )
  }

  /**
   * Puts `damage` into whichever barrel the shot crossed. Returns the barrel
   * and whether it blew, so the caller can run its own explosion model.
   */
  hitBarrel(
    x: number,
    y: number,
    r: number,
    damage: number
  ): { barrel: Barrel; destroyed: boolean } | null {
    for (let i = 0; i < this.barrels.length; i++) {
      const b = this.barrels[i]
      if (Math.hypot(b.x - x, b.y - y) > b.r + r) continue
      b.hp -= damage
      b.hurt = 0.12
      if (b.hp > 0) return { barrel: b, destroyed: false }
      this.barrels.splice(i, 1)
      return { barrel: b, destroyed: true }
    }
    return null
  }

  /** Removes a barrel caught in another blast, for chain detonations. */
  takeBarrelsInRadius(x: number, y: number, radius: number): Barrel[] {
    const caught: Barrel[] = []
    for (let i = this.barrels.length - 1; i >= 0; i--) {
      const b = this.barrels[i]
      if (Math.hypot(b.x - x, b.y - y) > radius + b.r) continue
      caught.push(b)
      this.barrels.splice(i, 1)
    }
    return caught
  }

  /** True when the given circle is standing in an oil slick. */
  slippery(x: number, y: number, r: number): boolean {
    return this.spills.some((s) => Math.hypot(s.x - x, s.y - y) < s.r + r)
  }

  /** Drifts the sheen on every slick and runs the plate cycles. */
  update(dt: number, _hooks: HazardHooks) {
    for (const s of this.spills) s.phase += dt * 0.8
    for (const b of this.barrels) b.hurt = Math.max(0, b.hurt - dt)
    const cycle = PLATE_IDLE + PLATE_WARN + PLATE_LIVE
    for (const p of this.plates) {
      p.timer = (p.timer + dt) % cycle
      p.phase += dt * 9
    }
  }

  render(ctx: CanvasRenderingContext2D) {
    for (const s of this.spills) {
      ctx.save()
      const glow = ctx.createRadialGradient(s.x, s.y, s.r * 0.2, s.x, s.y, s.r)
      glow.addColorStop(0, 'rgba(12,10,18,0.92)')
      glow.addColorStop(0.75, 'rgba(24,18,34,0.78)')
      glow.addColorStop(1, 'rgba(24,18,34,0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
      ctx.fill()
      // Oil-slick sheen: a couple of drifting iridescent rings.
      ctx.globalAlpha = 0.35
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = ['#7c3aed', '#0ea5e9', '#f472b6'][i]
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r * (0.35 + i * 0.22) + Math.sin(s.phase + i) * 5, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.restore()
    }

    for (const p of this.plates) {
      const live = this.plateLive(p)
      const warn = this.plateWarning(p)
      ctx.save()
      ctx.fillStyle = live ? 'rgba(56,189,248,0.22)' : 'rgba(30,41,59,0.55)'
      ctx.fillRect(p.x, p.y, p.w, p.h)
      ctx.strokeStyle = live ? '#7dd3fc' : warn ? '#fbbf24' : '#475569'
      ctx.lineWidth = live ? 3 : 2
      ctx.strokeRect(p.x, p.y, p.w, p.h)
      // Grating.
      ctx.globalAlpha = 0.5
      ctx.strokeStyle = live ? 'rgba(125,211,252,0.7)' : 'rgba(100,116,139,0.5)'
      ctx.lineWidth = 1
      for (let gx = p.x + 14; gx < p.x + p.w; gx += 14) {
        ctx.beginPath()
        ctx.moveTo(gx, p.y + 3)
        ctx.lineTo(gx, p.y + p.h - 3)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      if (live || warn) {
        // Arcs jumping between the rails.
        ctx.strokeStyle = live ? '#e0f2fe' : 'rgba(251,191,36,0.8)'
        ctx.lineWidth = live ? 2 : 1.5
        for (let a = 0; a < 3; a++) {
          const t = p.phase + a * 2.1
          ctx.beginPath()
          ctx.moveTo(p.x + 6, p.y + 12 + ((a * 41 + Math.sin(t) * 18 + p.h) % (p.h - 24)))
          for (let step = 1; step <= 5; step++) {
            ctx.lineTo(
              p.x + 6 + ((p.w - 12) * step) / 5,
              p.y + 12 + ((a * 41 + Math.sin(t + step) * 22 + p.h) % (p.h - 24))
            )
          }
          ctx.stroke()
        }
      }
      ctx.restore()
    }

    for (const b of this.barrels) {
      ctx.save()
      ctx.translate(b.x, b.y)
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.beginPath()
      ctx.ellipse(0, b.r * 0.6, b.r, b.r * 0.45, 0, 0, Math.PI * 2)
      ctx.fill()
      const body = ctx.createLinearGradient(-b.r, 0, b.r, 0)
      body.addColorStop(0, '#7f1d1d')
      body.addColorStop(0.45, '#dc2626')
      body.addColorStop(1, '#991b1b')
      ctx.fillStyle = body
      ctx.beginPath()
      ctx.roundRect(-b.r, -b.r - 4, b.r * 2, b.r * 2 + 6, 6)
      ctx.fill()
      ctx.strokeStyle = '#fca5a5'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(-b.r, -6)
      ctx.lineTo(b.r, -6)
      ctx.moveTo(-b.r, 8)
      ctx.lineTo(b.r, 8)
      ctx.stroke()
      ctx.fillStyle = '#fef08a'
      ctx.font = 'bold 13px monospace'
      ctx.textAlign = 'center'
      ctx.fillText('☣', 0, 5)
      if (b.hurt > 0) {
        ctx.globalAlpha = Math.min(1, b.hurt * 6)
        ctx.fillStyle = '#fff7ed'
        ctx.beginPath()
        ctx.roundRect(-b.r, -b.r - 4, b.r * 2, b.r * 2 + 6, 6)
        ctx.fill()
      }
      ctx.restore()
    }
  }
}

/**
 * Chapter 4 yards are slick with spilled oil; everywhere else is clean. The
 * rail mission is skipped because its players are bolted into a truck bed.
 */
export function buildHazards(map: GameMap, chapter: number, missionType: string): HazardManager | null {
  if (chapter !== 4 || missionType === 'rail') return null
  // The Crucible arena is the showcase: more drums and more live floor.
  return missionType === 'arena'
    ? new HazardManager(map, 4, 9, 4)
    : new HazardManager(map, 4, 5, 2)
}
