import type { CharacterId } from './characters'
import { CHARACTERS } from './characters'
import { MISSIONS } from './missions'
import type { SurvivorSkinId } from './survivorSkins'
import { SURVIVOR_SKINS, isSurvivorSkinId, skinUnlocked } from './survivorSkins'
import type { TexturePack } from './theme'
import type { GunSkinId } from './gunSkins'
import { isGunSkinId } from './gunSkins'
import type { Currency, Weapon, WeaponId } from './weapons'
import { STARTER_WEAPONS, WEAPONS, weaponById } from './weapons'

export const PROFILE_KEY = 'zombie-shooter-profile-v1'
const STORAGE_KEY = PROFILE_KEY

export interface Profile {
  /** Shop currency: bought with Scrap/Amber at the exchange, or earned in Endless Horde. */
  zcoins: number
  /** Campaign salvage from kills and mission bounties; exchanged into Z-Coins. */
  scrap: number
  /** Premium campaign resource from chapter 2-4 bounties; exchanged into Z-Coins. */
  amber: number
  owned: WeaponId[]
  /** Heavy firearm carried in the primary slot. */
  primary: WeaponId
  /** Sidearm or melee weapon carried in the secondary slot. */
  secondary: WeaponId
  character: CharacterId | null
  /** Second local player's character, used in 2-player co-op. */
  character2: CharacterId | null
  /** Local players sharing the screen. */
  players: 1 | 2
  /** Mission ids already cleared. */
  completed: string[]
  /** Chosen render style; null until the intro splash is answered. */
  textures: TexturePack | null
  /** Locker skin worn by player 1 in campaign missions; null keeps the survivor's own outfit. */
  skin: SurvivorSkinId | null
  /** Character skins bought in the Skin Shop. */
  ownedSkins: SurvivorSkinId[]
  /** Weapon camos bought in the Skin Shop. */
  ownedGunSkins: GunSkinId[]
  /** Camo painted on each loadout slot; null keeps the stock finish. */
  gunSkins: { primary: GunSkinId | null; secondary: GunSkinId | null }
}

/**
 * Z-Coins per unit of each campaign resource. Scrap and Amber are exchanged at
 * these rates in the shop; old Chips and Cores wallets were folded in on load.
 */
export const ZCOIN_RATE: Record<Currency, number> = { scrap: 1, chips: 4, amber: 5, cores: 6 }

/** Resources the shop exchange accepts. */
export type ExchangeResource = 'scrap' | 'amber'

/** Trades `amount` of a resource for Z-Coins; returns the Z-Coins gained. */
export function exchangeForZCoins(profile: Profile, resource: ExchangeResource, amount: number): number {
  const spend = Math.max(0, Math.min(Math.floor(amount), profile[resource]))
  const gained = spend * ZCOIN_RATE[resource]
  profile[resource] -= spend
  profile.zcoins += gained
  return gained
}

/** A weapon's shop price in Z-Coins: scrap-tier at the Scrap rate, higher tiers at the Amber rate. */
export function zcoinPrice(w: Weapon): number {
  return w.price * (w.currency === 'scrap' ? ZCOIN_RATE.scrap : ZCOIN_RATE.amber)
}

type CoinSink = (amount: number) => void
let coinSink: CoinSink | null = null

/** The live profile owner registers here so arcade cabinets can pay out Z-Coins. */
export function registerCoinSink(sink: CoinSink) {
  coinSink = sink
}

export function earnZCoins(amount: number) {
  if (amount > 0) coinSink?.(Math.round(amount))
}

/** The Chapter 4 finale: clearing it opens New Game+. */
export const FINAL_MISSION_ID = 'ch4-8'

export function ngPlusUnlocked(profile: Profile): boolean {
  return profile.completed.includes(FINAL_MISSION_ID)
}

/** Story missions cleared, ignoring the New Game+ ship scenes. */
export function campaignCleared(profile: Profile): number {
  return profile.completed.filter((id) => !id.startsWith('ng-')).length
}

export function unlockedSkins(profile: Profile): SurvivorSkinId[] {
  const cleared = campaignCleared(profile)
  const ngPlus = ngPlusUnlocked(profile)
  return SURVIVOR_SKINS.filter((s) => skinUnlocked(s, cleared, ngPlus, profile.ownedSkins)).map((s) => s.id)
}

/** Wipes the save entirely: progress, weapons, currency and survivors. */
export function freshProfile(): Profile {
  return blankProfile()
}

function blankProfile(): Profile {
  return {
    ...DEFAULT_PROFILE,
    owned: [...STARTER_WEAPONS],
    completed: [],
    ownedSkins: [],
    ownedGunSkins: [],
    gunSkins: { primary: null, secondary: null },
  }
}

export function clearProfile() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // storage unavailable (private mode) — nothing persisted to clear
  }
}

const DEFAULT_PROFILE: Profile = {
  zcoins: 0,
  scrap: 0,
  amber: 0,
  owned: [...STARTER_WEAPONS],
  primary: 'old-rifle',
  secondary: 'm9-sidearm',
  character: null,
  character2: null,
  players: 1,
  completed: [],
  textures: null,
  skin: null,
  ownedSkins: [],
  ownedGunSkins: [],
  gunSkins: { primary: null, secondary: null },
}

