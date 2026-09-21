import type { BindableAction, Settings } from './settings'
import {
  AVATARS,
  BINDABLE_ACTIONS,
  NAME_MAX,
  NAME_MIN,
  cleanName,
  eventCode,
  keyLabel,
  mouseCode,
  resetSettings,
  settings,
  updateSettings,
} from './settings'
import { playSfx } from './audio'
import { clearProfile } from './profile'
import { clearArcadeStats } from './arcadeStats'

export interface SettingsPanel {
  open: (tab?: Tab) => void
  close: () => void
  isOpen: () => boolean
}

export type Tab = 'profile' | 'audio' | 'controls'

/** The slot currently listening for the next key or mouse button. */
interface Capture {
  player: 'p1' | 'p2'
  action: BindableAction
}

const SLOT_CLASS =
  'w-36 rounded-md bg-white/10 px-3 py-1.5 text-xs font-bold text-slate-100 ring-1 ring-white/15 hover:bg-white/20'

export function mountSettings(): SettingsPanel {
  const overlay = document.createElement('div')
  overlay.className =
    'fixed inset-0 z-[60] hidden items-center justify-center bg-slate-950/90 p-4 backdrop-blur-sm'

  const panel = document.createElement('div')
  panel.className =
    'flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-white/15'
  overlay.appendChild(panel)
  document.body.appendChild(overlay)

  let tab: Tab = 'audio'
  let capture: Capture | null = null
  let open = false
  /** Second stage of the wipe: the confirm button only shows once armed. */
  let resetArmed = false

  const close = () => {
    open = false
    capture = null
    resetArmed = false
    overlay.classList.add('hidden')
    overlay.classList.remove('flex')
  }

  const tabButton = (id: Tab, label: string) => {
    const active = tab === id
    const classes = active
      ? 'bg-emerald-500/20 text-emerald-300 ring-emerald-400/50'
      : 'bg-white/5 text-slate-400 ring-white/10 hover:bg-white/10'
    return `<button data-tab="${id}" class="rounded-lg px-5 py-2 text-xs font-black uppercase tracking-widest ring-1 ${classes}">${label}</button>`
  }

  const slot = (player: 'p1' | 'p2', action: BindableAction, code: string) => {
    const listening = capture && capture.player === player && capture.action === action
    const label = listening ? 'Press any key…' : keyLabel(code)
    const extra = listening ? ' animate-pulse ring-amber-400/70 text-amber-200' : ''
    return `<button data-bind="${player}:${action}" class="${SLOT_CLASS}${extra}">${label}</button>`
  }

  const bindingRows = () => {
    const s = settings()
    return BINDABLE_ACTIONS.map(
      (a) => `
        <div class="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-white/5 py-2">
          <span class="text-xs font-semibold uppercase tracking-wider text-slate-400">${a.label}</span>
          ${slot('p1', a.id, s.p1[a.id])}
          ${slot('p2', a.id, s.p2[a.id])}
        </div>`,
    ).join('')
  }

  const profileTab = () => {
    const s = settings()
    const choices = AVATARS.map((a) => {
      const active = s.avatar === a
      const ring = active
        ? 'bg-emerald-500/20 ring-emerald-400/70'
        : 'bg-white/5 ring-white/10 hover:bg-white/10'
      return `<button data-avatar="${a}" class="h-14 w-14 rounded-xl text-3xl leading-none ring-2 ${ring}">${a}</button>`
    }).join('')
    return `
      <label class="mb-2 block text-xs font-black uppercase tracking-widest text-slate-300">Player Name</label>
      <input id="profile-name" type="text" maxlength="${NAME_MAX}" value="${s.playerName}" placeholder="Survivor"
        class="w-full rounded-lg bg-white/10 px-4 py-2 text-sm font-bold text-white ring-1 ring-white/15 outline-none focus:ring-emerald-400/60" />
      <p id="profile-name-hint" class="mt-1 text-[11px] text-slate-500">${NAME_MIN}–${NAME_MAX} characters.</p>
      <div class="mb-2 mt-6 text-xs font-black uppercase tracking-widest text-slate-300">Profile Avatar</div>
      <div class="flex flex-wrap gap-3">${choices}</div>
      <p class="mt-6 text-xs text-slate-500">Name, avatar and volume are saved to this browser automatically.</p>
      <div class="mt-8 rounded-xl bg-rose-500/5 p-4 ring-1 ring-rose-400/30">
        <div class="text-xs font-black uppercase tracking-widest text-rose-300">Danger Zone</div>
        <p class="mt-1 text-xs text-slate-400">Wipes this browser's save: every mission unlock, weapon, currency balance, survivor pick and arcade high score goes back to zero.</p>
        ${
          resetArmed
            ? `<div class="mt-3 rounded-lg bg-rose-500/10 p-3 ring-1 ring-rose-400/50">
                 <div class="text-xs font-bold text-rose-200">Are you sure? This cannot be undone.</div>
                 <div class="mt-3 flex flex-wrap gap-2">
                   <button id="data-reset-confirm" class="rounded-lg bg-rose-500/80 px-4 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-rose-500">Yes, Reset Everything</button>
                   <button id="data-reset-cancel" class="rounded-lg bg-white/10 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-white/20">Cancel</button>
                 </div>
               </div>`
            : `<button id="data-reset" class="mt-3 rounded-lg bg-rose-500/15 px-5 py-2 text-xs font-black uppercase tracking-widest text-rose-300 ring-1 ring-rose-400/40 hover:bg-rose-500/25">Reset Save Data</button>`
        }
      </div>`
  }

  const audioTab = () => {
    const s = settings()
    const row = (id: string, label: string, value: number) => `
      <div class="mb-6">
        <div class="mb-2 flex items-center justify-between text-xs font-black uppercase tracking-widest text-slate-300">
          <span>${label}</span><span id="${id}-value">${Math.round(value * 100)}%</span>
        </div>
        <input id="${id}" type="range" min="0" max="100" value="${Math.round(value * 100)}" class="w-full accent-emerald-400" />
      </div>`
    return `
      ${row('bgm-volume', 'Background Music (BGM)', s.bgmVolume)}
      ${row('sfx-volume', 'Sound Effects (SFX)', s.sfxVolume)}
      <p class="text-xs text-slate-500">Changes apply instantly and are saved to this browser.</p>`
  }

  const controlsTab = () => {
    const s = settings()
    const toggle = (id: string, label: string, active: boolean) => {
      const classes = active
        ? 'bg-emerald-500/20 text-emerald-300 ring-emerald-400/50'
        : 'bg-white/5 text-slate-400 ring-white/10 hover:bg-white/10'
      return `<button data-option="${id}" class="rounded-lg px-4 py-1.5 text-xs font-bold ring-1 ${classes}">${label}</button>`
    }
    return `
      <div class="mb-5 space-y-3">
        <div class="flex flex-wrap items-center gap-2">
          <span class="w-40 text-xs font-black uppercase tracking-widest text-slate-400">P1 Movement</span>
          ${toggle('move-keys', 'WASD / Keys', s.movementMode === 'keys')}
          ${toggle('move-click', 'Click-to-Move (Right Click)', s.movementMode === 'click')}
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span class="w-40 text-xs font-black uppercase tracking-widest text-slate-400">P1 Fire</span>
          ${toggle('fire-mouse', 'Left Click', s.fireBinding === 'mouse')}
          ${toggle('fire-key', 'Bound Shoot Key', s.fireBinding === 'key')}
        </div>
      </div>
      <div class="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-white/10 pb-2 text-[11px] font-black uppercase tracking-widest text-slate-500">
        <span>Action</span><span class="w-36 text-center">Player 1</span><span class="w-36 text-center">Player 2</span>
      </div>
      ${bindingRows()}
      <div class="mt-5 flex justify-end">
        <button id="settings-reset" class="rounded-lg bg-rose-500/15 px-5 py-2 text-xs font-bold text-rose-300 ring-1 ring-rose-400/40 hover:bg-rose-500/25">Reset to Defaults</button>
      </div>`
  }

  const render = () => {
    panel.innerHTML = `
      <div class="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <h2 class="text-lg font-black uppercase tracking-widest text-emerald-300">Settings</h2>
        <button id="settings-close" class="rounded-lg bg-white/10 px-4 py-1.5 text-xs font-bold text-white hover:bg-white/20">Close</button>
      </div>
      <div class="flex gap-2 px-6 py-3">
        ${tabButton('profile', 'Profile')}
        ${tabButton('audio', 'Audio Settings')}
        ${tabButton('controls', 'Controls / Keybindings')}
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        ${tab === 'profile' ? profileTab() : tab === 'audio' ? audioTab() : controlsTab()}
      </div>`
    wire()
  }

  const setVolume = (key: 'bgmVolume' | 'sfxVolume', percent: number) => {
    updateSettings({ [key]: percent / 100 } as Partial<Settings>)
  }

  const wire = () => {
    panel.querySelector('#settings-close')?.addEventListener('click', close)
    for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
      button.addEventListener('click', () => {
        const next = button.dataset.tab
        tab = next === 'controls' ? 'controls' : next === 'profile' ? 'profile' : 'audio'
        capture = null
        render()
      })
    }

    const nameInput = panel.querySelector<HTMLInputElement>('#profile-name')
    const nameHint = panel.querySelector<HTMLElement>('#profile-name-hint')
    nameInput?.addEventListener('input', () => {
      const name = cleanName(nameInput.value)
      if (nameHint) {
        nameHint.textContent = name
          ? `Saved as "${name}".`
          : `Enter at least ${NAME_MIN} characters to save a name.`
      }
      updateSettings({ playerName: name })
    })

    for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-avatar]')) {
      button.addEventListener('click', () => {
        updateSettings({ avatar: button.dataset.avatar ?? AVATARS[0] })
        playSfx('swap')
        render()
      })
    }

    panel.querySelector('#data-reset')?.addEventListener('click', () => {
      resetArmed = true
      render()
    })
    panel.querySelector('#data-reset-cancel')?.addEventListener('click', () => {
      resetArmed = false
      render()
    })
    panel.querySelector('#data-reset-confirm')?.addEventListener('click', () => {
      clearProfile()
      clearArcadeStats()
      // Reload so every menu, loadout and HUD rebuilds from the blank save.
      window.location.reload()
    })

    const slider = (id: string, key: 'bgmVolume' | 'sfxVolume') => {
      const input = panel.querySelector<HTMLInputElement>(`#${id}`)
      const readout = panel.querySelector<HTMLElement>(`#${id}-value`)
      input?.addEventListener('input', () => {
        const percent = Number(input.value)
        if (readout) readout.textContent = `${percent}%`
        setVolume(key, percent)
      })
      // A released slider is a good moment to hear the new SFX level.
      if (key === 'sfxVolume') input?.addEventListener('change', () => playSfx('swap'))
    }
    slider('bgm-volume', 'bgmVolume')
    slider('sfx-volume', 'sfxVolume')

    for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-option]')) {
      button.addEventListener('click', () => {
        switch (button.dataset.option) {
          case 'move-keys':
            updateSettings({ movementMode: 'keys' })
            break
          case 'move-click':
            updateSettings({ movementMode: 'click' })
            break
          case 'fire-mouse':
            updateSettings({ fireBinding: 'mouse' })
            break
          case 'fire-key':
            updateSettings({ fireBinding: 'key' })
            break
        }
        render()
      })
    }

    for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-bind]')) {
      button.addEventListener('click', () => {
        const [player, action] = (button.dataset.bind ?? '').split(':')
        capture = { player: player === 'p2' ? 'p2' : 'p1', action: action as BindableAction }
        render()
      })
    }

    panel.querySelector('#settings-reset')?.addEventListener('click', () => {
      resetSettings()
      capture = null
      render()
    })
  }

  /** Writes the captured code into the slot that is listening for it. */
  const applyCapture = (code: string) => {
    if (!capture) return
    const s = settings()
    const bindings = { ...s[capture.player], [capture.action]: code }
    updateSettings({ [capture.player]: bindings } as Partial<Settings>)
    capture = null
    render()
  }

  // Capture runs in the capture phase so a rebind never leaks into the game.
  window.addEventListener(
    'keydown',
    (e) => {
      if (!open) return
      if (!capture) {
        if (e.key === 'Escape') close()
        return
      }
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        capture = null
        render()
        return
      }
      applyCapture(eventCode(e))
    },
    true,
  )

  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay && !capture) close()
  })
  panel.addEventListener(
    'pointerdown',
    (e) => {
      // Only a slot that is already listening swallows the click as a binding.
      if (!capture) return
      const target = e.target as HTMLElement
      if (target.closest('[data-bind]')) return
      e.preventDefault()
      e.stopPropagation()
      applyCapture(mouseCode(e.button))
    },
    true,
  )
  panel.addEventListener('contextmenu', (e) => {
    if (capture) e.preventDefault()
  })

  return {
    open: (startTab: Tab = 'audio') => {
      open = true
      capture = null
      tab = startTab
      render()
      overlay.classList.remove('hidden')
      overlay.classList.add('flex')
    },
    close,
    isOpen: () => open,
  }
}
