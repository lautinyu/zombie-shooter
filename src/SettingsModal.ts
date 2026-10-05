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
import type { Profile } from './profile'
import { campaignCleared, clearProfile, ngPlusUnlocked } from './profile'
import type { SurvivorSkinId } from './survivorSkins'
import { SURVIVOR_SKINS, drawSurvivor, skinUnlockHint, skinUnlocked } from './survivorSkins'
import { clearArcadeStats } from './arcadeStats'
import {
  PASSWORD_WARNING,
  overwriteCloudSave,
  cloudAvailable,
  currentAccount,
  login,
  logout,
  onAccountChange,
  register,
} from './cloud/account'

export interface SettingsPanel {
  open: (tab?: Tab) => void
  close: () => void
  isOpen: () => boolean
}

export type Tab = 'profile' | 'audio' | 'controls'

/** The live campaign save the Locker reads and equips skins on. */
export interface LockerHost {
  profile: () => Profile
  save: () => void
  /** Opens the Skin Shop on top of the settings panel. */
  openShop?: () => void
}

/** The slot currently listening for the next key or mouse button. */
interface Capture {
  player: 'p1' | 'p2'
  action: BindableAction
}

const SLOT_CLASS =
  'w-36 rounded-md bg-white/10 px-3 py-1.5 text-xs font-bold text-slate-100 ring-1 ring-white/15 hover:bg-white/20'

