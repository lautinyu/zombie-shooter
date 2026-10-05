import { playSfx } from './audio'
import type { GunSkinId } from './gunSkins'
import { GUN_SKINS, paintGun } from './gunSkins'
import type { ExchangeResource, Profile } from './profile'
import { ZCOIN_RATE, campaignCleared, exchangeForZCoins, ngPlusUnlocked } from './profile'
import type { SurvivorSkin, SurvivorSkinId } from './survivorSkins'
import { SURVIVOR_SKINS, drawSurvivor, skinUnlockHint, skinUnlocked } from './survivorSkins'
import { weaponById } from './weapons'

/** The live save the shop spends Z-Coins from and equips cosmetics on. */
export interface SkinShopHost {
  profile: () => Profile
  save: () => void
}

export type ShopTab = 'characters' | 'weapons' | 'exchange'

export interface SkinShop {
  open: (tab?: ShopTab) => void
  close: () => void
  isOpen: () => boolean
}

type Slot = 'primary' | 'secondary'

export function mountSkinShop(host: SkinShopHost): SkinShop {
  const overlay = document.createElement('div')
  overlay.className = 'fixed inset-0 z-[70] hidden items-center justify-center bg-slate-950/90 p-4 backdrop-blur-sm'
  const panel = document.createElement('div')
  panel.className =
    'flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-fuchsia-400/30'
  overlay.appendChild(panel)
  document.body.appendChild(overlay)

  let open = false
  let tab: ShopTab = 'characters'
  let notice = ''
  let raf = 0

  const close = () => {
    open = false
    cancelAnimationFrame(raf)
    overlay.classList.add('hidden')
    overlay.classList.remove('flex')
  }

  const pill = (text: string, cls: string) =>
    `<span class="rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${cls}">${text}</span>`

  const characterCard = (skin: SurvivorSkin, profile: Profile) => {
    const unlocked = skinUnlocked(skin, campaignCleared(profile), ngPlusUnlocked(profile), profile.ownedSkins)
    const equipped = profile.skin === skin.id
    const affordable = profile.zcoins >= skin.price
    const status = equipped
      ? pill('Equipped', 'bg-emerald-500/80 text-slate-950')
      : unlocked
        ? pill(profile.ownedSkins.includes(skin.id) ? 'Owned' : 'Unlocked', 'bg-sky-500/30 text-sky-200')
        : pill(`${skin.price} Z`, affordable ? 'bg-yellow-400/90 text-yellow-950' : 'bg-white/10 text-slate-400')
    const action = equipped
      ? '<span class="text-[10px] font-bold uppercase tracking-widest text-emerald-300">Wearing</span>'
      : unlocked
        ? `<button data-equip-skin="${skin.id}" class="rounded-md bg-emerald-500/80 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-950 hover:bg-emerald-400">Equip</button>`
        : `<button data-buy-skin="${skin.id}" class="rounded-md px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
            affordable ? 'bg-yellow-400 text-yellow-950 hover:bg-yellow-300' : 'bg-white/10 text-slate-400'
          }">Buy · ${skin.price}</button>`
    return `
      <div class="relative flex flex-col items-center gap-1 rounded-xl p-3 text-center ${
        equipped ? `ring-2 ${skin.ring} bg-white/10` : 'bg-black/40 ring-1 ring-white/10'
      }">
        <span class="absolute right-2 top-2">${status}</span>
        <canvas data-shop-skin="${skin.id}" width="96" height="96" class="h-20 w-20 rounded-lg bg-slate-800/70 ring-1 ring-white/10"></canvas>
        <span class="text-xs font-black uppercase tracking-widest ${skin.text}">${skin.name}</span>
        <span class="text-[10px] leading-tight text-slate-400">${skin.blurb}</span>
        ${!unlocked && !skin.shopOnly ? `<span class="text-[9px] leading-tight text-slate-500">or ${skinUnlockHint(skin).toLowerCase()}</span>` : ''}
        <div class="pt-1">${action}</div>
      </div>`
  }

  const gunCard = (id: GunSkinId | null, profile: Profile) => {
    const def = id ? GUN_SKINS.find((g) => g.id === id) : null
    const owned = !id || profile.ownedGunSkins.includes(id)
    const affordable = def ? profile.zcoins >= def.price : true
    const slotButton = (slot: Slot) => {
      const on = profile.gunSkins[slot] === id
      return `<button data-equip-gun="${id ?? 'stock'}" data-slot="${slot}" class="rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-widest ${
        on ? 'bg-emerald-500/80 text-slate-950' : 'bg-white/10 text-slate-200 hover:bg-white/20'
      }">${on ? '✓ ' : ''}${slot === 'primary' ? 'Primary' : 'Secondary'}</button>`
    }
    const actions = owned
      ? `<div class="flex gap-1">${slotButton('primary')}${slotButton('secondary')}</div>`
      : `<button data-buy-gun="${id}" class="rounded-md px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
          affordable ? 'bg-yellow-400 text-yellow-950 hover:bg-yellow-300' : 'bg-white/10 text-slate-400'
        }">Buy · ${def?.price ?? 0}</button>`
    return `
      <div class="flex flex-col items-center gap-1 rounded-xl bg-black/40 p-3 text-center ring-1 ${def ? def.ring : 'ring-white/10'}">
        <canvas data-shop-gun="${id ?? 'stock'}" width="160" height="60" class="h-[60px] w-40 rounded-lg bg-slate-800/70 ring-1 ring-white/10"></canvas>
        <span class="text-xs font-black uppercase tracking-widest ${def ? def.text : 'text-slate-200'}">${def ? def.name : 'Stock Finish'}</span>
        <span class="text-[10px] leading-tight text-slate-400">${def ? def.blurb : 'Factory paint.'}</span>
        ${owned && def ? pill('Owned', 'bg-sky-500/30 text-sky-200') : ''}
        <div class="pt-1">${actions}</div>
      </div>`
  }

  const RESOURCES: { id: ExchangeResource; label: string; text: string }[] = [
    { id: 'scrap', label: '🔩 Scrap', text: 'text-yellow-300' },
    { id: 'chips', label: '❄ Data Chips', text: 'text-cyan-300' },
    { id: 'amber', label: '🟠 Ancient Amber', text: 'text-amber-300' },
    { id: 'cores', label: '⚙️ Rust Cores', text: 'text-orange-300' },
  ]
  const resourceLabel = (res: ExchangeResource) => RESOURCES.find((r) => r.id === res)?.label ?? res

  const exchangeCard = (res: ExchangeResource, profile: Profile) => {
    const have = profile[res]
    const rate = ZCOIN_RATE[res]
    return `
      <div class="rounded-xl bg-black/40 p-4 ring-1 ring-white/10">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <span class="text-sm font-black uppercase tracking-widest ${RESOURCES.find((r) => r.id === res)?.text ?? 'text-slate-200'}">${resourceLabel(res)}</span>
          <span class="font-mono text-xs text-slate-400">You have ${have} · 1 = ${rate} Z-Coin${rate === 1 ? '' : 's'}</span>
        </div>
        <input data-ex-range="${res}" type="range" min="0" max="${have}" step="1" value="0" ${have === 0 ? 'disabled' : ''} class="mt-3 w-full accent-yellow-400" />
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <input data-ex-qty="${res}" type="number" inputmode="numeric" min="0" max="${have}" step="1" value="0" class="w-28 rounded-md bg-slate-800 px-2 py-1 font-mono text-sm text-white ring-1 ring-white/10" />
          <button data-ex-max="${res}" class="rounded-md bg-white/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-slate-200 hover:bg-white/20">Max</button>
          <span data-ex-out="${res}" class="font-mono text-sm font-bold text-yellow-300">= 0 Z-Coins</span>
          <button data-ex-go="${res}" class="ml-auto rounded-md bg-yellow-400 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-yellow-950 hover:bg-yellow-300">Convert</button>
        </div>
      </div>`
  }

  const render = () => {
    const profile = host.profile()
    const tabButton = (id: ShopTab, label: string) =>
      `<button data-shop-tab="${id}" class="rounded-lg px-5 py-2 text-xs font-black uppercase tracking-widest ring-1 ${
        tab === id ? 'bg-fuchsia-500/20 text-fuchsia-200 ring-fuchsia-400/50' : 'bg-white/5 text-slate-400 ring-white/10 hover:bg-white/10'
      }">${label}</button>`
    const body =
      tab === 'exchange'
        ? `<p class="mb-3 text-[11px] text-slate-500">Turn campaign currencies into Z-Coins. Pick an amount with the slider or type it in; exchanges are final.</p>
           <div class="grid gap-3 md:grid-cols-2">${RESOURCES.map((r) => exchangeCard(r.id, profile)).join('')}</div>`
        : tab === 'characters'
        ? `<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">${SURVIVOR_SKINS.filter((s) => s.price > 0)
            .map((s) => characterCard(s, profile))
            .join('')}</div>
           <p class="mt-3 text-[11px] text-slate-500">Character skins are worn by Player 1 in campaign and NG+ missions. Class skins in the Locker stay free.</p>`
        : `<p class="mb-3 text-[11px] text-slate-500">Equipped on: <span class="font-bold text-slate-300">${weaponById(profile.primary).name}</span> (primary) · <span class="font-bold text-slate-300">${weaponById(profile.secondary).name}</span> (secondary). Camos are cosmetic only and follow the slot, in campaign and Endless Horde.</p>
           <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">${[null, ...GUN_SKINS.map((g) => g.id)]
             .map((id) => gunCard(id, profile))
             .join('')}</div>`
    panel.innerHTML = `
      <div class="flex items-center justify-between gap-3 border-b border-white/10 px-6 py-4">
        <div>
          <div class="text-2xl font-black tracking-tight text-fuchsia-300">SKIN SHOP</div>
          <div class="text-[11px] uppercase tracking-widest text-slate-500">Exchange campaign currencies, spend Z-Coins on outfits and camos</div>
        </div>
        <div class="flex items-center gap-3">
          <span class="rounded-full bg-yellow-400/15 px-4 py-1.5 font-mono text-sm font-black text-yellow-300 ring-1 ring-yellow-400/40">🪙 ${profile.zcoins} Z-Coins</span>
          <span class="hidden rounded-full bg-white/5 px-3 py-1.5 font-mono text-xs font-bold text-slate-300 ring-1 ring-white/10 sm:inline">🔩 ${profile.scrap} · <span class="text-cyan-300">❄ ${profile.chips}</span> · <span class="text-amber-300">🟠 ${profile.amber}</span> · <span class="text-orange-300">⚙️ ${profile.cores}</span></span>
          <button data-shop-close class="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-black text-slate-200 hover:bg-white/20">✕</button>
        </div>
      </div>
      <div class="flex gap-2 px-6 pt-4">${tabButton('characters', 'Character Skins')}${tabButton('weapons', 'Gun Skins')}${tabButton('exchange', 'Exchange')}</div>
      <div class="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        ${notice ? `<div class="mb-3 rounded-lg bg-white/5 px-3 py-2 text-xs font-bold text-amber-300 ring-1 ring-white/10">${notice}</div>` : ''}
        ${body}
      </div>`
    bind()
  }

  const buy = (price: number, grant: (p: Profile) => void, label: string) => {
    const profile = host.profile()
    if (profile.zcoins < price) {
      notice = `Need ${price - profile.zcoins} more Z-Coins for ${label}.`
      playSfx('denied')
      render()
      return
    }
    profile.zcoins -= price
    grant(profile)
    host.save()
    notice = `${label} unlocked.`
    playSfx('coin')
    render()
  }

  const bind = () => {
    panel.querySelector('[data-shop-close]')?.addEventListener('click', close)
    for (const b of panel.querySelectorAll<HTMLButtonElement>('[data-shop-tab]')) {
      b.addEventListener('click', () => {
        const next = b.dataset.shopTab
        tab = next === 'weapons' || next === 'exchange' ? next : 'characters'
        notice = ''
        render()
      })
    }
    for (const { id: res } of RESOURCES) {
      const range = panel.querySelector<HTMLInputElement>(`[data-ex-range="${res}"]`)
      const qty = panel.querySelector<HTMLInputElement>(`[data-ex-qty="${res}"]`)
      const out = panel.querySelector<HTMLElement>(`[data-ex-out="${res}"]`)
      if (!range || !qty || !out) continue
      const sync = (raw: number) => {
        const have = host.profile()[res]
        const amount = Math.max(0, Math.min(have, Math.floor(Number.isFinite(raw) ? raw : 0)))
        range.value = `${amount}`
        qty.value = `${amount}`
        out.textContent = `= ${amount * ZCOIN_RATE[res]} Z-Coins`
        return amount
      }
      range.addEventListener('input', () => sync(Number(range.value)))
      qty.addEventListener('input', () => sync(Number(qty.value)))
      panel.querySelector(`[data-ex-max="${res}"]`)?.addEventListener('click', () => sync(host.profile()[res]))
      panel.querySelector(`[data-ex-go="${res}"]`)?.addEventListener('click', () => {
        const amount = sync(Number(qty.value))
        if (amount === 0) {
          notice = `Choose how much ${resourceLabel(res)} to exchange.`
          playSfx('denied')
          render()
          return
        }
        const gained = exchangeForZCoins(host.profile(), res, amount)
        host.save()
        notice = `Exchanged ${amount} ${resourceLabel(res)} for ${gained} Z-Coins.`
        playSfx('coin')
        render()
      })
    }
    for (const b of panel.querySelectorAll<HTMLButtonElement>('[data-buy-skin]')) {
      const skin = SURVIVOR_SKINS.find((s) => s.id === b.dataset.buySkin)
      if (!skin) continue
      b.addEventListener('click', () =>
        buy(skin.price, (p) => {
          if (!p.ownedSkins.includes(skin.id)) p.ownedSkins.push(skin.id)
          p.skin = skin.id
        }, skin.name),
      )
    }
    for (const b of panel.querySelectorAll<HTMLButtonElement>('[data-equip-skin]')) {
      const skin = SURVIVOR_SKINS.find((s) => s.id === b.dataset.equipSkin)
      if (!skin) continue
      b.addEventListener('click', () => {
        const profile = host.profile()
        profile.skin = skin.id
        host.save()
        playSfx('swap')
        render()
      })
    }
    for (const b of panel.querySelectorAll<HTMLButtonElement>('[data-buy-gun]')) {
      const gun = GUN_SKINS.find((g) => g.id === b.dataset.buyGun)
      if (!gun) continue
      b.addEventListener('click', () =>
        buy(gun.price, (p) => {
          if (!p.ownedGunSkins.includes(gun.id)) p.ownedGunSkins.push(gun.id)
          p.gunSkins.primary = gun.id
        }, gun.name),
      )
    }
    for (const b of panel.querySelectorAll<HTMLButtonElement>('[data-equip-gun]')) {
      b.addEventListener('click', () => {
        const profile = host.profile()
        const slot: Slot = b.dataset.slot === 'secondary' ? 'secondary' : 'primary'
        const gun = GUN_SKINS.find((g) => g.id === b.dataset.equipGun)
        if (gun && !profile.ownedGunSkins.includes(gun.id)) return
        profile.gunSkins[slot] = gun ? gun.id : null
        host.save()
        playSfx('swap')
        render()
      })
    }
  }

  const drawPreviews = (t: number) => {
    for (const canvas of panel.querySelectorAll<HTMLCanvasElement>('[data-shop-skin]')) {
      const c = canvas.getContext('2d')
      const skin = SURVIVOR_SKINS.find((s) => s.id === canvas.dataset.shopSkin)
      if (!c || !skin) continue
      drawSkin(c, skin.id, t)
    }
    for (const canvas of panel.querySelectorAll<HTMLCanvasElement>('[data-shop-gun]')) {
      const c = canvas.getContext('2d')
      if (!c) continue
      const gun = GUN_SKINS.find((g) => g.id === canvas.dataset.shopGun)
      c.clearRect(0, 0, canvas.width, canvas.height)
      c.save()
      c.translate(20, 30)
      c.scale(3, 3)
      paintGun(c, gun ? gun.id : null, 0, -3.5, 34, 7, '#1f2937', t)
      c.fillStyle = 'rgba(0,0,0,0.35)'
      c.fillRect(4, 3.5, 5, 5)
      c.restore()
    }
  }

  const drawSkin = (c: CanvasRenderingContext2D, id: SurvivorSkinId, t: number) => {
    c.clearRect(0, 0, 96, 96)
    c.save()
    c.translate(48, 50)
    c.scale(2.5, 2.5)
    c.rotate(-Math.PI / 2)
    c.fillStyle = '#1f2937'
    c.fillRect(6, -3.5, 22, 7)
    drawSurvivor(c, id, t * 4, t)
    c.restore()
  }

  const tick = (now: number) => {
    if (!open) return
    drawPreviews(now / 1000)
    raf = requestAnimationFrame(tick)
  }

  window.addEventListener('keydown', (e) => {
    if (open && e.key === 'Escape') {
      e.stopPropagation()
      close()
    }
  }, true)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close()
  })

  return {
    open: (next?: ShopTab) => {
      if (next) tab = next
      notice = ''
      open = true
      overlay.classList.remove('hidden')
      overlay.classList.add('flex')
      render()
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(tick)
    },
    close,
    isOpen: () => open,
  }
}
