import { playSfx } from './audio'

/** Health fraction below which the screen pulses red and the heartbeat starts. */
export const LOW_HEALTH = 0.25

/** 0 at the threshold, 1 at zero health. */
export function lowHealthSeverity(hp: number, maxHp: number): number {
  if (maxHp <= 0 || hp <= 0) return 0
  const frac = hp / maxHp
  if (frac >= LOW_HEALTH) return 0
  return 1 - frac / LOW_HEALTH
}

/** Pulsing red vignette around the screen edges; `t` is seconds of game time. */
export function drawLowHealthVignette(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  severity: number
) {
  if (severity <= 0) return
  const rate = 1 + severity * 0.8
  const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * rate)
  const alpha = 0.22 + severity * 0.18 + pulse * 0.16
  const inner = Math.min(w, h) * (0.42 - severity * 0.08)
  const outer = Math.hypot(w, h) * 0.55
  const g = ctx.createRadialGradient(w / 2, h / 2, inner, w / 2, h / 2, outer)
  g.addColorStop(0, 'rgba(185,28,28,0)')
  g.addColorStop(0.6, `rgba(185,28,28,${alpha * 0.45})`)
  g.addColorStop(1, `rgba(127,29,29,${alpha})`)
  ctx.save()
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  ctx.restore()
}

/** Lub-dub heartbeat that quickens as health drops. */
export class Heartbeat {
  private timer = 0
  private dub = 0

  update(dt: number, severity: number) {
    if (this.dub > 0) {
      this.dub -= dt
      if (this.dub <= 0) playSfx('heartbeat')
    }
    if (severity <= 0) {
      this.timer = 0
      return
    }
    this.timer -= dt
    if (this.timer > 0) return
    playSfx('heartbeat')
    this.dub = 0.24
    this.timer = 1.05 - severity * 0.4
  }

  reset() {
    this.timer = 0
    this.dub = 0
  }
}
