import './style.css'
import { Game } from './game'
import type { GameState, Hud } from './game'
import {
  BOSSES_REQUIRED,
  CHAPTERS,
  MISSIONS,
  PATHS,
  bossesDefeated,
  chapterMissions,
  chapterUnlocked,
  missionMapName,
  missionUnlocked,
  pathComplete,
  pathMissions,
} from './missions'
import type { ChapterId, Mission, PathInfo } from './missions'
import { RadarChart } from './radar'
import { APP_VERSION } from './version'
import {
  chapterFourWeapons,
  chapterThreeWeapons,
  chapterTwoWeapons,
  weaponById,
  weaponsInSlot,
} from './weapons'
import type { Weapon, WeaponId, WeaponSlot } from './weapons'
import {
  loadProfile,
  missionAmberReward,
  missionChipReward,
  missionCoreReward,
  missionReward,
  ngPlusUnlocked,
  saveProfile,
  startNgPlus,
} from './profile'
import { CHARACTERS, characterById } from './characters'
import type { CharacterId } from './characters'
import { TEXTURE_PACKS } from './theme'
import type { TexturePack } from './theme'
import { playMusic, resumeAudio, stopMusic } from './audio'
import { playBossDialogue, playOutro, playStoryIntro } from './cutscene'
import { CHEAT_CURRENCY, bindCheatCodes } from './cheats'
import { mountArcade } from './arcade'
import { mountVoidBlast } from './voidblast'
import { mountEndlessGauntlet } from './EndlessGauntlet'
import { mountFightingArcade } from './FightingArcade'
import { mountArcadeHub } from './ArcadeHubScene'
import { mountSettings } from './SettingsModal'
import { onSettingsChange } from './settings'
import type { ArcadeGameId } from './arcadeStats'

declare global {
  interface Window {
    /** Dev-only handle so smoke tests can read entity positions. */
    game?: Game
  }
}

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('#app container missing')

