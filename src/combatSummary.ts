/** Per-run combat tallies shown on the end-of-run summary. */
export interface CombatStats {
  /** Rounds and melee swings the players put out. */
  shots: number
  /** Rounds and swings that connected at least once. */
  hits: number
  damage: number
  /** Headshots (dead-centre hits) plus critical rolls. */
  crits: number
  /** Kills by drones, turrets and other deployables. */
  abilityKills: number
  kills: number
}

export function emptyCombatStats(): CombatStats {
  return { shots: 0, hits: 0, damage: 0, crits: 0, abilityKills: 0, kills: 0 }
}

export function accuracy(stats: CombatStats): number {
  return stats.shots > 0 ? Math.min(100, Math.round((stats.hits / stats.shots) * 100)) : 0
}

const compact = (n: number) => (n >= 100000 ? `${(n / 1000).toFixed(0)}k` : n >= 10000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`)

/** A grid of stat tiles for the win / lose / overrun screens. */
export function combatSummaryHtml(stats: CombatStats, abilityLabel = 'Drone / Ability Kills'): string {
  const acc = accuracy(stats)
  const tiles: [string, string, string][] = [
    ['Kills', compact(stats.kills), 'text-rose-300'],
    ['Shots Fired', compact(stats.shots), 'text-slate-100'],
    ['Accuracy', `${acc}%`, acc >= 60 ? 'text-emerald-300' : acc >= 35 ? 'text-amber-300' : 'text-red-300'],
    ['Damage Dealt', compact(stats.damage), 'text-orange-300'],
    ['Headshots / Crits', compact(stats.crits), 'text-yellow-300'],
    [abilityLabel, compact(stats.abilityKills), 'text-cyan-300'],
  ]
  return `
    <div class="mx-auto w-full max-w-xl rounded-xl bg-black/40 p-3 ring-1 ring-white/10">
      <div class="pb-2 text-[10px] font-black uppercase tracking-[0.35em] text-slate-400">Combat Summary</div>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        ${tiles
          .map(
            ([label, value, color]) => `
          <div class="rounded-lg bg-white/5 px-3 py-2 ring-1 ring-white/10">
            <div class="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">${label}</div>
            <div class="pt-0.5 font-mono text-2xl font-black ${color}">${value}</div>
          </div>`
          )
          .join('')}
      </div>
    </div>`
}
