import type { Weapon } from './weapons'
import { onSettingsChange, settings } from './settings'

interface SoundProfile {
  startFreq: number
  endFreq: number
  duration: number
  type: OscillatorType
  gain: number
}

const PROFILES: Record<string, SoundProfile> = {
  'rusty-pistol': { startFreq: 320, endFreq: 90, duration: 0.09, type: 'square', gain: 0.12 },
  'old-rifle': { startFreq: 420, endFreq: 70, duration: 0.13, type: 'sawtooth', gain: 0.14 },
  'viper-smg': { startFreq: 540, endFreq: 180, duration: 0.05, type: 'square', gain: 0.08 },
  'hellfire-shotgun': { startFreq: 220, endFreq: 40, duration: 0.24, type: 'sawtooth', gain: 0.18 },
  'titan-sniper': { startFreq: 700, endFreq: 45, duration: 0.34, type: 'triangle', gain: 0.2 },
  'm9-sidearm': { startFreq: 380, endFreq: 120, duration: 0.07, type: 'square', gain: 0.1 },
  'combat-machete': { startFreq: 900, endFreq: 260, duration: 0.16, type: 'triangle', gain: 0.12 },
  'stun-baton': { startFreq: 1200, endFreq: 180, duration: 0.2, type: 'sawtooth', gain: 0.12 },
}

export type SfxId =
  | 'turret'
  | 'barricade'
  | 'overdrive'
  | 'medkit'
  | 'cloak'
  | 'groan'
  | 'sting'
  | 'boss-roar'
  | 'boss-dash'
  | 'explosion'
  | 'swap'
  | 'type'
  | 'katana'
  | 'drone-shot'
  | 'sniper'

const SFX: Record<SfxId, SoundProfile> = {
  turret: { startFreq: 180, endFreq: 620, duration: 0.28, type: 'square', gain: 0.14 },
  barricade: { startFreq: 150, endFreq: 60, duration: 0.32, type: 'sawtooth', gain: 0.16 },
  overdrive: { startFreq: 220, endFreq: 880, duration: 0.45, type: 'sawtooth', gain: 0.14 },
  medkit: { startFreq: 520, endFreq: 980, duration: 0.3, type: 'triangle', gain: 0.12 },
  cloak: { startFreq: 900, endFreq: 240, duration: 0.5, type: 'sine', gain: 0.12 },
  groan: { startFreq: 130, endFreq: 62, duration: 0.7, type: 'sawtooth', gain: 0.07 },
  sting: { startFreq: 980, endFreq: 300, duration: 0.16, type: 'square', gain: 0.12 },
  'boss-roar': { startFreq: 90, endFreq: 38, duration: 1.4, type: 'sawtooth', gain: 0.26 },
  'boss-dash': { startFreq: 420, endFreq: 110, duration: 0.5, type: 'square', gain: 0.2 },
  explosion: { startFreq: 260, endFreq: 24, duration: 1.9, type: 'sawtooth', gain: 0.32 },
  swap: { startFreq: 300, endFreq: 700, duration: 0.12, type: 'square', gain: 0.1 },
  type: { startFreq: 640, endFreq: 520, duration: 0.03, type: 'square', gain: 0.03 },
  katana: { startFreq: 2400, endFreq: 380, duration: 0.18, type: 'triangle', gain: 0.1 },
  'drone-shot': { startFreq: 1500, endFreq: 900, duration: 0.04, type: 'square', gain: 0.035 },
  sniper: { startFreq: 1300, endFreq: 140, duration: 0.12, type: 'sawtooth', gain: 0.16 },
}

/** Extra voices stacked under a base effect so signature sounds read as heavier. */
const LAYERS: Partial<Record<SfxId, SoundProfile[]>> = {
  katana: [{ startFreq: 5200, endFreq: 1800, duration: 0.12, type: 'sine', gain: 0.05 }],
  sniper: [
    { startFreq: 160, endFreq: 32, duration: 0.6, type: 'sine', gain: 0.3 },
    { startFreq: 480, endFreq: 60, duration: 0.32, type: 'triangle', gain: 0.12 },
  ],
}
/** Campaign weapons that share a signature effect instead of a plain blip. */
const SIGNATURE: Record<string, SfxId> = { 'titan-sniper': 'sniper' }

export type MusicTrack = 'menu' | 'battle' | 'boss' | 'gameover' | 'victory' | 'story'