app.innerHTML = `
  <canvas id="scene" class="absolute inset-0 block cursor-none"></canvas>

  <!-- HUD -->
  <div id="hud" class="pointer-events-none absolute inset-0 hidden select-none text-white">
    <div class="absolute left-5 top-5 w-80 space-y-3">
      <div id="player-panels" class="space-y-2"></div>

      <div class="rounded-lg bg-black/60 p-3 ring-1 ring-white/10">
        <div id="mission-name" class="text-sm font-bold text-white">Mission</div>
        <div class="mt-0.5 flex items-center justify-between text-xs text-slate-300">
          <span id="mission-zone">Map</span>
          <span id="kill-text" class="font-mono">0/0</span>
        </div>
        <div class="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
          <div id="mission-bar" class="h-full w-0 rounded-full bg-red-500 transition-[width] duration-200"></div>
        </div>
        <div id="objective-text" class="mt-2 text-xs text-slate-400"></div>
        <div id="survivor-panel" class="mt-3 hidden border-t border-white/10 pt-2">
          <div class="text-xs font-semibold uppercase tracking-wider text-slate-200">Survivors</div>
          <div id="survivor-list" class="mt-1.5 space-y-1.5"></div>
        </div>
      </div>

      <div class="rounded-lg bg-black/60 p-3 ring-1 ring-white/10">
        <div class="flex items-center justify-between">
          <span id="hud-weapon" class="text-sm font-bold text-white">Rusty Pistol</span>
          <span id="hud-scrap" class="font-mono text-xs font-bold text-yellow-300">+0 scrap</span>
        </div>
        <div id="hud-perk" class="mt-0.5 text-xs font-semibold text-sky-300"></div>
      </div>
    </div>

    <!--
      Every centred readout lives in this one column: siblings stack in flow
      instead of fighting over the same absolute slot, so nothing can overlap.
    -->
    <div class="absolute left-1/2 top-4 z-40 flex w-3/4 max-w-2xl -translate-x-1/2 flex-col items-center gap-2 [isolation:isolate]">
      <div class="rounded-md bg-black/50 px-3 py-1 text-xs uppercase tracking-widest text-slate-300">
        <span id="current-zone">The Streets</span>
      </div>

      <div id="hold-timer" class="hidden rounded-xl bg-black/70 px-8 py-2 text-center ring-2 ring-cyan-400/60">
        <div class="text-[11px] font-black uppercase tracking-[0.3em] text-cyan-300">Hold the Line</div>
        <div id="hold-clock" class="font-mono text-5xl font-black text-white">2:00</div>
      </div>

      <div id="generator-bar" class="hidden w-full">
        <div class="flex items-baseline justify-between text-xs font-black uppercase tracking-widest">
          <span class="text-cyan-300">Generator</span>
          <span id="generator-text" class="text-slate-300"></span>
        </div>
        <div class="mt-1 h-4 w-full overflow-hidden rounded-md bg-black/70 ring-2 ring-cyan-500/60">
          <div id="generator-fill" class="h-full w-full bg-gradient-to-r from-cyan-400 to-sky-600"></div>
        </div>
      </div>

      <div id="truck-bar" class="hidden w-full">
        <div class="flex items-baseline justify-between text-xs font-black uppercase tracking-widest">
          <span class="text-orange-300">TRUCK INTEGRITY</span>
          <span id="truck-text" class="text-slate-300"></span>
        </div>
        <div class="mt-1 h-5 w-full overflow-hidden rounded-md bg-black/70 ring-2 ring-orange-500/60">
          <div id="truck-fill" class="h-full w-full bg-gradient-to-r from-amber-400 to-orange-600"></div>
        </div>
      </div>

      <div id="boss-bar" class="hidden w-full flex-col [isolation:isolate]">
        <div id="boss-name" class="w-full truncate text-center text-xl font-bold uppercase tracking-wider text-orange-300 drop-shadow-[0_2px_3px_rgba(0,0,0,0.9)]">The Hive Mother</div>
        <div class="mt-1 h-6 w-full overflow-hidden rounded border-2 border-red-800 bg-gray-900">
          <div id="boss-fill" class="h-full w-full bg-gradient-to-r from-orange-500 to-red-600"></div>
        </div>
        <div class="mt-1 flex justify-between font-mono text-sm">
          <span id="boss-phase" class="text-amber-300"></span>
          <span id="boss-hp" class="text-slate-300"></span>
        </div>
      </div>

      <div id="jungle-bar" class="hidden w-full">
        <div class="flex items-baseline justify-between text-xs font-black uppercase tracking-widest">
          <span id="jungle-label" class="text-lime-300">Objective</span>
          <span id="jungle-text" class="text-slate-300"></span>
        </div>
        <div class="mt-1 h-4 w-full overflow-hidden rounded-md bg-black/70 ring-2 ring-lime-500/60">
          <div id="jungle-fill" class="h-full w-0 bg-gradient-to-r from-lime-400 to-emerald-600"></div>
        </div>
      </div>

      <div id="mutation-bar" class="hidden w-full rounded-md bg-black/70 px-4 py-2 text-center ring-2 ring-lime-500/60">
        <div id="mutation-title" class="text-sm font-black uppercase tracking-widest text-lime-300"></div>
        <div id="mutation-blurb" class="mt-0.5 text-[11px] text-slate-300"></div>
        <div class="mt-1 h-1.5 w-full overflow-hidden rounded bg-black/70">
          <div id="mutation-fill" class="h-full w-full bg-lime-400"></div>
        </div>
      </div>
    </div>

    <div class="menu-version absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/50 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-400"></div>

    <div id="hud-controls" class="absolute left-5 bottom-5 rounded-md bg-black/50 px-3 py-2 text-[11px] leading-relaxed text-slate-400">
      WASD / Arrows to move · Mouse to aim · Left click to shoot · R to reload
    </div>
  </div>

  <!-- Intro splash -->
  <div id="intro" class="absolute inset-0 z-30 hidden items-center justify-center bg-slate-950 p-6">
    <div class="w-full max-w-3xl text-center">
      <h1 class="text-5xl font-black tracking-tight text-emerald-400 drop-shadow">ZOMBIE SHOOTER</h1>
      <p class="mt-3 text-sm text-slate-400">Pick a texture pack. Physics, movement and combat are identical &mdash; only the art changes.</p>
      <div id="intro-packs" class="mt-8 grid gap-4 md:grid-cols-2"></div>
      <p class="mt-6 text-xs text-slate-500">You can switch packs any time from the main menu.</p>
    </div>
  </div>

  <!-- Main menu -->
  <div id="menu" class="absolute inset-0 h-screen max-h-screen flex-col overflow-hidden bg-slate-950/95">
    <header class="sticky top-0 z-50 shrink-0 border-b border-white/10 bg-slate-950/90 px-6 pb-3 pt-4 backdrop-blur-md">
      <div class="mx-auto w-full max-w-4xl">
        <h1 class="text-center text-4xl font-black tracking-tight text-emerald-400 drop-shadow">ZOMBIE SHOOTER</h1>
        <div class="menu-version absolute left-6 top-5 font-mono text-xs font-bold text-slate-500"></div>
        <button id="profile-chip" class="absolute right-6 top-4 flex items-center gap-2 rounded-full bg-white/5 py-1.5 pl-2 pr-4 text-sm font-bold text-slate-200 ring-1 ring-white/15 hover:bg-white/10" title="Profile / Settings">
          <span id="profile-avatar" class="text-xl leading-none">🧟</span>
          <span id="profile-name-label">Set Profile</span>
        </button>
        <div class="mt-2 text-center text-sm font-bold text-yellow-300">Scrap: <span id="menu-scrap">0</span>
          <span class="ml-3 text-cyan-300">Frozen Data Chips: <span id="menu-chips">0</span></span>
          <span class="ml-3 text-amber-400">Ancient Amber: <span id="menu-amber">0</span></span>
          <span class="ml-3 text-orange-400">Rust Cores: <span id="menu-cores">0</span></span>
        </div>
        <nav class="mt-3 flex flex-wrap justify-center gap-3">
          <button id="shop-btn" class="rounded-lg bg-yellow-500/15 px-6 py-2 text-sm font-bold text-yellow-300 ring-1 ring-yellow-400/40 hover:bg-yellow-500/25">Weapons Shop</button>
          <button id="locker-btn" class="rounded-lg bg-sky-500/15 px-6 py-2 text-sm font-bold text-sky-300 ring-1 ring-sky-400/40 hover:bg-sky-500/25">Locker</button>
          <button id="textures-btn" class="rounded-lg bg-violet-500/15 px-6 py-2 text-sm font-bold text-violet-300 ring-1 ring-violet-400/40 hover:bg-violet-500/25">Texture Pack</button>
          <button id="arcade-hub-btn" class="animate-pulse rounded-lg bg-cyan-500/20 px-6 py-2 text-sm font-black uppercase tracking-widest text-cyan-200 ring-2 ring-cyan-400/70 shadow-[0_0_22px_rgba(34,211,238,0.5)] hover:bg-cyan-500/35">🕹️ Arcade Hub</button>
          <button id="profile-btn" class="rounded-lg bg-emerald-500/15 px-6 py-2 text-sm font-bold text-emerald-300 ring-1 ring-emerald-400/40 hover:bg-emerald-500/25">👤 Profile</button>
          <button id="settings-btn" class="rounded-lg bg-slate-500/15 px-6 py-2 text-sm font-bold text-slate-200 ring-1 ring-slate-400/40 hover:bg-slate-500/25">⚙️ Settings</button>
        </nav>
      </div>
    </header>
    <div class="min-h-0 flex-1 overflow-y-auto px-6 pb-10 pt-4">
      <div class="mx-auto w-full max-w-4xl">
        <p class="text-center text-sm text-slate-400">Top-down survival · pick a mission, clear the zone, get out alive.</p>
      <div class="mt-4 flex justify-center">
        <button id="start-btn" class="rounded-xl bg-emerald-500 px-10 py-3 text-lg font-black tracking-wide text-emerald-950 hover:bg-emerald-400">Start Game</button>
      </div>
      <div class="mt-4 flex items-center justify-center gap-2 text-xs">
        <span class="font-semibold uppercase tracking-wider text-slate-400">Players</span>
        <button id="players-1" class="rounded-lg px-4 py-1.5 font-bold">1 Player</button>
        <button id="players-2" class="rounded-lg px-4 py-1.5 font-bold">2 Players</button>
      </div>
      <div class="mt-3 text-center text-xs text-slate-400">
        Loadout: <span id="menu-equipped" class="font-semibold text-emerald-300">Old Rifle</span>
        · Survivor: <span id="menu-character" class="font-semibold text-amber-300">—</span>
        <button id="character-btn" class="ml-2 rounded bg-white/10 px-2 py-0.5 font-semibold text-white hover:bg-white/20">Change</button>
      </div>
      <div id="campaign" class="mt-6 space-y-4"></div>
      <div class="mt-8 rounded-lg bg-white/5 p-4 text-xs text-slate-400 ring-1 ring-white/10">
        <span class="font-semibold text-slate-200">Controls:</span>
        WASD or Arrow keys to move · aim with the mouse · left click to shoot (keep running while you fire) · R to reload ·
        <span class="font-mono text-slate-200">Q</span> swaps between your primary and secondary weapon ·
        <span class="font-mono text-slate-200">E</span> for your character's active ability (Engineer also drops a barricade with <span class="font-mono text-slate-200">F</span>).
        Each mission loads its own isolated map. Yellow crates restock ammo.
        <span class="font-semibold text-orange-300">Orange Plague Bugs</span> are fast and sting — five stings and you turn.
        <div class="mt-2"><span class="font-semibold text-slate-200">Co-op:</span> Player 2 moves with the Arrow keys, auto-aims at the nearest enemy and fires on its own, or on demand with <span class="font-mono text-slate-200">.</span>, <span class="font-mono text-slate-200">Numpad 0</span> or <span class="font-mono text-slate-200">Right Ctrl</span>. Their ability is <span class="font-mono text-slate-200">M</span> (barricade <span class="font-mono text-slate-200">L</span>), and <span class="font-mono text-slate-200">N</span> swaps their weapon.</div>
      </div>
      </div>
    </div>
  </div>

  <!-- Character select -->
  <div id="characters" class="absolute inset-0 z-20 hidden items-center justify-center overflow-y-auto bg-slate-950/98 p-6">
    <div class="w-full max-w-4xl">
      <h2 class="text-center text-4xl font-black tracking-tight text-emerald-400">CHOOSE YOUR SURVIVOR</h2>
      <p class="mt-2 text-center text-sm text-slate-400">Each survivor carries a passive that changes how the wasteland treats you.</p>
      <div id="character-slots" class="mt-4 hidden justify-center gap-2 text-xs">
        <button id="slot-1" class="rounded-lg px-4 py-1.5 font-bold">Player 1</button>
        <button id="slot-2" class="rounded-lg px-4 py-1.5 font-bold">Player 2</button>
      </div>
      <div id="character-list" class="mt-8 grid gap-4 md:grid-cols-2"></div>
      <div class="mt-6 text-center">
        <button id="characters-close" class="hidden rounded-lg bg-white/10 px-8 py-3 text-sm font-bold text-white hover:bg-white/20">Back to Menu</button>
      </div>
    </div>
  </div>

  <!-- Shop / Locker -->
  <div id="arsenal" class="absolute inset-0 z-10 hidden items-center justify-center bg-slate-950/97 p-6">
    <div class="w-full max-w-5xl">
      <div class="flex items-baseline justify-between">
        <h2 id="arsenal-title" class="text-3xl font-black tracking-tight text-yellow-400">WEAPONS SHOP</h2>
        <div class="text-sm font-bold text-yellow-300">Scrap: <span id="arsenal-scrap">0</span>
          <span class="ml-3 text-cyan-300">Chips: <span id="arsenal-chips">0</span></span>
          <span class="ml-3 text-amber-400">Amber: <span id="arsenal-amber">0</span></span>
          <span class="ml-3 text-orange-400">Cores: <span id="arsenal-cores">0</span></span>
        </div>
      </div>
      <div class="mt-4 flex gap-2 text-xs">
        <button id="slot-primary" class="rounded-lg px-4 py-1.5 font-bold">Primary</button>
        <button id="slot-secondary" class="rounded-lg px-4 py-1.5 font-bold">Secondary / Melee</button>
        <button id="slot-chips" class="rounded-lg px-4 py-1.5 font-bold">❄ Chapter 2 Tech</button>
        <button id="slot-amber" class="rounded-lg px-4 py-1.5 font-bold">🌿 Ancient Tech</button>
        <button id="slot-cores" class="rounded-lg px-4 py-1.5 font-bold">⚙️ Rust Tech</button>
      </div>
      <div class="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_320px]">
        <div id="weapon-list" class="space-y-2"></div>
        <div class="rounded-xl bg-white/5 p-5 ring-1 ring-white/10">
          <div id="detail-name" class="text-xl font-bold text-white">Rusty Pistol</div>
          <p id="detail-desc" class="mt-1 text-xs text-slate-400"></p>
          <div class="mt-4 flex justify-center">
            <canvas id="radar" class="block"></canvas>
          </div>
          <div class="mt-4 rounded-lg bg-black/40 p-3">
            <div id="detail-perk" class="text-sm font-bold text-sky-300">No talent</div>
            <p id="detail-perk-desc" class="mt-1 text-xs text-slate-400"></p>
          </div>
          <button id="detail-action" class="mt-4 w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-bold text-emerald-950 hover:bg-emerald-400">Equip</button>
          <div id="detail-note" class="mt-2 h-4 text-center text-xs font-semibold text-red-400"></div>
        </div>
      </div>
      <button id="arsenal-close" class="mt-6 rounded-lg bg-white/10 px-8 py-3 text-sm font-bold text-white hover:bg-white/20">Back to Menu</button>
    </div>
  </div>

  <!-- Win -->
  <div id="win" class="absolute inset-0 hidden items-center justify-center bg-emerald-950/90 p-6">
    <div class="text-center">
      <h2 class="text-6xl font-black text-emerald-400">MISSION ACCOMPLISHED!</h2>
      <p id="win-sub" class="mt-3 text-slate-300"></p>
      <p id="win-reward" class="mt-2 text-lg font-bold text-yellow-300"></p>
      <button id="win-btn" class="mt-8 rounded-lg bg-emerald-500 px-8 py-3 text-lg font-bold text-emerald-950 hover:bg-emerald-400">
        Return to Main Menu
      </button>
    </div>
  </div>

  <!-- Lose -->
  <div id="lose" class="absolute inset-0 hidden items-center justify-center bg-red-950/90 p-6">
    <div class="text-center">
      <h2 id="lose-title" class="text-6xl font-black text-red-500">GAME OVER</h2>
      <p id="lose-tagline" class="mt-4 hidden text-2xl font-bold"></p>
      <p id="lose-sub" class="mt-3 text-slate-300"></p>
      <p id="lose-reward" class="mt-2 text-lg font-bold text-yellow-300"></p>
      <div class="mt-8 flex items-center justify-center gap-4">
        <button id="retry-btn" class="rounded-lg bg-red-500 px-8 py-3 text-lg font-bold text-white hover:bg-red-400">Try Again</button>
        <button id="lose-menu-btn" class="rounded-lg bg-white/10 px-8 py-3 text-lg font-bold text-white hover:bg-white/20">Main Menu</button>
      </div>
    </div>
  </div>
`

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id)
  if (!node) throw new Error(`missing element #${id}`)
  return node as T
}

