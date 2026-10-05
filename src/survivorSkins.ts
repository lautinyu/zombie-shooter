/**
 * Top-down survivor sprites shared by Endless Horde and the campaign Locker.
 * The four Horde class looks double as campaign skins, alongside cosmetics
 * unlocked by clearing campaign missions.
 */

export type SurvivorSkinId =
  | 'swat'
  | 'assassin'
  | 'technician'
  | 'marksman'
  | 'hazmat'
  | 'stealth'
  | 'juggernaut'
  | 'cyber'

export interface SurvivorSkin {
  id: SurvivorSkinId
  name: string
  blurb: string
  /** Card ring when equipped / idle. */
  ring: string
  text: string
  /** Campaign missions cleared before the skin can be equipped; 0 = always. */
  unlockMissions: number
  /** Needs the Chapter 4 finale cleared (New Game+ unlocked). */
  unlockNgPlus?: boolean
}

export const SURVIVOR_SKINS: SurvivorSkin[] = [
  { id: 'swat', name: 'SWAT', blurb: 'Navy plate and a blue visor.', ring: 'ring-sky-400', text: 'text-sky-300', unlockMissions: 0 },
  { id: 'assassin', name: 'Assassin', blurb: 'Hood, cape and a red scarf.', ring: 'ring-violet-400', text: 'text-violet-300', unlockMissions: 0 },
  { id: 'technician', name: 'Technician', blurb: 'Hi-vis vest, hard hat, antenna pack.', ring: 'ring-amber-400', text: 'text-amber-300', unlockMissions: 0 },
  { id: 'marksman', name: 'Marksman', blurb: 'Shaggy ghillie and boonie hat.', ring: 'ring-emerald-400', text: 'text-emerald-300', unlockMissions: 0 },
  { id: 'hazmat', name: 'Hazmat Ops', blurb: 'Sealed yellow suit, gas mask filters.', ring: 'ring-yellow-400', text: 'text-yellow-300', unlockMissions: 3 },
  { id: 'stealth', name: 'Stealth Recon', blurb: 'Matte black kit, quad night-vision.', ring: 'ring-lime-400', text: 'text-lime-300', unlockMissions: 6 },
  { id: 'juggernaut', name: 'Heavy Juggernaut', blurb: 'Bulky blast plate with red bands.', ring: 'ring-red-400', text: 'text-red-300', unlockMissions: 10 },
  { id: 'cyber', name: 'Cyber Operative', blurb: 'White shell, neon circuitry.', ring: 'ring-pink-400', text: 'text-pink-300', unlockMissions: 0, unlockNgPlus: true },
]

export function isSurvivorSkinId(value: unknown): value is SurvivorSkinId {
  return typeof value === 'string' && SURVIVOR_SKINS.some((s) => s.id === value)
}

/** Whether a save has met a skin's unlock requirement. */
export function skinUnlocked(skin: SurvivorSkin, campaignCleared: number, ngPlus: boolean): boolean {
  return campaignCleared >= skin.unlockMissions && (!skin.unlockNgPlus || ngPlus)
}

export function skinUnlockHint(skin: SurvivorSkin): string {
  if (skin.unlockNgPlus) return 'Clear the Chapter 4 finale'
  return `Clear ${skin.unlockMissions} campaign missions`
}

export function skinById(id: SurvivorSkinId): SurvivorSkin {
  return SURVIVOR_SKINS.find((s) => s.id === id) ?? SURVIVOR_SKINS[0]
}

const TAU = Math.PI * 2

/** Arms reaching from the shoulders to the grip. */
function drawArms(c: CanvasRenderingContext2D, color: string) {
  c.strokeStyle = color
  c.lineWidth = 4
  c.lineCap = 'round'
  c.beginPath()
  c.moveTo(1, -10)
  c.lineTo(11, -2.5)
  c.moveTo(1, 10)
  c.lineTo(9, 2.5)
  c.stroke()
}

/**
 * A top-down survivor in its local frame (facing +x), roughly 15 units in
 * radius. Each skin has its own silhouette: SWAT plate and visor, the
 * Assassin's hood and cape, the Technician's hard hat and pack, the Marksman's
 * ghillie, plus the Locker cosmetics below.
 */