export function mountSettings(locker: LockerHost): SettingsPanel {
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
  /** Last account message shown under the login form. */
  let authNotice = ''
  let authError = false
  let authUsername = ''
  let authBusy = false

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

  const accountSection = () => {
    const s = settings()
    const account = currentAccount()
    const notice = authNotice
      ? `<p class="mt-3 text-xs font-bold ${authError ? 'text-rose-300' : 'text-emerald-300'}">${authNotice}</p>`
      : ''
    if (!cloudAvailable()) {
      return `
        <div class="mb-8 rounded-xl bg-white/5 p-4 ring-1 ring-white/10">
          <div class="text-xs font-black uppercase tracking-widest text-slate-300">Account</div>
          <p class="mt-2 text-xs text-slate-400">Cloud saves are switched off on this build — you are playing as a guest and progress is stored in this browser only.</p>
        </div>`
    }
    if (account) {
      return `
        <div class="mb-8 rounded-xl bg-emerald-500/5 p-4 ring-1 ring-emerald-400/30">
          <div class="text-xs font-black uppercase tracking-widest text-slate-300">Account</div>
          <div class="mt-3 flex items-center gap-4">
            <div class="flex h-14 w-14 items-center justify-center rounded-xl bg-white/10 text-3xl leading-none ring-2 ring-emerald-400/60">${s.avatar}</div>
            <div class="min-w-0">
              <div class="truncate text-lg font-black text-white">${account.username}</div>
              <div class="text-xs font-bold text-emerald-300">🟢 Cloud Save Active</div>
            </div>
            <button id="account-logout" class="ml-auto rounded-lg bg-white/10 px-5 py-2 text-xs font-black uppercase tracking-widest text-slate-100 ring-1 ring-white/15 hover:bg-white/20">Log Out</button>
          </div>
          <p class="mt-3 text-[11px] text-slate-500">Progress, loadout, currency, arcade records, keybindings and audio are saved to the cloud as you play.</p>
          ${notice}
        </div>`
    }
    return `
      <div class="mb-8 rounded-xl bg-white/5 p-4 ring-1 ring-white/10">
        <div class="text-xs font-black uppercase tracking-widest text-slate-300">Account</div>
        <p class="mt-1 text-xs text-slate-400">Log in to carry your campaign, loadout and high scores to any device.</p>
        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          <input id="account-username" type="text" autocomplete="username" placeholder="Username" value="${authUsername}"
            class="w-full rounded-lg bg-white/10 px-4 py-2 text-sm font-bold text-white ring-1 ring-white/15 outline-none focus:ring-emerald-400/60" />
          <input id="account-password" type="password" autocomplete="current-password" placeholder="Password"
            class="w-full rounded-lg bg-white/10 px-4 py-2 text-sm font-bold text-white ring-1 ring-white/15 outline-none focus:ring-emerald-400/60" />
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <button id="account-login" class="rounded-lg bg-emerald-500/80 px-5 py-2 text-xs font-black uppercase tracking-widest text-slate-950 hover:bg-emerald-400">Log In</button>
          <button id="account-register" class="rounded-lg bg-white/10 px-5 py-2 text-xs font-black uppercase tracking-widest text-slate-100 ring-1 ring-white/15 hover:bg-white/20">Create Account</button>
          <button id="account-guest" class="rounded-lg bg-white/5 px-5 py-2 text-xs font-black uppercase tracking-widest text-slate-400 ring-1 ring-white/10 hover:bg-white/10">Play as Guest / Offline</button>
        </div>
        <p class="mt-3 text-[11px] text-amber-300">⚠ ${PASSWORD_WARNING}</p>
        ${notice}
      </div>`
  }

  const lockerSection = () => {
    const profile = locker.profile()
    const cleared = campaignCleared(profile)
    const ngPlus = ngPlusUnlocked(profile)
    const card = (key: string, id: SurvivorSkinId | null, name: string, blurb: string, ring: string, text: string, unlocked: boolean, hint: string) => {
      const equipped = profile.skin === id
      const border = equipped
        ? `ring-2 ${ring} bg-white/10 shadow-[0_0_18px_rgba(255,255,255,0.12)]`
        : unlocked
          ? 'ring-1 ring-white/10 bg-black/40 hover:bg-white/10 hover:ring-white/30'
          : 'ring-1 ring-white/5 bg-black/30 opacity-60 cursor-not-allowed'
      return `
        <button data-skin="${id ?? 'default'}" ${unlocked ? '' : 'disabled'} class="relative flex flex-col items-center gap-1 rounded-xl p-3 text-center transition ${border}">
          <span class="absolute left-2 top-2 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] font-black text-slate-300 ring-1 ring-white/15">${key}</span>
          ${equipped ? '<span class="absolute right-2 top-2 rounded bg-emerald-500/80 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-950">Equipped</span>' : ''}
          <canvas data-skin-preview="${id ?? 'default'}" width="96" height="96" class="h-20 w-20 rounded-lg bg-slate-800/70 ring-1 ring-white/10"></canvas>
          <span class="text-xs font-black uppercase tracking-widest ${text}">${name}</span>
          <span class="text-[10px] leading-tight text-slate-400">${unlocked ? blurb : `🔒 ${hint}`}</span>
        </button>`
    }
    const cards = [
      card('0', null, 'Survivor', "Your survivor's own outfit.", 'ring-slate-300', 'text-slate-200', true, ''),
      ...SURVIVOR_SKINS.map((skin, i) =>
        card(i < 9 ? `${i + 1}` : '·', skin.id, skin.name, skin.blurb, skin.ring, skin.text, skinUnlocked(skin, cleared, ngPlus, profile.ownedSkins), skinUnlockHint(skin)),
      ),
    ].join('')
    return `
      <div class="mb-6 rounded-xl bg-white/5 p-4 ring-1 ring-white/10">
        <div class="flex items-baseline justify-between gap-3">
          <div class="text-xs font-black uppercase tracking-widest text-slate-300">Locker / Character Skins</div>
          <div class="flex items-center gap-3">
            <div class="text-[10px] uppercase tracking-widest text-slate-500">Press 0–${Math.min(9, SURVIVOR_SKINS.length)} to equip</div>
            <button id="locker-open-shop" class="rounded-md bg-fuchsia-500/20 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-fuchsia-200 ring-1 ring-fuchsia-400/40 hover:bg-fuchsia-500/30">🎨 Skin Shop · 🪙 ${profile.zcoins}</button>
          </div>
        </div>
        <p class="mt-1 text-[11px] text-slate-500">Worn by Player 1 in campaign missions. Saved with your profile and cloud save.</p>
        <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">${cards}</div>
      </div>`
  }

  const equipSkin = (value: string | undefined) => {
    const profile = locker.profile()
    const cleared = campaignCleared(profile)
    const ngPlus = ngPlusUnlocked(profile)
    const skin = SURVIVOR_SKINS.find((s) => s.id === value)
    if (value !== 'default' && (!skin || !skinUnlocked(skin, cleared, ngPlus, profile.ownedSkins))) return
    const next = skin ? skin.id : null
    if (profile.skin === next) return
    profile.skin = next
    locker.save()
    playSfx('swap')
    render()
  }

  const drawSkinPreviews = () => {
    const profile = locker.profile()
    for (const canvas of panel.querySelectorAll<HTMLCanvasElement>('[data-skin-preview]')) {
      const c = canvas.getContext('2d')
      if (!c) continue
      const id = SURVIVOR_SKINS.find((s) => s.id === canvas.dataset.skinPreview)?.id
      c.clearRect(0, 0, canvas.width, canvas.height)
      c.save()
      c.translate(48, 50)
      c.scale(2.5, 2.5)
      c.rotate(-Math.PI / 2)
      c.fillStyle = '#1f2937'
      c.fillRect(6, -3.5, 22, 7)
      if (id) {
        drawSurvivor(c, id, 0, 0)
      } else {
        c.fillStyle = '#475569'
        c.beginPath()
        c.arc(0, 0, 12, 0, Math.PI * 2)
        c.fill()
        c.fillStyle = '#e2e8f0'
        c.font = '900 12px ui-sans-serif, system-ui, sans-serif'
        c.textAlign = 'center'
        c.textBaseline = 'middle'
        c.rotate(Math.PI / 2)
        c.fillText(profile.character ? '★' : '?', 0, 1)
      }
      c.restore()
    }
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
      ${accountSection()}
      ${lockerSection()}
      <label class="mb-2 block text-xs font-black uppercase tracking-widest text-slate-300">Player Name</label>
      <input id="profile-name" type="text" maxlength="${NAME_MAX}" value="${s.playerName}" placeholder="Survivor"
        class="w-full rounded-lg bg-white/10 px-4 py-2 text-sm font-bold text-white ring-1 ring-white/15 outline-none focus:ring-emerald-400/60" />
      <p id="profile-name-hint" class="mt-1 text-[11px] text-slate-500">${NAME_MIN}–${NAME_MAX} characters.</p>
      <div class="mb-2 mt-6 text-xs font-black uppercase tracking-widest text-slate-300">Profile Avatar</div>
      <div class="flex flex-wrap gap-3">${choices}</div>
      <p class="mt-6 text-xs text-slate-500">Name, avatar and volume are saved to this browser automatically.</p>
      <div class="mt-8 rounded-xl bg-rose-500/5 p-4 ring-1 ring-rose-400/30">
        <div class="text-xs font-black uppercase tracking-widest text-rose-300">Danger Zone</div>
        <p class="mt-1 text-xs text-slate-400">Wipes your save, here and in your cloud account: every mission unlock, weapon, Scrap, Chips, Amber, Cores and Z-Coins balance, owned and equipped skin, survivor pick and arcade high score goes back to zero.</p>
        ${
          resetArmed
            ? `<div class="mt-3 rounded-lg bg-rose-500/10 p-3 ring-1 ring-rose-400/50">
                 <div class="text-xs font-bold text-rose-200">Are you sure you want to reset all game data? This cannot be undone.</div>
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

    for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-skin]')) {
      button.addEventListener('click', () => equipSkin(button.dataset.skin))
    }
    panel.querySelector('#locker-open-shop')?.addEventListener('click', () => {
      close()
      locker.openShop?.()
    })
    drawSkinPreviews()

    for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-avatar]')) {
      button.addEventListener('click', () => {
        updateSettings({ avatar: button.dataset.avatar ?? AVATARS[0] })
        playSfx('swap')
        render()
      })
    }

    const usernameField = panel.querySelector<HTMLInputElement>('#account-username')
    const passwordField = panel.querySelector<HTMLInputElement>('#account-password')
    usernameField?.addEventListener('input', () => {
      authUsername = usernameField.value
    })

    const runAuth = async (action: 'login' | 'register') => {
      if (authBusy) return
      const username = usernameField?.value.trim() ?? ''
      const password = passwordField?.value ?? ''
      authBusy = true
      authUsername = username
      authNotice = action === 'login' ? 'Signing in…' : 'Creating account…'
      authError = false
      render()
      try {
        if (action === 'login') await login(username, password)
        else await register(username, password)
        authNotice = ''
        authError = false
        playSfx('swap')
      } catch (error) {
        authNotice = error instanceof Error ? error.message : 'Something went wrong.'
        authError = true
      } finally {
        authBusy = false
        render()
      }
    }

    panel.querySelector('#account-login')?.addEventListener('click', () => void runAuth('login'))
    panel
      .querySelector('#account-register')
      ?.addEventListener('click', () => void runAuth('register'))
    passwordField?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void runAuth('login')
    })
    panel.querySelector('#account-guest')?.addEventListener('click', () => {
      authNotice = 'Playing offline — progress is saved in this browser only.'
      authError = false
      render()
      close()
    })
    panel.querySelector('#account-logout')?.addEventListener('click', () => {
      void logout().then(() => {
        authNotice = 'Logged out. This browser is back on its local save.'
        authError = false
        render()
      })
    })

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
      void overwriteCloudSave().finally(() => window.location.reload())
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
        const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
        const slot = /^Digit(\d)$/.exec(e.code)
        if (tab === 'profile' && slot && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const index = Number(slot[1])
          if (index <= Math.min(9, SURVIVOR_SKINS.length)) {
            e.preventDefault()
            e.stopPropagation()
            equipSkin(index === 0 ? 'default' : SURVIVOR_SKINS[index - 1].id)
          }
        }
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

  // A session restored by Firebase arrives after mount, so redraw the tab.
  onAccountChange(() => {
    if (open && tab === 'profile') render()
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
