/**
 * bonk.io-style accounts: the player types a username and a password, and the
 * username is mapped to a synthetic email for Firebase Auth. Progress is
 * mirrored into Firestore under `users/{uid}` on top of the usual localStorage
 * save, so signing in on another device restores the same campaign.
 */
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import { doc, getDoc, runTransaction, setDoc } from 'firebase/firestore'
import { auth, db, firebaseConfigured } from './firebase'
import { PROFILE_KEY, loadProfile, onProfileSave, type Profile } from '../profile'
import { SETTINGS_KEY, onSettingsChange, settings } from '../settings'
import type { Settings } from '../settings'
import {
  applyArcadeSnapshot,
  arcadeSnapshot,
  onArcadeChange,
  type ArcadeSnapshot,
} from '../arcadeStats'

/** Every account's email is derived from its username; players never see it. */
export const EMAIL_DOMAIN = '@zshooter.com'

export const PASSWORD_WARNING = 'Keep your password safe! No email recovery available.'

export const USERNAME_MIN = 3
export const USERNAME_MAX = 16
const USERNAME_PATTERN = /^[a-z0-9_]+$/

export function usernameToEmail(username: string): string {
  return `${username.toLowerCase()}${EMAIL_DOMAIN}`
}

/** Null when the name is usable, otherwise the reason to show the player. */
export function usernameProblem(username: string): string | null {
  const name = username.trim()
  if (name.length < USERNAME_MIN) return `Username needs at least ${USERNAME_MIN} characters.`
  if (name.length > USERNAME_MAX) return `Username can be at most ${USERNAME_MAX} characters.`
  if (!USERNAME_PATTERN.test(name.toLowerCase())) {
    return 'Use letters, numbers and underscores only.'
  }
  return null
}

export interface CloudSave {
  /** Display form of the name, as typed at registration. */
  username: string
  profile: Profile
  settings: Settings
  arcade: ArcadeSnapshot
  updatedAt: number
}

export interface Account {
  uid: string
  username: string
}

type AccountListener = (account: Account | null) => void

let account: Account | null = null
let started = false
let pending: ReturnType<typeof setTimeout> | null = null
const listeners: AccountListener[] = []

export function cloudAvailable(): boolean {
  return firebaseConfigured()
}

export function currentAccount(): Account | null {
  return account
}

/** Subscribes to login/logout; fires once immediately with the current state. */
export function onAccountChange(listener: AccountListener): void {
  listeners.push(listener)
  listener(account)
}

function emit(): void {
  for (const listener of listeners) listener(account)
}

function localSnapshot(username: string): CloudSave {
  return {
    username,
    profile: loadProfile(),
    settings: settings(),
    arcade: arcadeSnapshot(),
    updatedAt: Date.now(),
  }
}

/**
 * Immediately overwrites the signed-in cloud save with the local one, so a
 * data reset is not undone by the next cloud hydration.
 */
export async function overwriteCloudSave(): Promise<void> {
  if (pending) clearTimeout(pending)
  pending = null
  const uid = account?.uid
  const name = account?.username
  if (!uid || !name || !cloudAvailable()) return
  await setDoc(doc(db(), 'users', uid), localSnapshot(name)).catch(() => {
    // Offline or rules-denied: the local wipe still stands.
  })
}

/** Writes the whole local save to `users/{uid}`, debounced to one write/sec. */
export function pushCloudSave(): void {
  if (!account || !cloudAvailable()) return
  if (pending) clearTimeout(pending)
  pending = setTimeout(() => {
    pending = null
    const uid = account?.uid
    const name = account?.username
    if (!uid || !name) return
    void setDoc(doc(db(), 'users', uid), localSnapshot(name)).catch(() => {
      // Offline or rules-denied: localStorage already holds the save.
    })
  }, 1000)
}

/**
 * Guards the one reload a hydration is allowed to do. `loadProfile()`
 * normalises and back-fills fields, so a cloud document written by an older
 * build never compares equal to the local save and would otherwise reload
 * forever.
 */
function hydratedThisSession(uid: string): boolean {
  const key = `zs-cloud-hydrated:${uid}`
  if (window.sessionStorage.getItem(key)) return true
  window.sessionStorage.setItem(key, '1')
  return false
}

/** Overwrites the local save with the cloud document. */
function applyCloudSave(save: CloudSave): void {
  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(save.profile))
  if (save.settings) {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(save.settings))
  }
  if (save.arcade) applyArcadeSnapshot(save.arcade)
}