export function drawSurvivor(c: CanvasRenderingContext2D, id: SurvivorSkinId, stride: number, t: number) {
  const step = Math.sin(stride) * 3
  c.fillStyle = '#111827'
  c.beginPath()
  c.ellipse(step, -6, 5, 3.5, 0, 0, TAU)
  c.fill()
  c.beginPath()
  c.ellipse(-step, 6, 5, 3.5, 0, 0, TAU)
  c.fill()

  if (id === 'hazmat') {
    c.fillStyle = '#334155'
    c.fillRect(-15, -6, 6, 12)
    c.fillStyle = '#eab308'
    c.beginPath()
    c.ellipse(0, 0, 10, 14, 0, 0, TAU)
    c.fill()
    c.strokeStyle = '#a16207'
    c.lineWidth = 1.5
    for (const y of [-8, 0, 8]) {
      c.beginPath()
      c.moveTo(-8, y)
      c.lineTo(7, y)
      c.stroke()
    }
    c.fillStyle = '#111827'
    c.fillRect(-9, -2, 4, 4)
    drawArms(c, '#ca8a04')
    c.fillStyle = '#fde047'
    c.beginPath()
    c.arc(-1, 0, 8, 0, TAU)
    c.fill()
    c.fillStyle = '#4ade80'
    c.globalAlpha = 0.85
    c.beginPath()
    c.ellipse(3, 0, 4, 5.5, 0, 0, TAU)
    c.fill()
    c.globalAlpha = 1
    c.fillStyle = '#1f2937'
    for (const side of [-1, 1]) {
      c.beginPath()
      c.arc(5, side * 6, 2.6, 0, TAU)
      c.fill()
    }
    return
  }

  if (id === 'stealth') {
    c.fillStyle = '#18181b'
    c.beginPath()
    c.ellipse(0, 0, 9, 13, 0, 0, TAU)
    c.fill()
    c.strokeStyle = '#3f3f46'
    c.lineWidth = 1.5
    c.beginPath()
    c.moveTo(-6, -10)
    c.lineTo(4, 10)
    c.moveTo(4, -10)
    c.lineTo(-6, 10)
    c.stroke()
    c.fillStyle = '#27272a'
    c.fillRect(-13, -5, 5, 10)
    drawArms(c, '#27272a')
    c.fillStyle = '#09090b'
    c.beginPath()
    c.arc(-1, 0, 7, 0, TAU)
    c.fill()
    const glow = 0.65 + Math.sin(t * 5) * 0.25
    c.fillStyle = `rgba(74,222,128,${glow})`
    for (const y of [-4, -1.5, 1.5, 4]) {
      c.beginPath()
      c.arc(6, y, 1.4, 0, TAU)
      c.fill()
    }
    return
  }

  if (id === 'juggernaut') {
    c.fillStyle = '#27272a'
    c.beginPath()
    c.ellipse(0, 0, 12, 17, 0, 0, TAU)
    c.fill()
    c.fillStyle = '#52525b'
    c.fillRect(-11, -12, 18, 24)
    c.fillStyle = '#b91c1c'
    c.fillRect(-11, -2, 18, 4)
    c.fillStyle = '#3f3f46'
    for (const side of [-1, 1]) {
      c.beginPath()
      c.arc(-1, side * 14, 6, 0, TAU)
      c.fill()
      c.fillStyle = '#71717a'
      c.fillRect(-4, side * 14 - 1, 6, 2)
      c.fillStyle = '#3f3f46'
    }
    drawArms(c, '#3f3f46')
    c.fillStyle = '#18181b'
    c.beginPath()
    c.arc(-1, 0, 9, 0, TAU)
    c.fill()
    c.fillStyle = '#ef4444'
    c.fillRect(4, -4, 3, 8)
    return
  }

  if (id === 'cyber') {
    c.fillStyle = '#e2e8f0'
    c.beginPath()
    c.ellipse(0, 0, 9, 13, 0, 0, TAU)
    c.fill()
    const pulse = 0.6 + Math.sin(t * 6) * 0.4
    c.strokeStyle = `rgba(236,72,153,${pulse})`
    c.lineWidth = 1.6
    c.beginPath()
    c.moveTo(-7, -9)
    c.lineTo(-2, -4)
    c.lineTo(-2, 4)
    c.lineTo(-7, 9)
    c.moveTo(5, -9)
    c.lineTo(2, -2)
    c.lineTo(5, 2)
    c.stroke()
    drawArms(c, '#94a3b8')
    c.fillStyle = '#cbd5e1'
    c.beginPath()
    c.arc(-1, 0, 7.5, 0, TAU)
    c.fill()
    c.strokeStyle = `rgba(34,211,238,${0.7 + pulse * 0.3})`
    c.lineWidth = 3
    c.beginPath()
    c.arc(-1, 0, 6.2, -1.1, 1.1)
    c.stroke()
    c.fillStyle = '#ec4899'
    c.fillRect(-7, -1, 3, 2)
    return
  }

  if (id === 'swat') {
    c.fillStyle = '#1e293b'
    c.beginPath()
    c.ellipse(0, 0, 9, 15, 0, 0, TAU)
    c.fill()
    c.fillStyle = '#1e3a8a'
    c.fillRect(-9, -10, 16, 20)
    c.fillStyle = '#2563eb'
    c.fillRect(-5, -6, 9, 12)
    c.fillStyle = '#f8fafc'
    c.fillRect(-9, -4, 2, 8)
    c.fillStyle = '#334155'
    for (const side of [-1, 1]) {
      c.beginPath()
      c.arc(0, side * 12, 4.5, 0, TAU)
      c.fill()
    }
    drawArms(c, '#1e293b')
    c.fillStyle = '#0f172a'
    c.beginPath()
    c.arc(-1, 0, 7.5, 0, TAU)
    c.fill()
    c.strokeStyle = '#38bdf8'
    c.lineWidth = 3
    c.beginPath()
    c.arc(-1, 0, 6.5, -0.9, 0.9)
    c.stroke()
    return
  }

  if (id === 'assassin') {
    const sway = Math.sin(t * 4 + stride * 0.5) * 4
    c.fillStyle = '#2e1065'
    c.beginPath()
    c.moveTo(-2, -12)
    c.quadraticCurveTo(-26, sway - 4, -22, sway)
    c.quadraticCurveTo(-26, sway + 4, -2, 12)
    c.closePath()
    c.fill()
    c.strokeStyle = '#dc2626'
    c.lineWidth = 3
    c.lineCap = 'round'
    c.beginPath()
    c.moveTo(-4, 3)
    c.quadraticCurveTo(-12, 4 + sway, -19, 7 + sway * 1.4)
    c.stroke()
    c.fillStyle = '#3b0764'
    c.beginPath()
    c.ellipse(0, 0, 8, 12, 0, 0, TAU)
    c.fill()
    drawArms(c, '#1e1b4b')
    c.fillStyle = '#4c1d95'
    c.beginPath()
    c.arc(-1, 0, 7.5, 0, TAU)
    c.fill()
    c.fillStyle = '#0b0616'
    c.beginPath()
    c.ellipse(3.5, 0, 3.5, 4.5, 0, 0, TAU)
    c.fill()
    c.fillStyle = '#c084fc'
    c.fillRect(4.5, -2.4, 1.8, 1.4)
    c.fillRect(4.5, 1, 1.8, 1.4)
    return
  }

  if (id === 'technician') {
    c.fillStyle = '#475569'
    c.fillRect(-16, -8, 9, 16)
    c.fillStyle = '#64748b'
    c.fillRect(-16, -2, 9, 3)
    c.strokeStyle = '#94a3b8'
    c.lineWidth = 1.5
    c.beginPath()
    c.moveTo(-13, -7)
    c.lineTo(-21, -15)
    c.stroke()
    c.fillStyle = Math.sin(t * 6) > 0 ? '#22c55e' : '#14532d'
    c.beginPath()
    c.arc(-21, -15, 2, 0, TAU)
    c.fill()
    c.fillStyle = '#ea580c'
    c.beginPath()
    c.ellipse(0, 0, 9, 13, 0, 0, TAU)
    c.fill()
    c.fillStyle = '#fde047'
    c.fillRect(-4, -13, 2.5, 26)
    c.fillRect(2, -12, 2, 24)
    drawArms(c, '#9a3412')
    c.fillStyle = '#facc15'
    c.beginPath()
    c.arc(-1, 0, 7.5, 0, TAU)
    c.fill()
    c.fillStyle = '#fde047'
    c.beginPath()
    c.ellipse(4, 0, 4, 7, 0, -Math.PI / 2, Math.PI / 2)
    c.fill()
    c.strokeStyle = '#ca8a04'
    c.lineWidth = 1.5
    c.beginPath()
    c.moveTo(-8, 0)
    c.lineTo(6, 0)
    c.stroke()
    c.fillStyle = '#14b8a6'
    c.fillRect(5, -4.5, 2.5, 3)
    c.fillRect(5, 1.5, 2.5, 3)
    return
  }

  // Marksman: shaggy ghillie wrap with a wide boonie hat.
  const greens = ['#4d7c0f', '#365314', '#65a30d']
  c.lineWidth = 2
  c.lineCap = 'round'
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU
    const len = 3 + ((i * 37) % 5)
    c.strokeStyle = greens[i % 3]
    c.beginPath()
    c.moveTo(Math.cos(a) * 8, Math.sin(a) * 11)
    c.lineTo(Math.cos(a) * (8 + len), Math.sin(a) * (11 + len))
    c.stroke()
  }
  c.fillStyle = '#3f6212'
  c.beginPath()
  c.ellipse(0, 0, 10, 14, 0, 0, TAU)
  c.fill()
  c.fillStyle = '#365314'
  for (const [x, y] of [[-5, -7], [2, 6], [-3, 4], [4, -5]]) {
    c.beginPath()
    c.arc(x, y, 2.5, 0, TAU)
    c.fill()
  }
  drawArms(c, '#365314')
  c.fillStyle = '#4d5b2a'
  c.beginPath()
  c.arc(-1, 0, 10, 0, TAU)
  c.fill()
  c.fillStyle = '#3f4a22'
  c.beginPath()
  c.arc(-1, 0, 6.5, 0, TAU)
  c.fill()
  c.strokeStyle = '#1c1917'
  c.lineWidth = 1.5
  c.stroke()
  c.strokeStyle = '#65a30d'
  c.beginPath()
  c.moveTo(-6, -4)
  c.lineTo(-10, -9)
  c.moveTo(-5, 5)
  c.lineTo(-11, 7)
  c.stroke()
}
