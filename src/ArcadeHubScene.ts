/**
 * ARCADE HUB — the CRT cabinet row that fronts every standalone mini-game.
 * It owns no gameplay: it just shows each cabinet's marquee, its saved high
 * score and play count, and hands control to whichever card is selected.
 */

import { playSfx, resumeAudio } from './audio'
import type { ArcadeGameId } from './arcadeStats'
import { gamesPlayed, highScore, readGauntletStats } from './arcadeStats'

interface CabinetCard {
  id: ArcadeGameId
  title: string
  tag: string
  blurb: string
  /** Tailwind accent colour classes for the card's neon trim. */
  ring: string
  text: string
  glow: string
}

const CARDS: CabinetCard[] = [
  {
    id: 'crimson-highway',
    title: 'Crimson Highway',
    tag: 'Vertical racer · 1P',
    blurb: 'Slide the lanes, twin-laser the bikers, survive the desert run.',
    ring: 'ring-rose-500/60 hover:ring-rose-300',
    text: 'text-rose-300',
    glow: 'hover:shadow-[0_0_40px_rgba(244,63,94,0.45)]',
  },
  {
    id: 'void-blast',
    title: 'Void Blast',
    tag: 'Rail shooter · 1P',
    blurb: 'Bottom-rail blaster against descending alien formations.',
    ring: 'ring-fuchsia-500/60 hover:ring-fuchsia-300',
    text: 'text-fuchsia-300',
    glow: 'hover:shadow-[0_0_40px_rgba(217,70,239,0.45)]',
  },
  {
    id: 'endless-gauntlet',
    title: 'The Endless Highway Gauntlet',
    tag: 'Truck-bed rail · 2P co-op',
    blurb: 'Endless horde, scaling threat, one rig between you. Weld it or die.',
    ring: 'ring-amber-500/60 hover:ring-amber-300',
    text: 'text-amber-300',
    glow: 'hover:shadow-[0_0_40px_rgba(245,158,11,0.45)]',
  },
  {
    id: 'rot-fighter',
    title: 'Rot Fighter',
    tag: 'Versus fighter · 1P ladder / 2P',
    blurb: 'Light, heavy, special and guard. Spacing wins, mashing loses.',
    ring: 'ring-lime-500/60 hover:ring-lime-300',
    text: 'text-lime-300',
    glow: 'hover:shadow-[0_0_40px_rgba(132,204,22,0.45)]',
  },
]

export interface ArcadeHub {
  open: () => void
  close: () => void
  isOpen: () => boolean
}

/**
 * @param onSelect launches the chosen cabinet; the hub hides itself first.
 * @param onBack returns to the main menu.
 */
export function mountArcadeHub(
  onSelect: (game: ArcadeGameId) => void,
  onBack: () => void,
): ArcadeHub {
  const overlay = document.createElement('div')
  overlay.className =
    'fixed inset-0 z-30 hidden flex-col items-center justify-center bg-black/95 p-4'

  const shell = document.createElement('div')
  shell.className =
    'relative w-full max-w-4xl overflow-hidden rounded-3xl border-4 border-slate-700 bg-slate-950/95 p-6 ring-4 ring-cyan-500/30 shadow-[0_0_80px_rgba(34,211,238,0.25)]'
  // Scanline wash over the whole cabinet, for the CRT feel.
  shell.style.backgroundImage =
    'repeating-linear-gradient(rgba(148,163,184,0.07) 0 1px, transparent 1px 3px)'

  shell.innerHTML = `
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-3xl font-black uppercase tracking-[0.3em] text-cyan-300 drop-shadow-[0_0_14px_rgba(34,211,238,0.9)]">Arcade Hub</h2>
        <p class="pt-1 text-[11px] uppercase tracking-[0.35em] text-slate-500">Insert coin · select cabinet</p>
      </div>
      <button id="arcade-hub-back" class="rounded-lg bg-cyan-500/15 px-4 py-2 text-xs font-black uppercase tracking-widest text-cyan-200 ring-1 ring-cyan-400/60 hover:bg-cyan-500/30">← Back to Main Menu</button>
    </div>
    <div id="arcade-hub-cards" class="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-4"></div>
  `

  overlay.appendChild(shell)
  document.body.appendChild(overlay)

  const cardHost = shell.querySelector<HTMLDivElement>('#arcade-hub-cards')
  if (!cardHost) throw new Error('arcade hub cards host missing')

  let open = false

  const statLine = (card: CabinetCard): string => {
    const plays = gamesPlayed(card.id)
    if (card.id === 'endless-gauntlet') {
      const stats = readGauntletStats()
      return `
        <div class="flex justify-between"><span class="text-slate-500">Best run</span><span class="${card.text}">${stats.maxDistance} m</span></div>
        <div class="flex justify-between"><span class="text-slate-500">Zombies killed</span><span class="${card.text}">${stats.zombiesKilled}</span></div>
        <div class="flex justify-between"><span class="text-slate-500">Games played</span><span class="${card.text}">${plays}</span></div>
      `
    }
    return `
      <div class="flex justify-between"><span class="text-slate-500">High score</span><span class="${card.text}">${highScore(card.id)}</span></div>
      <div class="flex justify-between"><span class="text-slate-500">Games played</span><span class="${card.text}">${plays}</span></div>
    `
  }

  const renderCards = () => {
    cardHost.innerHTML = ''
    for (const card of CARDS) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `group flex flex-col gap-3 rounded-2xl bg-slate-900/80 p-4 text-left ring-2 transition ${card.ring} ${card.glow}`
      button.innerHTML = `
        <div>
          <div class="text-sm font-black uppercase tracking-[0.2em] ${card.text}">${card.title}</div>
          <div class="pt-1 text-[10px] uppercase tracking-[0.25em] text-slate-500">${card.tag}</div>
        </div>
        <p class="text-xs leading-relaxed text-slate-400">${card.blurb}</p>
        <div class="mt-auto space-y-1 rounded-lg bg-black/50 p-2 text-[11px] font-semibold uppercase tracking-wider">${statLine(card)}</div>
        <div class="text-center text-[10px] font-black uppercase tracking-[0.3em] text-slate-600 group-hover:text-slate-300">Press to play</div>
      `
      button.addEventListener('mouseenter', () => playSfx('swap'))
      button.addEventListener('click', () => {
        playSfx('overdrive')
        hide()
        onSelect(card.id)
      })
      cardHost.appendChild(button)
    }
  }

  const hide = () => {
    open = false
    overlay.classList.add('hidden')
    overlay.classList.remove('flex')
  }

  function close() {
    if (!open) return
    playSfx('swap')
    hide()
    onBack()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) return
    if (e.key.toLowerCase() !== 'escape') return
    e.stopPropagation()
    close()
  }

  shell.querySelector<HTMLButtonElement>('#arcade-hub-back')?.addEventListener('click', () => close())
  window.addEventListener('keydown', onKeyDown, true)

  return {
    open: () => {
      if (open) return
      open = true
      resumeAudio()
      // Scores may have changed in a cabinet since the hub was last shown.
      renderCards()
      overlay.classList.remove('hidden')
      overlay.classList.add('flex')
    },
    close,
    isOpen: () => open,
  }
}
