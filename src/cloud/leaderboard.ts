/**
 * Global Endless Horde leaderboard. Each signed-in player owns one document,
 * `hordeLeaderboard/{uid}`, holding their best run (most waves, then most
 * kills). Anyone can read the board; guests simply never post to it.
 */
import { collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc } from 'firebase/firestore'
import { currentAccount } from './account'
import { db, firebaseConfigured } from './firebase'

const COLLECTION = 'hordeLeaderboard'
/** Pulled wider than the board shows so kill-count tie-breaks stay correct. */
const FETCH_LIMIT = 40

export interface HordeRun {
  waves: number
  kills: number
  seconds: number
  className: string
}

export interface LeaderboardEntry extends HordeRun {
  username: string
  updatedAt: number
}

export type SubmitResult = 'offline' | 'guest' | 'posted' | 'not-best'

const better = (a: HordeRun, b: HordeRun) => a.waves > b.waves || (a.waves === b.waves && a.kills > b.kills)

const isEntry = (data: Partial<LeaderboardEntry>): data is LeaderboardEntry =>
  typeof data.username === 'string' &&
  typeof data.waves === 'number' &&
  typeof data.kills === 'number' &&
  typeof data.seconds === 'number' &&
  typeof data.className === 'string'

export function leaderboardAvailable(): boolean {
  return firebaseConfigured()
}

/** Posts the run if it beats the signed-in player's stored best. */
export async function submitHordeRun(run: HordeRun): Promise<SubmitResult> {
  if (!firebaseConfigured()) return 'offline'
  const account = currentAccount()
  if (!account) return 'guest'
  const ref = doc(db(), COLLECTION, account.uid)
  const existing = await getDoc(ref)
  const previous = existing.exists() ? (existing.data() as Partial<LeaderboardEntry>) : null
  if (previous && isEntry(previous) && !better(run, previous)) return 'not-best'
  const entry: LeaderboardEntry = {
    username: account.username,
    waves: Math.floor(run.waves),
    kills: Math.floor(run.kills),
    seconds: Math.floor(run.seconds),
    className: run.className,
    updatedAt: Date.now(),
  }
  await setDoc(ref, entry)
  return 'posted'
}

export async function topHordeRuns(count = 10): Promise<LeaderboardEntry[]> {
  if (!firebaseConfigured()) return []
  const snap = await getDocs(query(collection(db(), COLLECTION), orderBy('waves', 'desc'), limit(FETCH_LIMIT)))
  const entries: LeaderboardEntry[] = []
  snap.forEach((d) => {
    const data = d.data() as Partial<LeaderboardEntry>
    if (isEntry(data)) entries.push(data)
  })
  entries.sort((a, b) => b.waves - a.waves || b.kills - a.kills || a.seconds - b.seconds)
  return entries.slice(0, count)
}
