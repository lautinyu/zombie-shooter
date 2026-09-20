/**
 * Environmental hazards for the Chapter 4 rustlands: oil slicks that rob the
 * ground of friction. The manager owns placement, simulation and drawing, and
 * treats every registered body the same way, so both co-op players and the
 * infected are equally at its mercy.
 */

import type { GameMap } from './maps'
import { circleHitsWall } from './maps'

/** Fraction of normal ground friction removed while standing in oil. */
export const OIL_FRICTION_LOSS = 0.6
/** Seconds a player keeps sliding after touching a slick. */
export const OIL_SLIDE_TIME = 1.5

export interface OilSpill {
  x: number
  y: number
  r: number
  /** Drives the slow rainbow shimmer on the surface. */
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

  constructor(map: GameMap, spillCount: number) {
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
  }

  /** True when the given circle is standing in an oil slick. */
  slippery(x: number, y: number, r: number): boolean {
    return this.spills.some((s) => Math.hypot(s.x - x, s.y - y) < s.r + r)
  }

  /** Drifts the sheen on every slick. */
  update(dt: number, _hooks: HazardHooks) {
    for (const s of this.spills) s.phase += dt * 0.8
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

  }
}

/**
 * Chapter 4 yards are slick with spilled oil; everywhere else is clean. The
 * rail mission is skipped because its players are bolted into a truck bed.
 */
export function buildHazards(map: GameMap, chapter: number, missionType: string): HazardManager | null {
  if (chapter !== 4 || missionType === 'rail') return null
  return new HazardManager(map, 4)
}