const count = (value: unknown): number => (typeof value === 'number' && value >= 0 ? Math.floor(value) : 0)

/** Saves written before Z-Coins carry Chips and Cores wallets; fold those in. Scrap and Amber stay separate. */
function readZCoins(record: Record<string, unknown>): number {
  if (typeof record.zcoins === 'number') return count(record.zcoins)
  return count(record.chips) * ZCOIN_RATE.chips + count(record.cores) * ZCOIN_RATE.cores
}

function readGunSkins(value: unknown, owned: GunSkinId[]): Profile['gunSkins'] {
  const out: Profile['gunSkins'] = { primary: null, secondary: null }
  if (typeof value !== 'object' || value === null) return out
  const record = value as Record<string, unknown>
  for (const slot of ['primary', 'secondary'] as const) {
    const id = record[slot]
    if (isGunSkinId(id) && owned.includes(id)) out[slot] = id
  }
  return out
}

function isWeaponId(value: unknown): value is WeaponId {
  return typeof value === 'string' && WEAPONS.some((w) => w.id === value)
}

function isCharacterId(value: unknown): value is CharacterId {
  return typeof value === 'string' && CHARACTERS.some((c) => c.id === value)
}

function isMissionId(value: unknown): value is string {
  return typeof value === 'string' && MISSIONS.some((m) => m.id === value)
}

function isTexturePack(value: unknown): value is TexturePack {
  return value === 'classic' || value === 'enhanced'
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return blankProfile()
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) throw new Error('bad profile')
    const record = parsed as Record<string, unknown>
    const owned = Array.isArray(record.owned) ? record.owned.filter(isWeaponId) : []
    for (const id of STARTER_WEAPONS) {
      if (!owned.includes(id)) owned.push(id)
    }
    // Older saves stored a single `equipped` weapon; keep it in its own slot.
    const legacy = isWeaponId(record.equipped) && owned.includes(record.equipped)
      ? record.equipped
      : null
    const pick = (slot: 'primary' | 'secondary', stored: unknown): WeaponId => {
      if (isWeaponId(stored) && owned.includes(stored) && weaponById(stored).slot === slot) {
        return stored
      }
      if (legacy && weaponById(legacy).slot === slot) return legacy
      return slot === 'primary' ? 'old-rifle' : 'm9-sidearm'
    }
    const ownedGunSkins = Array.isArray(record.ownedGunSkins) ? record.ownedGunSkins.filter(isGunSkinId) : []
    return {
      zcoins: readZCoins(record),
      scrap: count(record.scrap),
      amber: count(record.amber),
      owned,
      primary: pick('primary', record.primary),
      secondary: pick('secondary', record.secondary),
      character: isCharacterId(record.character) ? record.character : null,
      character2: isCharacterId(record.character2) ? record.character2 : null,
      players: record.players === 2 ? 2 : 1,
      completed: Array.isArray(record.completed) ? record.completed.filter(isMissionId) : [],
      textures: isTexturePack(record.textures) ? record.textures : null,
      skin: isSurvivorSkinId(record.skin) ? record.skin : null,
      ownedSkins: Array.isArray(record.ownedSkins) ? record.ownedSkins.filter(isSurvivorSkinId) : [],
      ownedGunSkins,
      gunSkins: readGunSkins(record.gunSkins, ownedGunSkins),
    }
  } catch {
    return blankProfile()
  }
}

type SaveListener = (profile: Profile) => void
const saveListeners: SaveListener[] = []

/** Notified after every local save, so the cloud layer can mirror it. */
export function onProfileSave(listener: SaveListener): void {
  saveListeners.push(listener)
}

export function saveProfile(profile: Profile) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
  } catch {
    // storage unavailable (private mode) — profile stays in memory only
  }
  for (const listener of saveListeners) listener(profile)
}

// Economy is deliberately tight: premium guns take several successful runs.
export const SCRAP_PER_KILL = 2
export const SCRAP_PER_BUG = 4
/** Arctic kills drop a chip each; chapter 1 kills never do. */
export const CHIPS_PER_KILL = 1

interface RewardMission {
  target: number
  survivors: number
  payout: number
  rewardBase?: number
  holdTime?: number
}

export function missionReward(mission: RewardMission): number {
  const base =
    (mission.rewardBase ?? 20) +
    mission.target * 2 +
    mission.survivors * 25 +
    Math.round((mission.holdTime ?? 0) / 2)
  return Math.round(base * mission.payout)
}

/** Completion bonus in Frozen Data Chips for a chapter 2 mission. */
export function missionChipReward(mission: RewardMission): number {
  const base = (mission.rewardBase ?? 20) + mission.target + Math.round((mission.holdTime ?? 0) / 6)
  return Math.round((base * mission.payout) / 5)
}

/** Completion bonus in Ancient Amber for a chapter 3 mission. */
export function missionAmberReward(mission: RewardMission): number {
  const base = (mission.rewardBase ?? 20) + mission.target
  return Math.round((base * mission.payout) / 6)
}

/** Completion bonus in Rust Cores for a chapter 4 mission. */
export function missionCoreReward(mission: RewardMission): number {
  const base = (mission.rewardBase ?? 20) + mission.target
  return Math.round((base * mission.payout) / 7)
}
