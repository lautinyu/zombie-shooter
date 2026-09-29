/**
 * Firebase wiring. Every value comes from Vite env vars so no project config
 * lives in the source tree; with none set the game simply stays offline and
 * the account UI falls back to guest mode.
 */
import { type FirebaseApp, initializeApp } from 'firebase/app'
import { type Auth, getAuth } from 'firebase/auth'
import { type Firestore, getFirestore } from 'firebase/firestore'

const CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

/** Without an api key and project id there is nothing to talk to. */
export function firebaseConfigured(): boolean {
  return Boolean(CONFIG.apiKey && CONFIG.projectId && CONFIG.appId)
}

let app: FirebaseApp | null = null
let authRef: Auth | null = null
let dbRef: Firestore | null = null

function ensureApp(): FirebaseApp {
  if (!firebaseConfigured()) throw new Error('Firebase is not configured on this build.')
  if (!app) app = initializeApp(CONFIG)
  return app
}

export function auth(): Auth {
  if (!authRef) authRef = getAuth(ensureApp())
  return authRef
}

export function db(): Firestore {
  if (!dbRef) dbRef = getFirestore(ensureApp())
  return dbRef
}