const canvas = el<HTMLCanvasElement>('scene')
const hud = el('hud')
const menu = el('menu')
const winScreen = el('win')
const loseScreen = el('lose')
const arsenalScreen = el('arsenal')
const characterScreen = el('characters')
const introScreen = el('intro')

const game = new Game(canvas)
if (import.meta.env.DEV) window.game = game
const profile = loadProfile()
const radar = new RadarChart(el<HTMLCanvasElement>('radar'), 280)

const campaignEl = el('campaign')

for (const tag of document.querySelectorAll('.menu-version')) tag.textContent = APP_VERSION

let currentMission: Mission = MISSIONS[0]
/** Which chapter's mission board the menu is showing. */
let chapter: ChapterId = 1

function unlocked(m: Mission) {
  return missionUnlocked(m, profile.completed)
}

function missionCard(m: Mission): HTMLElement {
  const done = profile.completed.includes(m.id)
  const open = unlocked(m)
  const card = document.createElement('button')
  card.disabled = !open
  card.className = `group w-full rounded-xl p-4 text-left ring-1 transition ${
    done
      ? 'bg-emerald-500/10 ring-emerald-400/40'
      : open
        ? 'bg-white/5 ring-white/10 hover:bg-emerald-500/10 hover:ring-emerald-400/60'
        : 'cursor-not-allowed bg-black/40 opacity-50 ring-white/5'
  }`
  const badge =
    m.type === 'protect'
      ? `<span class="rounded-md bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold text-sky-300">Protect ${m.survivors}</span>`
      : m.type === 'boss'
        ? '<span class="rounded-md bg-orange-500/20 px-2 py-0.5 text-[11px] font-semibold text-orange-300">Boss · 2 phases</span>'
        : m.type === 'hold'
          ? `<span class="rounded-md bg-cyan-500/15 px-2 py-0.5 text-[11px] font-semibold text-cyan-300">Survive ${Math.round((m.holdTime ?? 0) / 60)} min</span>`
          : m.type === 'generator'
            ? `<span class="rounded-md bg-cyan-500/15 px-2 py-0.5 text-[11px] font-semibold text-cyan-300">Defend generator · ${m.target} kills</span>`
            : m.type === 'overgrowth'
              ? `<span class="rounded-md bg-lime-500/15 px-2 py-0.5 text-[11px] font-semibold text-lime-300">Destroy ${m.hives ?? 0} Spore Hives</span>`
              : m.type === 'supply'
                ? `<span class="rounded-md bg-lime-500/15 px-2 py-0.5 text-[11px] font-semibold text-lime-300">Recover ${m.crates ?? 0} crates</span>`
                : m.type === 'rail'
                  ? '<span class="rounded-md bg-orange-500/15 px-2 py-0.5 text-[11px] font-semibold text-orange-300">Rail shooter · truck bed</span>'
                : m.type === 'arena'
                  ? `<span class="rounded-md bg-orange-500/15 px-2 py-0.5 text-[11px] font-semibold text-orange-300">Survive ${Math.round((m.arenaTime ?? 480) / 60)} min · boss finale</span>`
                : m.type === 'race'
                  ? '<span class="rounded-md bg-lime-500/15 px-2 py-0.5 text-[11px] font-semibold text-lime-300">Reach extraction</span>'
                  : `<span class="rounded-md bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-300">${m.target} kills</span>`
  const chips =
    m.chapter === 2
      ? `<span class="rounded-md bg-cyan-500/15 px-2 py-0.5 text-[11px] font-semibold text-cyan-300">${missionChipReward(m)} chips</span>`
      : m.chapter === 3
        ? `<span class="rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300">${missionAmberReward(m)} amber</span>`
        : m.chapter === 4
          ? `<span class="rounded-md bg-orange-500/15 px-2 py-0.5 text-[11px] font-semibold text-orange-300">${missionCoreReward(m)} cores</span>`
          : ''
  card.innerHTML = `
    <div class="flex items-center justify-between">
      <span class="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">${missionMapName(m)}</span>
      ${done ? '<span class="text-[11px] font-bold text-emerald-300">CLEARED</span>' : open ? '' : '<span class="text-[11px] font-bold text-slate-400">LOCKED</span>'}
    </div>
    <div class="mt-1 text-lg font-bold text-white">${m.name}</div>
    <p class="mt-1 text-xs text-slate-400">${m.description}</p>
    <div class="mt-3 flex items-center gap-2">
      ${badge}
      <span class="rounded-md bg-yellow-500/15 px-2 py-0.5 text-[11px] font-semibold text-yellow-300">${missionReward(m)} scrap</span>
      ${chips}
    </div>
  `
  if (open) card.addEventListener('click', () => launch(m))
  return card
}

function branchColumn(path: PathInfo): HTMLElement {
  const col = document.createElement('div')
  const finished = pathComplete(path.id, profile.completed)
  const started = pathMissions(path.id).some((m) => profile.completed.includes(m.id))
  col.className = `rounded-2xl p-4 ring-1 ${
    finished ? 'bg-emerald-500/5 ring-emerald-400/40' : 'bg-white/5 ring-white/10'
  }`
  const status = finished
    ? '<span class="text-[11px] font-bold text-emerald-300">PATH COMPLETE</span>'
    : started
      ? '<span class="text-[11px] font-bold text-sky-300">IN PROGRESS</span>'
      : ''
  col.innerHTML = `
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-black uppercase tracking-wider text-white">${path.title}</h3>
      ${status}
    </div>
    <p class="mt-1 text-xs text-slate-400">${path.blurb}</p>
  `
  const list = document.createElement('div')
  list.className = 'mt-3 space-y-3'
  for (const m of pathMissions(path.id)) list.appendChild(missionCard(m))
  col.appendChild(list)
  return col
}

const CHAPTER_LABEL: Record<ChapterId, string> = {
  1: '⬅️ RETURN TO CHAPTER 1: THE OUTBREAK',
  2: '➡️ TRAVEL TO CHAPTER 2: PROJECT HORIZON',
  3: '➡️ VENTURE TO CHAPTER 3: THE PRIMEVAL CANOPY',
  4: '➡️ DRIVE EAST TO CHAPTER 4: THE SCORCHED RUSTLANDS',
}

const CHAPTER_STYLE: Record<ChapterId, string> = {
  1: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/60 hover:bg-emerald-500/25',
  2: 'bg-cyan-500/15 text-cyan-200 ring-cyan-400/60 hover:bg-cyan-500/25',
  3: 'bg-lime-500/15 text-lime-200 ring-lime-400/60 hover:bg-lime-500/25',
  4: 'bg-orange-500/15 text-orange-200 ring-orange-400/60 hover:bg-orange-500/25',
}

/** Big stylised button that moves the mission board between chapters. */
function chapterButton(to: ChapterId, label = CHAPTER_LABEL[to]): HTMLElement {
  const open = chapterUnlocked(to, profile.completed)
  const btn = document.createElement('button')
  btn.disabled = !open
  btn.className = `w-full rounded-2xl px-6 py-4 text-center text-lg font-black tracking-wide ring-2 transition ${
    !open ? 'cursor-not-allowed bg-black/40 text-slate-500 ring-white/10' : CHAPTER_STYLE[to]
  }`
  btn.textContent = label
  if (!open) {
    const note = document.createElement('div')
    note.className = 'mt-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500'
    note.textContent =
      to === 4
        ? 'Locked — clear The Canopy Leviathan first'
        : to === 3
          ? 'Locked — clear The Cryo-Stalker Infusion first'
          : 'Locked — clear The Hive Mother first'
    const wrap = document.createElement('div')
    wrap.appendChild(btn)
    wrap.appendChild(note)
    return wrap
  }
  btn.addEventListener('click', () => {
    chapter = to
    renderCampaign()
  })
  return btn
}

/** Chapter 2's arctic board: a plain list of the frozen-lab missions. */
function renderChapterTwo() {
  const info = CHAPTERS[1]
  const header = document.createElement('div')
  header.className = 'rounded-2xl bg-cyan-500/5 p-4 ring-1 ring-cyan-400/30'
  header.innerHTML = `
    <h3 class="text-sm font-black uppercase tracking-wider text-cyan-200">${info.title}</h3>
    <p class="mt-1 text-xs text-slate-400">${info.blurb}</p>
    <div class="mt-2 text-xs font-semibold text-cyan-300">Frozen Data Chips: ${profile.chips} · enemies here have +50% health and hit 30% harder.</div>
  `
  campaignEl.appendChild(header)

  const list = document.createElement('div')
  list.className = 'grid gap-4 md:grid-cols-2'
  for (const m of chapterMissions(2)) list.appendChild(missionCard(m))
  campaignEl.appendChild(list)
  campaignEl.appendChild(chapterButton(3))
  campaignEl.appendChild(chapterButton(1))
}