/** Note tables are semitone offsets from A2, played as a looping bass riff. */
const TRACKS: Record<MusicTrack, { notes: number[]; step: number; loop: boolean; type: OscillatorType; lead: boolean }> = {
  menu: { notes: [0, 3, 7, 3, 5, 3, 0, -2], step: 0.42, loop: true, type: 'triangle', lead: false },
  battle: { notes: [0, 0, 7, 0, 5, 0, 3, 0, 0, 0, 8, 7], step: 0.2, loop: true, type: 'sawtooth', lead: true },
  boss: { notes: [-5, -5, -2, -5, 2, 1, 0, -5, -5, -5, 3, 2], step: 0.17, loop: true, type: 'sawtooth', lead: true },
  gameover: { notes: [7, 5, 3, 0, -2, -5], step: 0.55, loop: false, type: 'triangle', lead: false },
  victory: { notes: [0, 4, 7, 12, 7, 12], step: 0.22, loop: false, type: 'square', lead: false },
  // Slow, atmospheric drone under the story cutscenes.
  story: { notes: [-12, -12, -5, -8, -12, -10, -7, -12], step: 1.1, loop: true, type: 'sine', lead: false },
}

const A2 = 110

let context: AudioContext | null = null
let master: GainNode | null = null
let musicGain: GainNode | null = null
let sfxGain: GainNode | null = null
let musicTimer: number | null = null
let currentTrack: MusicTrack | null = null
/** Set on the first user gesture; a context built before that stays suspended. */
let unlocked = false

function ensureContext(): AudioContext | null {
  if (context) return context
  const Ctor = window.AudioContext
  if (!Ctor || !unlocked) return null
  context = new Ctor()
  master = context.createGain()
  master.gain.value = 0.9
  master.connect(context.destination)
  musicGain = context.createGain()
  musicGain.gain.value = settings().bgmVolume
  musicGain.connect(master)
  sfxGain = context.createGain()
  sfxGain.gain.value = settings().sfxVolume
  sfxGain.connect(master)
  return context
}

/** Slider moves land on the live buses, so volume changes are audible at once. */
onSettingsChange((s) => {
  if (musicGain) musicGain.gain.value = s.bgmVolume
  if (sfxGain) sfxGain.gain.value = s.sfxVolume
})

/** Browsers hold the context suspended until the first gesture. */
export function resumeAudio() {
  unlocked = true
  const ctx = ensureContext()
  if (ctx && ctx.state === 'suspended') void ctx.resume()
}

function blip(profile: SoundProfile, destination: AudioNode, when: number, ctx: AudioContext) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = profile.type
  osc.frequency.setValueAtTime(profile.startFreq, when)
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, profile.endFreq), when + profile.duration)
  gain.gain.setValueAtTime(profile.gain, when)
  gain.gain.exponentialRampToValueAtTime(0.001, when + profile.duration)
  osc.connect(gain).connect(destination)
  osc.start(when)
  osc.stop(when + profile.duration)
}

export function playShot(weapon: Weapon) {
  const ctx = ensureContext()
  if (!ctx || !sfxGain) return
  const signature = SIGNATURE[weapon.id]
  if (signature) {
    playSfx(signature)
    return
  }
  resumeAudio()
  blip(PROFILES[weapon.id] ?? PROFILES['rusty-pistol'], sfxGain, ctx.currentTime, ctx)
}

export function playSfx(id: SfxId) {
  const ctx = ensureContext()
  if (!ctx || !sfxGain) return
  resumeAudio()
  blip(SFX[id], sfxGain, ctx.currentTime, ctx)
  for (const layer of LAYERS[id] ?? []) blip(layer, sfxGain, ctx.currentTime, ctx)
}

function noteFreq(semitones: number): number {
  return A2 * Math.pow(2, semitones / 12)
}

function scheduleTrack(track: MusicTrack) {
  const ctx = ensureContext()
  if (!ctx || !musicGain) return
  const spec = TRACKS[track]
  let index = 0
  let next = ctx.currentTime + 0.05

  const tick = () => {
    if (currentTrack !== track || !ctx || !musicGain) return
    // Schedule a little ahead of the clock so the loop never gaps.
    while (next < ctx.currentTime + 0.35) {
      if (index >= spec.notes.length) {
        if (!spec.loop) {
          currentTrack = null
          return
        }
        index = 0
      }
      const semi = spec.notes[index]
      blip(
        { startFreq: noteFreq(semi), endFreq: noteFreq(semi) * 0.98, duration: spec.step * 0.9, type: spec.type, gain: 0.2 },
        musicGain,
        next,
        ctx
      )
      if (spec.lead && index % 4 === 0) {
        blip(
          { startFreq: noteFreq(semi + 12), endFreq: noteFreq(semi + 12), duration: spec.step * 0.4, type: 'square', gain: 0.07 },
          musicGain,
          next,
          ctx
        )
      }
      next += spec.step
      index += 1
    }
    musicTimer = window.setTimeout(tick, 90)
  }
  tick()
}

export function playMusic(track: MusicTrack) {
  const ctx = ensureContext()
  if (!ctx) return
  resumeAudio()
  if (currentTrack === track) return
  stopMusic()
  currentTrack = track
  scheduleTrack(track)
}

export function stopMusic() {
  if (musicTimer !== null) {
    window.clearTimeout(musicTimer)
    musicTimer = null
  }
  currentTrack = null
}
