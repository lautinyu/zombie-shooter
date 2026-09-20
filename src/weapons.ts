export type WeaponId =
  | 'rusty-pistol'
  | 'old-rifle'
  | 'viper-smg'
  | 'hellfire-shotgun'
  | 'titan-sniper'
  | 'm9-sidearm'
  | 'combat-machete'
  | 'stun-baton'
  | 'blizzard-rifle'
  | 'thermal-railgun'
  | 'cryo-launcher'
  | 'venom-spitter'
  | 'jungle-machete'
  | 'scrap-autocannon'
  | 'rebar-cleaver'

/** Primaries are the heavy firearms; secondaries are sidearms and melee. */
export type WeaponSlot = 'primary' | 'secondary'

/** Swing profile for melee secondaries, which hit an arc instead of firing. */
export interface MeleeProfile {
  /** How far in front of the player the swing lands. */
  reach: number
  /** Total width of the swing arc, in radians. */
  arc: number
  /** Push applied to everything caught in the swing. */
  knockback: number
  /** Chance per hit to freeze the target solid. */
  stunChance: number
  stunTime: number
}

export type PerkId =
  | 'none'
  | 'acidic-spray'
  | 'dragons-breath'
  | 'armor-piercing'
  | 'cryo-rounds'
  | 'thermal-lance'
  | 'cryo-blast'
  | 'venom-stacks'
  | 'heavy-cleave'

/**
 * Chapter 1 gear is bought with scrap, arctic tech with Frozen Data Chips and
 * the jungle relics with Ancient Amber and Rustland salvage with Rust Cores.
 */
export type Currency = 'scrap' | 'chips' | 'amber' | 'cores'

/** Radar chart axes, scored 1-5. */
export interface RadarStats {
  damage: number
  fireRate: number
  reloadSpeed: number
  ammoCapacity: number
  range: number
}

export interface Weapon {
  id: WeaponId
  name: string
  slot: WeaponSlot
  price: number
  /** Which wallet the price is paid from. */
  currency: Currency
  color: string
  perk: PerkId
  perkName: string
  perkDescription: string
  description: string
  radar: RadarStats
  /** Derived combat values used by the simulation. */
  damage: number
  fireInterval: number
  reloadTime: number
  magSize: number
  reserveStart: number
  bulletSpeed: number
  bulletLife: number
  pellets: number
  spread: number
  tracerWidth: number
  /** Fraction of damage a pellet keeps at the very end of its flight. */
  falloff?: number
  /** Never consumes ammo: sidearms with scavenged rounds and melee. */
  infiniteAmmo?: boolean
  /** Present on melee weapons; swings an arc instead of spawning bullets. */
  melee?: MeleeProfile
  /** Rounds fired between cryo shots; those slow whatever they hit. */
  cryoEvery?: number
  /** Seconds the trigger must be held before the beam releases. */
  chargeTime?: number
  /** Shots punch through everything they touch. */
  piercing?: boolean
  /** Detonates on impact, freezing and damaging everything in the blast. */
  blastRadius?: number
  blastFreeze?: number
  /** Acid needles melt armour and stack poison on the target. */
  venom?: boolean
}

/** Poison applications a single target can carry from the Venom Spitter. */
export const MAX_POISON_STACKS = 5

/** How much a cryo hit slows a target, and for how long. */
export const CRYO_SLOW = 0.5
export const CRYO_SLOW_TIME = 3

export const RADAR_AXES: { key: keyof RadarStats; label: string }[] = [
  { key: 'damage', label: 'Damage' },
  { key: 'fireRate', label: 'Fire Rate' },
  { key: 'reloadSpeed', label: 'Reload Speed' },
  { key: 'ammoCapacity', label: 'Ammo Capacity' },
  { key: 'range', label: 'Range' },
]

