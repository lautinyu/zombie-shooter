import type { CharacterId } from './characters'
import { CHARACTERS } from './characters'
import { MISSIONS } from './missions'
import type { TexturePack } from './theme'
import type { WeaponId } from './weapons'
import { STARTER_WEAPONS, WEAPONS, weaponById } from './weapons'

const STORAGE_KEY = 'zombie-shooter-profile-v1'

export interface Profile {
  scrap: number
  /** Chapter 2 currency, earned only in the arctic missions. */
  chips: number
  /** Chapter 3 currency, awarded only for clearing jungle stages. */
  amber: number
  /** Chapter 4 currency, salvaged only in the Rustlands. */
  cores: number
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
}

/** The Chapter 4 finale: clearing it opens New Game+. */
export const FINAL_MISSION_ID = 'ch4-8'

export function ngPlusUnlocked(profile: Profile): boolean {
  return profile.completed.includes(FINAL_MISSION_ID)
}

/** Wipes the save entirely: progress, weapons, currency and survivors. */
export function freshProfile(): Profile {
  return { ...DEFAULT_PROFILE, owned: [...STARTER_WEAPONS], completed: [] }
}

export function clearProfile() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // storage unavailable (private mode) — nothing persisted to clear
  }
}

const DEFAULT_PROFILE: Profile = {
  scrap: 0,
  chips: 0,
  amber: 0,
  cores: 0,
  owned: [...STARTER_WEAPONS],
  primary: 'old-rifle',
  secondary: 'm9-sidearm',
  character: null,
  character2: null,
  players: 1,
  completed: [],
  textures: null,
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
    if (!raw) return { ...DEFAULT_PROFILE, owned: [...STARTER_WEAPONS], completed: [] }
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
    return {
      scrap: typeof record.scrap === 'number' && record.scrap >= 0 ? Math.floor(record.scrap) : 0,
      chips: typeof record.chips === 'number' && record.chips >= 0 ? Math.floor(record.chips) : 0,
      // Saves written before chapter 3 simply have no amber yet.
      amber: typeof record.amber === 'number' && record.amber >= 0 ? Math.floor(record.amber) : 0,
      // Saves written before chapter 4 simply have no cores yet.
      cores: typeof record.cores === 'number' && record.cores >= 0 ? Math.floor(record.cores) : 0,
      owned,
      primary: pick('primary', record.primary),
      secondary: pick('secondary', record.secondary),
      character: isCharacterId(record.character) ? record.character : null,
      character2: isCharacterId(record.character2) ? record.character2 : null,
      players: record.players === 2 ? 2 : 1,
      completed: Array.isArray(record.completed) ? record.completed.filter(isMissionId) : [],
      textures: isTexturePack(record.textures) ? record.textures : null,
    }
  } catch {
    return { ...DEFAULT_PROFILE, owned: [...STARTER_WEAPONS], completed: [] }
  }
}

export function saveProfile(profile: Profile) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
  } catch {
    // storage unavailable (private mode) — profile stays in memory only
  }
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