async function loadCloudSave(uid: string): Promise<CloudSave | null> {
  const snap = await getDoc(doc(db(), 'users', uid))
  if (!snap.exists()) return null
  const data = snap.data() as Partial<CloudSave>
  if (!data.profile) return null
  return data as CloudSave
}

/**
 * Pulls the account's save down and swaps it in. A reload is the cleanest way
 * to rebuild menus, loadouts and HUD from a save that arrived mid-session.
 */
async function hydrate(uid: string, username: string): Promise<void> {
  const save = await loadCloudSave(uid)
  if (save) {
    applyCloudSave(save)
    if (!hydratedThisSession(uid)) window.location.reload()
    return
  }
  // First sign-in on a fresh account: seed the cloud from what is on disk.
  await setDoc(doc(db(), 'users', uid), localSnapshot(username))
}

function usernameDoc(username: string) {
  return doc(db(), 'usernames', username.toLowerCase())
}

/** Case-insensitive availability check against the `usernames` collection. */
export async function usernameAvailable(username: string): Promise<boolean> {
  const snap = await getDoc(usernameDoc(username))
  return !snap.exists()
}

function authMessage(error: unknown): string {
  const code = (error as { code?: string }).code ?? ''
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
    return 'Wrong username or password.'
  }
  if (code === 'auth/user-not-found') return 'No account with that username.'
  if (code === 'auth/email-already-in-use') return 'That username is already taken.'
  if (code === 'auth/weak-password') return 'Password needs at least 6 characters.'
  if (code === 'auth/network-request-failed') return 'Network unavailable — playing offline.'
  if (code === 'auth/too-many-requests') return 'Too many attempts. Try again in a minute.'
  if (code === 'permission-denied') return 'Cloud save rejected the request. Check Firestore rules.'
  return error instanceof Error ? error.message : 'Something went wrong.'
}

export async function register(username: string, password: string): Promise<Account> {
  const problem = usernameProblem(username)
  if (problem) throw new Error(problem)
  const name = username.trim()
  try {
    if (!(await usernameAvailable(name))) throw new Error('That username is already taken.')
    const credential = await createUserWithEmailAndPassword(
      auth(),
      usernameToEmail(name),
      password,
    )
    const uid = credential.user.uid
    // Reserve the lowercase name so a second sign-up cannot claim it.
    await runTransaction(db(), async (tx) => {
      const ref = usernameDoc(name)
      const existing = await tx.get(ref)
      if (existing.exists()) throw new Error('That username is already taken.')
      tx.set(ref, { uid, username: name, createdAt: Date.now() })
    })
    account = { uid, username: name }
    await setDoc(doc(db(), 'users', uid), localSnapshot(name))
    emit()
    return account
  } catch (error) {
    throw new Error(authMessage(error))
  }
}

export async function login(username: string, password: string): Promise<Account> {
  const name = username.trim()
  if (!name || !password) throw new Error('Enter a username and password.')
  try {
    const credential = await signInWithEmailAndPassword(auth(), usernameToEmail(name), password)
    account = { uid: credential.user.uid, username: name }
    emit()
    await hydrate(account.uid, name)
    return account
  } catch (error) {
    throw new Error(authMessage(error))
  }
}

export async function logout(): Promise<void> {
  if (!cloudAvailable()) return
  const uid = account?.uid
  await signOut(auth())
  if (uid) window.sessionStorage.removeItem(`zs-cloud-hydrated:${uid}`)
  account = null
  emit()
}

/**
 * Restores the session from Firebase's own persistence and starts mirroring
 * every local save into Firestore. Safe to call when Firebase is unconfigured:
 * the game then stays in guest mode on localStorage alone.
 */
export function startCloudSync(): void {
  if (started) return
  started = true
  onProfileSave(() => pushCloudSave())
  onSettingsChange(() => pushCloudSave())
  onArcadeChange(() => pushCloudSave())
  if (!cloudAvailable()) return
  onAuthStateChanged(auth(), (user) => {
    if (!user) {
      account = null
      emit()
      return
    }
    const email = user.email ?? ''
    account = { uid: user.uid, username: email.replace(EMAIL_DOMAIN, '') }
    emit()
    void loadCloudSave(user.uid)
      .then((save) => {
        if (!save) return
        // Another device may have played on this account since this browser
        // last ran; the cloud copy wins unless this one is further ahead.
        const local = loadProfile()
        if (save.profile.completed.length < local.completed.length) {
          pushCloudSave()
          return
        }
        if (JSON.stringify(save.profile) === JSON.stringify(local)) return
        applyCloudSave(save)
        if (!hydratedThisSession(user.uid)) window.location.reload()
      })
      .catch(() => {
        // Offline start: keep playing on the local save.
      })
  })
}