/** Chapter 3's jungle board: the three canopy operations, in order. */
function renderChapterThree() {
  const info = CHAPTERS[2]
  const header = document.createElement('div')
  header.className = 'rounded-2xl bg-lime-500/5 p-4 ring-1 ring-lime-400/30'
  header.innerHTML = `
    <h3 class="text-sm font-black uppercase tracking-wider text-lime-200">${info.title}</h3>
    <p class="mt-1 text-xs text-slate-400">${info.blurb}</p>
    <div class="mt-2 text-xs font-semibold text-amber-300">Ancient Amber: ${profile.amber} · moss-caked infected here carry double health. Hold E (player 2: M) to haul supply crates.</div>
  `
  campaignEl.appendChild(header)

  const list = document.createElement('div')
  list.className = 'grid gap-4 md:grid-cols-2'
  for (const m of chapterMissions(3)) list.appendChild(missionCard(m))
  campaignEl.appendChild(list)
  campaignEl.appendChild(chapterButton(4))
  campaignEl.appendChild(
    chapterButton(2, '⬅️ RETURN TO CHAPTER 2: PROJECT HORIZON')
  )
  campaignEl.appendChild(chapterButton(1))
}

/** Chapter 4's desert board: the eight Rustlands runs, in convoy order. */
function renderChapterFour() {
  const info = CHAPTERS[3]
  const header = document.createElement('div')
  header.className = 'rounded-2xl bg-orange-500/5 p-4 ring-1 ring-orange-400/30'
  header.innerHTML = `
    <h3 class="text-sm font-black uppercase tracking-wider text-orange-200">${info.title}</h3>
    <p class="mt-1 text-xs text-slate-400">${info.blurb}</p>
    <div class="mt-2 text-xs font-semibold text-orange-300">Rust Cores: ${profile.cores} · scavengers here carry 2.5× health and hit 50% harder. Fueling the Rig is a mounted rail shooter — you ride the bed and aim 360°.</div>
  `
  campaignEl.appendChild(header)

  const list = document.createElement('div')
  list.className = 'grid gap-4 md:grid-cols-2'
  for (const m of chapterMissions(4)) list.appendChild(missionCard(m))
  campaignEl.appendChild(list)
  campaignEl.appendChild(chapterButton(3, '⬅️ RETURN TO CHAPTER 3: THE PRIMEVAL CANOPY'))
  campaignEl.appendChild(
    chapterButton(2, '⬅️ RETURN TO CHAPTER 2: PROJECT HORIZON')
  )
  campaignEl.appendChild(chapterButton(1))
}

/**
 * Post-campaign banner: restarts the mission board with every weapon,
 * survivor and currency intact while the infected come back harder.
 */
function ngPlusPanel(): HTMLElement {
  const wrap = document.createElement('div')
  const active = profile.ngPlus > 0
  wrap.className = `rounded-2xl p-4 ring-1 ${
    active
      ? 'bg-fuchsia-500/10 ring-fuchsia-400/40'
      : 'bg-violet-500/5 ring-violet-400/30'
  }`
  wrap.innerHTML = `
    <h3 class="text-sm font-black uppercase tracking-wider text-fuchsia-200">New Game+${
      active ? ` · Cycle ${profile.ngPlus}` : ''
    }</h3>
    <p class="mt-1 text-xs text-slate-400">The Rustlands are clear, but whatever the craft dropped is still out there. Run the campaign again with every weapon, survivor and currency you own — the infected come back with +60% health and +12% speed. No new stages yet.</p>
  `
  const btn = document.createElement('button')
  btn.className =
    'mt-3 w-full rounded-xl bg-fuchsia-500/20 px-6 py-3 text-center text-base font-black tracking-wide text-fuchsia-100 ring-2 ring-fuchsia-400/60 transition hover:bg-fuchsia-500/30'
  btn.textContent = active ? `♻️ RESTART NEW GAME+ (CYCLE ${profile.ngPlus + 1})` : '♻️ START NEW GAME+'
  btn.addEventListener('click', () => {
    const ok = window.confirm(
      'Start New Game+? Mission progress resets to Chapter 1; weapons, currency and survivors carry over and enemies get tougher.'
    )
    if (!ok) return
    Object.assign(profile, startNgPlus(profile))
    saveProfile(profile)
    game.ngPlus = true
    chapter = 1
    renderCampaign()
    persist()
  })
  wrap.appendChild(btn)
  return wrap
}

function renderCampaign() {
  campaignEl.innerHTML = ''
  if (ngPlusUnlocked(profile)) campaignEl.appendChild(ngPlusPanel())
  if (chapter === 4) {
    renderChapterFour()
    return
  }
  if (chapter === 3) {
    renderChapterThree()
    return
  }
  if (chapter === 2) {
    renderChapterTwo()
    return
  }

  const intro = document.createElement('div')
  intro.className = 'grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-start'
  const prologue = document.createElement('div')
  prologue.className = 'rounded-2xl bg-white/5 p-4 ring-1 ring-white/10'
  prologue.innerHTML =
    '<h3 class="text-sm font-black uppercase tracking-wider text-white">Prologue</h3><p class="mt-1 text-xs text-slate-400">Clear this to open all three paths.</p>'
  const first = document.createElement('div')
  first.className = 'mt-3'
  first.appendChild(missionCard(MISSIONS[0]))
  prologue.appendChild(first)

  const note = document.createElement('div')
  note.className = 'rounded-2xl bg-black/30 p-4 text-xs text-slate-400 ring-1 ring-white/10'
  const bosses = bossesDefeated(profile.completed)
  note.innerHTML = `
    <span class="font-semibold text-slate-200">Campaign paths:</span>
    all three branches run in parallel — clearing a mission opens the next stage on that branch,
    each on its own dedicated map, paying 40–140% more scrap. Every path ends in its own boss.
    <div class="mt-2 font-semibold ${bosses >= BOSSES_REQUIRED ? 'text-emerald-300' : 'text-amber-300'}">
      Path bosses defeated: ${bosses}/${BOSSES_REQUIRED} needed to open The Infected Hive.
    </div>
  `
  intro.appendChild(prologue)
  intro.appendChild(note)
  campaignEl.appendChild(intro)

  const branches = document.createElement('div')
  branches.className = 'grid gap-4 md:grid-cols-3'
  for (const path of PATHS) branches.appendChild(branchColumn(path))
  campaignEl.appendChild(branches)

  const finale = MISSIONS.find((m) => m.requiresPathBosses)
  if (finale) {
    const wrap = document.createElement('div')
    wrap.className = `rounded-2xl p-4 ring-1 ${
      unlocked(finale) ? 'bg-orange-500/5 ring-orange-400/40' : 'bg-white/5 ring-white/10'
    }`
    wrap.innerHTML =
      `<h3 class="text-sm font-black uppercase tracking-wider text-orange-300">Finale · Boss Fight</h3><p class="mt-1 text-xs text-slate-400">Kill ${BOSSES_REQUIRED} path bosses to open the door to the Mutated Alpha Bug that started the plague.</p>`
    const holder = document.createElement('div')
    holder.className = 'mt-3'
    holder.appendChild(missionCard(finale))
    wrap.appendChild(holder)
    campaignEl.appendChild(wrap)
  }

  campaignEl.appendChild(chapterButton(2))
}

const introPacks = el('intro-packs')