export const WEAPONS: Weapon[] = [
  {
    id: 'rusty-pistol',
    name: 'Rusty Pistol',
    slot: 'secondary',
    price: 0,
    currency: 'scrap',
    color: '#94a3b8',
    perk: 'none',
    perkName: 'No talent',
    perkDescription: 'A scavenged sidearm. Reliable, unremarkable.',
    description: 'Free starter sidearm with balanced, low-end numbers.',
    radar: { damage: 2, fireRate: 2, reloadSpeed: 3, ammoCapacity: 2, range: 2 },
    damage: 30,
    fireInterval: 0.24,
    reloadTime: 1.2,
    magSize: 12,
    reserveStart: 96,
    bulletSpeed: 820,
    bulletLife: 0.7,
    pellets: 1,
    spread: 0.05,
    tracerWidth: 3,
  },
  {
    id: 'old-rifle',
    name: 'Old Rifle',
    slot: 'primary',
    price: 0,
    currency: 'scrap',
    color: '#a3a380',
    perk: 'none',
    perkName: 'No talent',
    perkDescription: 'Surplus service rifle. Hits harder, empties slower.',
    description: 'Free starter rifle: more damage and reach, sluggish reload.',
    radar: { damage: 3, fireRate: 2, reloadSpeed: 2, ammoCapacity: 2, range: 4 },
    damage: 45,
    fireInterval: 0.32,
    reloadTime: 1.7,
    magSize: 10,
    reserveStart: 80,
    bulletSpeed: 1000,
    bulletLife: 1.1,
    pellets: 1,
    spread: 0.02,
    tracerWidth: 3,
  },
  {
    id: 'viper-smg',
    name: 'Viper SMG',
    slot: 'primary',
    price: 500,
    currency: 'scrap',
    color: '#4ade80',
    perk: 'acidic-spray',
    perkName: 'Acidic Spray',
    perkDescription: 'Every 5th bullet coats the target in acid, dealing damage over time.',
    description: 'Blistering fire rate and a deep magazine, weak per-shot damage.',
    radar: { damage: 2, fireRate: 5, reloadSpeed: 4, ammoCapacity: 5, range: 2 },
    damage: 20.24,
    fireInterval: 0.075,
    reloadTime: 1.0,
    magSize: 75,
    reserveStart: 300,
    bulletSpeed: 880,
    bulletLife: 0.6,
    pellets: 1,
    spread: 0.08,
    tracerWidth: 3,
  },
  {
    id: 'hellfire-shotgun',
    name: 'Hellfire Shotgun',
    slot: 'primary',
    price: 620,
    currency: 'scrap',
    color: '#fb923c',
    perk: 'dragons-breath',
    perkName: "Dragon's Breath",
    perkDescription: 'Wide blast cone with a 30% chance per pellet to ignite and slow Plague Bugs.',
    description: 'Five-pellet blast cone: lethal point blank, weak at distance.',
    radar: { damage: 5, fireRate: 2, reloadSpeed: 2, ammoCapacity: 2, range: 1 },
    damage: 34,
    fireInterval: 0.62,
    reloadTime: 1.9,
    magSize: 8,
    reserveStart: 64,
    bulletSpeed: 760,
    bulletLife: 0.42,
    pellets: 5,
    spread: 0.28,
    tracerWidth: 4,
    falloff: 0.3,
  },
  {
    id: 'titan-sniper',
    name: 'Titan Sniper',
    slot: 'primary',
    price: 750,
    currency: 'scrap',
    color: '#60a5fa',
    perk: 'armor-piercing',
    perkName: 'Armor Piercing',
    perkDescription: 'Rounds punch straight through enemies instead of stopping on the first hit.',
    description: 'One shot, one line. Devastating damage and enormous reach.',
    radar: { damage: 5, fireRate: 1, reloadSpeed: 2, ammoCapacity: 1, range: 5 },
    damage: 130,
    fireInterval: 0.95,
    reloadTime: 2.1,
    magSize: 5,
    reserveStart: 40,
    bulletSpeed: 2600,
    bulletLife: 1.6,
    pellets: 1,
    spread: 0.005,
    tracerWidth: 5,
  },
  {
    id: 'm9-sidearm',
    name: 'M9 Sidearm',
    slot: 'secondary',
    price: 0,
    currency: 'scrap',
    color: '#cbd5e1',
    perk: 'none',
    perkName: 'Scavenged Rounds',
    perkDescription: 'Scavenged 9mm is everywhere, so it carries a deep 120-round reserve.',
    description: 'Free backup handgun: deep reserve, feeble damage, quick reloads.',
    radar: { damage: 1, fireRate: 3, reloadSpeed: 5, ammoCapacity: 3, range: 2 },
    damage: 18,
    fireInterval: 0.2,
    reloadTime: 0.9,
    magSize: 15,
    reserveStart: 120,
    bulletSpeed: 800,
    bulletLife: 0.65,
    pellets: 1,
    spread: 0.06,
    tracerWidth: 3,
  },
  {
    id: 'combat-machete',
    name: 'Combat Machete',
    slot: 'secondary',
    price: 260,
    currency: 'scrap',
    color: '#f87171',
    perk: 'none',
    perkName: 'Cleave',
    perkDescription: 'Each swing cuts every enemy in the arc and shoves them back.',
    description: 'Fast melee blade: no ammo, slices through overlapping zombies.',
    radar: { damage: 3, fireRate: 4, reloadSpeed: 5, ammoCapacity: 5, range: 1 },
    damage: 52,
    fireInterval: 0.34,
    reloadTime: 0,
    magSize: 1,
    reserveStart: 0,
    bulletSpeed: 0,
    bulletLife: 0,
    pellets: 0,
    spread: 0,
    tracerWidth: 0,
    infiniteAmmo: true,
    melee: { reach: 62, arc: Math.PI / 2, knockback: 26, stunChance: 0, stunTime: 0 },
  },
  {
    id: 'stun-baton',
    name: 'Stun Baton',
    slot: 'secondary',
    price: 340,
    currency: 'scrap',
    color: '#38bdf8',
    perk: 'none',
    perkName: 'Overcharge',
    perkDescription: '40% chance per hit to electrocute a target, freezing it for 2 seconds.',
    description: 'Defensive melee baton: no ammo, locks the horde down mid-swing.',
    radar: { damage: 2, fireRate: 3, reloadSpeed: 5, ammoCapacity: 5, range: 1 },
    damage: 34,
    fireInterval: 0.42,
    reloadTime: 0,
    magSize: 1,
    reserveStart: 0,
    bulletSpeed: 0,
    bulletLife: 0,
    pellets: 0,
    spread: 0,
    tracerWidth: 0,
    infiniteAmmo: true,
    melee: { reach: 54, arc: Math.PI / 2, knockback: 14, stunChance: 0.4, stunTime: 2 },
  },
  {
    id: 'blizzard-rifle',
    name: 'Blizzard Rifle',
    slot: 'primary',
    price: 24,
    currency: 'chips',
    color: '#7dd3fc',
    perk: 'cryo-rounds',
    perkName: 'Cryo Rounds',
    perkDescription: 'Every 3rd shot is a cryo bullet that slows its target by 50% for 3 seconds.',
    description: 'Arctic-issue assault rifle: steady damage with a freezing cadence.',
    radar: { damage: 3, fireRate: 4, reloadSpeed: 4, ammoCapacity: 4, range: 4 },
    damage: 34,
    fireInterval: 0.11,
    reloadTime: 1.3,
    magSize: 30,
    reserveStart: 240,
    bulletSpeed: 1100,
    bulletLife: 0.9,
    pellets: 1,
    spread: 0.04,
    tracerWidth: 3,
    cryoEvery: 3,
  },
  {
    id: 'thermal-railgun',
    name: 'Thermal Railgun',
    slot: 'primary',
    price: 38,
    currency: 'chips',
    color: '#f97316',
    perk: 'thermal-lance',
    perkName: 'Thermal Lance',
    perkDescription:
      'Hold fire to charge, then release a piercing heat beam that ignores hardened shells.',
    description: 'Heavy charge-up rail weapon: slow, brutal, melts a whole line at once.',
    radar: { damage: 5, fireRate: 1, reloadSpeed: 2, ammoCapacity: 1, range: 5 },
    damage: 210,
    fireInterval: 0.2,
    reloadTime: 2.4,
    magSize: 4,
    reserveStart: 32,
    bulletSpeed: 2400,
    bulletLife: 1.8,
    pellets: 1,
    spread: 0,
    tracerWidth: 9,
    chargeTime: 0.9,
    piercing: true,
  },
  {
    id: 'cryo-launcher',
    name: 'Cryo Grenade Launcher',
    slot: 'secondary',
    price: 30,
    currency: 'chips',
    color: '#38bdf8',
    perk: 'cryo-blast',
    perkName: 'Flash Freeze',
    perkDescription: 'Canisters detonate on impact, freezing everything in the blast for 2 seconds.',
    description: 'Lobbed cryo canister: light damage, locks down a whole group.',
    radar: { damage: 3, fireRate: 1, reloadSpeed: 2, ammoCapacity: 2, range: 3 },
    damage: 40,
    fireInterval: 1.1,
    reloadTime: 2.2,
    magSize: 4,
    reserveStart: 28,
    bulletSpeed: 620,
    bulletLife: 0.9,
    pellets: 1,
    spread: 0.02,
    tracerWidth: 7,
    blastRadius: 130,
    blastFreeze: 2,
  },
  {
    id: 'venom-spitter',
    name: 'Venom Spitter SMG',
    slot: 'primary',
    price: 26,
    currency: 'amber',
    color: '#a3e635',
    perk: 'venom-stacks',
    perkName: 'Acid Needles',
    perkDescription:
      'High-speed needles melt straight through armour and stack poison up to 5 times on one target.',
    description: 'Primeval SMG grown around a venom gland: fast, corrosive, relentless.',
    radar: { damage: 2, fireRate: 5, reloadSpeed: 4, ammoCapacity: 5, range: 3 },
    damage: 20,
    fireInterval: 0.065,
    reloadTime: 1.1,
    magSize: 40,
    reserveStart: 240,
    bulletSpeed: 1500,
    bulletLife: 0.7,
    pellets: 1,
    spread: 0.07,
    tracerWidth: 3,
    venom: true,
  },
  {
    id: 'jungle-machete',
    name: 'Jungle Machete',
    slot: 'secondary',
    price: 18,
    currency: 'amber',
    color: '#65a30d',
    perk: 'heavy-cleave',
    perkName: 'Heavy Cleave',
    perkDescription:
      'An oversized blade: a 120° arc that hacks through vines and throws the horde back twice as far.',
    description: 'Machete forged for the canopy. No ammo, huge arc, brutal knockback.',
    radar: { damage: 4, fireRate: 3, reloadSpeed: 5, ammoCapacity: 5, range: 2 },
    damage: 64,
    fireInterval: 0.38,
    reloadTime: 0,
    magSize: 1,
    reserveStart: 0,
    bulletSpeed: 0,
    bulletLife: 0,
    pellets: 0,
    spread: 0,
    tracerWidth: 0,
    infiniteAmmo: true,
    melee: { reach: 74, arc: (120 * Math.PI) / 180, knockback: 52, stunChance: 0, stunTime: 0 },
  },
  {
    id: 'scrap-autocannon',
    name: 'Scrap Autocannon',
    slot: 'primary',
    price: 28,
    currency: 'cores',
    color: '#f59e0b',
    perk: 'armor-piercing',
    perkName: 'Rustland Slugs',
    perkDescription:
      'Bored-out scrap slugs punch clean through a line of scavengers instead of stopping on the first one.',
    description: 'Salvaged deck gun rebuilt for the truck bed: heavy, sprayed wide, piercing.',
    radar: { damage: 4, fireRate: 4, reloadSpeed: 2, ammoCapacity: 4, range: 4 },
    damage: 34,
    fireInterval: 0.12,
    reloadTime: 2.1,
    magSize: 45,
    reserveStart: 270,
    bulletSpeed: 1500,
    bulletLife: 0.85,
    pellets: 1,
    spread: 0.085,
    tracerWidth: 4,
    piercing: true,
  },
  {
    id: 'rebar-cleaver',
    name: 'Rebar Cleaver',
    slot: 'secondary',
    price: 20,
    currency: 'cores',
    color: '#b45309',
    perk: 'heavy-cleave',
    perkName: 'Scrap Cleave',
    perkDescription:
      'A slab of welded rebar: a 140° arc that shatters plating and staggers whatever survives it.',
    description: 'Rustland melee slab. No ammo, enormous arc, bone-breaking knockback.',
    radar: { damage: 5, fireRate: 2, reloadSpeed: 5, ammoCapacity: 5, range: 2 },
    damage: 82,
    fireInterval: 0.46,
    reloadTime: 0,
    magSize: 1,
    reserveStart: 0,
    bulletSpeed: 0,
    bulletLife: 0,
    pellets: 0,
    spread: 0,
    tracerWidth: 0,
    infiniteAmmo: true,
    melee: { reach: 80, arc: (140 * Math.PI) / 180, knockback: 64, stunChance: 0.2, stunTime: 0.8 },
  },
]

export const STARTER_WEAPONS: WeaponId[] = ['old-rifle', 'rusty-pistol', 'm9-sidearm']

/** Arctic tech is sold on its own shop tab and paid for in Data Chips. */
export function chapterTwoWeapons(): Weapon[] {
  return WEAPONS.filter((w) => w.currency === 'chips')
}

/** Jungle relics live on the Ancient Tech tab and cost Ancient Amber. */
export function chapterThreeWeapons(): Weapon[] {
  return WEAPONS.filter((w) => w.currency === 'amber')
}

/** Rustland salvage lives on the Rust Tech tab and costs Rust Cores. */
export function chapterFourWeapons(): Weapon[] {
  return WEAPONS.filter((w) => w.currency === 'cores')
}

export function weaponsInSlot(slot: WeaponSlot): Weapon[] {
  return WEAPONS.filter((w) => w.slot === slot && w.currency === 'scrap')
}

export function weaponById(id: WeaponId): Weapon {
  const w = WEAPONS.find((weapon) => weapon.id === id)
  if (!w) throw new Error(`unknown weapon ${id}`)
  return w
}
