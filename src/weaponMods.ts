/**
 * Attachments that can ride on dropped weapons in Endless Horde and NG+.
 * A pickup adds its attachments to the matching gun for the rest of the run.
 */

export type WeaponModId = 'incendiary' | 'extended' | 'laser'

export interface WeaponMod {
  id: WeaponModId
  name: string
  icon: string
  color: string
  blurb: string
}

export const WEAPON_MODS: Record<WeaponModId, WeaponMod> = {
  incendiary: { id: 'incendiary', name: 'Incendiary Rounds', icon: '🔥', color: '#f97316', blurb: 'hits set targets burning' },
  extended: { id: 'extended', name: 'Extended Mag', icon: '📦', color: '#facc15', blurb: '+50% magazine' },
  laser: { id: 'laser', name: 'Laser Sight', icon: '🔴', color: '#ef4444', blurb: '70% tighter spread' },
}

const MOD_IDS: WeaponModId[] = ['incendiary', 'extended', 'laser']

export const EXTENDED_MAG_SCALE = 1.5
export const LASER_SPREAD_SCALE = 0.3
/** Seconds an incendiary hit keeps a target burning. */
export const INCENDIARY_TIME = 3
/** Share of a hit's damage dealt per second while the target burns. */
export const INCENDIARY_DPS_SHARE = 0.35
/** Odds a dropped weapon carries at least one attachment. */
const MOD_CHANCE = 0.55
/** Odds a modded drop carries a second attachment. */
const SECOND_MOD_CHANCE = 0.25

/** Attachments for a fresh drop; `guaranteed` drops always carry at least one. */
export function rollWeaponMods(guaranteed = false): WeaponModId[] {
  if (!guaranteed && Math.random() >= MOD_CHANCE) return []
  const pool = [...MOD_IDS]
  const first = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]
  const out = [first]
  if (Math.random() < SECOND_MOD_CHANCE) out.push(pool[Math.floor(Math.random() * pool.length)])
  return out
}

export function modIcons(mods: readonly WeaponModId[]): string {
  return mods.map((m) => WEAPON_MODS[m].icon).join('')
}

export function modNames(mods: readonly WeaponModId[]): string {
  return mods.map((m) => WEAPON_MODS[m].name).join(' + ')
}

/** A dropped gun on a glowing pad, haloed in its attachment colours. */
export function drawWeaponDrop(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  t: number,
  mods: readonly WeaponModId[],
  fading: boolean
) {
  const bob = Math.sin(t * 3) * 2
  ctx.save()
  ctx.translate(x, y)
  if (fading) ctx.globalAlpha = 0.45 + 0.35 * Math.sin(t * 18)
  const colors = mods.length ? mods.map((m) => WEAPON_MODS[m].color) : ['#94a3b8']
  colors.forEach((color, i) => {
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(0, 0, 15 + i * 4 + Math.sin(t * 4 + i) * 1.5, 0, Math.PI * 2)
    ctx.stroke()
  })
  ctx.fillStyle = mods.length ? 'rgba(250,204,21,0.14)' : 'rgba(148,163,184,0.12)'
  ctx.beginPath()
  ctx.arc(0, 0, 14, 0, Math.PI * 2)
  ctx.fill()
  ctx.translate(0, bob - 2)
  ctx.rotate(-0.35)
  ctx.fillStyle = '#334155'
  ctx.fillRect(-11, -3, 20, 6)
  ctx.fillRect(7, -1.5, 8, 3)
  ctx.fillStyle = '#1e293b'
  ctx.fillRect(-6, 2, 4, 7)
  ctx.fillRect(-12, -2, 4, 8)
  if (mods.includes('extended')) {
    ctx.fillStyle = '#facc15'
    ctx.fillRect(0, 2, 4, 9)
  }
  if (mods.includes('laser')) {
    ctx.fillStyle = '#ef4444'
    ctx.fillRect(4, -6, 6, 3)
  }
  if (mods.includes('incendiary')) {
    ctx.fillStyle = '#f97316'
    ctx.fillRect(-4, -5, 6, 2)
  }
  ctx.restore()
}
