/**
 * Cosmetic weapon camos sold in the Skin Shop. They only repaint the gun
 * sprite: damage, fire rate, spread and handling never change.
 */

export type GunSkinId = 'camo' | 'synthwave' | 'alien' | 'gold'

export interface GunSkin {
  id: GunSkinId
  name: string
  blurb: string
  price: number
  /** Card accent classes. */
  ring: string
  text: string
}

export const GUN_SKINS: GunSkin[] = [
  { id: 'camo', name: 'Tactical Camo', blurb: 'Olive, drab and bark woodland pattern.', price: 750, ring: 'ring-lime-500', text: 'text-lime-300' },
  { id: 'synthwave', name: 'Neon Synthwave', blurb: 'Midnight body, magenta and cyan glow.', price: 850, ring: 'ring-fuchsia-400', text: 'text-fuchsia-300' },
  { id: 'alien', name: 'Cyber Alien', blurb: 'Bio-green circuitry pulsing on violet.', price: 950, ring: 'ring-emerald-400', text: 'text-emerald-300' },
  { id: 'gold', name: 'Gold', blurb: 'Mirror-polished 24k plating.', price: 1000, ring: 'ring-yellow-300', text: 'text-yellow-200' },
]

export function isGunSkinId(value: unknown): value is GunSkinId {
  return typeof value === 'string' && GUN_SKINS.some((s) => s.id === value)
}

export function gunSkinById(id: GunSkinId): GunSkin {
  return GUN_SKINS.find((s) => s.id === id) ?? GUN_SKINS[0]
}

/**
 * Paints a gun body rectangle (local frame, barrel along +x) in a camo.
 * With no skin it fills the stock colour so callers can use it unconditionally.
 */
export function paintGun(
  c: CanvasRenderingContext2D,
  skin: GunSkinId | null,
  x: number,
  y: number,
  w: number,
  h: number,
  stock: string,
  t: number,
) {
  if (!skin) {
    c.fillStyle = stock
    c.fillRect(x, y, w, h)
    return
  }
  c.save()
  if (skin === 'gold') {
    const g = c.createLinearGradient(x, y, x, y + h)
    g.addColorStop(0, '#fef08a')
    g.addColorStop(0.5, '#eab308')
    g.addColorStop(1, '#a16207')
    c.fillStyle = g
    c.fillRect(x, y, w, h)
    const shine = x + ((t * 30) % (w + 8)) - 4
    c.fillStyle = 'rgba(255,255,255,0.55)'
    c.fillRect(Math.max(x, shine), y, Math.min(2, x + w - shine), h)
  } else if (skin === 'camo') {
    c.fillStyle = '#4d5b2a'
    c.fillRect(x, y, w, h)
    const blots = ['#2f3b16', '#7c6a3c', '#1c1917']
    for (let i = 0; i * 4 < w; i++) {
      c.fillStyle = blots[i % 3]
      c.fillRect(x + i * 4 + (i % 2), y + ((i * 3) % Math.max(1, h - 2)), 3, Math.min(3, h))
    }
  } else if (skin === 'synthwave') {
    c.fillStyle = '#1e1b4b'
    c.fillRect(x, y, w, h)
    c.shadowColor = '#e879f9'
    c.shadowBlur = 6
    c.fillStyle = '#f0abfc'
    c.fillRect(x, y, w, Math.max(1, h * 0.22))
    c.fillStyle = '#22d3ee'
    c.fillRect(x, y + h - Math.max(1, h * 0.22), w, Math.max(1, h * 0.22))
  } else {
    c.fillStyle = '#3b0764'
    c.fillRect(x, y, w, h)
    const pulse = 0.55 + 0.45 * Math.sin(t * 5)
    c.strokeStyle = `rgba(74,222,128,${pulse})`
    c.shadowColor = '#4ade80'
    c.shadowBlur = 5
    c.lineWidth = 1
    c.beginPath()
    c.moveTo(x + 1, y + h / 2)
    c.lineTo(x + w * 0.4, y + h / 2)
    c.lineTo(x + w * 0.5, y + 1)
    c.lineTo(x + w - 1, y + 1)
    c.stroke()
  }
  c.restore()
}
