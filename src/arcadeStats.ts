/**
 * Shared localStorage bookkeeping for the arcade cabinets: high scores, games
 * played, and the gauntlet's own distance/kill ledger.
 */

export type ArcadeGameId =
  | 'crimson-highway'
  | 'void-blast'
  | 'endless-gauntlet'
  | 'rot-fighter'
  | 'endless-horde'
  | 'riot-stage'

/** High score keys predate this module, so their names are kept as-is. */
const HIGH_SCORE_KEYS: Record<ArcadeGameId, string> = {
  'crimson-highway': 'crimson-highway-highscore-v1',
  'void-blast': 'void-blast-highscore-v1',
  'endless-gauntlet': 'endless-gauntlet-highscore-v1',
  'rot-fighter': 'rot-fighter-highscore-v1',
  'endless-horde': 'endless-horde-best-seconds-v1',
  'riot-stage': 'riot-stage-highscore-v1',
}

const PLAY_COUNT_KEYS: Record<ArcadeGameId, string> = {
  'crimson-highway': 'crimson-highway-plays-v1',
  'void-blast': 'void-blast-plays-v1',
  'endless-gauntlet': 'endless-gauntlet-plays-v1',
  'rot-fighter': 'rot-fighter-plays-v1',
  'endless-horde': 'endless-horde-plays-v1',
  'riot-stage': 'riot-stage-plays-v1',
}

export const GAUNTLET_STATS_KEY = 'ZOMBIE_ARCADE_GAUNTLET_STATS'

export interface GauntletStats {
  /** Furthest distance reached in a single run, in metres. */
  maxDistance: number
  /** Lifetime zombies put down across every run. */
  zombiesKilled: number
}

type ChangeListener = () => void
const changeListeners: ChangeListener[] = []

/** Notified whenever a cabinet record changes, so the cloud can mirror it. */
export function onArcadeChange(listener: ChangeListener): void {
  changeListeners.push(listener)
}

function notifyArcadeChange(): void {
  for (const listener of changeListeners) listener()
}

function readNumber(key: string): number {
  const raw = window.localStorage.getItem(key)
  const value = raw === null ? 0 : Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function highScore(game: ArcadeGameId): number {
  return readNumber(HIGH_SCORE_KEYS[game])
}

export function gamesPlayed(game: ArcadeGameId): number {
  return readNumber(PLAY_COUNT_KEYS[game])
}

/** Called when a run starts, so the hub can show how often a cabinet is fed. */
export function recordPlay(game: ArcadeGameId): void {
  window.localStorage.setItem(PLAY_COUNT_KEYS[game], `${gamesPlayed(game) + 1}`)
  notifyArcadeChange()
}

/** Stores a finished run's score and reports whether it beat the record. */
export function submitScore(game: ArcadeGameId, score: number): boolean {
  const best = highScore(game)
  const value = Math.floor(score)
  if (value <= best) return false
  window.localStorage.setItem(HIGH_SCORE_KEYS[game], `${value}`)
  notifyArcadeChange()
  return true
}

/** Drops every cabinet record and play count, for a full save wipe. */
export function clearArcadeStats(): void {
  for (const key of [...Object.values(HIGH_SCORE_KEYS), ...Object.values(PLAY_COUNT_KEYS)]) {
    window.localStorage.removeItem(key)
  }
  window.localStorage.removeItem(GAUNTLET_STATS_KEY)
}

/** Every cabinet record in one object, for the cloud save payload. */
export interface ArcadeSnapshot {
  highScores: Partial<Record<ArcadeGameId, number>>
  plays: Partial<Record<ArcadeGameId, number>>
  gauntlet: GauntletStats
}

export function arcadeSnapshot(): ArcadeSnapshot {
  const highScores: Partial<Record<ArcadeGameId, number>> = {}
  const plays: Partial<Record<ArcadeGameId, number>> = {}
  for (const game of Object.keys(HIGH_SCORE_KEYS) as ArcadeGameId[]) {
    highScores[game] = highScore(game)
    plays[game] = gamesPlayed(game)
  }
  return { highScores, plays, gauntlet: readGauntletStats() }
}

/** Applies a cloud snapshot, keeping whichever record is the better one. */
export function applyArcadeSnapshot(snapshot: ArcadeSnapshot): void {
  for (const game of Object.keys(HIGH_SCORE_KEYS) as ArcadeGameId[]) {
    const score = snapshot.highScores[game]
    if (typeof score === 'number' && score > highScore(game)) {
      window.localStorage.setItem(HIGH_SCORE_KEYS[game], `${Math.floor(score)}`)
    }
    const played = snapshot.plays[game]
    if (typeof played === 'number' && played > gamesPlayed(game)) {
      window.localStorage.setItem(PLAY_COUNT_KEYS[game], `${Math.floor(played)}`)
    }
  }
  const cloud = snapshot.gauntlet
  if (cloud && typeof cloud.maxDistance === 'number') {
    const local = readGauntletStats()
    const merged: GauntletStats = {
      maxDistance: Math.max(local.maxDistance, Math.floor(cloud.maxDistance)),
      zombiesKilled: Math.max(local.zombiesKilled, Math.floor(cloud.zombiesKilled ?? 0)),
    }
    window.localStorage.setItem(GAUNTLET_STATS_KEY, JSON.stringify(merged))
  }
}

export function readGauntletStats(): GauntletStats {
  const raw = window.localStorage.getItem(GAUNTLET_STATS_KEY)
  if (raw === null) return { maxDistance: 0, zombiesKilled: 0 }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return { maxDistance: 0, zombiesKilled: 0 }
    const record = parsed as Record<string, unknown>
    const distance = typeof record.maxDistance === 'number' ? record.maxDistance : 0
    const killed = typeof record.zombiesKilled === 'number' ? record.zombiesKilled : 0
    return { maxDistance: Math.max(0, Math.floor(distance)), zombiesKilled: Math.max(0, Math.floor(killed)) }
  } catch {
    return { maxDistance: 0, zombiesKilled: 0 }
  }
}

/** Folds one run into the lifetime ledger: best distance, total kills. */
export function saveGauntletRun(distance: number, kills: number): GauntletStats {
  const prev = readGauntletStats()
  const next: GauntletStats = {
    maxDistance: Math.max(prev.maxDistance, Math.floor(distance)),
    zombiesKilled: prev.zombiesKilled + Math.max(0, Math.floor(kills)),
  }
  window.localStorage.setItem(GAUNTLET_STATS_KEY, JSON.stringify(next))
  notifyArcadeChange()
  return next
}