function renderIntro() {
  introPacks.innerHTML = ''
  for (const pack of TEXTURE_PACKS) {
    const chosen = profile.textures === pack.id
    const card = document.createElement('button')
    card.className = `rounded-2xl p-6 text-left ring-1 transition ${
      chosen ? 'bg-emerald-500/10 ring-emerald-400/70' : 'bg-white/5 ring-white/10 hover:bg-white/10'
    }`
    card.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="text-xl font-bold text-white">${pack.name}</span>
        ${chosen ? '<span class="text-xs font-bold text-emerald-300">CURRENT</span>' : ''}
      </div>
      <p class="mt-2 text-sm text-slate-400">${pack.blurb}</p>
      <canvas width="320" height="140" class="mt-4 w-full rounded-lg bg-black/40" data-preview="${pack.id}"></canvas>
    `
    card.addEventListener('click', () => {
      resumeAudio()
      setTextures(pack.id)
      show(introScreen, false)
      if (profile.character) show(menu, true)
      else show(characterScreen, true)
      playMusic('menu')
    })
    introPacks.appendChild(card)
    const preview = card.querySelector('canvas')
    if (preview) drawPackPreview(preview, pack.id)
  }
}

/** Tiny side-by-side sample of how the world is drawn in each pack. */
function drawPackPreview(canvasEl: HTMLCanvasElement, pack: TexturePack) {
  const ctx = canvasEl.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#23262a'
  ctx.fillRect(0, 0, 320, 140)

  if (pack === 'enhanced') {
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fillRect(60, 40, 90, 60)
    ctx.fillStyle = '#8b5a2b'
    ctx.beginPath()
    ctx.moveTo(60, 100)
    ctx.lineTo(150, 100)
    ctx.lineTo(166, 116)
    ctx.lineTo(70, 116)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#a5703a'
    ctx.fillRect(70, 34, 96, 66)
    ctx.fillStyle = 'rgba(255,212,121,0.5)'
    ctx.fillRect(84, 48, 20, 22)
    ctx.fillRect(120, 48, 20, 22)
    ctx.fillStyle = 'rgba(0,0,0,0.4)'
    ctx.beginPath()
    ctx.ellipse(240, 96, 20, 9, 0, 0, Math.PI * 2)
    ctx.fill()
    const grad = ctx.createRadialGradient(232, 74, 4, 240, 84, 20)
    grad.addColorStop(0, '#7ef7a5')
    grad.addColorStop(1, '#12894a')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(240, 84, 20, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.fillStyle = '#8b5a2b'
    ctx.fillRect(60, 40, 96, 66)
    ctx.strokeStyle = '#5c3a1c'
    ctx.lineWidth = 3
    ctx.strokeRect(60, 40, 96, 66)
    ctx.fillStyle = '#3ddc84'
    ctx.beginPath()
    ctx.arc(240, 84, 20, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#0f172a'
    ctx.stroke()
  }
}

function setTextures(pack: TexturePack) {
  profile.textures = pack
  game.textures = pack
  persist()
}

el('textures-btn').addEventListener('click', () => {
  renderIntro()
  show(menu, false)
  show(introScreen, true)
})

/** Story crawl, then survivor select (or straight to the campaign). */
function startGameFlow() {
  show(menu, false)
  show(characterScreen, false)
  playStoryIntro(() => {
    if (profile.character) {
      show(menu, true)
      playMusic('menu')
    } else {
      renderCharacters()
      show(characterScreen, true)
    }
  })
}

function launch(m: Mission) {
  currentMission = m
  const roster = [characterById(activeCharacter())]
  if (profile.players === 2) roster.push(characterById(secondCharacter()))
  const loadout = [weaponById(profile.primary), weaponById(profile.secondary)]
  // The Crucible opens on the dying survivor's warning, then the swarm starts.
  if (m.type === 'arena') {
    show(menu, false)
    game.startMission(m, loadout, roster, true)
    playBossDialogue(activeCharacter(), m.boss ?? 'rust-colossus', () => game.resume())
    return
  }
  // Boss arenas load frozen behind the briefing scene, then cut to the reveal.
  if (m.type === 'boss') {
    show(menu, false)
    game.startMission(m, loadout, roster, true)
    playBossDialogue(activeCharacter(), m.boss ?? 'hive-mother', () => game.resume())
    return
  }
  game.startMission(m, loadout, roster)
}

function activeCharacter(): CharacterId {
  return profile.character ?? CHARACTERS[0].id
}

/** Player 2 defaults to a different survivor than player 1. */
function secondCharacter(): CharacterId {
  if (profile.character2 && profile.character2 !== activeCharacter()) return profile.character2
  const other = CHARACTERS.find((c) => c.id !== activeCharacter())
  return other ? other.id : CHARACTERS[0].id
}

const characterList = el('character-list')
const characterSlots = el('character-slots')
let editingSlot: 1 | 2 = 1

function slotButtonClass(active: boolean) {
  return `rounded-lg px-4 py-1.5 font-bold ${
    active ? 'bg-emerald-500 text-emerald-950' : 'bg-white/10 text-slate-300 hover:bg-white/20'
  }`
}

function renderCharacters() {
  characterSlots.classList.toggle('hidden', profile.players !== 2)
  characterSlots.classList.toggle('flex', profile.players === 2)
  if (profile.players === 1) editingSlot = 1
  el('slot-1').className = slotButtonClass(editingSlot === 1)
  el('slot-2').className = slotButtonClass(editingSlot === 2)

  const selectedId = editingSlot === 1 ? profile.character : secondCharacter()
  characterList.innerHTML = ''
  for (const c of CHARACTERS) {
    const chosen = selectedId === c.id
    const card = document.createElement('button')
    card.className = `rounded-xl p-6 text-left ring-1 transition ${
      chosen ? 'bg-emerald-500/10 ring-emerald-400/70' : 'bg-white/5 ring-white/10 hover:bg-white/10'
    }`
    card.innerHTML = `
      <div class="flex items-center gap-3">
        <span class="inline-block h-4 w-4 rounded-full" style="background:${c.color}"></span>
        <span class="text-xl font-bold text-white">${c.name}</span>
        ${chosen ? '<span class="ml-auto text-xs font-bold text-emerald-300">SELECTED</span>' : ''}
      </div>
      <p class="mt-2 text-sm italic text-slate-400">${c.tagline}</p>
      <div class="mt-4 rounded-lg bg-black/40 p-3">
        <div class="text-sm font-bold text-sky-300">Passive: ${c.perkName}</div>
        <p class="mt-1 text-xs text-slate-400">${c.perkDescription}</p>
      </div>
      <div class="mt-2 rounded-lg bg-black/40 p-3">
        <div class="text-sm font-bold text-violet-300">Active [E / M]: ${c.ability.name}</div>
        <p class="mt-1 text-xs text-slate-400">${c.ability.description}</p>
      </div>
    `
    card.addEventListener('click', () => {
      if (editingSlot === 1) profile.character = c.id
      else profile.character2 = c.id
      persist()
      if (profile.players === 2 && editingSlot === 1) {
        editingSlot = 2
        renderCharacters()
        return
      }
      renderCharacters()
      show(characterScreen, false)
      show(menu, true)
    })
    characterList.appendChild(card)
  }
  el<HTMLButtonElement>('characters-close').classList.toggle('hidden', profile.character === null)
}

el('slot-1').addEventListener('click', () => {
  editingSlot = 1
  renderCharacters()
})
el('slot-2').addEventListener('click', () => {
  editingSlot = 2
  renderCharacters()
})

function renderPlayerToggle() {
  el('players-1').className = slotButtonClass(profile.players === 1)
  el('players-2').className = slotButtonClass(profile.players === 2)
}

function setPlayers(count: 1 | 2) {
  profile.players = count
  if (count === 2 && !profile.character2) profile.character2 = secondCharacter()
  persist()
  renderCharacters()
}

el('players-1').addEventListener('click', () => setPlayers(1))
el('players-2').addEventListener('click', () => setPlayers(2))

el('character-btn').addEventListener('click', () => {
  renderCharacters()
  show(menu, false)
  show(characterScreen, true)
})
el('characters-close').addEventListener('click', () => {
  show(characterScreen, false)
  show(menu, true)
})

type ArsenalMode = 'shop' | 'locker'
let arsenalMode: ArsenalMode = 'shop'
/** Shop/locker tabs: the two scrap slots plus the premium chapter tabs. */
type ArsenalTab = WeaponSlot | 'chips' | 'amber' | 'cores'
const ARSENAL_TABS: ArsenalTab[] = ['primary', 'secondary', 'chips', 'amber', 'cores']
let arsenalSlot: ArsenalTab = 'primary'
let selectedWeapon: Weapon = weaponById(profile.primary)

const weaponListEl = el('weapon-list')
const detailAction = el<HTMLButtonElement>('detail-action')
const detailNote = el('detail-note')

function owns(id: WeaponId) {
  return profile.owned.includes(id)
}

function persist() {
  saveProfile(profile)
  el('menu-scrap').textContent = `${profile.scrap}`
  el('arsenal-scrap').textContent = `${profile.scrap}`
  el('menu-chips').textContent = `${profile.chips}`
  el('arsenal-chips').textContent = `${profile.chips}`
  el('menu-amber').textContent = `${profile.amber}`
  el('arsenal-amber').textContent = `${profile.amber}`
  el('menu-cores').textContent = `${profile.cores}`
  el('arsenal-cores').textContent = `${profile.cores}`
  el('menu-equipped').textContent = `${weaponById(profile.primary).name} + ${
    weaponById(profile.secondary).name
  }`
  el('menu-character').textContent = profile.character
    ? profile.players === 2
      ? `${characterById(profile.character).name} + ${characterById(secondCharacter()).name}`
      : characterById(profile.character).name
    : 'not chosen'
  renderPlayerToggle()
  renderCampaign()
}

function openArsenal(mode: ArsenalMode) {
  arsenalMode = mode
  el('arsenal-title').textContent = mode === 'shop' ? 'WEAPONS SHOP' : 'EQUIPMENT LOCKER'
  el('arsenal-title').className = `text-3xl font-black tracking-tight ${
    mode === 'shop' ? 'text-yellow-400' : 'text-sky-400'
  }`
  const available = slotWeapons()
  selectedWeapon = available.includes(selectedWeapon) ? selectedWeapon : available[0]
  show(menu, false)
  show(arsenalScreen, true)
  renderArsenal()
}

/** The shop lists every weapon in the tab; the locker only what you own. */
function slotWeapons(): Weapon[] {
  const inSlot =
    arsenalSlot === 'chips'
      ? chapterTwoWeapons()
      : arsenalSlot === 'amber'
        ? chapterThreeWeapons()
        : arsenalSlot === 'cores'
          ? chapterFourWeapons()
          : weaponsInSlot(arsenalSlot)
  return arsenalMode === 'shop' ? inSlot : inSlot.filter((w) => owns(w.id))
}

/** Price label for a weapon in whichever currency it is sold in. */
function priceLabel(w: Weapon): string {
  if (w.currency === 'chips') return `${w.price} chips`
  if (w.currency === 'amber') return `${w.price} amber`
  if (w.currency === 'cores') return `${w.price} cores`
  return `${w.price} scrap`
}

function balanceFor(w: Weapon): number {
  if (w.currency === 'chips') return profile.chips
  if (w.currency === 'amber') return profile.amber
  if (w.currency === 'cores') return profile.cores
  return profile.scrap
}

function equippedIn(w: Weapon) {
  return profile[w.slot] === w.id
}

function renderSlotTabs() {
  for (const slot of ARSENAL_TABS) {
    const btn = el(`slot-${slot}`)
    const active = arsenalSlot === slot
    btn.className = `rounded-lg px-4 py-1.5 font-bold ${
      active
        ? slot === 'chips'
          ? 'bg-cyan-400 text-cyan-950'
          : slot === 'amber'
            ? 'bg-amber-400 text-amber-950'
            : slot === 'cores'
              ? 'bg-orange-400 text-orange-950'
              : 'bg-emerald-500 text-emerald-950'
        : 'bg-white/10 text-slate-300 hover:bg-white/20'
    }`
  }
}

function renderArsenal() {
  renderSlotTabs()
  const available = slotWeapons()
  weaponListEl.innerHTML = ''
  for (const w of available) {
    const owned = owns(w.id)
    const equipped = equippedIn(w)
    const active = selectedWeapon.id === w.id
    const row = document.createElement('button')
    row.className = `flex w-full items-center justify-between rounded-xl px-4 py-3 text-left ring-1 transition ${
      active ? 'bg-white/10 ring-emerald-400/70' : 'bg-white/5 ring-white/10 hover:bg-white/10'
    }`
    const status = equipped
      ? '<span class="text-xs font-bold text-emerald-300">EQUIPPED</span>'
      : owned
        ? '<span class="text-xs font-bold text-sky-300">OWNED</span>'
        : `<span class="text-xs font-bold ${w.currency === 'chips' ? 'text-cyan-300' : w.currency === 'amber' ? 'text-amber-300' : w.currency === 'cores' ? 'text-orange-300' : 'text-yellow-300'}">${priceLabel(w)}</span>`
    row.innerHTML = `
      <span class="flex items-center gap-3">
        <span class="inline-block h-3 w-3 rounded-full" style="background:${w.color}"></span>
        <span>
          <span class="block text-sm font-bold text-white">${w.name}</span>
          <span class="block text-xs text-slate-400">${w.perk === 'none' ? 'No talent' : w.perkName}</span>
        </span>
      </span>
      ${status}
    `
    row.addEventListener('click', () => {
      selectedWeapon = w
      renderArsenal()
    })
    weaponListEl.appendChild(row)
  }
  renderDetail()
}

function renderDetail() {
  const w = selectedWeapon
  el('detail-name').textContent = w.name
  el('detail-desc').textContent = w.description
  el('detail-perk').textContent = w.perk === 'none' ? 'No talent' : `Talent: ${w.perkName}`
  el('detail-perk-desc').textContent = w.perkDescription
  radar.setStats(w.radar, w.color)
  detailNote.textContent = ''

  const owned = owns(w.id)
  const equipped = equippedIn(w)
  if (equipped) {
    detailAction.textContent = 'Equipped'
    detailAction.disabled = true
    detailAction.className =
      'mt-4 w-full cursor-default rounded-lg bg-white/10 px-4 py-3 text-sm font-bold text-slate-300'
  } else if (owned) {
    detailAction.textContent = w.slot === 'primary' ? 'Equip as primary' : 'Equip as secondary'
    detailAction.disabled = false
    detailAction.className =
      'mt-4 w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-bold text-emerald-950 hover:bg-emerald-400'
  } else {
    detailAction.textContent = `Buy — ${priceLabel(w)}`
    detailAction.disabled = false
    const affordable = balanceFor(w) >= w.price
    detailAction.className = `mt-4 w-full rounded-lg px-4 py-3 text-sm font-bold ${
      w.currency === 'amber'
        ? affordable
          ? 'bg-amber-400 text-amber-950 hover:bg-amber-300'
          : 'bg-amber-500/20 text-amber-200/70'
        : w.currency === 'cores'
          ? affordable
            ? 'bg-orange-400 text-orange-950 hover:bg-orange-300'
            : 'bg-orange-500/20 text-orange-200/70'
        : w.currency === 'chips'
          ? affordable
            ? 'bg-cyan-400 text-cyan-950 hover:bg-cyan-300'
            : 'bg-cyan-500/20 text-cyan-200/70'
        : affordable
          ? 'bg-yellow-400 text-yellow-950 hover:bg-yellow-300'
          : 'bg-yellow-500/20 text-yellow-200/70'
    }`
  }
}

detailAction.addEventListener('click', () => {
  const w = selectedWeapon
  if (owns(w.id)) {
    profile[w.slot] = w.id
  } else if (balanceFor(w) >= w.price) {
    if (w.currency === 'chips') profile.chips -= w.price
    else if (w.currency === 'amber') profile.amber -= w.price
    else if (w.currency === 'cores') profile.cores -= w.price
    else profile.scrap -= w.price
    profile.owned.push(w.id)
    profile[w.slot] = w.id
  } else {
    const short = w.price - balanceFor(w)
    const unit =
      w.currency === 'chips'
        ? 'data chips'
        : w.currency === 'amber'
          ? 'ancient amber'
          : w.currency === 'cores'
            ? 'rust cores'
            : 'scrap'
    detailNote.textContent = `Need ${short} more ${unit}.`
    return
  }
  persist()
  renderArsenal()
})

for (const slot of ARSENAL_TABS) {
  el(`slot-${slot}`).addEventListener('click', () => {
    arsenalSlot = slot
    const available = slotWeapons()
    if (available.length) selectedWeapon = available[0]
    renderArsenal()
  })
}

// The arcade cabinet runs entirely on its own overlay loop; the campaign just
// hands over the screen and picks up exactly where it left off.
/** Cabinets opened from the hub hand the screen back to the hub, not the menu. */
let cameFromHub = false

function leaveCabinet() {
  if (cameFromHub) {
    cameFromHub = false
    arcadeHub.open()
    return
  }
  show(menu, true)
  playMusic('menu')
}

const arcade = mountArcade(leaveCabinet)
const voidBlast = mountVoidBlast(leaveCabinet)
const gauntlet = mountEndlessGauntlet(leaveCabinet)
const rotFighter = mountFightingArcade(leaveCabinet)

const CABINETS: Record<ArcadeGameId, () => void> = {
  'crimson-highway': () => arcade.open(),
  'void-blast': () => voidBlast.open(),
  'endless-gauntlet': () => gauntlet.open(),
  'rot-fighter': () => rotFighter.open(),
}

const arcadeHub = mountArcadeHub(
  (game) => {
    cameFromHub = true
    CABINETS[game]()
  },
  () => {
    show(menu, true)
    playMusic('menu')
  },
)

function enterCabinet(openCabinet: () => void) {
  resumeAudio()
  stopMusic()
  show(menu, false)
  show(arsenalScreen, false)
  show(characterScreen, false)
  openCabinet()
}

el('arcade-hub-btn').addEventListener('click', () => enterCabinet(() => arcadeHub.open()))

const settingsPanel = mountSettings()
el('settings-btn').addEventListener('click', () => {
  resumeAudio()
  settingsPanel.open()
})

const openProfile = () => {
  resumeAudio()
  settingsPanel.open('profile')
}
el('profile-btn').addEventListener('click', openProfile)
el('profile-chip').addEventListener('click', openProfile)

const profileAvatar = el('profile-avatar')
const profileNameLabel = el('profile-name-label')
onSettingsChange((s) => {
  profileAvatar.textContent = s.avatar
  profileNameLabel.textContent = s.playerName || 'Set Profile'
})

el('shop-btn').addEventListener('click', () => openArsenal('shop'))
el('locker-btn').addEventListener('click', () => openArsenal('locker'))
el('arsenal-close').addEventListener('click', () => {
  show(arsenalScreen, false)
  show(menu, true)
})

function show(node: HTMLElement, visible: boolean, display: 'flex' | 'block' = 'flex') {
  node.classList.toggle('hidden', !visible)
  if (visible) node.classList.add(display)
  else node.classList.remove(display)
}

/** True while the ending cinematic is running, so the win screen is skipped. */
let finaleOutro = false

// A chapter boss's burst hands over to its dialogue and credit crawl.
game.onFinale = (boss) => {
  finaleOutro = true
  playOutro(activeCharacter(), boss, () => game.finishFinale())
}

game.onStateChange = (state: GameState) => {
  show(hud, state === 'playing', 'block')
  show(menu, state === 'menu')
  show(winScreen, state === 'won')
  show(loseScreen, state === 'lost')
  if (state !== 'menu') {
    show(arsenalScreen, false)
    show(characterScreen, false)
  }
  canvas.classList.toggle('cursor-none', state === 'playing')
  if (state === 'menu') playMusic('menu')
  if (state === 'won') playMusic('victory')
  if (state === 'lost') playMusic('gameover')
  if (state === 'won') {
    if (!profile.completed.includes(currentMission.id)) profile.completed.push(currentMission.id)
  }
  if (state === 'won' || state === 'lost') {
    const bonus = state === 'won' ? missionReward(currentMission) : 0
    const total = game.scrapEarned + bonus
    profile.scrap += total
    // Data chips only ever come out of the arctic chapter.
    const chipBonus =
      state === 'won' && currentMission.chapter === 2 ? missionChipReward(currentMission) : 0
    const chipTotal = currentMission.chapter === 2 ? game.chipsEarned + chipBonus : 0
    profile.chips += chipTotal
    // Ancient Amber is paid out only for clearing a jungle stage.
    const amberTotal =
      state === 'won' && currentMission.chapter === 3 ? missionAmberReward(currentMission) : 0
    profile.amber += amberTotal
    // Rust Cores are salvaged only out of the Rustlands.
    const coreTotal =
      state === 'won' && currentMission.chapter === 4 ? missionCoreReward(currentMission) : 0
    profile.cores += coreTotal
    persist()
    const chipText = chipTotal
      ? ` · +${chipTotal} frozen data chips`
      : amberTotal
        ? ` · +${amberTotal} ancient amber`
        : coreTotal
          ? ` · +${coreTotal} rust cores`
          : ''
    const rewardText =
      state === 'won'
        ? `+${total} scrap earned (${game.scrapEarned} from kills, ${bonus} mission bonus)${chipText}`
        : `+${total} scrap salvaged from kills${chipText}`
    el(state === 'won' ? 'win-reward' : 'lose-reward').textContent = rewardText
  }
  if (state === 'won' && finaleOutro) {
    // The ending already told the story: bank the scrap and go straight back.
    finaleOutro = false
    show(winScreen, false)
    game.toMenu()
    return
  }
  if (state === 'won') {
    const where = missionMapName(currentMission)
    el('win-sub').textContent =
      currentMission.type === 'hold'
        ? `${currentMission.name} complete — you held ${where} for the full ${Math.round((currentMission.holdTime ?? 0) / 60)} minutes.`
      : currentMission.type === 'generator'
        ? `${currentMission.name} complete — the generator is still running in ${where}.`
      : currentMission.type === 'rail'
        ? `${currentMission.name} complete — the rig rolled into the depot with its plating still on.`
      : currentMission.type === 'arena'
        ? `${currentMission.name} complete — eight minutes in the salt and the Rust Colossus went down with them.`
      : currentMission.type === 'boss'
        ? `${currentMission.name} complete — the Mutated Alpha Bug is dead. The hive falls silent.`
        : currentMission.type === 'protect'
        ? `${currentMission.name} complete — all ${currentMission.survivors} survivors extracted from ${where}.`
        : `${currentMission.name} complete — ${currentMission.target} zombies cleared in ${where}.`
    const nexts = currentMission.unlocks.filter((id) => !profile.completed.includes(id))
    el('win-reward').textContent += nexts.length ? ` · New missions unlocked` : ''
  }
  if (state === 'lost') {
    const infected = game.deathCause === 'infection'
    const lostSurvivor = game.deathCause === 'survivor'
    const lostGenerator = game.deathCause === 'generator'
    const lostTruck = game.deathCause === 'truck'
    const title = el('lose-title')
    const tagline = el('lose-tagline')
    title.textContent = infected
      ? 'INFECTION OVERWHELM!'
      : lostSurvivor
        ? 'SURVIVOR LOST'
        : lostGenerator
          ? 'GENERATOR DESTROYED'
          : lostTruck
            ? 'TRUCK DESTROYED'
            : 'GAME OVER'
    title.className = `text-6xl font-black ${infected ? 'animate-pulse text-orange-400' : 'text-red-500'}`
    tagline.classList.toggle('hidden', !infected)
    tagline.className = `mt-4 text-2xl font-bold text-orange-300 ${infected ? 'animate-pulse' : 'hidden'}`
    tagline.textContent = infected ? 'You have turned into a zombie.' : ''
    loseScreen.className = `absolute inset-0 flex items-center justify-center p-6 ${
      infected ? 'bg-orange-950/90' : 'bg-red-950/90'
    }`
    const where = missionMapName(currentMission)
    el('lose-sub').textContent = infected
      ? `The venom took hold in ${where} after 5 stings.`
      : lostSurvivor
        ? `A survivor died in ${where}. The escort is over.`
        : lostGenerator
          ? `The generator fell in ${where}. The camp freezes over.`
          : lostTruck
            ? `The rig broke apart on ${where}. The convoy never reaches the depot.`
            : `You fell in ${where} with ${game.kills} zombies cleared.`
  }
}

const playerPanels = el('player-panels')
const hudControls = el('hud-controls')
const missionBar = el('mission-bar')
const missionName = el('mission-name')
const missionZone = el('mission-zone')
const killText = el('kill-text')
const objectiveText = el('objective-text')
const survivorPanel = el('survivor-panel')
const survivorList = el('survivor-list')
const currentZone = el('current-zone')
const bossBar = el('boss-bar')
const bossName = el('boss-name')
const bossPhase = el('boss-phase')
const bossHp = el('boss-hp')
const bossFill = el('boss-fill')
const mutationBar = el('mutation-bar')
const mutationTitle = el('mutation-title')
const mutationBlurb = el('mutation-blurb')
const mutationFill = el('mutation-fill')
const hudWeapon = el('hud-weapon')
const hudPerk = el('hud-perk')
const hudScrap = el('hud-scrap')
const holdTimerBox = el('hold-timer')
const holdClock = el('hold-clock')
const generatorBar = el('generator-bar')
const generatorText = el('generator-text')
const generatorFill = el('generator-fill')
const truckBar = el('truck-bar')
const truckText = el('truck-text')
const truckFill = el('truck-fill')
const jungleBar = el('jungle-bar')
const jungleLabel = el('jungle-label')
const jungleText = el('jungle-text')
const jungleFill = el('jungle-fill')

function playerPanel(): HTMLElement {
  const panel = document.createElement('div')
  panel.className = 'rounded-lg bg-black/60 p-3 ring-1 ring-white/10'
  panel.innerHTML = `
    <div class="flex items-center justify-between text-xs font-bold uppercase tracking-wider">
      <span class="flex items-center gap-2">
        <span class="inline-block h-2.5 w-2.5 rounded-full" data-role="dot"></span>
        <span data-role="name"></span>
        <span class="font-normal normal-case text-slate-400" data-role="character"></span>
      </span>
      <span data-role="hp" class="text-emerald-300"></span>
    </div>
    <div class="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-white/10">
      <div data-role="hp-bar" class="h-full w-full rounded-full bg-emerald-500"></div>
    </div>
    <div class="mt-2 flex items-baseline justify-between">
      <span data-role="weapon" class="text-[11px] font-semibold uppercase tracking-wider text-amber-300">Ammo</span>
      <span data-role="ammo" class="font-mono text-base font-bold text-amber-200"></span>
    </div>
    <div data-role="stowed" class="text-[11px] font-semibold text-slate-400"></div>
    <div data-role="reload" class="hidden text-[11px] font-semibold text-amber-400">RELOADING…</div>
    <div data-role="lives" class="hidden text-[11px] font-semibold text-sky-300"></div>
    <div class="mt-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-orange-300">
      <span>Infection</span><span data-role="stings"></span>
    </div>
    <div data-role="pips" class="mt-1 flex gap-1.5"></div>
    <div data-role="ability" class="mt-2 rounded-md bg-white/5 px-2 py-1.5">
      <div class="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider">
        <span data-role="ability-name" class="text-violet-300"></span>
        <span data-role="ability-state" class="font-mono text-slate-300"></span>
      </div>
      <div class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div data-role="ability-bar" class="h-full w-full rounded-full bg-violet-400"></div>
      </div>
    </div>
  `
  return panel
}

function pick(root: HTMLElement, role: string): HTMLElement {
  const node = root.querySelector<HTMLElement>(`[data-role="${role}"]`)
  if (!node) throw new Error(`missing hud role ${role}`)
  return node
}

function updatePlayerPanels(h: Hud) {
  if (playerPanels.children.length !== h.players.length) {
    playerPanels.innerHTML = ''
    for (const _ of h.players) playerPanels.appendChild(playerPanel())
  }
  h.players.forEach((p, i) => {
    const panel = playerPanels.children[i] as HTMLElement
    const pct = (p.hp / p.maxHp) * 100
    pick(panel, 'dot').style.background = p.color
    pick(panel, 'name').textContent = h.players.length > 1 ? p.name : 'Health'
    pick(panel, 'character').textContent = p.characterName
    pick(panel, 'hp').textContent = p.down ? 'DOWN' : `${p.hp} / ${p.maxHp}`
    const bar = pick(panel, 'hp-bar')
    bar.style.width = `${pct}%`
    bar.className = `h-full rounded-full transition-[width] duration-150 ${
      pct > 50 ? 'bg-emerald-500' : pct > 25 ? 'bg-amber-500' : 'bg-red-500'
    }`
    pick(panel, 'weapon').textContent = p.weaponName
    pick(panel, 'ammo').textContent = p.infiniteAmmo ? '∞' : `${p.mag} / ${p.reserve}`
    pick(panel, 'stowed').textContent = p.stowedName
      ? `Swap [${p.switchKey}]: ${p.stowedName}`
      : ''
    pick(panel, 'reload').classList.toggle('hidden', !p.reloading)
    const lives = pick(panel, 'lives')
    lives.classList.toggle('hidden', p.lives <= 0)
    lives.textContent = `Extra lives: ${p.lives}`
    const stings = pick(panel, 'stings')
    stings.textContent = `Stings: ${p.stings}/${h.maxStings}`
    stings.className = `text-[11px] font-semibold ${
      p.stings >= h.maxStings - 1 ? 'animate-pulse text-red-400' : 'text-orange-300'
    }`
    const pips = pick(panel, 'pips')
    if (pips.children.length !== h.maxStings) {
      pips.innerHTML = ''
      for (let s = 0; s < h.maxStings; s++) pips.appendChild(document.createElement('div'))
    }
    Array.from(pips.children).forEach((pip, idx) => {
      pip.className = `h-2 flex-1 rounded-full ${idx < p.stings ? 'bg-orange-400' : 'bg-white/10'}`
    })
    const ab = p.ability
    const ready = ab.cooldown <= 0 && ab.charges !== 0
    pick(panel, 'ability-name').textContent = `${ab.name} [${ab.key}]`
    const extras: string[] = []
    if (ab.charges >= 0) extras.push(`${ab.charges} left`)
    if (ab.barricades > 0) extras.push(`barricade [${ab.barricadeKey}]`)
    const suffix = extras.length ? ` · ${extras.join(' · ')}` : ''
    pick(panel, 'ability-state').textContent = ab.active > 0
      ? `ACTIVE ${ab.active.toFixed(1)}s${suffix}`
      : ab.charges === 0
        ? `SPENT${suffix}`
        : ab.cooldown > 0
          ? `${ab.cooldown.toFixed(1)}s${suffix}`
          : `READY${suffix}`
    const abBar = pick(panel, 'ability-bar')
    const charge = ab.active > 0 ? 1 : ab.cooldownTotal ? 1 - ab.cooldown / ab.cooldownTotal : 1
    abBar.style.width = `${Math.max(0, Math.min(1, charge)) * 100}%`
    abBar.className = `h-full rounded-full ${
      ab.active > 0 ? 'bg-emerald-400' : ready ? 'bg-violet-400' : 'bg-slate-500'
    }`

    panel.className = `rounded-lg bg-black/60 p-3 ring-1 ${
      p.down ? 'opacity-60 ring-red-500/50' : 'ring-white/10'
    }`
  })

  hudControls.innerHTML =
    h.players.length > 1
      ? 'P1: WASD · mouse aim · left click to shoot · R reload · Q swap weapon · E ability · F barricade<br>P2: Arrow keys · auto-aim · fires automatically or with . · N swap weapon · M ability · L barricade'
      : 'WASD / Arrows to move · Mouse to aim · Left click to shoot · R to reload · Q to swap weapon · E ability · F barricade'
}

game.onHud = (h: Hud) => {
  updatePlayerPanels(h)
  missionName.textContent = h.missionName
  missionZone.textContent = h.mapName
  objectiveText.textContent = h.objective
  currentZone.textContent = h.mapName

  mutationBar.classList.toggle('hidden', !h.mutation)
  if (h.mutation) {
    mutationTitle.textContent = h.mutation.alert
      ? `ALERT: Virus Mutating! — ${h.mutation.name}`
      : h.mutation.name
    mutationBlurb.textContent = `${h.mutation.blurb} · ${Math.ceil(h.mutation.time)}s left`
    mutationFill.style.width = `${(h.mutation.time / 20) * 100}%`
    mutationBar.classList.toggle('animate-pulse', h.mutation.alert)
  }

  holdTimerBox.classList.toggle('hidden', !h.hold)
  if (h.hold) {
    const left = Math.ceil(h.hold.time)
    holdClock.textContent = `${Math.floor(left / 60)}:${`${left % 60}`.padStart(2, '0')}`
    holdClock.className = `font-mono text-5xl font-black ${
      left <= 15 ? 'animate-pulse text-red-400' : 'text-white'
    }`
  }

  generatorBar.classList.toggle('hidden', !h.generator)
  if (h.generator) {
    const pct = (h.generator.hp / h.generator.maxHp) * 100
    generatorText.textContent = `${h.generator.hp}/${h.generator.maxHp}`
    generatorFill.style.width = `${pct}%`
    generatorFill.className = `h-full ${
      pct > 50
        ? 'bg-gradient-to-r from-cyan-400 to-sky-600'
        : pct > 25
          ? 'bg-gradient-to-r from-amber-400 to-orange-500'
          : 'bg-gradient-to-r from-red-500 to-rose-700 animate-pulse'
    }`
  }

  truckBar.classList.toggle('hidden', !h.truck)
  if (h.truck) {
    const pct = (h.truck.hp / h.truck.maxHp) * 100
    truckText.textContent = `${h.truck.hp}/${h.truck.maxHp} · ${h.truck.progress}% of the highway`
    truckFill.style.width = `${pct}%`
    truckFill.className = `h-full ${
      pct > 50
        ? 'bg-gradient-to-r from-amber-400 to-orange-600'
        : pct > 25
          ? 'bg-gradient-to-r from-orange-400 to-red-500'
          : 'bg-gradient-to-r from-red-500 to-rose-700 animate-pulse'
    }`
  }
  jungleBar.classList.toggle('hidden', !h.jungle)
  if (h.jungle) {
    jungleLabel.textContent = h.jungle.label
    jungleText.textContent = `${h.jungle.done}/${h.jungle.total}`
    jungleFill.style.width = `${h.jungle.total ? (h.jungle.done / h.jungle.total) * 100 : 0}%`
  }

  bossBar.classList.toggle('hidden', !h.boss)
  if (h.boss) {
    const pct = (h.boss.hp / h.boss.maxHp) * 100
    // The name belongs to this node alone; every other readout is numeric.
    bossName.textContent = h.boss.name.toUpperCase()
    bossPhase.textContent = `PHASE ${h.boss.phase}/${h.boss.maxPhase}${h.boss.phase === 2 ? ' · ENRAGED' : ''}`
    bossHp.textContent = `${h.boss.hp}/${h.boss.maxHp}`
    bossFill.style.width = `${pct}%`
    bossFill.className = `h-full ${
      h.boss.phase === 2 ? 'bg-gradient-to-r from-red-500 to-rose-700 animate-pulse' : 'bg-gradient-to-r from-orange-500 to-red-600'
    }`
  }

  if (h.hold) {
    const done = h.hold.total - h.hold.time
    killText.textContent = `Hold: ${Math.ceil(h.hold.time)}s left`
    missionBar.style.width = `${h.hold.total ? (done / h.hold.total) * 100 : 0}%`
  } else if (h.jungle) {
    killText.textContent = `${h.jungle.label}: ${h.jungle.done}/${h.jungle.total}`
    missionBar.style.width = `${h.jungle.total ? (h.jungle.done / h.jungle.total) * 100 : 0}%`
  } else if (h.isProtect) {
    const total = h.survivors.length
    killText.textContent = `Extracted: ${h.extracted}/${total}`
    missionBar.style.width = `${total ? (h.extracted / total) * 100 : 0}%`
  } else {
    killText.textContent = h.boss
      ? `Boss: ${Math.round((h.boss.hp / h.boss.maxHp) * 100)}%`
      : `Zombies Cleared: ${h.kills}/${h.target}`
    missionBar.style.width = h.boss
      ? `${100 - (h.boss.hp / h.boss.maxHp) * 100}%`
      : `${h.target ? (h.kills / h.target) * 100 : 0}%`
  }

  survivorPanel.classList.toggle('hidden', !h.isProtect)
  if (h.isProtect) {
    if (survivorList.children.length !== h.survivors.length) {
      survivorList.innerHTML = ''
      for (let i = 0; i < h.survivors.length; i++) {
        const row = document.createElement('div')
        row.innerHTML =
          '<div class="flex items-center justify-between text-[11px] text-slate-300"><span></span><span></span></div><div class="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10"><div class="h-full w-full rounded-full bg-emerald-500"></div></div>'
        survivorList.appendChild(row)
      }
    }
    h.survivors.forEach((s, i) => {
      const row = survivorList.children[i]
      const labels = row.querySelectorAll('span')
      labels[0].textContent = `Survivor ${i + 1}`
      const pct = (s.hp / s.maxHp) * 100
      labels[1].textContent = s.safe
        ? 'SAFE'
        : `${Math.round(pct)}%${s.moving ? '' : ' · WAITING'}`
      const fill = row.querySelectorAll<HTMLElement>('div')[2]
      fill.style.width = `${pct}%`
      fill.className = `h-full rounded-full ${
        s.safe ? 'bg-sky-400' : pct > 50 ? 'bg-emerald-500' : pct > 25 ? 'bg-amber-500' : 'bg-red-500'
      }`
    })
  }

  hudWeapon.textContent = h.weaponName
  hudPerk.textContent = h.perkName ? `Talent: ${h.perkName}` : 'No talent'
  hudScrap.textContent = h.chips ? `+${h.scrap} scrap · +${h.chips} chips` : `+${h.scrap} scrap`
}

// Developer cheat code: type "cheat" on the mission board for the prompt.
bindCheatCodes({
  active: () => !menu.classList.contains('hidden'),
  unlockAll: () => {
    profile.completed = MISSIONS.map((m) => m.id)
    profile.scrap += CHEAT_CURRENCY
    profile.chips += CHEAT_CURRENCY
    profile.amber += CHEAT_CURRENCY
    profile.cores += CHEAT_CURRENCY
    persist()
    renderCampaign()
    renderArsenal()
  },
})

el('start-btn').addEventListener('click', startGameFlow)

el('win-btn').addEventListener('click', () => game.toMenu())
el('lose-menu-btn').addEventListener('click', () => game.toMenu())
el('retry-btn').addEventListener('click', () => launch(currentMission))

// Autoplay policies: the audio engine only builds its context after a gesture.
window.addEventListener('pointerdown', resumeAudio)
window.addEventListener('keydown', resumeAudio)

persist()
renderDetail()
renderCharacters()
renderIntro()
game.textures = profile.textures ?? 'classic'
game.ngPlus = profile.ngPlus > 0
game.onStateChange('menu')
stopMusic()
// Every page load opens on the lore crawl before any menu is shown.
show(menu, false)
playStoryIntro(() => {
  if (!profile.textures) {
    show(introScreen, true)
  } else if (!profile.character) {
    show(characterScreen, true)
  } else {
    show(menu, true)
  }
})
