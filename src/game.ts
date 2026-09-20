import type { BossKind, Mission } from './missions'
import type { MeleeProfile, Weapon } from './weapons'
import { weaponById } from './weapons'
import type { Character } from './characters'
import { characterById } from './characters'
import {
  CH2_DAMAGE_SCALE,
  CH2_HP_SCALE,
  CH2_SPEED_SCALE,
  CH3_DAMAGE_SCALE,
  CH3_HP_SCALE,
  CH3_SPAWN_SCALE,
  CH3_SPEED_SCALE,
  CH4_ARMOUR,
  CH4_DAMAGE_SCALE,
  CH4_HP_SCALE,
  CH4_SPAWN_SCALE,
  CH4_SPEED_SCALE,
} from './missions'
import { CHIPS_PER_KILL, SCRAP_PER_BUG, SCRAP_PER_KILL } from './profile'
import { CRYO_SLOW, CRYO_SLOW_TIME, MAX_POISON_STACKS } from './weapons'
import { playMusic, playSfx, playShot } from './audio'
import type { TexturePack } from './theme'
import { BUILDING_HEIGHT, MAX_BUILDING_LIFT, UNIT_LIFT } from './theme'
import type { GameMap, Rect } from './maps'
import { circleHitsWall, inMud, mapById } from './maps'
import { extractionField, flowDirection, goalField } from './nav'
import type { FlowField } from './nav'
import { drawCharacterSkin } from './skins'
import { bindInput, clearInput, keysPressed } from './input'
import { touchAim, touchStick } from './TouchControls'
import { settings } from './settings'
import { AOE_TICK_COOLDOWN, AOE_TICK_DAMAGE, AoeTicker, aoeTickCount } from './aoe'
import { HazardManager, OIL_FRICTION_LOSS, OIL_SLIDE_TIME, buildHazards } from './HazardManager'

export type GameState = 'menu' | 'playing' | 'won' | 'lost'

interface Player {
  id: 1 | 2
  x: number
  y: number
  r: number
  hp: number
  maxHp: number
  speed: number
  angle: number
  /** Velocity applied this frame, from the movement keys only. */
  vx: number
  vy: number
  hurtCooldown: number
  character: Character
  /** Live copy of the equipped slot's weapon and ammo. */
  weapon: Weapon
  mag: number
  reserve: number
  /** Primary slot first, secondary second; each keeps its own ammo. */
  slots: LoadoutSlot[]
  slotIndex: 0 | 1
  /** Progress 0→1 of the melee blade travelling through its arc. */
  swing: number
  swinging: boolean
  /** Swings alternate direction so repeated attacks read as slashes. */
  swingDir: 1 | -1
  /** Enemies the current sweep already cut, so the blade hits each once. */
  swingHits: Enemy[]
  swingHitBoss: boolean
  /** 0→1 coating of Hive Mother residue after she bursts. */
  gore: number
  reloadTimer: number
  fireTimer: number
  shotsFired: number
  shooting: boolean
  queuedShot: boolean
  stings: number
  lives: number
  safeTimer: number
  down: boolean
  /** Player 2 aims and fires at the nearest enemy on its own. */
  auto: boolean
  /** Seconds left before the active ability can be triggered again. */
  abilityCooldown: number
  /** Seconds left on a timed ability effect (Overdrive, Camouflage Blend). */
  abilityActive: number
  /** Remaining uses of a charge-limited ability; -1 when unlimited. */
  abilityCharges: number
  barricadeCharges: number
  /** 1 right after a shot, decaying to 0 — drives the hand kickback. */
  recoil: number
  /** Seconds of trigger hold banked by a charge-up weapon. */
  charge: number
  /** Seconds left of a Cryo-Stalker freeze slam's movement slow. */
  chill: number
  /** Seconds left of an oil slick's low-friction slide. */
  slip: number
  /** Carried velocity in units/second, which oil lets run away from the keys. */
  driftX: number
  driftY: number
}

/** One carried weapon and the ammo left in it. */
interface LoadoutSlot {
  weapon: Weapon
  mag: number
  reserve: number
}

export type EnemyKind = 'zombie' | 'bug' | 'runner' | 'camo'

interface Enemy {
  kind: EnemyKind
  x: number
  y: number
  r: number
  hp: number
  /** Health it spawned with, for percentage-based damage like ally fire. */
  maxHp: number
  speed: number
  attackCooldown: number
  wobble: number
  retreat: number
  baseSpeed: number
  poison: number
  /** Venom Spitter applications riding on the poison timer, up to 5. */
  poisonStacks: number
  burn: number
  vision: number
  aware: boolean
  driftAngle: number
  /** Camo zombies drop their disguise once they close in, and stay revealed. */
  revealed: boolean
  /** Seconds frozen solid by a Stun Baton hit or a cryo blast. */
  stun: number
  /** Seconds left of a cryo bullet's movement slow. */
  slow: number
}

/** A rooted Spore Hive hatching bugs on 'overgrowth' missions. */
interface Hive {
  x: number
  y: number
  r: number
  hp: number
  maxHp: number
  hurt: number
  /** Drives the egg sack's breathing animation. */
  pulse: number
  spawnTimer: number
}

/** A Primeval Crystal channelling health into the Canopy Leviathan. */
interface Crystal {
  x: number
  y: number
  r: number
  hp: number
  maxHp: number
  hurt: number
  /** Drives the idle glow and the healing beam's shimmer. */
  pulse: number
  /** Seconds left of the visible beam fired on the last heal tick. */
  beam: number
}

/** A telegraphed Leviathan slam zone: warns first, then burns. */
interface FlameZone {
  x: number
  y: number
  r: number
  /** Seconds of red warning circle left before the flames erupt. */
  warn: number
  /** Seconds of burning left once the warning expires. */
  burn: number
  /** Keeps each player's burn inside the shared AoE damage budget. */
  ticker: AoeTicker<Player>
}

/** Ticking AoE damage still owed to a player. */
interface AoeBurn {
  player: Player
  ticksLeft: number
  timer: number
}

/** An air-dropped crate collected by standing on it on 'supply' missions. */
interface Crate {
  x: number
  y: number
  r: number
  /** 0→1 while a player holds the interact key beside it. */
  progress: number
  collected: boolean
}

/** The power generator defended on 'generator' missions. */
interface Generator {
  x: number
  y: number
  r: number
  hp: number
  maxHp: number
  /** Brief flash after taking a hit. */
  hurt: number
}

/** Expanding cryo shockwave drawn after a canister detonates. */
interface Blast {
  x: number
  y: number
  r: number
  life: number
  maxLife: number
}

/**
 * The armoured rig ridden on the chapter 4 rail mission. It drives itself
 * down the highway and carries its own integrity pool, separate from the
 * players sitting in its bed.
 */
interface Truck {
  x: number
  y: number
  /** Half-extents of the chassis. */
  hw: number
  hh: number
  hp: number
  maxHp: number
  /** Brief flash after taking a hit. */
  hurt: number
  speed: number
  /** Wheel rotation, for the rolling animation. */
  wheel: number
}

/** Whatever an enemy is currently walking at. */
interface EnemyTarget {
  x: number
  y: number
  survivor: Survivor | null
  player: Player | null
  generator: Generator | null
}

/** Acid left by enemies killed under the Toxic Blood mutation. */
interface AcidPool {
  x: number
  y: number
  r: number
  life: number
  maxLife: number
  /** Keeps a puddle's burn inside the shared AoE damage budget. */
  ticker: AoeTicker<Player>
}

export type MutationId = 'hyper-speed' | 'hardened' | 'toxic-blood'

interface Mutation {
  id: MutationId
  name: string
  blurb: string
  /** Seconds of effect left. */
  time: number
}

interface Survivor {
  x: number
  y: number
  r: number
  hp: number
  maxHp: number
  speed: number
  safe: boolean
  hurtCooldown: number
  /** Seconds spent making no progress; drives the unstick sidestep. */
  stuck: number
  /** Sidestep direction chosen while unsticking, in radians. */
  detour: number
}

interface Turret {
  x: number
  y: number
  r: number
  angle: number
  cooldown: number
  /** Seconds of operation left before the turret powers down. */
  life: number
}

interface Medkit {
  x: number
  y: number
  /** Short delay so the kit is visible before the dropper can grab it. */
  arm: number
}

/** The five field upgrades the Crucible drops, one choice per minute. */
type ArenaPerkId = 'ally' | 'lifesteal' | 'haste' | 'armour' | 'explosive'

interface ArenaPerk {
  id: ArenaPerkId
  name: string
  blurb: string
  color: string
}

/** One of the two upgrades on offer in a drop; taking either clears both. */
interface Powerup {
  x: number
  y: number
  r: number
  perk: ArenaPerk
  /** Drop wave the pair belongs to, so the twin despawns with it. */
  wave: number
  pulse: number
}

/** An automated companion gun that answers to nobody and shoots forever. */
interface Ally {
  x: number
  y: number
  r: number
  angle: number
  cooldown: number
  /** Decays after a shot, drawing the muzzle kick. */
  recoil: number
}

interface Barricade {
  x: number
  y: number
  w: number
  h: number
  hp: number
  maxHp: number
}

/** Wet prints the Camo Stalker leaves while it is invisible. */
interface Footprint {
  x: number
  y: number
  life: number
}

/** A two-phase campaign boss; behaviour and art branch on `kind`. */
interface Boss {
  kind: BossKind
  name: string
  /** Species label shown beside the name on the HUD bar. */
  title: string
  x: number
  y: number
  r: number
  hp: number
  maxHp: number
  baseSpeed: number
  phase: 1 | 2
  wobble: number
  angle: number
  ringTimer: number
  broodTimer: number
  dashTimer: number
  /** Seconds left of the phase-2 charge; movement is locked to dashDir. */
  dashing: number
  dashDir: { x: number; y: number }
  hurt: number
  attackCooldown: number
  /** Cryo-Stalker: true once it has burned its one full-health regeneration. */
  regenerated: boolean
  /** Permanent movement multiplier layered on top of the phase bonus. */
  speedMult: number
  /** Runner Alpha: seconds until the next pack-summoning scream. */
  screamTimer: number
  /** Camo Stalker: seconds left of the current visible/invisible stretch. */
  cloakTimer: number
  cloaked: boolean
  footprints: Footprint[]
}

/** Chunk of the Hive Mother thrown out by her death burst. */
interface Gib {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  life: number
  decay: number
  color: string
}

/** Venom spat by the boss; a hit counts as a sting. */
interface Projectile {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  life: number
}

/** A Cryo-Stalker icicle: pierces, so it tracks who it already hit. */
interface Shard extends Projectile {
  hit: Player[]
}

/** Expanding freeze shockwave from a Cryo-Stalker slam. */
interface Shock {
  x: number
  y: number
  r: number
  maxR: number
  hit: Player[]
}

interface Bullet {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  damage: number
  pierce: boolean
  poison: boolean
  ignite: boolean
  /** Slows whatever it hits by CRYO_SLOW for CRYO_SLOW_TIME seconds. */
  cryo: boolean
  /** Acid needles that stack poison instead of refreshing a single dose. */
  venom: boolean
  /** Thermal beams cut straight through hardened shells. */
  ignoreArmour: boolean
  /** Detonation radius on impact; 0 for ordinary rounds. */
  blast: number
  blastFreeze: number
  color: string
  width: number
  hit: Set<Enemy>
  /** Who fired it, so Crucible lifesteal knows where to send the health. */
  owner: Player | null
  maxLife: number
  falloff: number
  tracerLength: number
}

interface AmmoBox {
  x: number
  y: number
  amount: number
}

export interface HudSurvivor {
  hp: number
  maxHp: number
  safe: boolean
  /** False while no player is close enough to escort them. */
  moving: boolean
}

export interface HudAbility {
  name: string
  key: string
  cooldown: number
  cooldownTotal: number
  active: number
  /** Remaining uses, or -1 when the ability is cooldown-gated only. */
  charges: number
  barricades: number
  barricadeKey: string
}

export interface HudPlayer {
  id: 1 | 2
  name: string
  characterName: string
  color: string
  hp: number
  maxHp: number
  mag: number
  magSize: number
  reserve: number
  reloading: boolean
  weaponName: string
  /** True for weapons that never consume ammo (M9, melee). */
  infiniteAmmo: boolean
  /** Name of the weapon in the slot that is not equipped. */
  stowedName: string
  switchKey: string
  stings: number
  lives: number
  down: boolean
  ability: HudAbility
}

/** Countdown shown across the top of the HUD on Hold the Line missions. */
export interface HudHold {
  time: number
  total: number
}

export interface HudGenerator {
  hp: number
  maxHp: number
}

/** TRUCK INTEGRITY bar shown across the top of the rail mission HUD. */
export interface HudTruck {
  hp: number
  maxHp: number
  /** 0→100 of the highway covered so far. */
  progress: number
}

/** Chapter 3 objective counters: hives felled, crates hauled, ground covered. */
export interface HudObjective {
  label: string
  done: number
  total: number
}

export interface HudBoss {
  name: string
  title: string
  hp: number
  maxHp: number
  phase: 1 | 2
  /** Phases this boss fights through, for the 'PHASE 1/2' readout. */
  maxPhase: number
}

export interface HudMutation {
  name: string
  blurb: string
  /** Seconds of effect left. */
  time: number
  /** True during the short "Virus Mutating!" alert. */
  alert: boolean
}

export interface Hud {
  players: HudPlayer[]
  boss: HudBoss | null
  hold: HudHold | null
  generator: HudGenerator | null
  truck: HudTruck | null
  /** Chapter 3 progress counter, or null outside the jungle missions. */
  jungle: HudObjective | null
  /** Frozen Data Chips banked so far this mission. */
  chips: number
  mutation: HudMutation | null
  kills: number
  target: number
  missionName: string
  objective: string
  mapName: string
  maxStings: number
  weaponName: string
  perkName: string
  scrap: number
  survivors: HudSurvivor[]
  extracted: number
  isProtect: boolean
}

export type DeathCause = 'wounds' | 'infection' | 'survivor' | 'generator' | 'truck'

const PLAYER_RADIUS = 16
const PLAYER_BASE_SPEED = 260
const ZOMBIE_VISION = 620
const BUG_VISION = 780
/** Awareness is kept until the player breaks well past the spotting range. */
const VISION_HYSTERESIS = 1.5
/** Wall clearance used when routing enemies around structures. */
const ENEMY_CLEARANCE = 14
/** Seconds between rebuilds of the enemy route field. */
const CHASE_FIELD_INTERVAL = 0.4
const MAX_STINGS = 5
const POISON_DURATION = 3
const POISON_DPS = 14
const BURN_DURATION = 2.5
const BURN_DPS = 16
const BURN_SLOW = 0.45
const ACID_SHOT_INTERVAL = 5
const IGNITE_CHANCE = 0.3
const BUG_SPAWN_CHANCE = 0.2
/** Share of the non-bug spawns that come out as each zombie variant. */
const RUNNER_SPAWN_CHANCE = 0.24
const CAMO_SPAWN_CHANCE = 0.16
/** Runners: twice the pace of a normal zombie on 40% of its health. */
const RUNNER_SPEED = 2
const RUNNER_HP_FRACTION = 0.4
/** How close a camo zombie gets before it drops the disguise. */
const CAMO_REVEAL_RANGE = 130
/** Distance at which a camo zombie starts mimicking a nearby survivor. */
const CAMO_MIMIC_RANGE = 260
/** Mutations roll 40% more often than the original 45s cadence. */
const MUTATION_INTERVAL = 32
const MUTATION_DURATION = 20
const MUTATION_ALERT_TIME = 4
const MUTATION_SPEED = 1.25
const MUTATION_ARMOUR = 0.7
const ACID_LIFE = 7
const ACID_RADIUS = 34
/** How fast a mutation skin fades in and back out again, in units per second. */
const MUTATION_SKIN_FADE = 2.5
/** How fast the hand kickback settles after a shot. */
const RECOIL_RECOVERY = 7
/** Ammo crates drop often enough to keep sustained fire going, more so on bosses. */
const AMMO_DROP_CHANCE = 0.55
const AMMO_DROP_CHANCE_BOSS = 0.75
const AMMO_DROP_AMOUNT = 30
/** Seconds a melee blade takes to travel through its full arc. */
const MELEE_SWING_TIME = 0.22
/** Half-width of the blade's own hit wedge as it sweeps. */
const MELEE_BLADE_HALF = 0.35
/** Seconds the Hive Mother's death burst plays before the outro dialogue. */
const FINALE_BURST_TIME = 2.4
const FINALE_GIBS = 140
/** Dead time after a weapon swap, so switching is not a free extra shot. */
const WEAPON_SWITCH_TIME = 0.3
/** Generator missions: the horde beelines for the generator over survivors. */
const GENERATOR_RADIUS = 54
const GENERATOR_AGGRO_BIAS = 1.6
const GENERATOR_ZOMBIE_DAMAGE = 26
const GENERATOR_BUG_DAMAGE = 18
const BLAST_LIFE = 0.35
/** Hold the Line: how much the wave pressure ramps by the final second. */
const HOLD_RAMP = 2.2
/** Spore Hives: fat, stationary egg sacks that keep hatching until burst. */
const HIVE_RADIUS = 46
const HIVE_HP = 900
const HIVE_BROOD_INTERVAL = 3.4
/** Bugs a single hive keeps alive at once. */
const HIVE_BROOD_MAX = 6
const CRATE_RADIUS = 22
/** Seconds of held interaction needed to haul a supply crate out. */
const CRATE_COLLECT_TIME = 1.2
/** Gap between player and crate that still counts as standing on the drop. */
const CRATE_INTERACT_RANGE = 30
/** Mud pits: everything wading through one moves at 55% pace. */
const MUD_SLOW = 0.55
/** How hard boots bite the ground, in 1/seconds; oil cuts into this. */
const GROUND_GRIP = 34

const MUTATION_SKINS: Record<MutationId, { body: string; trim: string }> = {
  'hyper-speed': { body: '#a855f7', trim: '#e9d5ff' },
  hardened: { body: '#64748b', trim: '#1e293b' },
  'toxic-blood': { body: '#22c55e', trim: '#bbf7d0' },
}

const MUTATIONS: Omit<Mutation, 'time'>[] = [
  { id: 'hyper-speed', name: 'Hyper-Speed Mutation', blurb: 'All infected move 25% faster.' },
  { id: 'hardened', name: 'Hardened Shell Mutation', blurb: 'Infected take 30% less bullet damage.' },
  {
    id: 'toxic-blood',
    name: 'Toxic Blood Mutation',
    blurb: 'Kills leave acid puddles that burn you.',
  },
]
const HIVE_BUG_SPAWN_CHANCE = 0.45
const EXTRACTION_RADIUS = 70
const SURVIVOR_SPEED = 54
/** Survivors only advance while a player is close enough to escort them. */
const ESCORT_RADIUS = 240
const SURVIVOR_MAX_HP = 80
const SURVIVOR_ZOMBIE_DAMAGE = 20
const SURVIVOR_BUG_DAMAGE = 28
/** Survivors only pull aggro when clearly closer than a player. */
const SURVIVOR_AGGRO_BIAS = 0.75
/** Co-op camera keeps this much slack around the pair before zooming out. */
const COOP_CAMERA_MARGIN = 420
const MIN_ZOOM = 0.5
const P2_AUTO_FIRE_RANGE = 620
/** Click-to-move drops the order once the walker is this close. */
const WALK_ARRIVE_RANGE = 14
/** Radians per second player 2's muzzle sweeps while tracking a target. */
const P2_TURN_RATE = 11
const TURRET_RANGE = 460
const TURRET_INTERVAL = 0.55
const TURRET_DAMAGE = 9
const TURRET_LIFETIME = 30
const OVERDRIVE_SPEED = 1.2
const OVERDRIVE_DAMAGE = 1.5
const MEDKIT_HEAL_FRACTION = 0.5
const MEDKIT_ARM_TIME = 0.8
const BARRICADE_HP = 260
const BARRICADE_W = 130
const BARRICADE_H = 26
const BOSS_NAME = 'The Hive Mother'
const BOSS_MAX_HP = 2340
const BOSS_RADIUS = 62
const BOSS_SPEED = 62
const BOSS_ENRAGE_SPEED = 1.3
const BOSS_RING_INTERVAL = 3.4
const BOSS_RING_SHOTS = 12
const BOSS_BROOD_INTERVAL = 6
const BOSS_BROOD_MAX = 16
/** Bugs hatched per brood wave. */
const BOSS_BROOD_COUNT = 2
const BOSS_DASH_INTERVAL = 5
const BOSS_DASH_TIME = 0.75
const BOSS_DASH_SPEED = 640
const BOSS_CONTACT_DAMAGE = 22
/** Runner Alpha: 50% faster than a normal zombie, leaps walls, calls a pack. */
const ALPHA_MAX_HP = 1500
const ALPHA_RADIUS = 34
const ALPHA_SPEED = 165
const ALPHA_LEAP_INTERVAL = 4
const ALPHA_LEAP_TIME = 0.5
const ALPHA_LEAP_SPEED = 760
const ALPHA_SCREAM_INTERVAL = 10
const ALPHA_PACK_SIZE = 3
const ALPHA_PACK_MAX = 10
const ALPHA_CONTACT_DAMAGE = 16
/** Camo Stalker: cloaks for six seconds, then backstabs out of the fog. */
const STALKER_MAX_HP = 1600
const STALKER_RADIUS = 44
const STALKER_SPEED = 96
const STALKER_CLOAK_TIME = 6
const STALKER_VISIBLE_TIME = 6
const STALKER_BACKSTAB_DAMAGE = 38
const STALKER_FOOTPRINT_INTERVAL = 0.28
const STALKER_FOOTPRINT_LIFE = 3
/** Fraction of an overlap resolved per frame when two bodies interpenetrate. */
const SEPARATION_PUSH = 0.5
/** Cryo-Stalker: freeze slams and piercing icicles inside the frost core. */
const CRYO_STALKER_MAX_HP = 2000
const CRYO_STALKER_RADIUS = 52
const CRYO_STALKER_SPEED = 78
const SLAM_INTERVAL = 7
const SLAM_RANGE = 420
const SLAM_GROWTH = 520
const SLAM_DAMAGE = 14
/** Freeze slam: 40% slower movement for three seconds. */
const CHILL_SLOW = 0.6
const CHILL_TIME = 3
const SHARD_INTERVAL = 3.2
const SHARD_COUNT = 3
const SHARD_SPREAD = 0.22
const SHARD_SPEED = 430
const SHARD_LIFE = 2.4
const SHARD_DAMAGE = 11
/** Cryo-Stalker regeneration: full heal and a permanent speed hike, once. */
const CRYO_REGEN_SPEED = 1.25
const CRYO_REGEN_BANNER = '⚠️ CRYO-STALKER REGENERATED! PHASE 2 START'
const BANNER_TIME = 3.2
/** Seconds the white-out flash takes to fade after a banner fires. */
const FLASH_TIME = 0.6
/**
 * Fog of war: how far a player sees on the main canvas, already cut by 30%
 * from the old 620px sight line for a tighter, darker arena. The minimap is
 * drawn in screen space afterwards, so it never inherits this mask.
 */
const VISIBILITY_BASE_RADIUS = 620
const VISIBILITY_RADIUS = VISIBILITY_BASE_RADIUS * 0.7
const DARKNESS = 0.72
/**
 * The Canopy Leviathan: a huge, slow chapter 3 finale that cannot be killed
 * while any of its four Primeval Crystals still feeds it.
 */
const LEVIATHAN_MAX_HP = 9000
const LEVIATHAN_RADIUS = 78
const LEVIATHAN_SPEED = 62
const LEVIATHAN_CONTACT_DAMAGE = 26
const CRYSTAL_RADIUS = 32
const CRYSTAL_HP = 700
/** Every live crystal beams 5% of the boss's pool back to it every 2s. */
const CRYSTAL_HEAL_INTERVAL = 2
const CRYSTAL_HEAL_FRACTION = 0.05
const CRYSTAL_BEAM_TIME = 0.45
/** Ground slam: three zones telegraphed for 1.5s, then burning ground. */
const LEVIATHAN_SLAM_INTERVAL = 6
const FLAME_ZONE_COUNT = 3
const FLAME_ZONE_RADIUS = 135
const FLAME_ZONE_SPREAD = 420
const FLAME_WARNING_TIME = 1.5
const FLAME_BURN_TIME = 2.6
/**
 * Chapter 4 rail convoy. The rig rolls at a fixed pace, the players are
 * bolted into its bed and every equipped weapon cycles 1.5x faster.
 */
const TRUCK_HALF_W = 96
const TRUCK_HALF_H = 46
const TRUCK_SPEED = 155
const RAIL_FIRE_RATE = 1.5
/** Seats in the bed, relative to the chassis centre. */
const TRUCK_SEATS = [
  { x: -38, y: -20 },
  { x: -38, y: 20 },
]
/** Damage a scavenger or machine does when it slams into the chassis. */
const RAIL_RAM_DAMAGE = 30
/** Ranged crawlers hold this far back and spit into the bed instead. */
const RAIL_SPIT_RANGE = 620
const RAIL_SPIT_HOLD = 300
const RAIL_SPIT_INTERVAL = 2.4

/** Brood Matron: a lighter Hive Mother that guards the skyline. */
const MATRON_MAX_HP = 1400
const MATRON_RADIUS = 50
const VENOM_SPEED = 210
const VENOM_LIFE = 3
const VENOM_DAMAGE = 6.5
/** Every campaign boss escalates once, at half health. */
const BOSS_PHASES = 2
/** How close a player must get to the hive centre to trigger the reveal. */
const BOSS_REVEAL_RANGE = 320
const BOSS_REVEAL_TIME = 3.6
/** Chapter 4's Crucible: eight minutes of swarm, then the Colossus. */
const ARENA_TIME = 480
/** Seconds between field-upgrade drops. */
const ARENA_DROP_INTERVAL = 60
/** The Crucible rifle hits 50% harder than the stock Old Rifle. */
const ARENA_RIFLE_BONUS = 1.5
/** Ally shots take a flat 5% of a zombie's full health; 20 shots kills it. */
const ALLY_DAMAGE_FRACTION = 0.05
const ALLY_FIRE_INTERVAL = 0.4
const ALLY_RANGE = 460
const ALLY_FOLLOW_DISTANCE = 70
const ALLY_SPEED = 210
/** Baseline zombie health, used to size the drone's chip damage on a boss. */
const ARENA_ZOMBIE_HP = 60
/** Each lifesteal stack returns 0.2% of the damage dealt as health. */
const ARENA_LIFESTEAL = 0.002
/** Each armour stack soaks 15% of every hit taken. */
const ARENA_ARMOUR = 0.15
/** Each explosive stack splashes 10% of the hit onto everything nearby. */
const ARENA_SPLASH = 0.1
const ARENA_SPLASH_RADIUS = 90
/** Each haste stack adds 15% movement speed and 15% rate of fire. */
const ARENA_HASTE = 0.15

const ARENA_PERKS: ArenaPerk[] = [
  {
    id: 'ally',
    name: 'Support Drone Ally',
    blurb: 'An automated gun that kills a zombie in about 8 seconds',
    color: '#38bdf8',
  },
  {
    id: 'lifesteal',
    name: 'Leech Coupling',
    blurb: '+0.2% of all damage dealt returned as health',
    color: '#f87171',
  },
  {
    id: 'haste',
    name: 'Kinetic Servos',
    blurb: '+15% movement speed and +15% fire rate',
    color: '#fbbf24',
  },
  {
    id: 'armour',
    name: 'Armour Plating',
    blurb: 'Incoming damage reduced by 15%',
    color: '#94a3b8',
  },
  {
    id: 'explosive',
    name: 'Explosive Rounds',
    blurb: 'Hits splash 10% damage onto nearby infected',
    color: '#fb923c',
  },
]

/** The Colossus: a wall of scrap that closes fast and hits for 25. */
const COLOSSUS_MAX_HP = 26000
const COLOSSUS_RADIUS = 62
const COLOSSUS_SPEED = 118
const COLOSSUS_CONTACT_DAMAGE = 25

/** Swaps the primary slot for the Crucible's up-gunned rifle. */
function arenaLoadout(loadout: Weapon[]): Weapon[] {
  const base = weaponById('old-rifle')
  const rifle: Weapon = {
    ...base,
    name: 'Reinforced Rifle',
    damage: base.damage * ARENA_RIFLE_BONUS,
    description: 'Crucible issue: the same old action with 50% more punch behind it.',
  }
  return [rifle, ...loadout.slice(1)]
}

const BOSS_REVEAL_LINES: Record<BossKind, string> = {
  'hive-mother': "There she is... the source of the infection. Eyes up, let's take it down!",
  'brood-matron': "There she is... the roof belongs to her brood. Eyes up, let's take it down!",
  'runner-alpha': "There she is... that's the Alpha. Watch the walls and keep moving!",
  'camo-stalker': "There it is... barely. Watch the floor for prints, it's already circling!",
  'cryo-stalker': "It's out of the pod — keep moving, that frost wave will pin you down!",
  'canopy-leviathan':
    'Break the four crystals first — it heals off them faster than we can shoot!',
  'rust-colossus': 'Eight minutes up — that thing is walking out of the salt. Do not let it reach you!',
}

export class Game {
  private ctx: CanvasRenderingContext2D
  private canvas: HTMLCanvasElement

  state: GameState = 'menu'
  mission: Mission | null = null
  kills = 0
  scrapEarned = 0
  /** Frozen Data Chips banked from chapter 2 kills. */
  chipsEarned = 0
  extracted = 0
  /** Spore Hives burst this mission. */
  hivesDestroyed = 0
  /** Supply crates hauled out this mission. */
  cratesCollected = 0
  deathCause: DeathCause = 'wounds'
  weapon: Weapon = weaponById('rusty-pistol')
  character: Character = characterById('nature-lover')
  map: GameMap = mapById('streets')
  /** Chosen on the intro splash; affects drawing only, never physics. */
  textures: TexturePack = 'classic'

  /** Frozen simulation: the world renders but nothing moves. */
  private paused = false
  private players: Player[] = []
  private enemies: Enemy[] = []
  private bullets: Bullet[] = []
  private ammoBoxes: AmmoBox[] = []
  private survivors: Survivor[] = []
  private turrets: Turret[] = []
  private medkits: Medkit[] = []
  private boss: Boss | null = null
  private gibs: Gib[] = []
  /**
   * Finale death sequence: 'burst' plays the explosion with controls frozen,
   * 'done' holds the wrecked arena still behind the outro cinematic.
   */
  private outro: 'off' | 'burst' | 'done' = 'off'
  private outroTimer = 0
  /** Which boss's death is playing out, so the right ending runs. */
  private finaleBoss: BossKind = 'hive-mother'
  /** Splatter tint: hive innards are green, the Cryo-Stalker's are icy. */
  private goreColor = '#4ade80'
  private venom: Projectile[] = []
  private shards: Shard[] = []
  private shocks: Shock[] = []
  /** Ticking AoE damage owed to players from slams and other bursts. */
  private aoeBurns: AoeBurn[] = []
  private groanTimer = 2
  private barricades: Barricade[] = []
  /** Route field to the nearest player or survivor, rebuilt periodically. */
  private chaseField: FlowField | null = null
  private chaseTimer = 0
  private acid: AcidPool[] = []
  private blasts: Blast[] = []
  /** Centre-screen announcement text, with the seconds it stays up. */
  private banner = ''
  private bannerTimer = 0
  /** Screen-wide flash fired alongside a banner. */
  private flash = 0
  /** Offscreen buffer the fog-of-war mask is composited on. */
  private mask: HTMLCanvasElement | null = null
  private generator: Generator | null = null
  private truck: Truck | null = null
  private hazards: HazardManager | null = null
  /** Seconds the current mission has been running, for hazard animation. */
  private hazardClock = 0
  private hives: Hive[] = []
  private crates: Crate[] = []
  private crystals: Crystal[] = []
  private flameZones: FlameZone[] = []
  /** Set once a player stands inside the jungle extraction hatch. */
  private raceEscaped = false
  /** Seconds left on a Hold the Line siege. */
  private holdTimer = 0
  /** Seconds survived in the Crucible, counting up to the boss drop. */
  private arenaTimer = 0
  /** Field upgrades taken this run, by id; every one of them stacks. */
  private arenaPerks: Record<ArenaPerkId, number> = {
    ally: 0,
    lifesteal: 0,
    haste: 0,
    armour: 0,
    explosive: 0,
  }
  private powerups: Powerup[] = []
  private allies: Ally[] = []
  /** Number of minute drops already offered. */
  private arenaDrops = 0
  private arenaBossSpawned = false
  private mutation: Mutation | null = null
  private mutationTimer = MUTATION_INTERVAL
  /** Seconds left on the "Virus Mutating!" HUD alert. */
  private mutationAlert = 0
  /** Mutation whose skin is on screen; outlives the effect while fading out. */
  private mutationSkin: MutationId | null = null
  /** 0..1 blend of the mutation skin over the default enemy look. */
  private mutationFade = 0

  private spawnTimer = 0
  private spawned = 0

  private runAndGunChecked = false
  private mouseWorld = { x: 0, y: 0 }
  private mouseScreen = { x: 0, y: 0 }
  /** Click-to-move destination for player 1, in world space. */
  private walkTarget: { x: number; y: number } | null = null

  /**
   * Boss reveal cinematic. 'pending' keeps the Hive Mother dormant until a
   * player reaches the middle of the map; 'playing' locks controls while the
   * camera slides onto her; 'done' hands control back and starts phase 1.
   */
  private reveal: 'off' | 'pending' | 'playing' | 'done' = 'off'
  private revealTimer = 0
  private bubbleTimer = 0
  private shake = 0
  /** Seconds of eased camera motion left after the cinematic hands back. */
  private cameraEase = 0

  private camera = { x: 0, y: 0 }
  private zoom = 1
  private last = 0
  private running = false

  onHud: (hud: Hud) => void = () => {}
  /** Fires once a chapter boss's death burst finishes, to run the outro. */
  onFinale: (boss: BossKind) => void = () => {}
  onStateChange: (state: GameState) => void = () => {}

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')
    this.ctx = ctx
    this.bindInput()
    this.resize()
    window.addEventListener('resize', () => this.resize())
    // Catches layout changes the window 'resize' event misses (zoom, chrome
    // panels opening) so the canvas always covers the full viewport.
    new ResizeObserver(() => this.resize()).observe(document.documentElement)
  }

  private makePlayer(
    id: 1 | 2,
    x: number,
    y: number,
    loadout: Weapon[],
    character: Character,
    auto: boolean
  ): Player {
    const slots: LoadoutSlot[] = loadout.map((w) => ({
      weapon: w,
      mag: w.magSize,
      reserve: w.reserveStart,
    }))
    const active = slots[0]
    return {
      id,
      x,
      y,
      r: PLAYER_RADIUS,
      hp: 100,
      maxHp: 100,
      speed: PLAYER_BASE_SPEED * character.speedMultiplier,
      angle: 0,
      vx: 0,
      vy: 0,
      hurtCooldown: 0,
      character,
      weapon: active.weapon,
      mag: active.mag,
      reserve: active.reserve,
      slots,
      slotIndex: 0,
      swing: 0,
      swinging: false,
      swingDir: 1,
      swingHits: [],
      swingHitBoss: false,
      gore: 0,
      reloadTimer: 0,
      fireTimer: 0,
      shotsFired: 0,
      shooting: false,
      queuedShot: false,
      stings: 0,
      lives: character.extraLives,
      safeTimer: 0,
      down: false,
      auto,
      abilityCooldown: 0,
      abilityActive: 0,
      abilityCharges: character.ability.charges > 0 ? character.ability.charges : -1,
      barricadeCharges: character.barricades,
      recoil: 0,
      charge: 0,
      chill: 0,
      slip: 0,
      driftX: 0,
      driftY: 0,
    }
  }

  private get p1(): Player {
    return this.players[0]
  }

  private get alivePlayers(): Player[] {
    return this.players.filter((p) => !p.down)
  }

  /** Position snapshot used by the automated movement smoke tests. */
  debugState() {
    return {
      map: this.map.id,
      players: this.players.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
      enemies: this.enemies.map((e) => ({
        x: Math.round(e.x),
        y: Math.round(e.y),
        kind: e.kind,
        aware: e.aware,
      })),
    }
  }

  private bindInput() {
    bindInput(this.canvas, {
      reload: () => this.startReload(this.p1),
      p2Reload: () => this.startReload(this.players[1]),
      p1Ability: () => this.useAbility(this.p1),
      p2Ability: () => this.useAbility(this.players[1]),
      p1Barricade: () => this.deployBarricade(this.p1),
      p2Barricade: () => this.deployBarricade(this.players[1]),
      p1Switch: () => this.switchWeapon(this.p1),
      p2Switch: () => this.switchWeapon(this.players[1]),
      p1Shot: () => {
        if (this.p1) this.p1.queuedShot = true
      },
      p2Shot: () => {
        const p2 = this.players[1]
        if (p2) p2.queuedShot = true
      },
      aim: (x, y) => {
        this.mouseScreen.x = x
        this.mouseScreen.y = y
      },
      walkTo: (x, y) => {
        this.walkTarget = { x: x / this.zoom + this.camera.x, y: y / this.zoom + this.camera.y }
      },
      canShoot: () => this.state === 'playing' && Boolean(this.p1),
    })
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1
    const w = this.viewW
    const h = this.viewH
    this.canvas.width = Math.floor(w * dpr)
    this.canvas.height = Math.floor(h * dpr)
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  private get viewW() {
    return document.documentElement.clientWidth || window.innerWidth
  }

  private get viewH() {
    return document.documentElement.clientHeight || window.innerHeight
  }

  /**
   * Boss missions load frozen so the pre-fight dialogue plays over the arena;
   * `resume()` unfreezes them and rolls straight into the reveal.
   */
  startMission(
    mission: Mission,
    loadout: Weapon[],
    characters: Character[],
    paused = false
  ) {
    this.paused = paused
    this.mission = mission
    this.weapon = loadout[0]
    this.character = characters[0]
    // Only the mission's own map is instantiated — other maps never load.
    this.map = mapById(mission.map)
    this.kills = 0
    this.scrapEarned = 0
    this.chipsEarned = 0
    this.extracted = 0
    this.hivesDestroyed = 0
    this.cratesCollected = 0
    this.banner = ''
    this.bannerTimer = 0
    this.flash = 0
    this.raceEscaped = false
    this.spawned = 0
    this.spawnTimer = 0
    this.deathCause = 'wounds'
    this.enemies = []
    this.bullets = []
    this.ammoBoxes = []
    this.turrets = []
    this.medkits = []
    this.barricades = []
    this.venom = []
    this.shards = []
    this.shocks = []
    this.aoeBurns = []
    this.gibs = []
    this.outro = 'off'
    this.outroTimer = 0
    this.boss = null
    this.groanTimer = 2
    this.chaseField = null
    this.chaseTimer = 0
    this.acid = []
    this.blasts = []
    this.flameZones = []
    this.holdTimer = mission.holdTime ?? 0
    this.arenaTimer = 0
    this.arenaDrops = 0
    this.arenaBossSpawned = false
    this.arenaPerks = { ally: 0, lifesteal: 0, haste: 0, armour: 0, explosive: 0 }
    this.powerups = []
    this.allies = []
    this.mutation = null
    this.mutationTimer = MUTATION_INTERVAL
    this.mutationAlert = 0
    this.mutationSkin = null
    this.mutationFade = 0
    this.zoom = 1
    this.hazards = buildHazards(this.map, mission.chapter, mission.type)
    this.hazardClock = 0
    this.runAndGunChecked = false
    this.reveal = mission.type === 'boss' ? 'pending' : 'off'
    this.revealTimer = 0
    this.bubbleTimer = 0
    this.shake = 0
    this.cameraEase = 0

    // Spore Hives and supply crates sit at fixed, hand-placed jungle spots so
    // the objective layout is identical every run.
    this.hives =
      mission.type === 'overgrowth'
        ? (this.map.hives ?? []).map((h) => ({
            x: h.x,
            y: h.y,
            r: HIVE_RADIUS,
            hp: HIVE_HP,
            maxHp: HIVE_HP,
            hurt: 0,
            pulse: Math.random() * 6,
            spawnTimer: 1 + Math.random(),
          }))
        : []
    this.crates =
      mission.type === 'supply'
        ? (this.map.crates ?? []).map((c) => ({
            x: c.x,
            y: c.y,
            r: CRATE_RADIUS,
            progress: 0,
            collected: false,
          }))
        : []

    this.players = []
    characters.slice(0, 2).forEach((c, i) => {
      const id: 1 | 2 = i === 0 ? 1 : 2
      // Player 1 starts near the middle of the map, not pinned to an edge —
      // except on the finale, where the walk to the hive centre is the trigger
      // for the boss reveal, and the valley, which starts at the run's mouth.
      const centre =
        mission.type === 'race' && this.map.spawn
          ? this.map.spawn
          : { x: this.map.width / 2, y: this.map.height / 2 }
      const solo =
        mission.type === 'boss'
          ? this.openSpot(PLAYER_RADIUS + 10, centre, BOSS_REVEAL_RANGE * 2.2, 1200)
          : this.openSpot(PLAYER_RADIUS + 10, centre, 0, 420)
      const spawn =
        i === 0 ? solo : this.openSpot(PLAYER_RADIUS + 10, this.players[0], 50, 180)
      const kit = mission.type === 'arena' ? arenaLoadout(loadout) : loadout
      this.players.push(this.makePlayer(id, spawn.x, spawn.y, kit, c, id === 2))
    })

    this.survivors = []
    for (let i = 0; i < mission.survivors; i++) {
      let spot = this.openSpot(20, this.p1, 120, 700)
      // Keep the walk to extraction long enough to be a real escort.
      for (let tries = 0; tries < 60; tries++) {
        if (Math.hypot(spot.x - this.map.extraction.x, spot.y - this.map.extraction.y) > 750) break
        spot = this.openSpot(20, this.p1, 120, 700)
      }
      this.survivors.push({
        x: spot.x,
        y: spot.y,
        r: 13,
        hp: SURVIVOR_MAX_HP,
        maxHp: SURVIVOR_MAX_HP,
        speed: SURVIVOR_SPEED,
        safe: false,
        hurtCooldown: 0,
        stuck: 0,
        detour: 0,
      })
    }

    if (mission.type === 'boss') {
      this.boss = this.makeBoss(mission.boss ?? 'hive-mother')
    }

    // The Leviathan's life sources sit at the hand-placed arena corners.
    this.crystals =
      mission.boss === 'canopy-leviathan'
        ? (this.map.crystals ?? []).map((c) => ({
            x: c.x,
            y: c.y,
            r: CRYSTAL_RADIUS,
            hp: CRYSTAL_HP,
            maxHp: CRYSTAL_HP,
            hurt: 0,
            pulse: Math.random() * 6,
            beam: 0,
          }))
        : []

    // The generator sits dead centre; the camp is built around defending it.
    this.generator =
      mission.type === 'generator'
        ? {
            x: this.map.width / 2,
            y: this.map.height / 2,
            r: GENERATOR_RADIUS,
            hp: mission.generatorHp ?? 1000,
            maxHp: mission.generatorHp ?? 1000,
            hurt: 0,
          }
        : null

    // The rig starts at the mouth of the highway and drives itself east.
    this.truck =
      mission.type === 'rail'
        ? {
            x: this.map.spawn?.x ?? TRUCK_HALF_W + 60,
            y: this.map.spawn?.y ?? this.map.height / 2,
            hw: TRUCK_HALF_W,
            hh: TRUCK_HALF_H,
            hp: mission.truckHp ?? 1400,
            maxHp: mission.truckHp ?? 1400,
            hurt: 0,
            speed: TRUCK_SPEED,
            wheel: 0,
          }
        : null
    this.seatPlayers()

    playMusic(mission.type === 'boss' ? 'boss' : 'battle')
    this.setState('playing')
    this.start()
  }

  /** Every boss nests in the middle of its arena, where the reveal fires. */
  private makeBoss(kind: BossKind): Boss {
    const stats: Record<
      BossKind,
      { name: string; title: string; r: number; hp: number; speed: number }
    > = {
      'hive-mother': {
        name: BOSS_NAME,
        title: 'Mutated Alpha Bug',
        r: BOSS_RADIUS,
        hp: BOSS_MAX_HP,
        speed: BOSS_SPEED,
      },
      'brood-matron': {
        name: 'The Brood Matron',
        title: 'Mutated Alpha Bug',
        r: MATRON_RADIUS,
        hp: MATRON_MAX_HP,
        speed: BOSS_SPEED * 1.15,
      },
      'runner-alpha': {
        name: 'The Runner Alpha',
        title: 'Alpha Runner',
        r: ALPHA_RADIUS,
        hp: ALPHA_MAX_HP,
        speed: ALPHA_SPEED,
      },
      'camo-stalker': {
        name: 'The Camo Stalker',
        title: 'Chameleon Abomination',
        r: STALKER_RADIUS,
        hp: STALKER_MAX_HP,
        speed: STALKER_SPEED,
      },
      'cryo-stalker': {
        name: 'The Cryo-Stalker Infusion',
        title: 'Cryogenic Mutation',
        r: CRYO_STALKER_RADIUS,
        hp: CRYO_STALKER_MAX_HP,
        speed: CRYO_STALKER_SPEED,
      },
      'canopy-leviathan': {
        name: 'The Canopy Leviathan',
        title: 'Primeval Colossus',
        r: LEVIATHAN_RADIUS,
        hp: LEVIATHAN_MAX_HP,
        speed: LEVIATHAN_SPEED,
      },
      'rust-colossus': {
        name: 'The Rust Colossus',
        title: 'Scrapyard Titan',
        r: COLOSSUS_RADIUS,
        hp: COLOSSUS_MAX_HP,
        speed: COLOSSUS_SPEED,
      },
    }
    const s = stats[kind]
    const spot = this.openSpot(
      s.r + 12,
      { x: this.map.width / 2, y: this.map.height / 2 },
      0,
      260
    )
    return {
      kind,
      name: s.name,
      title: s.title,
      x: spot.x,
      y: spot.y,
      r: s.r,
      hp: s.hp,
      maxHp: s.hp,
      baseSpeed: s.speed,
      phase: 1,
      wobble: 0,
      angle: 0,
      ringTimer: 2,
      broodTimer: 3,
      dashTimer: kind === 'runner-alpha' ? ALPHA_LEAP_INTERVAL : BOSS_DASH_INTERVAL,
      dashing: 0,
      dashDir: { x: 1, y: 0 },
      hurt: 0,
      attackCooldown: 0,
      regenerated: false,
      speedMult: 1,
      screamTimer: ALPHA_SCREAM_INTERVAL,
      cloakTimer: STALKER_VISIBLE_TIME,
      cloaked: false,
      footprints: [],
    }
  }

  /** Finds a wall-free point, optionally within a distance band of an anchor. */
  private openSpot(
    radius: number,
    anchor?: { x: number; y: number },
    min = 0,
    max = Infinity
  ): { x: number; y: number } {
    const m = this.map
    for (let i = 0; i < 800; i++) {
      const x = 60 + Math.random() * (m.width - 120)
      const y = 60 + Math.random() * (m.height - 120)
      if (circleHitsWall(m, x, y, radius)) continue
      if (anchor) {
        const d = Math.hypot(x - anchor.x, y - anchor.y)
        if (d < min || d > max) continue
      }
      return { x, y }
    }
    return { x: m.width / 2, y: m.height / 2 }
  }

  private setState(s: GameState) {
    this.state = s
    this.onStateChange(s)
  }

  toMenu() {
    this.running = false
    this.setState('menu')
  }

  start() {
    if (this.running) return
    // A press that started a mission must not linger as a held trigger.
    clearInput()
    this.running = true
    this.last = performance.now()
    requestAnimationFrame(this.loop)
  }

  private loop = (now: number) => {
    if (!this.running) return
    const dt = Math.min((now - this.last) / 1000, 0.05)
    this.last = now
    if (this.state === 'playing' && !this.paused) this.update(dt)
    this.render()
    this.emitHud()
    requestAnimationFrame(this.loop)
  }

  private emitHud() {
    const mission = this.mission
    this.onHud({
      players: this.players.map((p) => ({
        id: p.id,
        name: `Player ${p.id}`,
        characterName: p.character.name,
        color: p.character.color,
        hp: Math.max(0, Math.round(p.hp)),
        maxHp: p.maxHp,
        mag: p.mag,
        magSize: p.weapon.magSize,
        reserve: p.reserve,
        reloading: p.reloadTimer > 0,
        infiniteAmmo: Boolean(p.weapon.infiniteAmmo),
        stowedName: p.slots[1 - p.slotIndex]?.weapon.name ?? '',
        switchKey: p.id === 1 ? 'Q' : 'N',
        stings: p.stings,
        lives: p.lives,
        down: p.down,
        weaponName: p.weapon.name,
        ability: {
          name: p.character.ability.name,
          key: p.id === 1 ? 'E' : 'M',
          cooldown: Math.max(0, p.abilityCooldown),
          cooldownTotal: p.character.ability.cooldown,
          active: Math.max(0, p.abilityActive),
          charges: p.abilityCharges,
          barricades: p.barricadeCharges,
          barricadeKey: p.id === 1 ? 'F' : 'L',
        },
      })),
      mutation:
        this.mutation && (this.mutationAlert > 0 || this.mutation.time > 0)
          ? {
              name: this.mutation.name,
              blurb: this.mutation.blurb,
              time: Math.max(0, this.mutation.time),
              alert: this.mutationAlert > 0,
            }
          : null,
      hold:
        mission?.type === 'hold'
          ? { time: Math.max(0, this.holdTimer), total: mission.holdTime ?? 0 }
          : mission?.type === 'arena' && !this.arenaBossSpawned
            ? {
                time: Math.max(0, (mission.arenaTime ?? ARENA_TIME) - this.arenaTimer),
                total: mission.arenaTime ?? ARENA_TIME,
              }
            : null,
      generator: this.generator
        ? { hp: Math.max(0, Math.round(this.generator.hp)), maxHp: this.generator.maxHp }
        : null,
      truck: this.truck
        ? {
            hp: Math.max(0, Math.round(this.truck.hp)),
            maxHp: this.truck.maxHp,
            progress: Math.round(this.railProgress * 100),
          }
        : null,
      jungle: this.jungleObjective(),
      chips: this.chipsEarned,
      boss: this.boss
        ? {
            name: this.boss.name,
            title: this.boss.title,
            hp: Math.max(0, Math.round(this.boss.hp)),
            maxHp: this.boss.maxHp,
            phase: this.boss.phase,
            maxPhase: BOSS_PHASES,
          }
        : null,
      kills: this.kills,
      target: mission?.target ?? 0,
      missionName: mission?.name ?? '',
      objective: mission?.objective ?? '',
      mapName: this.map.name,
      maxStings: MAX_STINGS,
      weaponName: (this.p1?.weapon ?? this.weapon).name,
      perkName:
        (this.p1?.weapon ?? this.weapon).perk === 'none'
          ? ''
          : (this.p1?.weapon ?? this.weapon).perkName,
      scrap: this.scrapEarned,
      survivors: this.survivors.map((s) => ({
        hp: Math.max(0, Math.round(s.hp)),
        maxHp: s.maxHp,
        safe: s.safe,
        moving: this.alivePlayers.some((p) => Math.hypot(p.x - s.x, p.y - s.y) < ESCORT_RADIUS),
      })),
      extracted: this.extracted,
      isProtect: mission?.type === 'protect',
    })
  }

  private update(dt: number) {
    if (this.outro !== 'off') {
      this.updateFinale(dt)
      return
    }
    this.shake = Math.max(0, this.shake - dt * 1.6)
    this.bannerTimer = Math.max(0, this.bannerTimer - dt)
    this.flash = Math.max(0, this.flash - dt)
    this.bubbleTimer = Math.max(0, this.bubbleTimer - dt)
    this.cameraEase = Math.max(0, this.cameraEase - dt)
    if (this.reveal === 'playing') {
      // Controls are locked: nothing but the camera moves during the reveal.
      this.revealTimer -= dt
      if (this.revealTimer <= 0) {
        this.reveal = 'done'
        this.cameraEase = 1.2
        clearInput()
      }
      this.updateCamera()
      return
    }

    for (const p of this.players) {
      if (p.down) continue
      this.updatePlayer(p, dt)
      this.updateWeapon(p, dt)
    }
    this.updateTruck(dt)
    this.updateHazards(dt)
    this.updateBullets(dt)
    this.updateBoss(dt)
    this.updateVenom(dt)
    this.updateShards(dt)
    this.updateShocks(dt)
    this.updateAoeBurns(dt)
    this.updateSurvivors(dt)
    this.updateTurrets(dt)
    this.updateEnemies(dt)
    this.separateBodies()
    this.pushOffPlayers()
    this.updatePickups(dt)
    this.updateAcid(dt)
    this.updateBlasts(dt)
    this.updateFlameZones(dt)
    this.updateHives(dt)
    this.updateCrates(dt)
    this.updateRace()
    this.updateArena(dt)
    this.updateMutation(dt)
    if (this.generator) this.generator.hurt = Math.max(0, this.generator.hurt - dt)
    if (this.mission?.type === 'hold') this.holdTimer = Math.max(0, this.holdTimer - dt)
    this.updateSpawning(dt)
    this.updateCamera()
    this.updateAmbience(dt)
    this.checkOutcome()
  }

  /**
   * Rustlands oil slicks and industrial turrets. Both co-op players and every
   * zombie are registered as beam targets, so the yard is hostile to all.
   */
  private updateHazards(dt: number) {
    const h = this.hazards
    if (!h) return
    this.hazardClock += dt
    h.update(dt, {
      bodies: [
        ...this.alivePlayers.map((p) => ({
          body: p,
          hurt: (amount: number) => {
            this.damagePlayer(p, amount)
            p.hurtCooldown = 0.2
            p.safeTimer = 0
          },
        })),
        ...this.enemies.map((z) => ({ body: z, hurt: (amount: number) => (z.hp -= amount) })),
      ],
    })
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].hp <= 0) this.killEnemy(i)
    }
  }

  /** True while the players are mounted in the rail mission's truck bed. */
  private get railMode(): boolean {
    return this.mission?.type === 'rail' && this.truck !== null
  }

  /**
   * Drives the rig down the highway, carries its passengers with it and
   * settles anything that rams the chassis into the Truck Integrity pool.
   */
  private updateTruck(dt: number) {
    const t = this.truck
    if (!t) return
    t.hurt = Math.max(0, t.hurt - dt)
    t.wheel += dt * t.speed * 0.06
    t.x = Math.min(t.x + t.speed * dt, this.map.extraction.x)
    this.seatPlayers()

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const z = this.enemies[i]
      // Ranged crawlers never touch the chassis: their venom is what hurts.
      if (z.kind === 'bug') continue
      if (!this.hitsTruck(z.x, z.y, z.r)) continue
      t.hp -= RAIL_RAM_DAMAGE * this.damageScale
      t.hurt = 0.25
      this.shake = Math.max(this.shake, 0.5)
      playSfx('explosion')
      this.killEnemy(i)
    }
  }

  /** Bolts every player into their seat in the bed. */
  private seatPlayers() {
    const t = this.truck
    if (!t) return
    this.players.forEach((p, i) => {
      const seat = TRUCK_SEATS[i] ?? TRUCK_SEATS[0]
      p.x = t.x + seat.x
      p.y = t.y + seat.y
      p.vx = 0
      p.vy = 0
    })
  }

  private hitsTruck(x: number, y: number, r: number): boolean {
    const t = this.truck
    if (!t) return false
    const nx = clamp(x, t.x - t.hw, t.x + t.hw)
    const ny = clamp(y, t.y - t.hh, t.y + t.hh)
    return (x - nx) ** 2 + (y - ny) ** 2 < r * r
  }

  /** 0→1 of the highway the convoy has covered. */
  private get railProgress(): number {
    const t = this.truck
    const start = this.map.spawn
    if (!t || !start) return 0
    const span = this.map.extraction.x - start.x || 1
    return clamp((t.x - start.x) / span, 0, 1)
  }

  /** Lifts the pre-fight freeze; boss arenas cut straight to the reveal. */
  resume() {
    this.paused = false
    if (this.reveal === 'pending') this.startReveal()
  }

  /** Pans the camera onto the boss and hands the scene over to phase 1. */
  private startReveal() {
    if (!this.boss) return
    this.reveal = 'playing'
    this.revealTimer = BOSS_REVEAL_TIME
    this.bubbleTimer = BOSS_REVEAL_TIME + 0.8
    this.shake = 1
    clearInput()
    playSfx('boss-roar')
  }

  /** Rolls a fresh global enemy modifier every MUTATION_INTERVAL seconds. */
  private updateMutation(dt: number) {
    this.mutationAlert = Math.max(0, this.mutationAlert - dt)
    if (this.mutation) {
      this.mutation.time -= dt
      if (this.mutation.time <= 0) this.mutation = null
    }
    // Skins blend in when a mutation lands and blend back out when it expires.
    const step = dt * MUTATION_SKIN_FADE
    if (this.mutation) {
      this.mutationSkin = this.mutation.id
      this.mutationFade = Math.min(1, this.mutationFade + step)
    } else {
      this.mutationFade = Math.max(0, this.mutationFade - step)
      if (this.mutationFade === 0) this.mutationSkin = null
    }
    this.mutationTimer -= dt
    if (this.mutationTimer > 0) return
    this.mutationTimer = MUTATION_INTERVAL
    const rolled = MUTATIONS[Math.floor(Math.random() * MUTATIONS.length)]
    this.mutation = { ...rolled, time: MUTATION_DURATION }
    this.mutationAlert = MUTATION_ALERT_TIME
    playSfx('sting')
  }

  private get mutationSpeed(): number {
    return this.mutation?.id === 'hyper-speed' ? MUTATION_SPEED : 1
  }

  private get mutationArmour(): number {
    return this.mutation?.id === 'hardened' ? MUTATION_ARMOUR : 1
  }

  /** Toxic Blood puddles: hurt players who stand in them, then fade. */
  private updateAcid(dt: number) {
    for (let i = this.acid.length - 1; i >= 0; i--) {
      const pool = this.acid[i]
      pool.life -= dt
      if (pool.life <= 0) {
        this.acid.splice(i, 1)
        continue
      }
      for (const p of this.alivePlayers) {
        if (Math.hypot(p.x - pool.x, p.y - pool.y) > pool.r + p.r) {
          pool.ticker.reset(p)
          continue
        }
        const damage = pool.ticker.tick(p, dt)
        if (!damage) continue
        this.damagePlayer(p, damage)
        p.hurtCooldown = 0.25
        p.safeTimer = 0
      }
    }
  }

  /**
   * Spore Hives never move: they breathe, soak up fire and keep hatching bugs
   * until they are shot apart.
   */
  private updateHives(dt: number) {
    if (!this.hives.length) return
    for (const hive of this.hives) {
      hive.pulse += dt
      hive.hurt = Math.max(0, hive.hurt - dt)
      hive.spawnTimer -= dt
      if (hive.spawnTimer > 0) continue
      hive.spawnTimer = HIVE_BROOD_INTERVAL
      if (this.enemies.length >= this.hives.length * HIVE_BROOD_MAX) continue
      const a = Math.random() * Math.PI * 2
      const d = hive.r + 20
      this.enemies.push(this.makeBug({ x: hive.x + Math.cos(a) * d, y: hive.y + Math.sin(a) * d }))
    }
  }

  /** A burst hive sprays its brood chamber across the hollow. */
  private burstHive(index: number) {
    const hive = this.hives[index]
    this.hives.splice(index, 1)
    this.hivesDestroyed += 1
    this.shake = Math.max(this.shake, 0.8)
    playSfx('explosion')
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2
      const speed = 90 + Math.random() * 320
      this.gibs.push({
        x: hive.x,
        y: hive.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        r: 4 + Math.random() * 8,
        life: 1,
        decay: 0.5 + Math.random() * 0.6,
        color: Math.random() < 0.5 ? '#a3e635' : '#65a30d',
      })
    }
  }

  /** Supply crates are hauled out by standing on one and holding the key. */
  private updateCrates(dt: number) {
    if (!this.crates.length) return
    for (const crate of this.crates) {
      if (crate.collected) continue
      const hauler = this.alivePlayers.some(
        (p) => this.nearCrate(p, crate) && this.holdingRetrieve(p)
      )
      if (!hauler) {
        crate.progress = Math.max(0, crate.progress - dt / CRATE_COLLECT_TIME)
        continue
      }
      crate.progress += dt / CRATE_COLLECT_TIME
      if (crate.progress < 1) continue
      crate.progress = 1
      crate.collected = true
      this.cratesCollected += 1
      playSfx('medkit')
    }
  }

  /** True while the player stands inside a crate's interaction ring. */
  private nearCrate(p: Player, crate: Crate): boolean {
    return Math.hypot(p.x - crate.x, p.y - crate.y) < p.r + crate.r + CRATE_INTERACT_RANGE
  }

  /** E retrieves for player 1, M for player 2; Space still works for both. */
  private holdingRetrieve(p: Player): boolean {
    if (keysPressed.interact) return true
    return p.id === 1 ? keysPressed.interactP1 : keysPressed.interactP2
  }

  /** The valley run ends the moment anyone stands in the escape hatch. */
  private updateRace() {
    if (this.mission?.type !== 'race' || this.raceEscaped) return
    const hatch = this.map.extraction
    this.raceEscaped = this.alivePlayers.some(
      (p) => Math.hypot(p.x - hatch.x, p.y - hatch.y) < EXTRACTION_RADIUS
    )
  }

  /** Cryo shockwaves are pure decoration once their damage has landed. */
  private updateBlasts(dt: number) {
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i]
      b.life -= dt
      if (b.life <= 0) this.blasts.splice(i, 1)
    }
  }

  /** Arctic infected carry 50% more health; jungle and desert ones more. */
  private get hpScale(): number {
    const chapter = this.mission?.chapter
    if (chapter === 4) return CH4_HP_SCALE
    if (chapter === 3) return CH3_HP_SCALE
    return chapter === 2 ? CH2_HP_SCALE : 1
  }

  /** Later chapters also field quicker variants. */
  private get speedScale(): number {
    const chapter = this.mission?.chapter
    if (chapter === 4) return CH4_SPEED_SCALE
    if (chapter === 3) return CH3_SPEED_SCALE
    return chapter === 2 ? CH2_SPEED_SCALE : 1
  }

  /** Waves arrive this much faster in the jungle and the Rustlands. */
  private get spawnScale(): number {
    const chapter = this.mission?.chapter
    if (chapter === 4) return CH4_SPAWN_SCALE
    return chapter === 3 ? CH3_SPAWN_SCALE : 1
  }

  /**
   * Damage multiplier applied to every hit an enemy takes: the global
   * Hardened mutation stacks with Rustlands scrap plating.
   */
  private get enemyArmour(): number {
    return this.mutationArmour * (this.mission?.chapter === 4 ? CH4_ARMOUR : 1)
  }

  /** ...and all of them hit harder than their chapter 1 kin. */
  private get damageScale(): number {
    const chapter = this.mission?.chapter
    if (chapter === 4) return CH4_DAMAGE_SCALE
    if (chapter === 3) return CH3_DAMAGE_SCALE
    return chapter === 2 ? CH2_DAMAGE_SCALE : 1
  }

  /** Progress counter shown on the HUD for the three jungle mission modes. */
  private jungleObjective(): HudObjective | null {
    const type = this.mission?.type
    const crystals = this.map.crystals?.length
    if (this.mission?.boss === 'canopy-leviathan' && crystals) {
      return {
        label: 'Primeval Crystals shattered',
        done: crystals - this.crystals.length,
        total: crystals,
      }
    }
    if (type === 'arena') {
      return {
        label: 'Field upgrades installed',
        done: Object.values(this.arenaPerks).reduce((a, b) => a + b, 0),
        total: Math.floor((this.mission?.arenaTime ?? ARENA_TIME) / ARENA_DROP_INTERVAL),
      }
    }
    if (type === 'overgrowth') {
      return {
        label: 'Spore Hives destroyed',
        done: this.hivesDestroyed,
        total: this.hivesDestroyed + this.hives.length,
      }
    }
    if (type === 'supply') {
      return {
        label: 'Supply crates recovered',
        done: this.cratesCollected,
        total: this.crates.length,
      }
    }
    if (type === 'rail') {
      return {
        label: 'Convoy distance',
        done: Math.round(this.railProgress * 100),
        total: 100,
      }
    }
    if (type === 'race') {
      return {
        label: 'Run to extraction',
        done: Math.round(this.raceProgress * 100),
        total: 100,
      }
    }
    return null
  }

  /** 0→1 along the valley, measured from the spawn end to the hatch. */
  private get raceProgress(): number {
    const start = this.map.spawn
    if (!start) return 0
    const target = this.map.extraction
    const span = Math.hypot(target.x - start.x, target.y - start.y) || 1
    const lead = this.alivePlayers.length ? this.alivePlayers : this.players
    if (!lead.length) return 0
    const best = Math.min(...lead.map((p) => Math.hypot(target.x - p.x, target.y - p.y)))
    return clamp(1 - best / span, 0, 1)
  }

  /** Occasional groans from the horde while enemies are around. */
  private updateAmbience(dt: number) {
    if (!this.enemies.length) return
    this.groanTimer -= dt
    if (this.groanTimer > 0) return
    this.groanTimer = 3 + Math.random() * 4
    playSfx('groan')
  }

  private checkOutcome() {
    const mission = this.mission
    if (!mission) return

    if (mission.type === 'protect') {
      if (this.survivors.some((s) => s.hp <= 0)) {
        this.deathCause = 'survivor'
        this.finish('lost')
        return
      }
      if (this.survivors.length && this.survivors.every((s) => s.safe)) {
        this.finish('won')
        return
      }
    } else if (mission.type === 'hold') {
      if (this.holdTimer <= 0) {
        this.finish('won')
        return
      }
    } else if (mission.type === 'generator') {
      if (this.generator && this.generator.hp <= 0) {
        this.deathCause = 'generator'
        this.finish('lost')
        return
      }
      if (this.kills >= mission.target) {
        this.finish('won')
        return
      }
    } else if (mission.type === 'overgrowth') {
      if (!this.hives.length) {
        this.finish('won')
        return
      }
    } else if (mission.type === 'supply') {
      if (this.crates.length && this.crates.every((c) => c.collected)) {
        this.finish('won')
        return
      }
    } else if (mission.type === 'arena') {
      // The clock alone never ends the Crucible: the Colossus has to fall.
      if (this.arenaBossSpawned && this.boss && this.boss.hp <= 0) {
        this.boss = null
        this.finish('won')
        return
      }
    } else if (mission.type === 'race') {
      if (this.raceEscaped) {
        this.finish('won')
        return
      }
    } else if (mission.type === 'rail') {
      const t = this.truck
      // Either pool emptying ends the run on the spot.
      if (t && t.hp <= 0) {
        this.deathCause = 'truck'
        this.finish('lost')
        return
      }
      if (this.players.some((p) => p.down)) {
        this.finish('lost')
        return
      }
      if (t && t.x >= this.map.extraction.x - 2) {
        this.finish('won')
        return
      }
    } else if (mission.type === 'boss') {
      if (this.boss && this.boss.hp <= 0) {
        // The Cryo-Stalker refuses to die the first time: it regenerates
        // instead of handing over the level.
        if (this.boss.kind === 'cryo-stalker' && !this.boss.regenerated) {
          this.regenerateCryoStalker(this.boss)
          return
        }
        // Chapter bosses close their chapter with a cinematic instead of the
        // usual win screen.
        if (
          this.boss.kind === 'hive-mother' ||
          this.boss.kind === 'cryo-stalker' ||
          this.boss.kind === 'canopy-leviathan'
        ) {
          this.startFinaleBurst(this.boss)
          return
        }
        this.boss = null
        this.finish('won')
        return
      }
    } else if (this.kills >= mission.target) {
      this.finish('won')
      return
    }

    for (const p of this.players) {
      if (p.down) continue
      const infected = p.stings >= MAX_STINGS
      if (!infected && p.hp > 0) continue
      if (p.lives > 0) {
        // Medic's field triage: burn a life instead of going down.
        p.lives -= 1
        p.hp = p.maxHp
        p.stings = 0
        p.hurtCooldown = 0.6
        continue
      }
      p.hp = 0
      p.down = true
      p.shooting = false
      this.deathCause = infected ? 'infection' : 'wounds'
    }

    if (this.players.length && this.players.every((p) => p.down)) this.finish('lost')
  }

  /**
   * First time its health pool empties the Cryo-Stalker heals back to full,
   * announces phase 2 and keeps a permanent movement bonus from then on.
   */
  private regenerateCryoStalker(boss: Boss) {
    boss.regenerated = true
    boss.hp = boss.maxHp
    boss.phase = 2
    boss.speedMult = CRYO_REGEN_SPEED
    boss.dashTimer = 2
    boss.hurt = 0.4
    this.announce(CRYO_REGEN_BANNER)
    this.shake = Math.max(this.shake, 1.2)
    playSfx('boss-roar')
  }

  /** Flashes the screen and holds a banner across the middle of the arena. */
  private announce(text: string) {
    this.banner = text
    this.bannerTimer = BANNER_TIME
    this.flash = FLASH_TIME
  }

  private finish(state: GameState) {
    this.running = false
    this.setState(state)
  }

  /** Ends the run after the outro cinematic has played out. */
  finishFinale() {
    this.outro = 'off'
    this.finish('won')
  }

  /**
   * The chapter boss tears apart: the arena is swept clear, its innards spray
   * across the survivors and controls stay frozen until the cinematic opens.
   */
  private startFinaleBurst(boss: Boss) {
    this.finaleBoss = boss.kind
    this.outro = 'burst'
    this.outroTimer = FINALE_BURST_TIME
    this.shake = 2
    this.enemies = []
    this.bullets = []
    this.venom = []
    this.shards = []
    this.shocks = []
    this.aoeBurns = []
    this.boss = null
    clearInput()
    playSfx('explosion')
    playSfx('boss-roar')

    const frost = boss.kind === 'cryo-stalker'
    const jungle = boss.kind === 'canopy-leviathan'
    if (jungle) this.flameZones = []
    for (let i = 0; i < FINALE_GIBS; i++) {
      const a = Math.random() * Math.PI * 2
      const speed = 120 + Math.random() * 520
      this.gibs.push({
        x: boss.x,
        y: boss.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        r: 3 + Math.random() * 9,
        life: 1,
        decay: 0.35 + Math.random() * 0.5,
        color: frost
          ? Math.random() < 0.55
            ? '#bae6fd'
            : '#38bdf8'
          : jungle
            ? Math.random() < 0.55
              ? '#a3e635'
              : '#4d7c0f'
            : Math.random() < 0.55
              ? '#5ff07a'
              : '#fb923c',
      })
    }

    for (const p of this.players) {
      p.shooting = false
      p.swinging = false
      if (!p.down) p.gore = 1
    }
    this.goreColor = frost ? '#7dd3fc' : jungle ? '#a3e635' : '#4ade80'
  }

  /** Only the debris moves while the finale burst and cinematic play. */
  private updateFinale(dt: number) {
    this.shake = Math.max(0, this.shake - dt * 1.1)
    for (let i = this.gibs.length - 1; i >= 0; i--) {
      const g = this.gibs[i]
      g.x += g.vx * dt
      g.y += g.vy * dt
      g.vx *= 1 - Math.min(1, dt * 2.2)
      g.vy *= 1 - Math.min(1, dt * 2.2)
      g.life -= g.decay * dt
      if (g.life <= 0) this.gibs.splice(i, 1)
    }
    this.updateCamera()
    if (this.outro !== 'burst') return
    this.outroTimer -= dt
    if (this.outroTimer <= 0) {
      this.outro = 'done'
      this.onFinale(this.finaleBoss)
    }
  }

  /** Triggers the character's active ability for that player. */
  private useAbility(p: Player | undefined) {
    if (this.state !== 'playing' || !p || p.down) return
    if (p.abilityCooldown > 0 || p.abilityCharges === 0) return
    const ability = p.character.ability

    switch (p.character.id) {
      case 'army-retiree':
        p.abilityActive = ability.duration
        playSfx('overdrive')
        break
      case 'nature-lover':
        p.abilityActive = ability.duration
        playSfx('cloak')
        break
      case 'medic':
        this.medkits.push({ x: p.x, y: p.y, arm: MEDKIT_ARM_TIME })
        playSfx('medkit')
        break
      case 'engineer': {
        // One turret runs at a time, twice per mission.
        if (this.turrets.length) return
        const spot = circleHitsWall(this.map, p.x, p.y, 14) ? null : { x: p.x, y: p.y }
        if (!spot) return
        this.turrets.push({ x: spot.x, y: spot.y, r: 14, angle: p.angle, cooldown: 0, life: TURRET_LIFETIME })
        playSfx('turret')
        break
      }
    }

    if (p.abilityCharges > 0) p.abilityCharges -= 1
    p.abilityCooldown = ability.cooldown
  }

  /** Swaps the primary and secondary slots, ammo state and all. */
  private switchWeapon(p: Player | undefined) {
    if (this.state !== 'playing' || this.paused || !p || p.down || p.slots.length < 2) return
    const current = p.slots[p.slotIndex]
    current.mag = p.mag
    current.reserve = p.reserve
    p.slotIndex = p.slotIndex === 0 ? 1 : 0
    const next = p.slots[p.slotIndex]
    p.weapon = next.weapon
    p.mag = next.mag
    p.reserve = next.reserve
    p.reloadTimer = 0
    p.fireTimer = Math.max(p.fireTimer, WEAPON_SWITCH_TIME)
    playSfx('swap')
  }

  /** Engineer's secondary: a destructible wall that blocks the horde. */
  private deployBarricade(p: Player | undefined) {
    if (this.state !== 'playing' || !p || p.down || p.barricadeCharges <= 0) return
    const horizontal = Math.abs(Math.cos(p.angle)) < Math.abs(Math.sin(p.angle))
    const w = horizontal ? BARRICADE_W : BARRICADE_H
    const h = horizontal ? BARRICADE_H : BARRICADE_W
    // Slide the wall back toward the player until it clears the structures.
    for (const reach of [46, 34, 24, 16, 0]) {
      const x = p.x + Math.cos(p.angle) * reach - w / 2
      const y = p.y + Math.sin(p.angle) * reach - h / 2
      if (this.rectBlocked(x, y, w, h)) continue
      this.barricades.push({ x, y, w, h, hp: BARRICADE_HP, maxHp: BARRICADE_HP })
      playSfx('barricade')
      p.barricadeCharges -= 1
      return
    }
  }

  /** True when the rect overlaps a structure or leaves the map. */
  private rectBlocked(x: number, y: number, w: number, h: number): boolean {
    if (x < 0 || y < 0 || x + w > this.map.width || y + h > this.map.height) return true
    return this.map.walls.some(
      (s) => x < s.x + s.w && x + w > s.x && y < s.y + s.h && y + h > s.y
    )
  }

  private hitsBarricade(x: number, y: number, r: number): Barricade | null {
    for (const b of this.barricades) {
      const cx = clamp(x, b.x, b.x + b.w)
      const cy = clamp(y, b.y, b.y + b.h)
      if (Math.hypot(x - cx, y - cy) < r) return b
    }
    return null
  }

  private updatePlayer(p: Player, dt: number) {
    const k = keysPressed
    p.abilityCooldown = Math.max(0, p.abilityCooldown - dt)
    p.abilityActive = Math.max(0, p.abilityActive - dt)
    const move = this.moveVector(p)
    const boosted = p.character.id === 'army-retiree' && p.abilityActive > 0
    p.chill = Math.max(0, p.chill - dt)
    const step =
      p.speed *
      this.arenaHaste *
      (boosted ? OVERDRIVE_SPEED : 1) *
      (p.chill > 0 ? CHILL_SLOW : 1) *
      (inMud(this.map, p.x, p.y) ? MUD_SLOW : 1) *
      dt
    // Mounted in the truck bed the direction keys do not move anything: the
    // rig drives itself and the whole stage is aim and trigger.
    const locked = this.railMode
    if (!locked) {
      // Oil keeps a player coasting: the ground's grip on them is cut, so the
      // keys only bend a heading they are already carrying.
      if (this.hazards?.slippery(p.x, p.y, p.r)) p.slip = OIL_SLIDE_TIME
      p.slip = Math.max(0, p.slip - dt)
      const grip = GROUND_GRIP * (p.slip > 0 ? 1 - OIL_FRICTION_LOSS : 1)
      const ease = Math.min(1, grip * dt)
      const wantX = (move.x * step) / dt
      const wantY = (move.y * step) / dt
      p.driftX += (wantX - p.driftX) * ease
      p.driftY += (wantY - p.driftY) * ease
      p.vx = p.driftX * dt
      p.vy = p.driftY * dt
      this.moveCircle(p, p.vx, p.vy)
      this.checkRunAndGun(p, k.shooting)
    } else {
      p.vx = 0
      p.vy = 0
      p.driftX = 0
      p.driftY = 0
    }

    // Locked in the bed, a held direction snaps the muzzle straight onto that
    // heading — instant 360° tracking from the truck centre.
    const steered = locked && (move.x !== 0 || move.y !== 0)
    if (steered) p.angle = Math.atan2(move.y, move.x)

    if (p.auto) {
      const mark = this.nearestEnemyTo(p, 1200)
      if (!steered) {
        // Continuous rotation towards the mark (or the heading being walked)
        // instead of snapping the muzzle onto a cardinal direction.
        const want = mark
          ? Math.atan2(mark.y - p.y, mark.x - p.x)
          : move.x !== 0 || move.y !== 0
            ? Math.atan2(move.y, move.x)
            : p.angle
        const turn = angleDelta(want, p.angle)
        p.angle += clamp(turn, -P2_TURN_RATE * dt, P2_TURN_RATE * dt)
      }
      // Hold fire unless the target is close and not behind a building.
      const inRange = mark && Math.hypot(mark.x - p.x, mark.y - p.y) < P2_AUTO_FIRE_RANGE
      p.shooting =
        keysPressed.shootingP2 || Boolean(inRange && mark && this.hasLineOfSight(p, mark))
      if (p.mag === 0) this.startReload(p)
    } else if (steered) {
      p.shooting = keysPressed.shooting
    } else if (p.id === 1 && touchStick.engaged) {
      // Touchscreen: the muzzle follows the aim stick only, with no assist.
      if (touchAim.active) p.angle = touchAim.angle
      p.shooting = keysPressed.shooting
    } else {
      this.mouseWorld.x = this.mouseScreen.x / this.zoom + this.camera.x
      this.mouseWorld.y = this.mouseScreen.y / this.zoom + this.camera.y
      p.angle = Math.atan2(this.mouseWorld.y - p.y, this.mouseWorld.x - p.x)
      // Held mouse button keeps the trigger down; movement above already ran.
      p.shooting = keysPressed.shooting
    }
    p.hurtCooldown = Math.max(0, p.hurtCooldown - dt)
    p.recoil = Math.max(0, p.recoil - dt * RECOIL_RECOVERY)
    this.updateSwing(p, dt)

    const c = p.character
    if (c.regenFraction > 0) {
      p.safeTimer += dt
      if (p.safeTimer >= c.regenInterval) {
        p.safeTimer = 0
        p.hp = Math.min(p.maxHp, p.hp + p.maxHp * c.regenFraction)
      }
    }
  }

  /**
   * Self-check for the run-and-gun contract: while the trigger is held and a
   * direction key is down, velocity must still be non-zero. Reports once.
   */
  private checkRunAndGun(p: Player, shooting: boolean) {
    if (this.runAndGunChecked || !shooting || !this.movementRequested(p)) return
    this.runAndGunChecked = true
    const ok = p.vx !== 0 || p.vy !== 0
    console[ok ? 'info' : 'error'](
      `[input] shooting=true velocity=(${p.vx.toFixed(1)}, ${p.vy.toFixed(1)}) ${
        ok ? 'OK — movement runs while firing' : 'FAIL — velocity cleared by shooting'
      }`
    )
  }

  private movementRequested(p: Player): boolean {
    const v = this.moveVector(p)
    return v.x !== 0 || v.y !== 0
  }

  /**
   * Normalised direction the player's own keys are asking for. Drives movement
   * everywhere except the rail mission, where it steers the weapon instead.
   */
  private moveVector(p: Player): { x: number; y: number } {
    const k = keysPressed
    const solo = this.players.length === 1
    let dx = 0
    let dy = 0
    if (p.id === 1 && settings().movementMode === 'click') {
      // Click-to-move: walk the straight line to the last right-clicked
      // point, and drop the order once it is reached or a key is touched.
      const target = this.walkTarget
      const keyed = k.w || k.a || k.s || k.d
      if (keyed) this.walkTarget = null
      if (target && !keyed) {
        const tx = target.x - p.x
        const ty = target.y - p.y
        const len = Math.hypot(tx, ty)
        if (len < WALK_ARRIVE_RANGE) {
          this.walkTarget = null
          return { x: 0, y: 0 }
        }
        return { x: tx / len, y: ty / len }
      }
    }
    // The thumbstick is analogue, so it replaces the keys outright for P1.
    if (p.id === 1 && touchStick.active) return { x: touchStick.x, y: touchStick.y }
    if (p.id === 1) {
      if (k.w || (solo && k.up)) dy -= 1
      if (k.s || (solo && k.down)) dy += 1
      if (k.a || (solo && k.left)) dx -= 1
      if (k.d || (solo && k.right)) dx += 1
    } else {
      if (k.up) dy -= 1
      if (k.down) dy += 1
      if (k.left) dx -= 1
      if (k.right) dx += 1
    }
    if (dx || dy) {
      const len = Math.hypot(dx, dy)
      dx /= len
      dy /= len
    }
    return { x: dx, y: dy }
  }

  private hasLineOfSight(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const steps = Math.ceil(Math.hypot(dx, dy) / 24)
    for (let i = 1; i < steps; i++) {
      const t = i / steps
      if (circleHitsWall(this.map, from.x + dx * t, from.y + dy * t, 2)) return false
    }
    return true
  }

  private nearestEnemyTo(from: { x: number; y: number }, range: number): Enemy | null {
    let best: Enemy | null = null
    let bestD = range
    for (const e of this.enemies) {
      const d = Math.hypot(e.x - from.x, e.y - from.y)
      if (d < bestD) {
        bestD = d
        best = e
      }
    }
    return best
  }

  /**
   * Solid bodies: an enemy may touch a player but never stand inside one, so
   * a crowd stacks up against the hitbox instead of clipping through it.
   * Players are treated as immovable, and contact damage is unaffected.
   */
  private pushOffPlayers() {
    for (const p of this.players) {
      if (p.down) continue
      for (const z of this.enemies) {
        const min = p.r + z.r
        const dx = z.x - p.x
        const dy = z.y - p.y
        const d = Math.hypot(dx, dy)
        if (d >= min) continue
        const angle = d < 0.001 ? Math.random() * Math.PI * 2 : Math.atan2(dy, dx)
        const push = min - Math.min(d, min)
        this.moveEnemy(z, Math.cos(angle) * push, Math.sin(angle) * push)
      }
    }
  }

  /** Enemy movement also respects deployed barricades. */
  private moveEnemy(z: Enemy, dx: number, dy: number) {
    const m = this.map
    if (dx) {
      const nx = clamp(z.x + dx, z.r, m.width - z.r)
      if (!circleHitsWall(m, nx, z.y, z.r) && !this.hitsBarricade(nx, z.y, z.r)) z.x = nx
    }
    if (dy) {
      const ny = clamp(z.y + dy, z.r, m.height - z.r)
      if (!circleHitsWall(m, z.x, ny, z.r) && !this.hitsBarricade(z.x, ny, z.r)) z.y = ny
    }
  }

  /**
   * Pushes overlapping enemies and survivors apart so a crowd spreads out
   * side by side instead of collapsing into one unshootable point.
   */
  private separateBodies() {
    const bodies: { x: number; y: number; r: number }[] = [...this.enemies]
    for (const s of this.survivors) {
      if (!s.safe && s.hp > 0) bodies.push(s)
    }
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i]
        const b = bodies[j]
        const min = a.r + b.r
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.hypot(dx, dy)
        if (d >= min) continue
        // Exactly coincident bodies need an arbitrary axis to split along.
        const angle = d < 0.001 ? Math.random() * Math.PI * 2 : Math.atan2(dy, dx)
        const push = ((min - Math.min(d, min)) * SEPARATION_PUSH) / 2
        const ux = Math.cos(angle) * push
        const uy = Math.sin(angle) * push
        this.moveCircle(a, -ux, -uy)
        this.moveCircle(b, ux, uy)
      }
    }
  }

  private moveCircle(e: { x: number; y: number; r: number }, dx: number, dy: number) {
    const m = this.map
    if (dx) {
      const nx = clamp(e.x + dx, e.r, m.width - e.r)
      if (!circleHitsWall(m, nx, e.y, e.r)) e.x = nx
    }
    if (dy) {
      const ny = clamp(e.y + dy, e.r, m.height - e.r)
      if (!circleHitsWall(m, e.x, ny, e.r)) e.y = ny
    }
  }

  private startReload(p: Player | undefined) {
    if (this.state !== 'playing' || !p || p.down || p.weapon.infiniteAmmo) return
    if (p.reloadTimer > 0 || p.mag === p.weapon.magSize || p.reserve <= 0) return
    p.reloadTimer = p.weapon.reloadTime * p.character.reloadMultiplier
  }

  private updateWeapon(p: Player, dt: number) {
    p.fireTimer = Math.max(0, p.fireTimer - dt)
    if (p.reloadTimer > 0) {
      p.reloadTimer -= dt
      if (p.reloadTimer <= 0) {
        const need = p.weapon.magSize - p.mag
        const take = Math.min(need, p.reserve)
        p.mag += take
        p.reserve -= take
        p.reloadTimer = 0
      }
      return
    }
    const charge = p.weapon.chargeTime
    if (charge) {
      // Charge weapons bank trigger time and release once the coil is full.
      if (!p.shooting && !p.queuedShot) {
        p.charge = Math.max(0, p.charge - dt * 2)
        return
      }
      if (p.mag <= 0) {
        p.queuedShot = false
        p.charge = 0
        this.startReload(p)
        return
      }
      p.charge += dt
      if (p.charge < charge || p.fireTimer > 0) return
      p.charge = 0
      p.queuedShot = false
      this.fire(p)
      p.fireTimer = this.fireInterval(p)
      return
    }
    p.charge = 0
    if ((p.shooting || p.queuedShot) && p.fireTimer === 0) {
      if (p.mag > 0) {
        this.fire(p)
        p.fireTimer = this.fireInterval(p)
        p.queuedShot = false
      } else {
        p.queuedShot = false
        this.startReload(p)
      }
    }
  }

  /** Rail convoy weapons cycle 1.5x faster, for the arcade cadence. */
  private fireInterval(p: Player): number {
    const base = this.railMode ? p.weapon.fireInterval / RAIL_FIRE_RATE : p.weapon.fireInterval
    return base / this.arenaHaste
  }

  private fire(p: Player) {
    const w = p.weapon
    p.shotsFired += 1
    if (w.melee) {
      this.swingMelee(p, w.melee)
      return
    }
    const acidShot = w.perk === 'acidic-spray' && p.shotsFired % ACID_SHOT_INTERVAL === 0
    const cryoShot = Boolean(w.cryoEvery) && p.shotsFired % (w.cryoEvery ?? 1) === 0
    const overdrive = p.character.id === 'army-retiree' && p.abilityActive > 0
    const damage = w.damage * (overdrive ? OVERDRIVE_DAMAGE : 1)

    for (let i = 0; i < w.pellets; i++) {
      const spread = (Math.random() - 0.5) * w.spread * (w.pellets > 1 ? 2 : 1)
      const a = p.angle + spread
      const speed = w.bulletSpeed * (w.pellets > 1 ? 0.85 + Math.random() * 0.3 : 1)
      this.bullets.push({
        x: p.x + Math.cos(a) * (p.r + 6),
        y: p.y + Math.sin(a) * (p.r + 6),
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: w.bulletLife,
        maxLife: w.bulletLife,
        falloff: w.falloff ?? 1,
        tracerLength:
          w.perk === 'thermal-lance' ? 120 : w.perk === 'armor-piercing' ? 56 : w.pellets > 1 ? 10 : 18,
        damage,
        pierce: w.perk === 'armor-piercing' || Boolean(w.piercing),
        poison: acidShot || Boolean(w.venom),
        ignite: w.perk === 'dragons-breath',
        cryo: cryoShot,
        venom: Boolean(w.venom),
        // Acid needles eat straight through hardened shells.
        ignoreArmour: Boolean(w.piercing) || Boolean(w.venom),
        blast: w.blastRadius ?? 0,
        blastFreeze: w.blastFreeze ?? 0,
        color: cryoShot
          ? '#7dd3fc'
          : w.blastRadius
            ? '#38bdf8'
            : w.piercing
              ? '#fb923c'
              : acidShot
                ? '#7cf03d'
                : overdrive
                  ? '#ff4d4d'
                  : w.perk === 'dragons-breath'
                    ? '#ff7a18'
                    : '#ffe066',
        width: acidShot || cryoShot ? w.tracerWidth + 1 : w.tracerWidth,
        hit: new Set<Enemy>(),
        owner: p,
      })
    }
    if (!w.infiniteAmmo) p.mag -= 1
    p.recoil = 1
    playShot(w)
  }

  /**
   * Melee weapons sweep an arc in front of the player, cutting through every
   * enemy inside it, shoving them back and — for the baton — freezing them.
   */
  private swingMelee(p: Player, melee: MeleeProfile) {
    p.swinging = true
    p.swing = 0
    p.swingDir = p.swingDir === 1 ? -1 : 1
    p.swingHits = []
    p.swingHitBoss = false
    p.recoil = 1
    playShot(p.weapon)
    // Land the first slice on the frame the swing starts.
    this.updateSwing(p, 0, melee)
  }

  /**
   * Advances an in-flight melee swing: the blade travels across the weapon's
   * arc and cuts whatever its wedge passes over, once per enemy per swing.
   */
  private updateSwing(p: Player, dt: number, profile?: MeleeProfile) {
    if (!p.swinging) return
    const melee = profile ?? p.weapon.melee
    if (!melee) {
      p.swinging = false
      p.swing = 0
      return
    }
    p.swing = Math.min(1, p.swing + dt / MELEE_SWING_TIME)
    const blade = p.angle + p.swingDir * (p.swing - 0.5) * melee.arc
    const overdrive = p.character.id === 'army-retiree' && p.abilityActive > 0
    const damage = p.weapon.damage * (overdrive ? OVERDRIVE_DAMAGE : 1)

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]
      if (p.swingHits.includes(e)) continue
      const d = Math.hypot(e.x - p.x, e.y - p.y)
      if (d > p.r + melee.reach + e.r) continue
      const to = Math.atan2(e.y - p.y, e.x - p.x)
      // Wide targets are forgiving: their radius widens the angular window.
      const half = MELEE_BLADE_HALF + Math.atan2(e.r, Math.max(d, 1))
      if (Math.abs(angleDelta(to, blade)) > half) continue
      p.swingHits.push(e)
      e.hp -= damage * this.enemyArmour
      this.moveEnemy(e, Math.cos(to) * melee.knockback, Math.sin(to) * melee.knockback)
      if (melee.stunChance > 0 && Math.random() < melee.stunChance) e.stun = melee.stunTime
      if (e.hp <= 0) this.killEnemy(i)
    }

    const boss = this.boss
    if (boss && boss.hp > 0 && !p.swingHitBoss) {
      const d = Math.hypot(boss.x - p.x, boss.y - p.y)
      const to = Math.atan2(boss.y - p.y, boss.x - p.x)
      const half = MELEE_BLADE_HALF + Math.atan2(boss.r, Math.max(d, 1))
      if (d <= p.r + melee.reach + boss.r && Math.abs(angleDelta(to, blade)) <= half) {
        p.swingHitBoss = true
        boss.hp -= damage
        boss.hurt = 0.12
        if (boss.hp <= boss.maxHp / 2 && boss.phase === 1) {
          boss.phase = 2
          boss.dashTimer = 2
          playSfx('boss-roar')
        }
      }
    }

    if (p.swing >= 1) {
      p.swinging = false
      p.swingHits = []
    }
  }

  /** True while Camouflage Blend hides this player from every enemy. */
  private isCloaked(p: Player): boolean {
    return p.character.id === 'nature-lover' && p.abilityActive > 0
  }

  private updateTurrets(dt: number) {
    for (let i = this.turrets.length - 1; i >= 0; i--) {
      const t = this.turrets[i]
      t.life -= dt
      if (t.life <= 0) {
        this.turrets.splice(i, 1)
        continue
      }
      this.updateTurret(t, dt)
    }
  }

  private updateTurret(t: Turret, dt: number) {
    t.cooldown = Math.max(0, t.cooldown - dt)

    let closest: Enemy | null = null
    let best = TURRET_RANGE
    for (const e of this.enemies) {
      const d = Math.hypot(e.x - t.x, e.y - t.y)
      if (d < best) {
        best = d
        closest = e
      }
    }
    if (!closest) return

    t.angle = Math.atan2(closest.y - t.y, closest.x - t.x)
    if (t.cooldown > 0) return
    t.cooldown = TURRET_INTERVAL
    this.bullets.push({
      x: t.x + Math.cos(t.angle) * (t.r + 6),
      y: t.y + Math.sin(t.angle) * (t.r + 6),
      vx: Math.cos(t.angle) * 900,
      vy: Math.sin(t.angle) * 900,
      life: 0.7,
      maxLife: 0.7,
      falloff: 1,
      tracerLength: 14,
      damage: TURRET_DAMAGE,
      pierce: false,
      poison: false,
      ignite: false,
      cryo: false,
      venom: false,
      ignoreArmour: false,
      blast: 0,
      blastFreeze: 0,
      color: '#a78bfa',
      width: 2,
      hit: new Set<Enemy>(),
      owner: null,
    })
  }

  private updateBullets(dt: number) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]
      const px = b.x
      const py = b.y
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.life -= dt
      let dead = b.life <= 0 || circleHitsWall(this.map, b.x, b.y, 2)
      const boss = this.boss
      // Fast rounds cover more ground per frame than an enemy is wide, so hits
      // are measured against the whole step, not just where the bullet landed.
      if (!dead && boss && boss.hp > 0 && segmentDistance(boss.x, boss.y, px, py, b.x, b.y) < boss.r) {
        const travelled = 1 - b.life / b.maxLife
        const dealt = b.damage * (1 - (1 - b.falloff) * travelled)
        boss.hp -= dealt
        this.arenaOnHit(b, dealt, b.x, b.y, null)
        if (b.blast > 0) dead = true
        boss.hurt = 0.12
        if (boss.hp <= boss.maxHp / 2 && boss.phase === 1) {
          boss.phase = 2
          boss.dashTimer = 2
          playSfx('boss-roar')
        }
        if (!b.pierce) dead = true
      }
      if (!dead) {
        for (let c = this.crystals.length - 1; c >= 0; c--) {
          const crystal = this.crystals[c]
          if (segmentDistance(crystal.x, crystal.y, px, py, b.x, b.y) >= crystal.r) continue
          crystal.hp -= b.damage
          crystal.hurt = 0.14
          if (crystal.hp <= 0) this.burstCrystal(c)
          if (!b.pierce) dead = true
          break
        }
      }
      if (!dead) {
        for (let h = this.hives.length - 1; h >= 0; h--) {
          const hive = this.hives[h]
          if (segmentDistance(hive.x, hive.y, px, py, b.x, b.y) >= hive.r) continue
          hive.hp -= b.damage
          hive.hurt = 0.14
          if (hive.hp <= 0) this.burstHive(h)
          if (!b.pierce) dead = true
          break
        }
      }
      if (!dead) {
        for (let j = this.enemies.length - 1; j >= 0; j--) {
          const e = this.enemies[j]
          if (b.hit.has(e)) continue
          if (segmentDistance(e.x, e.y, px, py, b.x, b.y) >= e.r + 2) continue
          b.hit.add(e)
          const travelled = 1 - b.life / b.maxLife
          const armour = b.ignoreArmour ? 1 : this.enemyArmour
          const dealt = b.damage * (1 - (1 - b.falloff) * travelled) * armour
          e.hp -= dealt
          this.arenaOnHit(b, dealt, e.x, e.y, e)
          if (b.poison) {
            e.poison = POISON_DURATION
            // Acid needles pile up; a single acidic-spray round does not.
            if (b.venom) e.poisonStacks = Math.min(MAX_POISON_STACKS, e.poisonStacks + 1)
          }
          if (b.cryo) e.slow = CRYO_SLOW_TIME
          if (b.ignite && e.kind === 'bug' && Math.random() < IGNITE_CHANCE) e.burn = BURN_DURATION
          if (e.hp <= 0) this.killEnemy(j)
          if (b.blast > 0) {
            dead = true
            break
          }
          if (!b.pierce) {
            dead = true
            break
          }
        }
      }
      if (dead) {
        if (b.blast > 0) this.detonate(b)
        this.bullets.splice(i, 1)
      }
    }
  }

  /** Cryo canister: damages the group it lands in and freezes it solid. */
  private detonate(b: Bullet) {
    this.blasts.push({ x: b.x, y: b.y, r: b.blast, life: BLAST_LIFE, maxLife: BLAST_LIFE })
    playSfx('explosion')
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]
      if (Math.hypot(e.x - b.x, e.y - b.y) > b.blast + e.r) continue
      e.hp -= b.damage * this.enemyArmour
      e.stun = Math.max(e.stun, b.blastFreeze)
      e.slow = CRYO_SLOW_TIME
      if (e.hp <= 0) this.killEnemy(i)
    }
    const boss = this.boss
    if (boss && boss.hp > 0 && Math.hypot(boss.x - b.x, boss.y - b.y) < b.blast + boss.r) {
      boss.hp -= b.damage
      boss.hurt = 0.12
    }
  }

  private killEnemy(index: number) {
    const z = this.enemies[index]
    this.enemies.splice(index, 1)
    this.kills += 1
    this.scrapEarned += z.kind === 'bug' ? SCRAP_PER_BUG : SCRAP_PER_KILL
    // Cold-weather mutations are the only source of chips outside missions.
    if (this.mission?.chapter === 2) this.chipsEarned += CHIPS_PER_KILL
    if (this.mutation?.id === 'toxic-blood') {
      this.acid.push({
        x: z.x,
        y: z.y,
        r: ACID_RADIUS,
        life: ACID_LIFE,
        maxLife: ACID_LIFE,
        ticker: new AoeTicker<Player>(),
      })
    }
    const dropChance =
      this.mission?.type === 'boss' ? AMMO_DROP_CHANCE_BOSS : AMMO_DROP_CHANCE
    if (Math.random() < dropChance) {
      this.ammoBoxes.push({ x: z.x, y: z.y, amount: AMMO_DROP_AMOUNT })
    }
  }

  /**
   * Phase 1 stalks the nearest player, spitting venom rings and hatching
   * brood. Below half health she enrages: faster, and charging every 5s.
   */
  private updateBoss(dt: number) {
    const b = this.boss
    if (!b || b.hp <= 0) return
    // She only stirs once the reveal cinematic has played.
    if (this.reveal === 'pending' || this.reveal === 'playing') return
    b.wobble += dt
    b.hurt = Math.max(0, b.hurt - dt)
    b.attackCooldown = Math.max(0, b.attackCooldown - dt)

    const prey = this.nearestPlayerTo(b)
    if (prey) b.angle = Math.atan2(prey.y - b.y, prey.x - b.x)

    if (b.kind === 'runner-alpha') {
      this.updateRunnerAlpha(b, dt, prey)
      return
    }
    if (b.kind === 'camo-stalker') {
      this.updateCamoStalker(b, dt, prey)
      return
    }
    if (b.kind === 'cryo-stalker') {
      this.updateCryoStalker(b, dt, prey)
      return
    }
    if (b.kind === 'canopy-leviathan') {
      this.updateCanopyLeviathan(b, dt, prey)
      return
    }

    if (b.dashing > 0) {
      b.dashing -= dt
      this.moveCircle(b, b.dashDir.x * BOSS_DASH_SPEED * dt, b.dashDir.y * BOSS_DASH_SPEED * dt)
    } else if (prey) {
      const speed = b.baseSpeed * (b.phase === 2 ? BOSS_ENRAGE_SPEED : 1)
      this.moveCircle(b, Math.cos(b.angle) * speed * dt, Math.sin(b.angle) * speed * dt)
    }

    b.ringTimer -= dt
    if (b.ringTimer <= 0) {
      b.ringTimer = BOSS_RING_INTERVAL
      this.fireVenomRing(b)
    }

    b.broodTimer -= dt
    if (b.broodTimer <= 0) {
      b.broodTimer = BOSS_BROOD_INTERVAL
      for (let i = 0; i < BOSS_BROOD_COUNT; i++) {
        if (this.enemies.length >= BOSS_BROOD_MAX) break
        const spot = this.openSpot(12, b, 80, 220)
        this.enemies.push(this.makeBug(spot))
      }
    }

    // The Colossus charges from the first second, not just when enraged.
    if ((b.phase === 2 || b.kind === 'rust-colossus') && b.dashing <= 0) {
      b.dashTimer -= dt
      if (b.dashTimer <= 0 && prey) {
        b.dashTimer = b.kind === 'rust-colossus' ? BOSS_DASH_INTERVAL * 0.55 : BOSS_DASH_INTERVAL
        b.dashing = BOSS_DASH_TIME
        b.dashDir = { x: Math.cos(b.angle), y: Math.sin(b.angle) }
        playSfx('boss-dash')
      }
    }

    if (prey && b.attackCooldown === 0) {
      const d = Math.hypot(prey.x - b.x, prey.y - b.y)
      if (d < b.r + prey.r) {
        this.damagePlayer(
          prey,
          b.kind === 'rust-colossus' ? COLOSSUS_CONTACT_DAMAGE : BOSS_CONTACT_DAMAGE
        )
        prey.hurtCooldown = 0.3
        prey.safeTimer = 0
        b.attackCooldown = 1
      }
    }
  }

  /**
   * The Runner Alpha sprints at the nearest player, leaps clean over debris
   * and screams every ten seconds to pull in a pack of Runner minions.
   */
  private updateRunnerAlpha(b: Boss, dt: number, prey: Player | null) {
    const enraged = b.phase === 2
    if (b.dashing > 0) {
      // A leap ignores walls: she vaults the rubble instead of pathing round.
      b.dashing -= dt
      const nx = clamp(b.x + b.dashDir.x * ALPHA_LEAP_SPEED * dt, b.r, this.map.width - b.r)
      const ny = clamp(b.y + b.dashDir.y * ALPHA_LEAP_SPEED * dt, b.r, this.map.height - b.r)
      b.x = nx
      b.y = ny
      if (b.dashing <= 0 && circleHitsWall(this.map, b.x, b.y, b.r)) {
        const landing = this.openSpot(b.r, b, 0, 160)
        b.x = landing.x
        b.y = landing.y
      }
    } else if (prey) {
      const speed = b.baseSpeed * (enraged ? BOSS_ENRAGE_SPEED : 1)
      this.moveCircle(b, Math.cos(b.angle) * speed * dt, Math.sin(b.angle) * speed * dt)
      b.dashTimer -= dt
      if (b.dashTimer <= 0) {
        b.dashTimer = ALPHA_LEAP_INTERVAL * (enraged ? 0.7 : 1)
        b.dashing = ALPHA_LEAP_TIME
        b.dashDir = { x: Math.cos(b.angle), y: Math.sin(b.angle) }
        playSfx('boss-dash')
      }
    }

    b.screamTimer -= dt
    if (b.screamTimer <= 0) {
      b.screamTimer = ALPHA_SCREAM_INTERVAL
      playSfx('boss-roar')
      for (let i = 0; i < ALPHA_PACK_SIZE; i++) {
        if (this.enemies.length >= ALPHA_PACK_MAX) break
        this.enemies.push(this.makeRunner(this.openSpot(12, b, 120, 300)))
      }
    }

    if (prey && b.attackCooldown === 0 && Math.hypot(prey.x - b.x, prey.y - b.y) < b.r + prey.r) {
      this.damagePlayer(prey, ALPHA_CONTACT_DAMAGE)
      prey.hurtCooldown = 0.3
      prey.safeTimer = 0
      b.attackCooldown = 0.8
    }
  }

  /**
   * The Camo Stalker alternates six seconds visible with six invisible. While
   * cloaked she only shows as wet footprints, then reappears behind her prey
   * for a backstab.
   */
  private updateCamoStalker(b: Boss, dt: number, prey: Player | null) {
    for (let i = b.footprints.length - 1; i >= 0; i--) {
      b.footprints[i].life -= dt
      if (b.footprints[i].life <= 0) b.footprints.splice(i, 1)
    }

    b.cloakTimer -= dt
    if (b.cloakTimer <= 0) {
      b.cloaked = !b.cloaked
      b.cloakTimer = b.cloaked ? STALKER_CLOAK_TIME : STALKER_VISIBLE_TIME
      if (!b.cloaked && prey) {
        // Slips in behind whoever she was hunting and strikes.
        const behind = prey.angle + Math.PI
        const spot = {
          x: clamp(prey.x + Math.cos(behind) * (prey.r + b.r + 6), b.r, this.map.width - b.r),
          y: clamp(prey.y + Math.sin(behind) * (prey.r + b.r + 6), b.r, this.map.height - b.r),
        }
        if (!circleHitsWall(this.map, spot.x, spot.y, b.r)) {
          b.x = spot.x
          b.y = spot.y
        }
        this.damagePlayer(prey, STALKER_BACKSTAB_DAMAGE)
        prey.hurtCooldown = 0.4
        prey.safeTimer = 0
        playSfx('boss-dash')
      } else {
        playSfx('cloak')
      }
    }

    if (prey) {
      const speed = b.baseSpeed * (b.cloaked ? 1.45 : 1) * (b.phase === 2 ? BOSS_ENRAGE_SPEED : 1)
      this.moveCircle(b, Math.cos(b.angle) * speed * dt, Math.sin(b.angle) * speed * dt)
    }

    if (b.cloaked) {
      b.ringTimer -= dt
      if (b.ringTimer <= 0) {
        b.ringTimer = STALKER_FOOTPRINT_INTERVAL
        b.footprints.push({ x: b.x, y: b.y, life: STALKER_FOOTPRINT_LIFE })
      }
    }

    if (
      prey &&
      !b.cloaked &&
      b.attackCooldown === 0 &&
      Math.hypot(prey.x - b.x, prey.y - b.y) < b.r + prey.r
    ) {
      this.damagePlayer(prey, BOSS_CONTACT_DAMAGE)
      prey.hurtCooldown = 0.3
      prey.safeTimer = 0
      b.attackCooldown = 1
    }
  }

  /**
   * The Cryo-Stalker walks its prey down, slamming the floor for a freezing
   * shockwave and spitting bursts of three piercing icicles between slams.
   */
  private updateCryoStalker(b: Boss, dt: number, prey: Player | null) {
    if (prey) {
      const speed = b.baseSpeed * (b.phase === 2 ? BOSS_ENRAGE_SPEED : 1) * b.speedMult
      this.moveCircle(b, Math.cos(b.angle) * speed * dt, Math.sin(b.angle) * speed * dt)
    }

    // broodTimer drives the slam, ringTimer the icicle burst.
    b.broodTimer -= dt
    if (b.broodTimer <= 0 && prey) {
      b.broodTimer = SLAM_INTERVAL * (b.phase === 2 ? 0.65 : 1)
      if (Math.hypot(prey.x - b.x, prey.y - b.y) < SLAM_RANGE) {
        this.shocks.push({ x: b.x, y: b.y, r: b.r, maxR: SLAM_RANGE, hit: [] })
        this.shake = Math.max(this.shake, 0.6)
        playSfx('boss-dash')
      }
    }

    b.ringTimer -= dt
    if (b.ringTimer <= 0 && prey) {
      b.ringTimer = SHARD_INTERVAL * (b.phase === 2 ? 0.7 : 1)
      for (let i = 0; i < SHARD_COUNT; i++) {
        const a = b.angle + (i - (SHARD_COUNT - 1) / 2) * SHARD_SPREAD
        this.shards.push({
          x: b.x + Math.cos(a) * (b.r + 8),
          y: b.y + Math.sin(a) * (b.r + 8),
          vx: Math.cos(a) * SHARD_SPEED,
          vy: Math.sin(a) * SHARD_SPEED,
          r: 6,
          life: SHARD_LIFE,
          hit: [],
        })
      }
      playSfx('sting')
    }

    if (prey && b.attackCooldown === 0 && Math.hypot(prey.x - b.x, prey.y - b.y) < b.r + prey.r) {
      this.damagePlayer(prey, BOSS_CONTACT_DAMAGE)
      prey.hurtCooldown = 0.3
      prey.safeTimer = 0
      b.attackCooldown = 1
    }
  }

  /**
   * The Leviathan lumbers after its prey and slams the ground every six
   * seconds. While a Primeval Crystal still stands it drinks back 5% of its
   * pool every two seconds and cannot be dropped below a sliver of health.
   */
  private updateCanopyLeviathan(b: Boss, dt: number, prey: Player | null) {
    this.updateCrystals(b, dt)
    if (this.crystals.length) b.hp = Math.max(b.hp, 1)

    if (prey) {
      const speed = b.baseSpeed * (b.phase === 2 ? BOSS_ENRAGE_SPEED : 1) * b.speedMult
      this.moveCircle(b, Math.cos(b.angle) * speed * dt, Math.sin(b.angle) * speed * dt)
    }

    b.broodTimer -= dt
    if (b.broodTimer <= 0) {
      b.broodTimer = LEVIATHAN_SLAM_INTERVAL * (b.phase === 2 ? 0.75 : 1)
      this.slamFlameZones(b, prey)
    }

    if (prey && b.attackCooldown === 0 && Math.hypot(prey.x - b.x, prey.y - b.y) < b.r + prey.r) {
      this.damagePlayer(prey, LEVIATHAN_CONTACT_DAMAGE)
      prey.hurtCooldown = 0.3
      prey.safeTimer = 0
      b.attackCooldown = 1
    }
  }

  /** Each surviving crystal beams a slice of the boss's pool back to it. */
  private updateCrystals(b: Boss, dt: number) {
    for (const c of this.crystals) {
      c.pulse += dt
      c.hurt = Math.max(0, c.hurt - dt)
      c.beam = Math.max(0, c.beam - dt)
    }
    if (!this.crystals.length) return
    b.ringTimer -= dt
    if (b.ringTimer > 0) return
    b.ringTimer = CRYSTAL_HEAL_INTERVAL
    for (const c of this.crystals) {
      c.beam = CRYSTAL_BEAM_TIME
      b.hp = Math.min(b.maxHp, b.hp + b.maxHp * CRYSTAL_HEAL_FRACTION)
    }
    playSfx('sting')
  }

  /** A crystal shatters, cutting one of the boss's lifelines. */
  private burstCrystal(index: number) {
    const c = this.crystals[index]
    this.crystals.splice(index, 1)
    this.shake = Math.max(this.shake, 0.7)
    playSfx('explosion')
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2
      const speed = 100 + Math.random() * 300
      this.gibs.push({
        x: c.x,
        y: c.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        r: 3 + Math.random() * 6,
        life: 1,
        decay: 0.6 + Math.random() * 0.6,
        color: Math.random() < 0.5 ? '#67e8f9' : '#a3e635',
      })
    }
    if (!this.crystals.length) this.announce('⚠️ PRIMEVAL CRYSTALS DOWN! THE LEVIATHAN IS VULNERABLE')
  }

  /** Marks three patches of ground around the prey for the coming eruption. */
  private slamFlameZones(b: Boss, prey: Player | null) {
    const focus = prey ?? { x: b.x, y: b.y }
    for (let i = 0; i < FLAME_ZONE_COUNT; i++) {
      const a = Math.random() * Math.PI * 2
      const d = Math.random() * FLAME_ZONE_SPREAD
      this.flameZones.push({
        x: clamp(focus.x + Math.cos(a) * d, FLAME_ZONE_RADIUS, this.map.width - FLAME_ZONE_RADIUS),
        y: clamp(focus.y + Math.sin(a) * d, FLAME_ZONE_RADIUS, this.map.height - FLAME_ZONE_RADIUS),
        r: FLAME_ZONE_RADIUS,
        warn: FLAME_WARNING_TIME,
        burn: FLAME_BURN_TIME,
        ticker: new AoeTicker<Player>(),
      })
    }
    this.shake = Math.max(this.shake, 0.7)
    playSfx('boss-dash')
  }

  /** Warning circles count down, then cook anything standing in them. */
  private updateFlameZones(dt: number) {
    for (let i = this.flameZones.length - 1; i >= 0; i--) {
      const z = this.flameZones[i]
      if (z.warn > 0) {
        z.warn -= dt
        if (z.warn <= 0) playSfx('explosion')
        continue
      }
      z.burn -= dt
      if (z.burn <= 0) {
        this.flameZones.splice(i, 1)
        continue
      }
      for (const p of this.alivePlayers) {
        if (Math.hypot(p.x - z.x, p.y - z.y) > z.r + p.r) {
          z.ticker.reset(p)
          continue
        }
        const damage = z.ticker.tick(p, dt)
        if (!damage) continue
        this.damagePlayer(p, damage)
        p.hurtCooldown = 0.25
        p.safeTimer = 0
      }
    }
  }

  /** Icicles fly straight through players; each one hits a player only once. */
  private updateShards(dt: number) {
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i]
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.life -= dt
      if (s.life <= 0 || circleHitsWall(this.map, s.x, s.y, s.r)) {
        this.shards.splice(i, 1)
        continue
      }
      for (const p of this.alivePlayers) {
        if (s.hit.includes(p) || this.isCloaked(p)) continue
        if (Math.hypot(p.x - s.x, p.y - s.y) > p.r + s.r) continue
        s.hit.push(p)
        this.damagePlayer(p, SHARD_DAMAGE)
        p.hurtCooldown = 0.2
        p.safeTimer = 0
        playSfx('sting')
      }
    }
  }

  /** Freeze slams expand once, chilling each player they wash over. */
  private updateShocks(dt: number) {
    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const w = this.shocks[i]
      w.r += SLAM_GROWTH * dt
      for (const p of this.alivePlayers) {
        if (w.hit.includes(p)) continue
        if (Math.hypot(p.x - w.x, p.y - w.y) > w.r) continue
        w.hit.push(p)
        this.applyAoeDamage(p, SLAM_DAMAGE)
        p.chill = CHILL_TIME
        p.hurtCooldown = 0.2
        p.safeTimer = 0
      }
      if (w.r >= w.maxR) this.shocks.splice(i, 1)
    }
  }

  /**
   * Queues a one-shot AoE hit as spaced ticks instead of a single spike, so
   * no slam can ever empty a health bar in a single frame.
   */
  private applyAoeDamage(p: Player, total: number) {
    const ticks = aoeTickCount(total)
    const existing = this.aoeBurns.find((b) => b.player === p)
    if (existing) {
      existing.ticksLeft = Math.max(existing.ticksLeft, ticks)
      return
    }
    this.aoeBurns.push({ player: p, ticksLeft: ticks, timer: 0 })
  }

  private updateAoeBurns(dt: number) {
    for (let i = this.aoeBurns.length - 1; i >= 0; i--) {
      const burn = this.aoeBurns[i]
      burn.timer -= dt
      if (burn.player.down || burn.ticksLeft <= 0) {
        this.aoeBurns.splice(i, 1)
        continue
      }
      if (burn.timer > 0) continue
      burn.ticksLeft -= 1
      burn.timer = AOE_TICK_COOLDOWN
      this.damagePlayer(burn.player, AOE_TICK_DAMAGE)
      burn.player.hurtCooldown = 0.2
      burn.player.safeTimer = 0
    }
  }

  private fireVenomRing(b: Boss) {
    for (let i = 0; i < BOSS_RING_SHOTS; i++) {
      const a = (i / BOSS_RING_SHOTS) * Math.PI * 2 + b.wobble
      this.venom.push({
        x: b.x + Math.cos(a) * (b.r + 6),
        y: b.y + Math.sin(a) * (b.r + 6),
        vx: Math.cos(a) * VENOM_SPEED,
        vy: Math.sin(a) * VENOM_SPEED,
        r: 7,
        life: VENOM_LIFE,
      })
    }
  }

  private updateVenom(dt: number) {
    for (let i = this.venom.length - 1; i >= 0; i--) {
      const v = this.venom[i]
      v.x += v.vx * dt
      v.y += v.vy * dt
      v.life -= dt
      let dead = v.life <= 0 || circleHitsWall(this.map, v.x, v.y, v.r)
      if (!dead) {
        for (const p of this.alivePlayers) {
          if (this.isCloaked(p) || p.hurtCooldown > 0) continue
          if (Math.hypot(p.x - v.x, p.y - v.y) > p.r + v.r) continue
          // Venom is a sting: it feeds the infection meter, not just health.
          p.stings += 1
          this.damagePlayer(p, VENOM_DAMAGE)
          p.hurtCooldown = 1.2
          p.safeTimer = 0
          playSfx('sting')
          dead = true
          break
        }
      }
      if (dead) this.venom.splice(i, 1)
    }
  }

  private nearestPlayerTo(from: { x: number; y: number }): Player | null {
    let best: Player | null = null
    let bestD = Infinity
    for (const p of this.alivePlayers) {
      if (this.isCloaked(p)) continue
      const d = Math.hypot(p.x - from.x, p.y - from.y)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    return best
  }

  private updateSurvivors(dt: number) {
    const exit = this.map.extraction
    const field = extractionField(this.map, 20)
    for (const s of this.survivors) {
      if (s.safe || s.hp <= 0) continue
      s.hurtCooldown = Math.max(0, s.hurtCooldown - dt)
      const dx = exit.x - s.x
      const dy = exit.y - s.y
      const d = Math.hypot(dx, dy) || 1
      if (d < EXTRACTION_RADIUS) {
        s.safe = true
        this.extracted += 1
        continue
      }

      const escorted = this.alivePlayers.some(
        (p) => Math.hypot(p.x - s.x, p.y - s.y) < ESCORT_RADIUS
      )
      if (!escorted) continue

      // Follow the pre-computed route field so corners and buildings are
      // steered around rather than walked into.
      const flow = flowDirection(field, s.x, s.y) ?? { x: dx / d, y: dy / d }
      const sep = this.survivorSeparation(s)
      let ux = flow.x + sep.x
      let uy = flow.y + sep.y
      const len = Math.hypot(ux, uy) || 1
      ux /= len
      uy /= len

      const step = s.speed * dt
      const base = Math.atan2(uy, ux) + (s.stuck > 0 ? s.detour : 0)
      const before = { x: s.x, y: s.y }
      for (const offset of [0, 0.4, -0.4, 0.9, -0.9, 1.4, -1.4, 2.1, -2.1]) {
        const a = base + offset
        const nx = s.x + Math.cos(a) * step
        const ny = s.y + Math.sin(a) * step
        if (circleHitsWall(this.map, nx, ny, s.r)) continue
        s.x = nx
        s.y = ny
        break
      }

      // Wedged against a corner: commit to a sidestep for a moment.
      if (Math.hypot(s.x - before.x, s.y - before.y) < step * 0.4) {
        if (s.stuck <= 0) s.detour = Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2
        s.stuck = 0.7
      } else {
        s.stuck = Math.max(0, s.stuck - dt)
      }
    }
  }

  /** Keeps escorted survivors from stacking into one another. */
  private survivorSeparation(self: Survivor): { x: number; y: number } {
    let x = 0
    let y = 0
    for (const other of this.survivors) {
      if (other === self || other.safe || other.hp <= 0) continue
      const dx = self.x - other.x
      const dy = self.y - other.y
      const d = Math.hypot(dx, dy)
      if (d > 0 && d < self.r * 3) {
        x += dx / d
        y += dy / d
      }
    }
    return { x: x * 0.6, y: y * 0.6 }
  }

  /** Enemies prefer whichever survivor, player or generator is closest. */
  private targetFor(z: Enemy): EnemyTarget {
    let best: EnemyTarget = {
      x: z.x,
      y: z.y,
      survivor: null,
      player: null,
      generator: null,
    }
    let bestD = Infinity
    for (const p of this.alivePlayers) {
      // Camouflage Blend drops all aggro on that player.
      if (this.isCloaked(p)) continue
      const d = Math.hypot(p.x - z.x, p.y - z.y)
      if (d < bestD) {
        bestD = d
        best = { x: p.x, y: p.y, survivor: null, player: p, generator: null }
      }
    }
    for (const s of this.survivors) {
      if (s.safe || s.hp <= 0) continue
      const d = Math.hypot(s.x - z.x, s.y - z.y)
      if (d < bestD * SURVIVOR_AGGRO_BIAS) {
        bestD = d
        best = { x: s.x, y: s.y, survivor: s, player: null, generator: null }
      }
    }
    const gen = this.generator
    // The horde is drawn to the generator's heat far more than to people.
    if (gen && gen.hp > 0 && Math.hypot(gen.x - z.x, gen.y - z.y) < bestD * GENERATOR_AGGRO_BIAS) {
      best = { x: gen.x, y: gen.y, survivor: null, player: null, generator: gen }
    }
    return best
  }

  /** Refreshes the shared route field enemies follow when a wall blocks them. */
  private updateChaseField(dt: number) {
    this.chaseTimer -= dt
    if (this.chaseField && this.chaseTimer > 0) return
    const goals: { x: number; y: number }[] = this.alivePlayers.filter((p) => !this.isCloaked(p))
    for (const s of this.survivors) if (!s.safe && s.hp > 0) goals.push(s)
    if (this.generator && this.generator.hp > 0) goals.push(this.generator)
    this.chaseField = goals.length ? goalField(this.map, ENEMY_CLEARANCE, goals) : null
    this.chaseTimer = CHASE_FIELD_INTERVAL
  }

  private updateEnemies(dt: number) {
    this.updateChaseField(dt)
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const z = this.enemies[i]
      z.wobble += dt
      if (z.poison > 0) {
        z.poison -= dt
        z.hp -= POISON_DPS * Math.max(1, z.poisonStacks) * dt
        if (z.poison <= 0) z.poisonStacks = 0
      }
      if (z.burn > 0) {
        z.burn -= dt
        z.hp -= BURN_DPS * dt
      }
      if (z.hp <= 0) {
        this.killEnemy(i)
        continue
      }
      if (z.slow > 0) z.slow -= dt
      z.speed =
        (z.burn > 0 ? z.baseSpeed * BURN_SLOW : z.baseSpeed) *
        this.mutationSpeed *
        this.speedScale *
        (z.slow > 0 ? CRYO_SLOW : 1)

      // A stunned enemy is frozen solid: no chasing, no attacking.
      if (z.stun > 0) {
        z.stun -= dt
        continue
      }

      const target = this.targetFor(z)
      if (!target.survivor && !target.player && !target.generator) continue
      const dx = target.x - z.x
      const dy = target.y - z.y
      const d = Math.hypot(dx, dy) || 1
      // A camo zombie keeps its disguise until a player is within striking range.
      if (z.kind === 'camo' && !z.revealed) {
        const hunter = this.nearestPlayerTo(z)
        if (hunter && Math.hypot(hunter.x - z.x, hunter.y - z.y) < CAMO_REVEAL_RANGE) {
          z.revealed = true
        }
      }
      const step = z.speed * dt
      const wob = Math.sin(z.wobble * 4) * 0.25
      z.retreat = Math.max(0, z.retreat - dt)

      // Convoy crawlers are the ranged threat: they hold off the chassis and
      // spit into the bed, so their damage lands on the players, not the rig.
      if (this.railMode && z.kind === 'bug') {
        if (d < RAIL_SPIT_HOLD) z.retreat = 0.5
        if (z.attackCooldown === 0 && d < RAIL_SPIT_RANGE) {
          this.spitAtBed(z, target)
          z.attackCooldown = RAIL_SPIT_INTERVAL
        }
      }

      // The horde always knows roughly where its prey is; only a stealth
      // character's low profile can keep it shambling instead of charging.
      const sight = z.vision * (target.player ? target.player.character.aggroMultiplier : 1)
      const stealthy = target.player ? target.player.character.aggroMultiplier < 1 : false
      z.aware = !stealthy || d < sight * (z.aware ? VISION_HYSTERESIS : 1)

      // Walk straight when the target is visible, otherwise follow the route
      // field so walls are rounded instead of pressed into.
      let hx = dx / d
      let hy = dy / d
      if (this.chaseField && d > z.r + 8 && !this.hasLineOfSight(z, target)) {
        const flow = flowDirection(this.chaseField, z.x, z.y)
        if (flow) {
          hx = flow.x
          hy = flow.y
        }
      }
      const dir = z.retreat > 0 ? -1 : 1
      const ux = hx * dir
      const uy = hy * dir
      const px = -uy * wob
      const py = ux * wob
      // An unaware enemy still closes in, just at a shamble.
      const pace = z.aware ? step : step * 0.45
      this.moveEnemy(z, (ux + px) * pace, (uy + py) * pace)

      z.attackCooldown = Math.max(0, z.attackCooldown - dt)

      // Chew through any barricade standing between the enemy and its target.
      const wall = this.hitsBarricade(z.x + ux * (z.r + 6), z.y + uy * (z.r + 6), z.r)
      if (wall && z.attackCooldown === 0) {
        wall.hp -= z.kind === 'bug' ? 10 : 18
        z.attackCooldown = 0.6
        if (wall.hp <= 0) this.barricades.splice(this.barricades.indexOf(wall), 1)
        continue
      }
      const victim = target.survivor
      const hunted = target.player
      const machine = target.generator
      const reach = z.r + (victim ? victim.r : hunted ? hunted.r : machine ? machine.r : 0)
      if (d < reach && z.attackCooldown === 0) {
        if (machine) {
          machine.hp -= (z.kind === 'bug' ? GENERATOR_BUG_DAMAGE : GENERATOR_ZOMBIE_DAMAGE) * this.damageScale
          machine.hurt = 0.2
          z.attackCooldown = z.kind === 'bug' ? 1.2 : 0.8
        } else if (victim) {
          victim.hp -= (z.kind === 'bug' ? SURVIVOR_BUG_DAMAGE : SURVIVOR_ZOMBIE_DAMAGE) * this.damageScale
          victim.hurtCooldown = 0.25
          z.attackCooldown = z.kind === 'bug' ? 1.5 : 0.9
          if (z.kind === 'bug') z.retreat = 0.9
        } else if (hunted && z.kind === 'bug') {
          hunted.stings += 1
          z.attackCooldown = 2.2
          z.retreat = 1.1
          hunted.hurtCooldown = 0.25
          hunted.safeTimer = 0
        } else if (hunted) {
          this.damagePlayer(hunted, 8 * this.damageScale)
          z.attackCooldown = 0.7
          hunted.hurtCooldown = 0.25
          hunted.safeTimer = 0
        }
      }
    }
  }

  /** A convoy crawler lobs a venom bolt at whoever is riding in the bed. */
  private spitAtBed(z: Enemy, target: { x: number; y: number }) {
    const a = Math.atan2(target.y - z.y, target.x - z.x)
    this.venom.push({
      x: z.x + Math.cos(a) * (z.r + 6),
      y: z.y + Math.sin(a) * (z.r + 6),
      vx: Math.cos(a) * VENOM_SPEED,
      vy: Math.sin(a) * VENOM_SPEED,
      r: 7,
      life: VENOM_LIFE,
    })
    playSfx('sting')
  }

  /**
   * The Crucible: eight minutes of open-field swarm with a field upgrade
   * dropped every minute, then the Colossus walks in and the clock stops
   * mattering. Every upgrade taken carries straight into the boss fight.
   */
  /** A field upgrade crate: a pulsing ring in the perk's own colour. */
  private drawPowerup(pu: Powerup) {
    const ctx = this.ctx
    const beat = 1 + Math.sin(pu.pulse * 4) * 0.12
    ctx.save()
    ctx.translate(pu.x, pu.y)
    ctx.globalAlpha = 0.28
    ctx.fillStyle = pu.perk.color
    ctx.beginPath()
    ctx.arc(0, 0, pu.r * 2.1 * beat, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.fillStyle = '#0f172a'
    ctx.strokeStyle = pu.perk.color
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.rect(-pu.r, -pu.r, pu.r * 2, pu.r * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = pu.perk.color
    ctx.font = 'bold 15px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(pu.perk.name.slice(0, 1), 0, 1)
    ctx.font = 'bold 11px system-ui, sans-serif'
    ctx.fillStyle = '#e2e8f0'
    ctx.fillText(pu.perk.name.toUpperCase(), 0, -pu.r - 10)
    ctx.restore()
  }

  /** A support drone: a squat turret body with a barrel and a muzzle kick. */
  private drawAlly(a: Ally) {
    const ctx = this.ctx
    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.beginPath()
    ctx.ellipse(a.x, a.y + a.r * 0.5, a.r, a.r * 0.5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.translate(a.x, a.y)
    ctx.rotate(a.angle)
    ctx.fillStyle = '#0ea5e9'
    ctx.beginPath()
    ctx.arc(0, 0, a.r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#e0f2fe'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = '#bae6fd'
    ctx.fillRect(a.r * 0.2 - a.recoil * 4, -3, a.r * 1.1, 6)
    ctx.restore()
  }

  private updateArena(dt: number) {
    const mission = this.mission
    if (!mission || mission.type !== 'arena') return
    const total = mission.arenaTime ?? ARENA_TIME

    if (!this.arenaBossSpawned) {
      this.arenaTimer += dt
      // One drop per elapsed minute, capped at the eight the run is long.
      const due = Math.min(Math.floor(this.arenaTimer / ARENA_DROP_INTERVAL), Math.floor(total / ARENA_DROP_INTERVAL))
      if (due > this.arenaDrops) {
        this.arenaDrops = due
        this.dropArenaChoice(due)
      }
      if (this.arenaTimer >= total) this.startColossus()
    }

    for (const pu of this.powerups) pu.pulse += dt
    this.updateAllies(dt)
  }

  /** Lays two upgrades in front of the players; taking one clears the pair. */
  private dropArenaChoice(wave: number) {
    const pool = [...ARENA_PERKS].sort(() => Math.random() - 0.5).slice(0, 2)
    const anchor = this.p1 ?? { x: this.map.width / 2, y: this.map.height / 2 }
    for (const perk of pool) {
      const spot = this.openSpot(18, anchor, 120, 260)
      this.powerups.push({ x: spot.x, y: spot.y, r: 18, perk, wave, pulse: 0 })
    }
    this.banner = `Field upgrade dropped — minute ${wave}/8`
    this.bannerTimer = 3
    playSfx('medkit')
  }

  /** Ends the survival phase: the field is swept and the Colossus lands. */
  private startColossus() {
    this.arenaBossSpawned = true
    this.arenaTimer = this.mission?.arenaTime ?? ARENA_TIME
    // The swarm is wiped so the finale is a clean duel, not a pile-on.
    this.enemies = []
    this.venom = []
    this.powerups = []
    this.boss = this.makeBoss(this.mission?.boss ?? 'rust-colossus')
    this.banner = 'THE RUST COLOSSUS'
    this.bannerTimer = 4
    this.flash = 0.6
    this.shake = 1
    playSfx('boss-roar')
    playMusic('boss')
  }

  /** Support drones trail their owner and snipe whatever is closest. */
  private updateAllies(dt: number) {
    const leader = this.p1 && !this.p1.down ? this.p1 : this.alivePlayers[0]
    this.allies.forEach((a, i) => {
      a.recoil = Math.max(0, a.recoil - dt * 4)
      a.cooldown = Math.max(0, a.cooldown - dt)
      if (leader) {
        // Fan the drones around their owner instead of stacking them.
        const slot = (i / Math.max(1, this.allies.length)) * Math.PI * 2
        const goal = {
          x: leader.x + Math.cos(slot) * ALLY_FOLLOW_DISTANCE,
          y: leader.y + Math.sin(slot) * ALLY_FOLLOW_DISTANCE,
        }
        const d = Math.hypot(goal.x - a.x, goal.y - a.y)
        if (d > 6) {
          const step = Math.min(ALLY_SPEED * dt, d)
          this.moveCircle(a, ((goal.x - a.x) / d) * step, ((goal.y - a.y) / d) * step)
        }
      }

      let target: Enemy | null = null
      let best = ALLY_RANGE
      for (const e of this.enemies) {
        const d = Math.hypot(e.x - a.x, e.y - a.y)
        if (d < best) {
          best = d
          target = e
        }
      }
      const boss = this.boss
      if (!target && boss && boss.hp > 0 && Math.hypot(boss.x - a.x, boss.y - a.y) < ALLY_RANGE) {
        a.angle = Math.atan2(boss.y - a.y, boss.x - a.x)
        if (a.cooldown === 0) {
          a.cooldown = ALLY_FIRE_INTERVAL
          a.recoil = 1
          // Against the boss the drone chips a flat slice of a zombie's worth.
          boss.hp -= ARENA_ZOMBIE_HP * this.hpScale * ALLY_DAMAGE_FRACTION
          boss.hurt = 0.1
        }
        return
      }
      if (!target) return
      a.angle = Math.atan2(target.y - a.y, target.x - a.x)
      if (a.cooldown > 0) return
      a.cooldown = ALLY_FIRE_INTERVAL
      a.recoil = 1
      const index = this.enemies.indexOf(target)
      target.hp -= target.maxHp * ALLY_DAMAGE_FRACTION
      if (target.hp <= 0 && index >= 0) this.killEnemy(index)
      playSfx('turret')
    })
  }

  /** Adds a taken upgrade to the run; drones spawn beside their owner. */
  private takeArenaPerk(perk: ArenaPerk, taker: Player) {
    this.arenaPerks[perk.id] += 1
    if (perk.id === 'ally') {
      const spot = this.openSpot(14, taker, 40, 90)
      this.allies.push({ x: spot.x, y: spot.y, r: 13, angle: 0, cooldown: 0, recoil: 0 })
    }
    this.banner = `${perk.name} online — ${perk.blurb}`
    this.bannerTimer = 3.5
    playSfx('overdrive')
  }

  /** Multiplier on movement speed and rate of fire from Kinetic Servos. */
  private get arenaHaste(): number {
    return 1 + ARENA_HASTE * this.arenaPerks.haste
  }

  /**
   * Single funnel for everything that wounds a player, so Armour Plating
   * cannot be missed by one damage source.
   */
  private damagePlayer(p: Player, amount: number) {
    const soak = Math.max(0.1, 1 - ARENA_ARMOUR * this.arenaPerks.armour)
    p.hp -= amount * soak
  }

  /**
   * Crucible rounds: Leech Coupling heals the shooter and Explosive Rounds
   * splash a slice of the hit onto everything standing nearby.
   */
  private arenaOnHit(b: Bullet, dealt: number, x: number, y: number, victim: Enemy | null) {
    if (dealt <= 0) return
    const leech = this.arenaPerks.lifesteal
    if (leech > 0 && b.owner && !b.owner.down) {
      b.owner.hp = Math.min(b.owner.maxHp, b.owner.hp + dealt * ARENA_LIFESTEAL * leech)
    }
    const stacks = this.arenaPerks.explosive
    if (stacks <= 0) return
    const splash = dealt * ARENA_SPLASH * stacks
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]
      if (e === victim) continue
      if (Math.hypot(e.x - x, e.y - y) > ARENA_SPLASH_RADIUS + e.r) continue
      e.hp -= splash
      if (e.hp <= 0) this.killEnemy(i)
    }
    const boss = this.boss
    if (boss && boss.hp > 0 && Math.hypot(boss.x - x, boss.y - y) < ARENA_SPLASH_RADIUS + boss.r) {
      boss.hp -= splash
    }
  }

  private updatePickups(dt: number) {
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const pu = this.powerups[i]
      const taker = this.alivePlayers.find(
        (p) => Math.hypot(pu.x - p.x, pu.y - p.y) < p.r + pu.r
      )
      if (!taker) continue
      this.takeArenaPerk(pu.perk, taker)
      // Only one upgrade per minute: the twin on offer disappears with it.
      this.powerups = this.powerups.filter((o) => o.wave !== pu.wave)
      break
    }

    for (let i = this.ammoBoxes.length - 1; i >= 0; i--) {
      const a = this.ammoBoxes[i]
      const taker = this.alivePlayers.find((p) => Math.hypot(a.x - p.x, a.y - p.y) < p.r + 14)
      if (taker) {
        taker.reserve += a.amount
        this.ammoBoxes.splice(i, 1)
      }
    }

    for (let i = this.medkits.length - 1; i >= 0; i--) {
      const kit = this.medkits[i]
      kit.arm = Math.max(0, kit.arm - dt)
      if (kit.arm > 0) continue
      const taker = this.alivePlayers.find(
        (p) => p.hp < p.maxHp && Math.hypot(kit.x - p.x, kit.y - p.y) < p.r + 16
      )
      if (taker) {
        taker.hp = Math.round(
          Math.min(taker.maxHp, taker.hp + (taker.maxHp - taker.hp) * MEDKIT_HEAL_FRACTION)
        )
        this.medkits.splice(i, 1)
      }
    }
  }

  private updateSpawning(dt: number) {
    const mission = this.mission
    if (!mission) return
    const protect = mission.type === 'protect'
    const boss = mission.type === 'boss'
    const hold = mission.type === 'hold'
    const generator = mission.type === 'generator'
    const overgrowth = mission.type === 'overgrowth'
    const supply = mission.type === 'supply'
    // The valley gauntlet thickens the further down it the players push.
    const race = mission.type === 'race'
    const rail = mission.type === 'rail'
    // The Crucible swarms without let-up until the Colossus lands, then stops.
    const arena = mission.type === 'arena'
    if (arena && this.arenaBossSpawned) return
    const jungle = overgrowth || supply || race || rail || arena
    const arenaRamp = arena ? Math.min(1, this.arenaTimer / (mission.arenaTime ?? ARENA_TIME)) : 0
    const raceRamp = race ? this.raceProgress : 0
    // Hold the Line ramps from a trickle to a wall of bodies by the last second.
    const holdProgress = hold && mission.holdTime ? 1 - this.holdTimer / mission.holdTime : 0
    const ramp = 1 + holdProgress * (HOLD_RAMP - 1)
    const maxAlive = protect
      ? 4 + mission.survivors * 2
      : boss
        ? 6
        : hold
          ? Math.round(6 * ramp)
          : arena
            ? Math.round(16 + arenaRamp * 20)
          : generator
            ? 12
            : rail
              ? 14
              : race
              ? Math.round(8 + raceRamp * 10)
              : overgrowth
                ? 8
                : supply
                  ? 10
                  : Math.min(14, Math.max(4, Math.ceil(mission.target / 3)))
    // Dense stages keep noticeably more bodies on the floor at once.
    const density = mission.density ?? 1
    if (this.enemies.length >= Math.round(maxAlive * density)) return
    if (!protect && !boss && !hold && !jungle) {
      const remaining = mission.target - this.kills
      if (this.spawned - this.kills >= remaining + 4) return
    }

    this.spawnTimer -= dt
    if (this.spawnTimer > 0) return
    this.spawnTimer = protect
      ? 1.5
      : boss
        ? 2.4
        : hold
          ? Math.max(0.35, 1.6 / ramp)
          : arena
            ? Math.max(0.18, 0.85 - arenaRamp * 0.6)
          : generator
            ? 0.8
            : rail
              ? 0.65
              : race
              ? Math.max(0.35, 1.4 - raceRamp)
              : jungle
                ? 1.2
                : 0.9
    this.spawnTimer /= density * this.spawnScale

    const spot = this.spawnPoint()
    if (!spot) return
    const bugChance = mission.type === 'hive' ? HIVE_BUG_SPAWN_CHANCE : BUG_SPAWN_CHANCE
    this.enemies.push(this.makeEnemy(spot, bugChance))
    this.spawned += 1
  }

  /** Waves mix normal zombies with bugs, runners and camo stalkers. */
  private makeEnemy(spot: { x: number; y: number }, bugChance: number): Enemy {
    const roll = Math.random()
    if (roll < bugChance) return this.makeBug(spot)
    const variant = Math.random()
    if (variant < RUNNER_SPAWN_CHANCE) return this.makeRunner(spot)
    if (variant < RUNNER_SPAWN_CHANCE + CAMO_SPAWN_CHANCE) return this.makeCamo(spot)
    return this.makeZombie(spot)
  }

  /** The Runner: twice the speed of a zombie, 40% of its health. */
  private makeRunner(spot: { x: number; y: number }): Enemy {
    return {
      kind: 'runner',
      x: spot.x,
      y: spot.y,
      r: 11,
      hp: 60 * RUNNER_HP_FRACTION * this.hpScale,
      maxHp: 60 * RUNNER_HP_FRACTION * this.hpScale,
      speed: 0,
      baseSpeed: RUNNER_SPEED * (95 + Math.random() * 30),
      attackCooldown: 0,
      wobble: Math.random() * 10,
      retreat: 0,
      poison: 0,
      poisonStacks: 0,
      burn: 0,
      vision: ZOMBIE_VISION,
      aware: false,
      driftAngle: Math.random() * Math.PI * 2,
      revealed: false,
      stun: 0,
      slow: 0,
    }
  }

  /** The Camo Zombie: blends into the floor and mimics survivors. */
  private makeCamo(spot: { x: number; y: number }): Enemy {
    return {
      kind: 'camo',
      x: spot.x,
      y: spot.y,
      r: 14,
      hp: 70 * this.hpScale,
      maxHp: 70 * this.hpScale,
      speed: 0,
      baseSpeed: 88 + Math.random() * 26,
      attackCooldown: 0,
      wobble: Math.random() * 10,
      retreat: 0,
      poison: 0,
      poisonStacks: 0,
      burn: 0,
      vision: ZOMBIE_VISION,
      aware: false,
      driftAngle: Math.random() * Math.PI * 2,
      revealed: false,
      stun: 0,
      slow: 0,
    }
  }

  private makeZombie(spot: { x: number; y: number }): Enemy {
    const brute = Math.random() > 0.85
    return {
      kind: 'zombie',
      x: spot.x,
      y: spot.y,
      r: brute ? 20 : 14,
      hp: (brute ? 120 : 60) * this.hpScale,
      maxHp: (brute ? 120 : 60) * this.hpScale,
      speed: 0,
      baseSpeed: brute ? 70 : 95 + Math.random() * 30,
      attackCooldown: 0,
      wobble: Math.random() * 10,
      retreat: 0,
      poison: 0,
      poisonStacks: 0,
      burn: 0,
      vision: ZOMBIE_VISION,
      aware: false,
      driftAngle: Math.random() * Math.PI * 2,
      revealed: false,
      stun: 0,
      slow: 0,
    }
  }

  private makeBug(spot: { x: number; y: number }): Enemy {
    return {
      kind: 'bug',
      x: spot.x,
      y: spot.y,
      r: 10,
      hp: 34 * this.hpScale,
      maxHp: 34 * this.hpScale,
      speed: 0,
      baseSpeed: 1.5 * (95 + Math.random() * 30),
      attackCooldown: 0,
      wobble: Math.random() * 10,
      retreat: 0,
      poison: 0,
      poisonStacks: 0,
      burn: 0,
      vision: BUG_VISION,
      aware: false,
      driftAngle: Math.random() * Math.PI * 2,
      revealed: false,
      stun: 0,
      slow: 0,
    }
  }

  private spawnPoint() {
    const m = this.map
    const players = this.alivePlayers
    if (!players.length) return null
    for (let i = 0; i < 300; i++) {
      const x = 40 + Math.random() * (m.width - 80)
      const y = 40 + Math.random() * (m.height - 80)
      const d = Math.min(...players.map((p) => Math.hypot(x - p.x, y - p.y)))
      if (d < 380 || d > 1300) continue
      if (circleHitsWall(m, x, y, 22)) continue
      return { x, y }
    }
    return null
  }

  /** Shared co-op camera: centred between both players, zoomed to fit them. */
  private updateCamera() {
    const m = this.map
    const tracked = this.alivePlayers.length ? this.alivePlayers : this.players
    if (!tracked.length) return

    const xs = tracked.map((p) => p.x)
    const ys = tracked.map((p) => p.y)
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2
    const spanX = Math.max(...xs) - Math.min(...xs) + COOP_CAMERA_MARGIN
    const spanY = Math.max(...ys) - Math.min(...ys) + COOP_CAMERA_MARGIN

    const fit = Math.min(this.viewW / spanX, this.viewH / spanY, 1)
    // Never zoom out past the point where the arena stops covering the screen,
    // otherwise a map narrower than the window leaves empty bands at the edges.
    const cover = Math.max(this.viewW / m.width, this.viewH / m.height)
    const target = clamp(fit, Math.max(MIN_ZOOM, cover), Math.max(1, cover))
    this.zoom += (target - this.zoom) * 0.08
    // Settle exactly on the target: an endlessly creeping zoom resamples every
    // texture line each frame, which reads as flickering while walking.
    if (Math.abs(target - this.zoom) < 0.002) this.zoom = target

    const worldW = this.viewW / this.zoom
    const worldH = this.viewH / this.zoom
    const boss = this.boss
    const focusBoss = this.reveal === 'playing' && boss !== null
    const fx = focusBoss && boss ? boss.x : cx
    const fy = focusBoss && boss ? boss.y : cy
    const camX = clamp(fx - worldW / 2, 0, Math.max(0, m.width - worldW))
    const camY = clamp(fy - worldH / 2, 0, Math.max(0, m.height - worldH))
    if (focusBoss || this.cameraEase > 0) {
      // Cinematic slide: ease onto the boss and back to the players after.
      this.camera.x += (camX - this.camera.x) * 0.07
      this.camera.y += (camY - this.camera.y) * 0.07
    } else {
      this.camera.x = camX
      this.camera.y = camY
    }
  }

  private render() {
    const ctx = this.ctx
    const m = this.map
    ctx.fillStyle = '#0b0f0d'
    ctx.fillRect(0, 0, this.viewW, this.viewH)
    ctx.save()
    if (this.shake > 0) {
      const amp = this.shake * 12
      ctx.translate((Math.random() * 2 - 1) * amp, (Math.random() * 2 - 1) * amp)
    }
    this.applyWorldTransform()

    ctx.fillStyle = m.color
    ctx.fillRect(0, 0, m.width, m.height)
    this.drawFloor()
    this.drawMapLabel()
    for (const pit of m.mud ?? []) this.drawMud(pit)
    this.hazards?.render(ctx, this.hazardClock)
    const mode = this.mission?.type
    if (mode === 'protect' || mode === 'race' || mode === 'rail') this.drawExtraction()

    for (const w of m.walls) {
      if (this.textures === 'enhanced') this.drawStructure3D(w)
      else this.drawStructure(w)
    }

    for (const a of this.ammoBoxes) {
      ctx.fillStyle = '#f4c542'
      ctx.fillRect(a.x - 8, a.y - 6, 16, 12)
      ctx.strokeStyle = '#8a6b12'
      ctx.lineWidth = 2
      ctx.strokeRect(a.x - 8, a.y - 6, 16, 12)
    }

    for (const kit of this.medkits) this.drawMedkit(kit)
    for (const pu of this.powerups) this.drawPowerup(pu)
    for (const a of this.allies) this.drawAlly(a)
    for (const b of this.barricades) this.drawBarricade(b)

    for (const s of this.survivors) this.drawSurvivor(s)
    if (this.mission?.type === 'protect') this.drawSurvivorHealthBars()
    for (const t of this.turrets) this.drawTurret(t)

    for (const pool of this.acid) this.drawAcid(pool)
    for (const crate of this.crates) this.drawCrate(crate)
    for (const hive of this.hives) this.drawHive(hive)
    for (const zone of this.flameZones) this.drawFlameZone(zone)
    for (const crystal of this.crystals) this.drawCrystal(crystal)
    if (this.generator) this.drawGenerator(this.generator)
    if (this.truck) this.drawTruck(this.truck)
    for (const blast of this.blasts) this.drawBlast(blast)

    for (const e of this.enemies) {
      if (e.kind !== 'camo' || e.revealed) this.drawGroundShadow(e.x, e.y, e.r)
      if (e.kind === 'bug') this.drawBug(e)
      else if (e.kind === 'camo') this.drawCamo(e)
      else if (e.kind === 'runner') this.drawRunner(e)
      else this.drawZombie(e)
      if (e.stun > 0) this.drawStun(e)
    }

    if (this.boss) this.drawBoss(this.boss)
    for (const w of this.shocks) this.drawShock(w)
    for (const s of this.shards) this.drawShard(s)
    for (const v of this.venom) this.drawVenom(v)
    for (const g of this.gibs) this.drawGib(g)

    for (const b of this.bullets) {
      ctx.strokeStyle = b.color
      ctx.lineWidth = b.width
      ctx.lineCap = 'round'
      const len = Math.min(b.tracerLength, Math.hypot(b.vx, b.vy) * 0.03)
      const nx = b.vx / (Math.hypot(b.vx, b.vy) || 1)
      const ny = b.vy / (Math.hypot(b.vx, b.vy) || 1)
      ctx.beginPath()
      ctx.moveTo(b.x - nx * len, b.y - ny * len)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }

    for (const p of this.players) {
      this.drawGroundShadow(p.x, p.y, p.r)
      this.drawPlayer(p)
      if (p.gore > 0) this.drawGore(p)
    }
    if (this.bubbleTimer > 0) this.drawRevealBubble()
    for (const crate of this.crates) this.drawCratePrompt(crate)
    ctx.restore()

    this.drawVisibility()
    this.drawFlash()
    this.drawCrosshair()
    this.drawMinimap()
    this.drawBanner()
  }

  /**
   * Fog of war: everything past VISIBILITY_RADIUS of a player is dimmed on the
   * main canvas. Drawn in screen space, after the world transform is popped.
   */
  private drawVisibility() {
    if (this.state !== 'playing') return
    // The reveal pan and the death cinematic frame the boss, not the players.
    if (this.reveal === 'playing' || this.outro !== 'off') return
    const ctx = this.ctx
    const lit = this.alivePlayers.length ? this.alivePlayers : this.players
    if (!lit.length) return

    const dpr = window.devicePixelRatio || 1
    const mask = this.maskCanvas(dpr)
    const mctx = mask.getContext('2d')
    if (!mctx) return
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    mctx.clearRect(0, 0, this.viewW, this.viewH)
    mctx.fillStyle = `rgba(2,6,4,${DARKNESS})`
    mctx.fillRect(0, 0, this.viewW, this.viewH)

    // Punching the sight circles out of one mask keeps overlapping lights from
    // stacking into a darker patch where two players stand together.
    mctx.globalCompositeOperation = 'destination-out'
    const r = VISIBILITY_RADIUS * this.zoom
    for (const p of lit) {
      const sx = (p.x - this.camera.x) * this.zoom
      const sy = (p.y - this.camera.y) * this.zoom
      const grad = mctx.createRadialGradient(sx, sy, r * 0.35, sx, sy, r)
      grad.addColorStop(0, 'rgba(0,0,0,1)')
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      mctx.fillStyle = grad
      mctx.beginPath()
      mctx.arc(sx, sy, r, 0, Math.PI * 2)
      mctx.fill()
    }
    mctx.globalCompositeOperation = 'source-over'

    ctx.drawImage(mask, 0, 0, this.viewW, this.viewH)
  }

  /** Scratch canvas for the fog mask, resized with the viewport. */
  private maskCanvas(dpr: number): HTMLCanvasElement {
    const mask = this.mask ?? document.createElement('canvas')
    this.mask = mask
    const w = Math.floor(this.viewW * dpr)
    const h = Math.floor(this.viewH * dpr)
    if (mask.width !== w || mask.height !== h) {
      mask.width = w
      mask.height = h
    }
    return mask
  }

  /** White-out that fires with an announcement banner. */
  private drawFlash() {
    if (this.flash <= 0) return
    const ctx = this.ctx
    ctx.save()
    ctx.fillStyle = `rgba(186,230,253,${(this.flash / FLASH_TIME) * 0.55})`
    ctx.fillRect(0, 0, this.viewW, this.viewH)
    ctx.restore()
  }

  /** Centre-screen announcement, e.g. the Cryo-Stalker's phase 2 warning. */
  private drawBanner() {
    if (this.bannerTimer <= 0 || !this.banner) return
    const ctx = this.ctx
    const cx = this.viewW / 2
    const cy = this.viewH / 2 - 40
    const fade = Math.min(1, this.bannerTimer / 0.5)
    ctx.save()
    ctx.globalAlpha = fade
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = 'bold 38px ui-sans-serif, system-ui, sans-serif'
    const w = Math.max(420, ctx.measureText(this.banner).width + 80)
    ctx.fillStyle = 'rgba(8,20,28,0.82)'
    ctx.fillRect(cx - w / 2, cy - 46, w, 92)
    ctx.strokeStyle = '#7dd3fc'
    ctx.lineWidth = 3
    ctx.strokeRect(cx - w / 2, cy - 46, w, 92)
    ctx.fillStyle = '#e0f2fe'
    ctx.shadowColor = '#38bdf8'
    ctx.shadowBlur = 18
    ctx.fillText(this.banner, cx, cy)
    ctx.restore()
  }

  /**
   * World transform for the camera, snapped to whole device pixels so floor
   * seams and shadows do not shimmer between frames while the player walks.
   */
  private applyWorldTransform() {
    const ctx = this.ctx
    const dpr = window.devicePixelRatio || 1
    const unit = this.zoom * dpr
    const cx = Math.round(this.camera.x * unit) / unit
    const cy = Math.round(this.camera.y * unit) / unit
    ctx.scale(this.zoom, this.zoom)
    ctx.translate(-cx, -cy)
  }

  /** Floor texture: asphalt seams, warehouse planks, hive veins, camp dirt. */
  private drawFloor() {
    const ctx = this.ctx
    const m = this.map
    const x0 = Math.max(0, this.camera.x - 200)
    const y0 = Math.max(0, this.camera.y - 200)
    const x1 = Math.min(m.width, this.camera.x + this.viewW / this.zoom + 200)
    const y1 = Math.min(m.height, this.camera.y + this.viewH / this.zoom + 200)

    ctx.save()
    if (m.floor === 'asphalt') {
      ctx.fillStyle = 'rgba(255,255,255,0.02)'
      for (let y = Math.floor(y0 / 60) * 60; y < y1; y += 60) {
        for (let x = Math.floor(x0 / 90) * 90; x < x1; x += 90) {
          ctx.fillRect(x + ((y / 60) % 2 ? 45 : 0), y, 86, 56)
        }
      }
      // Road markings down the main avenues.
      ctx.strokeStyle = 'rgba(240,220,120,0.16)'
      ctx.lineWidth = 6
      ctx.setLineDash([40, 34])
      for (let y = Math.floor(y0 / 520) * 520 + 260; y < y1; y += 520) {
        ctx.beginPath()
        ctx.moveTo(x0, y)
        ctx.lineTo(x1, y)
        ctx.stroke()
      }
      ctx.setLineDash([])
    } else if (m.floor === 'wood') {
      ctx.strokeStyle = 'rgba(0,0,0,0.28)'
      ctx.lineWidth = 2
      for (let y = Math.floor(y0 / 42) * 42; y < y1; y += 42) {
        ctx.beginPath()
        ctx.moveTo(x0, y)
        ctx.lineTo(x1, y)
        ctx.stroke()
      }
      ctx.fillStyle = 'rgba(255,255,255,0.03)'
      for (let y = Math.floor(y0 / 42) * 42; y < y1; y += 42) {
        for (let x = Math.floor(x0 / 180) * 180 + ((y / 42) % 2 ? 90 : 0); x < x1; x += 180) {
          ctx.fillRect(x, y + 3, 176, 36)
        }
      }
    } else if (m.floor === 'ice') {
      // Cracked lab ice: pale plates with hairline fractures between them.
      ctx.strokeStyle = 'rgba(186,230,253,0.16)'
      ctx.lineWidth = 2
      for (let y = Math.floor(y0 / 120) * 120; y < y1; y += 120) {
        for (let x = Math.floor(x0 / 120) * 120; x < x1; x += 120) {
          ctx.strokeRect(x, y, 118, 118)
          ctx.beginPath()
          ctx.moveTo(x + 18, y + 96)
          ctx.lineTo(x + 56, y + 40)
          ctx.lineTo(x + 104, y + 74)
          ctx.stroke()
        }
      }
    } else if (m.floor === 'snow') {
      ctx.fillStyle = 'rgba(224,242,254,0.07)'
      for (let y = Math.floor(y0 / 80) * 80; y < y1; y += 80) {
        for (let x = Math.floor(x0 / 80) * 80 + ((y / 80) % 2 ? 40 : 0); x < x1; x += 80) {
          const r = ((x * 13 + y * 7) % 11) + 8
          ctx.beginPath()
          ctx.ellipse(x + 30, y + 34, r, r * 0.5, 0, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    } else if (m.floor === 'jungle') {
      // Leaf litter and creeping roots, laid out from the coordinates so the
      // canopy floor never reshuffles between frames.
      ctx.fillStyle = 'rgba(132,204,22,0.07)'
      for (let y = Math.floor(y0 / 64) * 64; y < y1; y += 64) {
        for (let x = Math.floor(x0 / 64) * 64 + ((y / 64) % 2 ? 32 : 0); x < x1; x += 64) {
          const r = ((x * 19 + y * 11) % 10) + 7
          ctx.beginPath()
          ctx.ellipse(x + 22, y + 26, r, r * 0.45, (x % 7) * 0.4, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.strokeStyle = 'rgba(20,60,25,0.35)'
      ctx.lineWidth = 4
      for (let y = Math.floor(y0 / 210) * 210; y < y1; y += 210) {
        ctx.beginPath()
        for (let x = x0; x < x1; x += 40) {
          ctx.lineTo(x, y + Math.sin(x / 130 + y / 210) * 26)
        }
        ctx.stroke()
      }
    } else if (m.floor === 'sand') {
      // Wind-combed dust ridges over buried rusted plating.
      ctx.strokeStyle = 'rgba(253,230,138,0.06)'
      ctx.lineWidth = 5
      for (let y = Math.floor(y0 / 130) * 130; y < y1; y += 130) {
        ctx.beginPath()
        for (let x = x0; x < x1; x += 50) {
          ctx.lineTo(x, y + Math.sin(x / 220 + y / 130) * 22)
        }
        ctx.stroke()
      }
      ctx.fillStyle = 'rgba(120,72,32,0.14)'
      for (let y = Math.floor(y0 / 90) * 90; y < y1; y += 90) {
        for (let x = Math.floor(x0 / 90) * 90 + ((y / 90) % 2 ? 45 : 0); x < x1; x += 90) {
          const r = ((x * 23 + y * 13) % 9) + 5
          ctx.beginPath()
          ctx.ellipse(x + 26, y + 32, r, r * 0.55, 0, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    } else if (m.floor === 'organic') {
      ctx.strokeStyle = 'rgba(224,163,255,0.12)'
      ctx.lineWidth = 3
      for (let y = Math.floor(y0 / 140) * 140; y < y1; y += 140) {
        ctx.beginPath()
        for (let x = x0; x < x1; x += 40) {
          ctx.lineTo(x, y + Math.sin(x / 90 + y) * 18)
        }
        ctx.stroke()
      }
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.16)'
      for (let y = Math.floor(y0 / 70) * 70; y < y1; y += 70) {
        for (let x = Math.floor(x0 / 70) * 70; x < x1; x += 70) {
          const r = ((x * 31 + y * 17) % 9) + 3
          ctx.beginPath()
          ctx.ellipse(x + 20, y + 30, r, r * 0.6, 0, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
    ctx.restore()
  }

  /** Buildings get brick courses, window grids and a rooftop cap. */
  private drawStructure(w: Rect) {
    const ctx = this.ctx
    const m = this.map
    ctx.save()
    ctx.fillStyle = m.wallColor
    ctx.fillRect(w.x, w.y, w.w, w.h)

    if (w.kind !== 'barrier') {
      ctx.beginPath()
      ctx.rect(w.x, w.y, w.w, w.h)
      ctx.clip()

      ctx.strokeStyle = 'rgba(0,0,0,0.22)'
      ctx.lineWidth = 1.5
      for (let y = w.y + 14; y < w.y + w.h; y += 14) {
        ctx.beginPath()
        ctx.moveTo(w.x, y)
        ctx.lineTo(w.x + w.w, y)
        ctx.stroke()
      }
      let row = 0
      for (let y = w.y; y < w.y + w.h; y += 14, row++) {
        for (let x = w.x + (row % 2 ? 0 : 14); x < w.x + w.w; x += 28) {
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.lineTo(x, y + 14)
          ctx.stroke()
        }
      }

      // Window grid with a couple of lit panes.
      const stepX = 42
      const stepY = 46
      for (let y = w.y + 20; y < w.y + w.h - 22; y += stepY) {
        for (let x = w.x + 18; x < w.x + w.w - 20; x += stepX) {
          const lit = ((x * 7 + y * 13) % 11) < 3
          ctx.fillStyle = lit ? 'rgba(255,212,121,0.5)' : 'rgba(15,23,32,0.72)'
          ctx.fillRect(x, y, 22, 24)
          ctx.strokeStyle = 'rgba(0,0,0,0.45)'
          ctx.lineWidth = 2
          ctx.strokeRect(x, y, 22, 24)
          ctx.beginPath()
          ctx.moveTo(x + 11, y)
          ctx.lineTo(x + 11, y + 24)
          ctx.moveTo(x, y + 12)
          ctx.lineTo(x + 22, y + 12)
          ctx.stroke()
        }
      }

      // Rooftop lip and vents.
      ctx.fillStyle = 'rgba(0,0,0,0.3)'
      ctx.fillRect(w.x, w.y, w.w, 10)
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      for (let x = w.x + 24; x < w.x + w.w - 20; x += 96) {
        ctx.fillRect(x, w.y + 2, 26, 6)
      }
    }

    ctx.restore()
    ctx.strokeStyle = m.wallEdge
    ctx.lineWidth = 3
    ctx.strokeRect(w.x, w.y, w.w, w.h)
  }

  /**
   * Enhanced pack: extrude the footprint away from the map centre so the
   * building shows a lit top face and shaded sides, like a block. The centre is
   * fixed rather than camera-based, so blocks never shift while walking.
   */
  private drawStructure3D(w: Rect) {
    const ctx = this.ctx
    const m = this.map
    if (w.kind === 'barrier') {
      this.drawStructure(w)
      return
    }
    const cx = m.width / 2
    const cy = m.height / 2
    // Slide the roof away from the view centre by a small, clamped amount: a
    // proportional extrusion detaches distant blocks and reads as platforms.
    const dx = w.x + w.w / 2 - cx
    const dy = w.y + w.h / 2 - cy
    const dist = Math.hypot(dx, dy) || 1
    const lift = Math.min(dist * BUILDING_HEIGHT, MAX_BUILDING_LIFT)
    const top: Rect = {
      x: w.x + (dx / dist) * lift,
      y: w.y + (dy / dist) * lift,
      w: w.w,
      h: w.h,
      kind: w.kind,
    }

    // Footprint shadow, then the four side faces up to the roof outline.
    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fillRect(w.x, w.y, w.w, w.h)

    const base = [
      { x: w.x, y: w.y },
      { x: w.x + w.w, y: w.y },
      { x: w.x + w.w, y: w.y + w.h },
      { x: w.x, y: w.y + w.h },
    ]
    const roof = [
      { x: top.x, y: top.y },
      { x: top.x + top.w, y: top.y },
      { x: top.x + top.w, y: top.y + top.h },
      { x: top.x, y: top.y + top.h },
    ]
    const shades = ['rgba(0,0,0,0.45)', 'rgba(0,0,0,0.2)', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.38)']
    for (let i = 0; i < 4; i++) {
      const a = base[i]
      const b = base[(i + 1) % 4]
      const c = roof[(i + 1) % 4]
      const d = roof[i]
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.lineTo(c.x, c.y)
      ctx.lineTo(d.x, d.y)
      ctx.closePath()
      ctx.fillStyle = m.wallColor
      ctx.fill()
      ctx.fillStyle = shades[i]
      ctx.fill()
      ctx.strokeStyle = m.wallEdge
      ctx.lineWidth = 2
      ctx.stroke()
    }
    ctx.restore()

    this.drawStructure(top)
  }

  /** Soft ellipse under a unit so it reads as standing on the ground. */
  private drawGroundShadow(x: number, y: number, r: number) {
    if (this.textures !== 'enhanced') return
    const ctx = this.ctx
    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.38)'
    ctx.beginPath()
    ctx.ellipse(x + r * 0.15, y + r * 0.55, r * 0.95, r * 0.45, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  private drawVenom(v: Projectile) {
    const ctx = this.ctx
    this.drawGroundShadow(v.x, v.y, v.r * 0.8)
    ctx.save()
    ctx.translate(v.x, this.textures === 'enhanced' ? v.y - UNIT_LIFT : v.y)
    const grad = ctx.createRadialGradient(-v.r * 0.3, -v.r * 0.3, 1, 0, 0, v.r)
    grad.addColorStop(0, '#d9ff8a')
    grad.addColorStop(1, '#5aa30d')
    ctx.fillStyle = this.textures === 'enhanced' ? grad : '#8fdb2e'
    ctx.beginPath()
    ctx.arc(0, 0, v.r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(30,60,0,0.8)'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.restore()
  }

  /** A flying icicle, drawn as a sharp sliver pointing along its flight. */
  private drawShard(s: Shard) {
    const ctx = this.ctx
    this.drawGroundShadow(s.x, s.y, s.r * 0.7)
    ctx.save()
    ctx.translate(s.x, this.textures === 'enhanced' ? s.y - UNIT_LIFT : s.y)
    ctx.rotate(Math.atan2(s.vy, s.vx))
    ctx.fillStyle = '#e0f7ff'
    ctx.beginPath()
    ctx.moveTo(s.r * 2.2, 0)
    ctx.lineTo(-s.r, -s.r * 0.8)
    ctx.lineTo(-s.r, s.r * 0.8)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = '#38bdf8'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.restore()
  }

  /** The freezing ring thrown out by a slam. */
  private drawShock(w: Shock) {
    const ctx = this.ctx
    const fade = Math.max(0, 1 - w.r / w.maxR)
    ctx.save()
    ctx.globalAlpha = 0.25 + fade * 0.5
    ctx.strokeStyle = '#bae6fd'
    ctx.lineWidth = 6 + fade * 8
    ctx.beginPath()
    ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = fade * 0.18
    ctx.fillStyle = '#7dd3fc'
    ctx.fill()
    ctx.restore()
  }

  /** A chunk of the burst boss, fading as it flies. */
  private drawGib(g: Gib) {
    const ctx = this.ctx
    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, g.life))
    ctx.fillStyle = g.color
    ctx.beginPath()
    ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  /** Boss residue sprayed over a survivor once the hive bursts. */
  private drawGore(p: Player) {
    const ctx = this.ctx
    ctx.save()
    ctx.translate(p.x, this.textures === 'enhanced' ? p.y - UNIT_LIFT : p.y)
    ctx.globalAlpha = 0.72 * p.gore
    ctx.fillStyle = this.goreColor
    ctx.beginPath()
    ctx.arc(0, 0, p.r, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#166534'
    const blobs: [number, number, number][] = [
      [-0.5, -0.4, 0.34],
      [0.45, -0.2, 0.28],
      [0.05, 0.55, 0.3],
      [-0.3, 0.35, 0.22],
    ]
    for (const [bx, by, br] of blobs) {
      ctx.beginPath()
      ctx.arc(bx * p.r, by * p.r, br * p.r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  /** The Hive Mother: layered blocky body with wings floating over her shadow. */
  private drawBoss(b: Boss) {
    if (b.kind === 'runner-alpha') {
      this.drawRunnerAlpha(b)
      return
    }
    if (b.kind === 'camo-stalker') {
      this.drawCamoStalker(b)
      return
    }
    if (b.kind === 'cryo-stalker') {
      this.drawCryoStalker(b)
      return
    }
    if (b.kind === 'canopy-leviathan') {
      this.drawCanopyLeviathan(b)
      return
    }
    const ctx = this.ctx
    const enhanced = this.textures === 'enhanced'
    const lift = enhanced ? UNIT_LIFT * 3 : 0
    const flap = Math.sin(b.wobble * 9) * 0.45
    const enraged = b.phase === 2

    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.beginPath()
    ctx.ellipse(b.x, b.y + b.r * 0.4, b.r * 1.05, b.r * 0.5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    ctx.save()
    ctx.translate(b.x, b.y - lift)
    ctx.rotate(b.angle)

    // Wings first so the body layers sit on top of them.
    ctx.fillStyle = enraged ? 'rgba(255,140,120,0.42)' : 'rgba(255, 213, 128, 0.4)'
    for (const side of [-1, 1]) {
      ctx.save()
      ctx.rotate(side * (0.8 + flap * side))
      ctx.beginPath()
      ctx.ellipse(-b.r * 0.2, -b.r * 1.5 * side, b.r * 0.55, b.r * 1.25, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.restore()
    }

    const body = enraged ? '#e04a2f' : '#f0871b'
    const dark = enraged ? '#7c1d0f' : '#8a4b00'
    if (enhanced) {
      // Stacked blocks: abdomen, thorax, head, each with a lit top edge.
      const segments = [
        { dx: -b.r * 0.75, size: b.r * 1.05 },
        { dx: 0, size: b.r * 0.95 },
        { dx: b.r * 0.8, size: b.r * 0.68 },
      ]
      for (const seg of segments) {
        ctx.fillStyle = dark
        ctx.fillRect(seg.dx - seg.size / 2, -seg.size / 2, seg.size, seg.size)
        ctx.fillStyle = body
        ctx.fillRect(seg.dx - seg.size / 2, -seg.size / 2, seg.size, seg.size * 0.78)
        ctx.fillStyle = 'rgba(255,255,255,0.18)'
        ctx.fillRect(seg.dx - seg.size / 2, -seg.size / 2, seg.size, seg.size * 0.18)
        ctx.strokeStyle = dark
        ctx.lineWidth = 3
        ctx.strokeRect(seg.dx - seg.size / 2, -seg.size / 2, seg.size, seg.size)
      }
    } else {
      ctx.beginPath()
      ctx.ellipse(0, 0, b.r, b.r * 0.82, 0, 0, Math.PI * 2)
      ctx.fillStyle = body
      ctx.fill()
      ctx.strokeStyle = dark
      ctx.lineWidth = 4
      ctx.stroke()
    }

    // Eyes and stinger point along her facing.
    ctx.fillStyle = enraged ? '#fff1a8' : '#2b0b00'
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.arc(b.r * 0.85, side * b.r * 0.22, b.r * 0.12, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = dark
    ctx.beginPath()
    ctx.moveTo(-b.r * 1.25, 0)
    ctx.lineTo(-b.r * 0.75, -b.r * 0.22)
    ctx.lineTo(-b.r * 0.75, b.r * 0.22)
    ctx.closePath()
    ctx.fill()

    if (b.hurt > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.45)'
      ctx.beginPath()
      ctx.arc(0, 0, b.r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()

    if (b.dashing > 0) {
      ctx.save()
      ctx.strokeStyle = 'rgba(255,80,60,0.8)'
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.arc(b.x, b.y - lift, b.r + 12, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  /** Runner Alpha: an oversized, glowing Runner mid-sprint. */
  private drawRunnerAlpha(b: Boss) {
    const ctx = this.ctx
    const lift = this.textures === 'enhanced' ? UNIT_LIFT * 2.4 : 0
    const leaping = b.dashing > 0
    const stride = Math.sin(b.wobble * 12)

    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.beginPath()
    ctx.ellipse(b.x, b.y + b.r * 0.4, b.r * (leaping ? 0.7 : 1), b.r * 0.42, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    ctx.save()
    ctx.translate(b.x, b.y - lift - (leaping ? b.r * 0.5 : 0))
    ctx.rotate(b.angle)

    // Heat glow: brighter mid-leap and in phase 2.
    const glow = ctx.createRadialGradient(0, 0, b.r * 0.3, 0, 0, b.r * 1.9)
    glow.addColorStop(0, b.phase === 2 ? 'rgba(255,90,60,0.55)' : 'rgba(255,60,60,0.4)')
    glow.addColorStop(1, 'rgba(255,60,60,0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(0, 0, b.r * 1.9, 0, Math.PI * 2)
    ctx.fill()

    // Sprinting legs.
    ctx.strokeStyle = '#7f1d1d'
    ctx.lineWidth = 7
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(-b.r * 0.2, side * b.r * 0.4)
      ctx.lineTo(-b.r * 0.9, side * b.r * 0.8 + stride * side * b.r * 0.4)
      ctx.stroke()
    }

    ctx.beginPath()
    ctx.arc(0, 0, b.r, 0, Math.PI * 2)
    ctx.fillStyle = b.phase === 2 ? '#f43f5e' : '#dc2626'
    ctx.fill()
    ctx.strokeStyle = '#450a0a'
    ctx.lineWidth = 5
    ctx.stroke()

    // Clawed arms reaching forward.
    ctx.strokeStyle = '#fca5a5'
    ctx.lineWidth = 6
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(b.r * 0.2, side * b.r * 0.5)
      ctx.lineTo(b.r * 1.25, side * b.r * (0.55 - stride * 0.2))
      ctx.stroke()
    }

    ctx.fillStyle = '#fde68a'
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.arc(b.r * 0.55, side * b.r * 0.28, b.r * 0.14, 0, Math.PI * 2)
      ctx.fill()
    }

    if (b.hurt > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.45)'
      ctx.beginPath()
      ctx.arc(0, 0, b.r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()

    if (leaping) {
      ctx.save()
      ctx.strokeStyle = 'rgba(255,120,80,0.75)'
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.arc(b.x, b.y - lift, b.r + 16, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  /** Camo Stalker: near-invisible while cloaked, tracked by wet prints. */
  private drawCamoStalker(b: Boss) {
    const ctx = this.ctx
    const lift = this.textures === 'enhanced' ? UNIT_LIFT * 2.4 : 0

    for (const f of b.footprints) {
      ctx.save()
      ctx.globalAlpha = Math.max(0, f.life / STALKER_FOOTPRINT_LIFE) * 0.6
      ctx.fillStyle = '#7dd3fc'
      ctx.beginPath()
      ctx.ellipse(f.x, f.y, 9, 5, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    const alpha = b.cloaked ? 0.12 : 1
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.fillStyle = 'rgba(0,0,0,0.4)'
    ctx.beginPath()
    ctx.ellipse(b.x, b.y + b.r * 0.4, b.r, b.r * 0.45, 0, 0, Math.PI * 2)
    ctx.fill()

    ctx.translate(b.x, b.y - lift)
    ctx.rotate(b.angle)

    // Chameleon body: takes the floor colour while blending away.
    ctx.beginPath()
    ctx.ellipse(0, 0, b.r, b.r * 0.78, 0, 0, Math.PI * 2)
    ctx.fillStyle = b.cloaked ? this.map.color : '#3f6212'
    ctx.fill()
    ctx.strokeStyle = b.cloaked ? 'rgba(148,163,184,0.6)' : '#1a2e05'
    ctx.lineWidth = 4
    ctx.stroke()

    // Ridged spine plates.
    ctx.fillStyle = b.cloaked ? 'rgba(148,163,184,0.35)' : '#65a30d'
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath()
      ctx.moveTo(i * b.r * 0.32, -b.r * 0.5)
      ctx.lineTo(i * b.r * 0.32 + b.r * 0.14, -b.r * 0.85)
      ctx.lineTo(i * b.r * 0.32 + b.r * 0.28, -b.r * 0.5)
      ctx.closePath()
      ctx.fill()
    }

    // Curled tail and a long striking tongue-arm.
    ctx.strokeStyle = b.cloaked ? 'rgba(148,163,184,0.5)' : '#4d7c0f'
    ctx.lineWidth = 8
    ctx.beginPath()
    ctx.arc(-b.r * 1.1, 0, b.r * 0.4, Math.PI * 0.2, Math.PI * 1.6)
    ctx.stroke()

    ctx.fillStyle = '#fde047'
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.arc(b.r * 0.6, side * b.r * 0.3, b.r * 0.16, 0, Math.PI * 2)
      ctx.fill()
    }

    if (b.hurt > 0) {
      ctx.globalAlpha = 1
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.beginPath()
      ctx.ellipse(0, 0, b.r, b.r * 0.78, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  /** Cryo-Stalker: a pale, ice-crusted hulk wreathed in frost. */
  private drawCryoStalker(b: Boss) {
    const ctx = this.ctx
    const enhanced = this.textures === 'enhanced'
    const lift = enhanced ? UNIT_LIFT * 2.6 : 0
    const breathe = Math.sin(b.wobble * 3) * 0.06

    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.beginPath()
    ctx.ellipse(b.x, b.y + b.r * 0.4, b.r, b.r * 0.45, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    ctx.save()
    ctx.translate(b.x, b.y - lift)

    // Cold aura, brighter once it enrages.
    const aura = ctx.createRadialGradient(0, 0, b.r * 0.4, 0, 0, b.r * 2)
    aura.addColorStop(0, b.phase === 2 ? 'rgba(56,189,248,0.5)' : 'rgba(125,211,252,0.32)')
    aura.addColorStop(1, 'rgba(125,211,252,0)')
    ctx.fillStyle = aura
    ctx.beginPath()
    ctx.arc(0, 0, b.r * 2, 0, Math.PI * 2)
    ctx.fill()

    ctx.rotate(b.angle)

    // Heavy fists it slams the floor with.
    ctx.fillStyle = '#7fb6d6'
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.arc(b.r * 0.55, side * b.r * 0.78, b.r * 0.3, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#e0f7ff'
      ctx.lineWidth = 3
      ctx.stroke()
    }

    const body = b.phase === 2 ? '#9fd8f2' : '#8ec6e0'
    if (enhanced) {
      const size = b.r * (1.5 + breathe)
      ctx.fillStyle = '#3f6d88'
      ctx.fillRect(-size / 2, -size / 2, size, size)
      ctx.fillStyle = body
      ctx.fillRect(-size / 2, -size / 2, size, size * 0.76)
      ctx.fillStyle = 'rgba(255,255,255,0.25)'
      ctx.fillRect(-size / 2, -size / 2, size, size * 0.16)
      ctx.strokeStyle = '#2c5165'
      ctx.lineWidth = 3
      ctx.strokeRect(-size / 2, -size / 2, size, size)
    } else {
      ctx.beginPath()
      ctx.arc(0, 0, b.r * (1 + breathe), 0, Math.PI * 2)
      ctx.fillStyle = body
      ctx.fill()
      ctx.strokeStyle = '#2c5165'
      ctx.lineWidth = 4
      ctx.stroke()
    }

    // Ice spikes bursting out of its back.
    ctx.fillStyle = '#e0f7ff'
    for (let i = -2; i <= 2; i++) {
      const a = Math.PI + i * 0.35
      ctx.beginPath()
      ctx.moveTo(Math.cos(a) * b.r * 0.9, Math.sin(a) * b.r * 0.9)
      ctx.lineTo(Math.cos(a - 0.12) * b.r * 1.55, Math.sin(a - 0.12) * b.r * 1.55)
      ctx.lineTo(Math.cos(a + 0.12) * b.r * 0.95, Math.sin(a + 0.12) * b.r * 0.95)
      ctx.closePath()
      ctx.fill()
    }

    // Frost-burned eyes.
    ctx.fillStyle = b.phase === 2 ? '#f0f9ff' : '#38bdf8'
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.arc(b.r * 0.7, side * b.r * 0.26, b.r * 0.14, 0, Math.PI * 2)
      ctx.fill()
    }

    if (b.hurt > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.beginPath()
      ctx.arc(0, 0, b.r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  private drawExtraction() {
    const ctx = this.ctx
    const { x, y } = this.map.extraction
    ctx.save()
    ctx.setLineDash([14, 10])
    ctx.strokeStyle = 'rgba(61,220,132,0.85)'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(x, y, EXTRACTION_RADIUS, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = 'rgba(61,220,132,0.12)'
    ctx.fill()
    ctx.fillStyle = 'rgba(61,220,132,0.9)'
    ctx.font = 'bold 18px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('EXTRACTION', x, y + 6)
    ctx.textAlign = 'left'
    ctx.restore()
  }

  /** A mud pit: a dark, wet patch that visibly bogs the players down. */
  private drawMud(pit: Rect) {
    const ctx = this.ctx
    ctx.save()
    ctx.fillStyle = 'rgba(48,34,18,0.75)'
    ctx.beginPath()
    ctx.ellipse(pit.x + pit.w / 2, pit.y + pit.h / 2, pit.w / 2, pit.h / 2, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(120,86,44,0.7)'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.fillStyle = 'rgba(146,110,60,0.35)'
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2
      ctx.beginPath()
      ctx.ellipse(
        pit.x + pit.w / 2 + Math.cos(a) * pit.w * 0.24,
        pit.y + pit.h / 2 + Math.sin(a) * pit.h * 0.24,
        pit.w * 0.08,
        pit.h * 0.05,
        a,
        0,
        Math.PI * 2
      )
      ctx.fill()
    }
    ctx.restore()
  }

  /** A Spore Hive: a breathing egg sack that splits open as it takes fire. */
  private drawHive(hive: Hive) {
    const ctx = this.ctx
    const beat = 1 + Math.sin(hive.pulse * 2.2) * 0.06
    const pct = Math.max(0, hive.hp / hive.maxHp)
    ctx.save()
    this.drawGroundShadow(hive.x, hive.y, hive.r)
    ctx.translate(hive.x, hive.y)
    ctx.beginPath()
    ctx.ellipse(0, 0, hive.r * beat, hive.r * 1.15 * beat, 0, 0, Math.PI * 2)
    ctx.fillStyle = hive.hurt > 0 ? '#fca5a5' : '#4d7c0f'
    ctx.fill()
    ctx.strokeStyle = '#1a2e05'
    ctx.lineWidth = 4
    ctx.stroke()

    // Eggs inside the sack, and splits that widen as the hive is chewed down.
    ctx.fillStyle = 'rgba(190,242,100,0.75)'
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + hive.pulse * 0.4
      ctx.beginPath()
      ctx.arc(Math.cos(a) * hive.r * 0.45, Math.sin(a) * hive.r * 0.5, hive.r * 0.16, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.strokeStyle = 'rgba(20,10,4,0.7)'
    ctx.lineWidth = 3
    for (let i = 0; i < Math.round((1 - pct) * 5); i++) {
      const a = (i / 5) * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(Math.cos(a) * hive.r * 0.2, Math.sin(a) * hive.r * 0.2)
      ctx.lineTo(Math.cos(a) * hive.r * 0.95, Math.sin(a) * hive.r * 0.95)
      ctx.stroke()
    }

    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(-hive.r, -hive.r * 1.55, hive.r * 2, 9)
    ctx.fillStyle = pct > 0.5 ? '#a3e635' : pct > 0.25 ? '#facc15' : '#ef4444'
    ctx.fillRect(-hive.r, -hive.r * 1.55, hive.r * 2 * pct, 9)
    ctx.restore()
  }

  /**
   * The Leviathan: a mossy colossus ringed with tendrils, glowing while its
   * crystals still feed it and dulled once they are all down.
   */
  private drawCanopyLeviathan(b: Boss) {
    const ctx = this.ctx
    const enhanced = this.textures === 'enhanced'
    const lift = enhanced ? UNIT_LIFT * 3.4 : 0
    const breathe = Math.sin(b.wobble * 2.2) * 0.05
    const fed = this.crystals.length > 0

    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    ctx.beginPath()
    ctx.ellipse(b.x, b.y + b.r * 0.4, b.r * 1.1, b.r * 0.5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    ctx.save()
    ctx.translate(b.x, b.y - lift)

    const aura = ctx.createRadialGradient(0, 0, b.r * 0.5, 0, 0, b.r * 1.9)
    aura.addColorStop(0, fed ? 'rgba(74,222,128,0.4)' : 'rgba(120,53,15,0.35)')
    aura.addColorStop(1, 'rgba(74,222,128,0)')
    ctx.fillStyle = aura
    ctx.beginPath()
    ctx.arc(0, 0, b.r * 1.9, 0, Math.PI * 2)
    ctx.fill()

    ctx.rotate(b.angle)

    // Tendrils lashing out of the shell.
    ctx.strokeStyle = fed ? '#4d7c0f' : '#3f2d12'
    ctx.lineWidth = 9
    ctx.lineCap = 'round'
    for (let i = -3; i <= 3; i++) {
      const a = Math.PI + i * 0.32
      const wave = Math.sin(b.wobble * 4 + i) * 0.22
      ctx.beginPath()
      ctx.moveTo(Math.cos(a) * b.r * 0.8, Math.sin(a) * b.r * 0.8)
      ctx.lineTo(Math.cos(a + wave) * b.r * 1.7, Math.sin(a + wave) * b.r * 1.7)
      ctx.stroke()
    }

    const body = b.phase === 2 ? '#3f6212' : '#4d7c0f'
    const size = b.r * (1.7 + breathe)
    if (enhanced) {
      ctx.fillStyle = '#1a2e05'
      ctx.fillRect(-size / 2, -size / 2, size, size)
      ctx.fillStyle = body
      ctx.fillRect(-size / 2, -size / 2, size, size * 0.76)
      ctx.fillStyle = 'rgba(190,242,100,0.22)'
      ctx.fillRect(-size / 2, -size / 2, size, size * 0.16)
      ctx.strokeStyle = '#1a2e05'
      ctx.lineWidth = 4
      ctx.strokeRect(-size / 2, -size / 2, size, size)
    } else {
      ctx.beginPath()
      ctx.ellipse(0, 0, b.r * (1 + breathe), b.r * 0.88, 0, 0, Math.PI * 2)
      ctx.fillStyle = body
      ctx.fill()
      ctx.strokeStyle = '#1a2e05'
      ctx.lineWidth = 5
      ctx.stroke()
    }

    // Amber plates down the back and the pair of eyes up front.
    ctx.fillStyle = fed ? 'rgba(163,230,53,0.85)' : 'rgba(120,113,108,0.8)'
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath()
      ctx.arc(-b.r * 0.35, i * b.r * 0.42, b.r * 0.18, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = b.hurt > 0 ? '#fecaca' : fed ? '#bef264' : '#f97316'
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.arc(b.r * 0.6, side * b.r * 0.3, b.r * 0.16, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  /** A Primeval Crystal, with its health bar and its beam to the boss. */
  private drawCrystal(c: Crystal) {
    const ctx = this.ctx
    const beat = 1 + Math.sin(c.pulse * 2.6) * 0.08
    const pct = Math.max(0, c.hp / c.maxHp)

    if (c.beam > 0 && this.boss) {
      ctx.save()
      ctx.globalAlpha = 0.35 + (c.beam / CRYSTAL_BEAM_TIME) * 0.45
      ctx.strokeStyle = '#86efac'
      ctx.lineWidth = 7
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(c.x, c.y)
      ctx.lineTo(this.boss.x, this.boss.y)
      ctx.stroke()
      ctx.strokeStyle = '#ecfccb'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.restore()
    }

    ctx.save()
    this.drawGroundShadow(c.x, c.y, c.r * 0.8)
    ctx.translate(c.x, c.y)
    ctx.rotate(Math.sin(c.pulse) * 0.08)
    ctx.beginPath()
    ctx.moveTo(0, -c.r * 1.5 * beat)
    ctx.lineTo(c.r * 0.72, -c.r * 0.2)
    ctx.lineTo(0, c.r * 0.95)
    ctx.lineTo(-c.r * 0.72, -c.r * 0.2)
    ctx.closePath()
    ctx.fillStyle = c.hurt > 0 ? '#fecaca' : '#34d399'
    ctx.fill()
    ctx.strokeStyle = '#064e3b'
    ctx.lineWidth = 4
    ctx.stroke()
    ctx.fillStyle = 'rgba(236,253,245,0.55)'
    ctx.beginPath()
    ctx.moveTo(0, -c.r * 1.3 * beat)
    ctx.lineTo(c.r * 0.26, -c.r * 0.2)
    ctx.lineTo(0, c.r * 0.6)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(c.x - c.r, c.y - c.r * 2.1, c.r * 2, 8)
    ctx.fillStyle = pct > 0.5 ? '#4ade80' : pct > 0.25 ? '#facc15' : '#ef4444'
    ctx.fillRect(c.x - c.r, c.y - c.r * 2.1, c.r * 2 * pct, 8)
    ctx.restore()
  }

  /** A slam zone: a red warning ring first, then burning ground. */
  private drawFlameZone(z: FlameZone) {
    const ctx = this.ctx
    ctx.save()
    if (z.warn > 0) {
      const grow = 1 - z.warn / FLAME_WARNING_TIME
      ctx.fillStyle = 'rgba(220,38,38,0.22)'
      ctx.beginPath()
      ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(248,113,113,0.9)'
      ctx.lineWidth = 4
      ctx.stroke()
      ctx.strokeStyle = 'rgba(254,202,202,0.85)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(z.x, z.y, z.r * grow, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
      return
    }
    const heat = Math.max(0, z.burn / FLAME_BURN_TIME)
    ctx.globalAlpha = 0.55 + heat * 0.35
    ctx.fillStyle = '#ea580c'
    ctx.beginPath()
    ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(250,204,21,0.7)'
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + z.burn * 3
      const d = z.r * (0.25 + Math.random() * 0.6)
      ctx.beginPath()
      ctx.arc(z.x + Math.cos(a) * d, z.y + Math.sin(a) * d, 6 + Math.random() * 10, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  /** A supply crate, with the hold-to-collect ring drawn around it. */
  private drawCrate(crate: Crate) {
    const ctx = this.ctx
    ctx.save()
    ctx.translate(crate.x, crate.y)
    if (crate.collected) {
      // Nothing but the stripped pallet is left behind.
      ctx.globalAlpha = 0.45
      ctx.strokeStyle = '#78716c'
      ctx.lineWidth = 3
      ctx.strokeRect(-crate.r, -crate.r * 0.7, crate.r * 2, crate.r * 1.4)
      ctx.restore()
      return
    }
    ctx.fillStyle = '#b45309'
    ctx.fillRect(-crate.r, -crate.r * 0.8, crate.r * 2, crate.r * 1.6)
    ctx.strokeStyle = '#3f2d12'
    ctx.lineWidth = 3
    ctx.strokeRect(-crate.r, -crate.r * 0.8, crate.r * 2, crate.r * 1.6)
    ctx.strokeStyle = '#fbbf24'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(-crate.r, 0)
    ctx.lineTo(crate.r, 0)
    ctx.stroke()
    if (crate.progress > 0) {
      ctx.strokeStyle = '#a3e635'
      ctx.lineWidth = 5
      ctx.beginPath()
      ctx.arc(0, 0, crate.r + 12, -Math.PI / 2, -Math.PI / 2 + crate.progress * Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }

  /**
   * Floating control hint above a crate, drawn only while a player stands
   * inside the interaction ring and gone the instant they step back out.
   */
  private drawCratePrompt(crate: Crate) {
    if (crate.collected) return
    const prompts = this.alivePlayers
      .filter((p) => this.nearCrate(p, crate))
      .map((p) => (p.id === 1 ? '[Hold E to Retrieve]' : '[Hold M to Retrieve]'))
    if (!prompts.length) return

    const ctx = this.ctx
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = 'bold 16px ui-sans-serif, system-ui, sans-serif'
    let y = crate.y - crate.r - 26
    for (const text of prompts) {
      const w = ctx.measureText(text).width + 18
      ctx.fillStyle = 'rgba(8,16,10,0.78)'
      ctx.fillRect(crate.x - w / 2, y - 13, w, 26)
      ctx.strokeStyle = 'rgba(163,230,53,0.7)'
      ctx.lineWidth = 2
      ctx.strokeRect(crate.x - w / 2, y - 13, w, 26)
      ctx.fillStyle = '#ecfccb'
      ctx.fillText(text, crate.x, y)
      y -= 30
    }
    ctx.restore()
  }

  private drawSurvivor(s: Survivor) {
    const ctx = this.ctx
    ctx.beginPath()
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
    ctx.fillStyle = s.safe ? '#94a3b8' : s.hurtCooldown > 0 ? '#fecaca' : '#e2e8f0'
    ctx.fill()
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = 2
    ctx.stroke()
  }

  private drawSurvivorHealthBars() {
    for (const s of this.survivors) this.drawSurvivorHealthBar(s)
  }

  private drawSurvivorHealthBar(s: Survivor) {
    const ctx = this.ctx
    const bw = 40
    const bh = 6
    const bx = s.x - bw / 2
    const by = s.y - s.r - 14
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2)
    const pct = Math.max(0, s.hp) / s.maxHp
    ctx.fillStyle = pct > 0.5 ? '#22c55e' : pct > 0.25 ? '#f59e0b' : '#ef4444'
    ctx.fillRect(bx, by, bw * pct, bh)
    if (s.safe) {
      ctx.fillStyle = '#22c55e'
      ctx.font = 'bold 11px ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('SAFE', s.x, by - 5)
      ctx.textAlign = 'left'
    }
  }

  private drawMedkit(kit: Medkit) {
    const ctx = this.ctx
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(kit.x - 11, kit.y - 9, 22, 18)
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = 2
    ctx.strokeRect(kit.x - 11, kit.y - 9, 22, 18)
    ctx.fillStyle = '#ef4444'
    ctx.fillRect(kit.x - 2.5, kit.y - 6, 5, 12)
    ctx.fillRect(kit.x - 7, kit.y - 2.5, 14, 5)
  }

  private drawBarricade(b: Barricade) {
    const ctx = this.ctx
    ctx.save()
    ctx.fillStyle = '#7c5c2b'
    ctx.fillRect(b.x, b.y, b.w, b.h)
    ctx.strokeStyle = '#3f2d12'
    ctx.lineWidth = 3
    ctx.strokeRect(b.x, b.y, b.w, b.h)
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.lineWidth = 2
    const along = b.w > b.h
    for (let i = 14; i < (along ? b.w : b.h); i += 18) {
      ctx.beginPath()
      if (along) {
        ctx.moveTo(b.x + i, b.y)
        ctx.lineTo(b.x + i, b.y + b.h)
      } else {
        ctx.moveTo(b.x, b.y + i)
        ctx.lineTo(b.x + b.w, b.y + i)
      }
      ctx.stroke()
    }
    const pct = Math.max(0, b.hp) / b.maxHp
    ctx.fillStyle = pct > 0.5 ? '#22c55e' : pct > 0.25 ? '#f59e0b' : '#ef4444'
    ctx.fillRect(b.x, b.y - 8, b.w * pct, 4)
    ctx.restore()
  }

  private drawTurret(t: Turret) {
    const ctx = this.ctx
    ctx.save()
    ctx.translate(t.x, t.y)
    ctx.beginPath()
    ctx.arc(0, 0, t.r, 0, Math.PI * 2)
    ctx.fillStyle = '#6d28d9'
    ctx.fill()
    ctx.strokeStyle = '#c4b5fd'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.rotate(t.angle)
    ctx.fillStyle = '#c4b5fd'
    ctx.fillRect(t.r - 3, -3, 18, 6)
    ctx.restore()
  }

  private drawStatusRing(e: Enemy) {
    const ctx = this.ctx
    if (e.poison <= 0 && e.burn <= 0) return
    ctx.beginPath()
    ctx.arc(e.x, e.y, e.r + 5, 0, Math.PI * 2)
    ctx.strokeStyle = e.burn > 0 ? 'rgba(255,122,24,0.9)' : 'rgba(124,240,61,0.9)'
    ctx.lineWidth = 2
    ctx.stroke()
  }

  /** Body colour for an enemy, swapped out while a mutation skin is on. */
  private enemySkinColor(base: string): string {
    const skin = this.mutationSkin
    return skin && this.mutationFade > 0.5 ? MUTATION_SKINS[skin].body : base
  }

  /** Direction an enemy is lunging in: its prey, or its idle drift. */
  private enemyFacing(z: Enemy): number {
    const prey = this.nearestPlayerTo(z)
    if (!prey) return z.driftAngle
    return Math.atan2(prey.y - z.y, prey.x - z.x)
  }

  /**
   * Two fists clawing toward the prey, alternating so the enemy looks like it
   * is frantically grabbing as it closes in.
   */
  private drawReachingHands(z: Enemy, y: number, skin: string, outline: string) {
    const ctx = this.ctx
    const angle = this.enemyFacing(z)
    const hr = Math.max(3.5, z.r * 0.3)
    ctx.save()
    ctx.translate(z.x, y)
    ctx.rotate(angle)
    for (const side of [-1, 1]) {
      const cycle = Math.sin(z.wobble * 7 + (side > 0 ? Math.PI : 0))
      const reach = z.r + Math.max(7, z.r * 0.3) + z.r * 0.35 * cycle
      const lift = side * (Math.max(7, z.r * 0.55) - z.r * 0.12 * cycle)
      ctx.beginPath()
      ctx.moveTo(z.r * 0.35, side * z.r * 0.45)
      ctx.lineTo(reach, lift)
      ctx.strokeStyle = outline
      ctx.lineWidth = Math.max(2, z.r * 0.18)
      ctx.lineCap = 'round'
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(reach, lift, hr, 0, Math.PI * 2)
      ctx.fillStyle = skin
      ctx.fill()
      ctx.strokeStyle = outline
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
    ctx.restore()
  }

  /**
   * Paints the active mutation's texture over an enemy body, fading in when the
   * virus mutates and back out when the modifier expires.
   */
  private drawMutationSkin(z: Enemy, y: number, r: number) {
    const skin = this.mutationSkin
    if (!skin || this.mutationFade <= 0.01) return
    const ctx = this.ctx
    const { body, trim } = MUTATION_SKINS[skin]
    const fade = this.mutationFade
    ctx.save()
    ctx.translate(z.x, y)
    ctx.globalAlpha = 0.92 * fade

    if (skin === 'hardened') {
      // Rocky plating with a spiked rim.
      ctx.beginPath()
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2
        const spike = i % 2 === 0 ? r * 1.28 : r * 0.94
        const px = Math.cos(a) * spike
        const py = Math.sin(a) * spike
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
      ctx.fillStyle = body
      ctx.fill()
      ctx.strokeStyle = trim
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = 'rgba(148,163,184,0.55)'
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.6
        ctx.beginPath()
        ctx.arc(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45, r * 0.22, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
      return
    }

    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.fillStyle = body
    ctx.fill()
    ctx.strokeStyle = trim
    ctx.lineWidth = 2
    ctx.stroke()

    if (skin === 'hyper-speed') {
      // Electric sparks trailing behind the direction of travel.
      const back = this.enemyFacing(z) + Math.PI
      ctx.globalAlpha = 0.8 * fade
      ctx.strokeStyle = trim
      ctx.lineWidth = 2
      for (let i = 0; i < 3; i++) {
        const a = back + (i - 1) * 0.4
        const jitter = Math.sin(z.wobble * 18 + i * 2) * 4
        ctx.beginPath()
        ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
        ctx.lineTo(Math.cos(a) * (r + 12 + jitter), Math.sin(a) * (r + 12 + jitter))
        ctx.stroke()
      }
      ctx.fillStyle = '#f5d0fe'
      for (let i = 0; i < 3; i++) {
        const a = back + Math.sin(z.wobble * 9 + i * 2.1) * 0.9
        const d = r + 6 + ((z.wobble * 40 + i * 9) % 14)
        ctx.beginPath()
        ctx.arc(Math.cos(a) * d, Math.sin(a) * d, 2, 0, Math.PI * 2)
        ctx.fill()
      }
    } else {
      // Bubbling radioactive hide with droplets running off the body.
      ctx.globalAlpha = 0.85 * fade
      ctx.fillStyle = trim
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + z.wobble * 1.5
        const rad = r * 0.22 * (0.7 + 0.4 * Math.sin(z.wobble * 6 + i))
        ctx.beginPath()
        ctx.arc(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45, rad, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = '#84cc16'
      for (let i = 0; i < 3; i++) {
        const drip = (z.wobble * 30 + i * 7) % 16
        ctx.beginPath()
        ctx.ellipse((i - 1) * r * 0.5, r * 0.6 + drip, 2.5, 4, 0, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()
  }

  /** Crackling electric ring over a baton-frozen enemy. */
  private drawStun(e: Enemy) {
    const ctx = this.ctx
    const y = this.textures === 'enhanced' ? e.y - UNIT_LIFT : e.y
    ctx.save()
    ctx.translate(e.x, y)
    ctx.strokeStyle = 'rgba(56,189,248,0.9)'
    ctx.lineWidth = 2
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + e.stun * 6
      ctx.beginPath()
      ctx.moveTo(Math.cos(a) * (e.r + 2), Math.sin(a) * (e.r + 2))
      ctx.lineTo(Math.cos(a) * (e.r + 9), Math.sin(a) * (e.r + 9))
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.arc(0, 0, e.r + 5, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(125,211,252,0.5)'
    ctx.stroke()
    ctx.restore()
  }

  private drawZombie(z: Enemy) {
    const ctx = this.ctx
    this.drawStatusRing(z)
    const enhanced = this.textures === 'enhanced'
    const y = enhanced ? z.y - UNIT_LIFT : z.y
    const mossy = this.mission?.chapter === 3
    const flat = mossy ? (z.r > 16 ? '#3f6212' : '#4d7c0f') : z.r > 16 ? '#8b1414' : '#d62828'
    const outline = mossy ? '#1a2e05' : '#4a0a0a'
    this.drawReachingHands(z, y, this.enemySkinColor(flat), outline)
    ctx.beginPath()
    ctx.arc(z.x, y, z.r, 0, Math.PI * 2)
    if (enhanced) {
      // Shaded sphere so the body reads as standing above its shadow.
      const grad = ctx.createRadialGradient(z.x - z.r * 0.35, y - z.r * 0.4, z.r * 0.15, z.x, y, z.r)
      grad.addColorStop(0, mossy ? '#84cc16' : z.r > 16 ? '#c94141' : '#ff6b5e')
      grad.addColorStop(1, mossy ? '#1f3b07' : z.r > 16 ? '#5c0d0d' : '#8f1616')
      ctx.fillStyle = grad
    } else {
      ctx.fillStyle = flat
    }
    ctx.fill()
    ctx.strokeStyle = outline
    ctx.lineWidth = 2
    ctx.stroke()
    if (mossy) this.drawMoss(z, y)
    this.drawMutationSkin(z, y, z.r)
  }

  /**
   * Jungle infected wear the canopy: clumps of moss and a vine trailing off
   * the body. Mutation skins still paint over the top of it.
   */
  private drawMoss(z: Enemy, y: number) {
    const ctx = this.ctx
    ctx.save()
    ctx.translate(z.x, y)
    ctx.fillStyle = 'rgba(163,230,53,0.55)'
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + z.driftAngle
      const d = z.r * 0.55
      ctx.beginPath()
      ctx.ellipse(Math.cos(a) * d, Math.sin(a) * d, z.r * 0.26, z.r * 0.17, a, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.strokeStyle = 'rgba(101,163,13,0.85)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(-z.r * 0.6, -z.r * 0.2)
    ctx.quadraticCurveTo(0, z.r * 0.35 + Math.sin(z.wobble * 3) * 2, z.r * 0.7, -z.r * 0.35)
    ctx.stroke()
    ctx.restore()
  }

  /**
   * The armoured rig: a plated chassis rolling east, with an open bed the
   * players are strapped into and a roll cage over the cab.
   */
  private drawTruck(t: Truck) {
    const ctx = this.ctx
    ctx.save()
    ctx.translate(t.x, t.y)

    // Wheels, rolling as the rig covers ground.
    ctx.fillStyle = '#111827'
    for (const wx of [-t.hw + 26, 4, t.hw - 26]) {
      for (const wy of [-t.hh - 6, t.hh + 6]) {
        ctx.save()
        ctx.translate(wx, wy)
        ctx.fillRect(-16, -9, 32, 18)
        ctx.strokeStyle = '#6b7280'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(-10, Math.sin(t.wheel) * 7)
        ctx.lineTo(10, -Math.sin(t.wheel) * 7)
        ctx.stroke()
        ctx.restore()
      }
    }

    ctx.fillStyle = t.hurt > 0 ? '#fca5a5' : '#5b6470'
    ctx.fillRect(-t.hw, -t.hh, t.hw * 2, t.hh * 2)
    ctx.strokeStyle = '#1f2937'
    ctx.lineWidth = 4
    ctx.strokeRect(-t.hw, -t.hh, t.hw * 2, t.hh * 2)

    // Open bed at the rear, cab and windscreen at the front.
    ctx.fillStyle = '#3f4652'
    ctx.fillRect(-t.hw + 10, -t.hh + 10, t.hw, t.hh * 2 - 20)
    ctx.fillStyle = '#7b8592'
    ctx.fillRect(t.hw - 58, -t.hh + 8, 46, t.hh * 2 - 16)
    ctx.fillStyle = '#bae6fd'
    ctx.fillRect(t.hw - 20, -t.hh + 14, 10, t.hh * 2 - 28)

    // Ram plate up front and hazard stripes along the bed rails.
    ctx.fillStyle = '#9ca3af'
    ctx.fillRect(t.hw, -t.hh + 6, 12, t.hh * 2 - 12)
    ctx.fillStyle = '#f59e0b'
    for (let x = -t.hw + 12; x < 4; x += 22) {
      ctx.fillRect(x, -t.hh + 2, 12, 6)
      ctx.fillRect(x, t.hh - 8, 12, 6)
    }
    ctx.restore()
  }

  /** Toxic Blood residue: a bubbling green puddle that fades out. */
  /** The generator: a humming steel block with its own health bar. */
  private drawGenerator(g: Generator) {
    const ctx = this.ctx
    const w = g.r * 2
    ctx.save()
    this.drawGroundShadow(g.x, g.y, g.r)
    ctx.translate(g.x, g.y)
    ctx.fillStyle = g.hurt > 0 ? '#fca5a5' : '#4b5563'
    ctx.fillRect(-g.r, -g.r * 0.75, w, g.r * 1.5)
    ctx.strokeStyle = '#111827'
    ctx.lineWidth = 4
    ctx.strokeRect(-g.r, -g.r * 0.75, w, g.r * 1.5)
    ctx.fillStyle = '#f59e0b'
    ctx.fillRect(-g.r * 0.6, -g.r * 0.4, g.r * 0.5, g.r * 0.5)
    ctx.fillStyle = '#38bdf8'
    ctx.fillRect(g.r * 0.1, -g.r * 0.4, g.r * 0.7, g.r * 0.8)
    ctx.fillStyle = '#1f2937'
    ctx.fillRect(-g.r * 0.3, g.r * 0.4, g.r * 0.6, g.r * 0.35)

    const pct = Math.max(0, g.hp / g.maxHp)
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(-g.r, -g.r * 1.35, w, 10)
    ctx.fillStyle = pct > 0.5 ? '#34d399' : pct > 0.25 ? '#fbbf24' : '#ef4444'
    ctx.fillRect(-g.r, -g.r * 1.35, w * pct, 10)
    ctx.restore()
  }

  /** Cryo detonation: a fading ring of frost. */
  private drawBlast(b: Blast) {
    const ctx = this.ctx
    const t = 1 - b.life / b.maxLife
    ctx.save()
    ctx.globalAlpha = Math.max(0, 1 - t)
    ctx.strokeStyle = '#7dd3fc'
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.arc(b.x, b.y, b.r * (0.4 + t * 0.6), 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = 'rgba(56,189,248,0.18)'
    ctx.beginPath()
    ctx.arc(b.x, b.y, b.r * (0.4 + t * 0.6), 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  private drawAcid(pool: AcidPool) {
    const ctx = this.ctx
    const fade = Math.min(1, pool.life / pool.maxLife + 0.2)
    ctx.save()
    ctx.globalAlpha = 0.55 * fade
    ctx.beginPath()
    ctx.arc(pool.x, pool.y, pool.r, 0, Math.PI * 2)
    ctx.fillStyle = '#65a30d'
    ctx.fill()
    ctx.globalAlpha = 0.85 * fade
    ctx.strokeStyle = '#a3e635'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.globalAlpha = 0.5 * fade
    ctx.fillStyle = '#bef264'
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + pool.life
      ctx.beginPath()
      ctx.arc(pool.x + Math.cos(a) * pool.r * 0.45, pool.y + Math.sin(a) * pool.r * 0.45, 4, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  /** The Runner: small, bright red, with motion streaks behind it. */
  private drawRunner(z: Enemy) {
    const ctx = this.ctx
    this.drawStatusRing(z)
    const y = this.textures === 'enhanced' ? z.y - UNIT_LIFT : z.y
    ctx.save()
    ctx.strokeStyle = 'rgba(255,60,60,0.35)'
    ctx.lineWidth = 3
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath()
      ctx.arc(z.x - Math.cos(z.driftAngle) * 0, y, z.r + i * 4, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
    this.drawReachingHands(z, y, this.enemySkinColor('#ff1e1e'), '#7f1d1d')
    ctx.beginPath()
    ctx.arc(z.x, y, z.r, 0, Math.PI * 2)
    ctx.fillStyle = '#ff1e1e'
    ctx.fill()
    ctx.strokeStyle = '#7f1d1d'
    ctx.lineWidth = 2
    ctx.stroke()
    this.drawMutationSkin(z, y, z.r)
  }

  /**
   * The Camo Zombie: tinted to the floor until it closes in, and disguised as
   * a survivor whenever one is nearby.
   */
  private drawCamo(z: Enemy) {
    const ctx = this.ctx
    const y = this.textures === 'enhanced' ? z.y - UNIT_LIFT : z.y
    if (z.revealed) {
      this.drawStatusRing(z)
      this.drawReachingHands(z, y, this.enemySkinColor('#3f6212'), '#1a2e05')
      ctx.beginPath()
      ctx.arc(z.x, y, z.r, 0, Math.PI * 2)
      ctx.fillStyle = '#3f6212'
      ctx.fill()
      ctx.strokeStyle = '#d62828'
      ctx.lineWidth = 3
      ctx.stroke()
      this.drawMutationSkin(z, y, z.r)
      return
    }

    const mimic = this.survivors.some(
      (s) => !s.safe && s.hp > 0 && Math.hypot(s.x - z.x, s.y - z.y) < CAMO_MIMIC_RANGE
    )
    if (mimic) {
      // Wears a survivor's look — including a fake health bar — as a decoy.
      ctx.beginPath()
      ctx.arc(z.x, y, z.r, 0, Math.PI * 2)
      ctx.fillStyle = '#e2e8f0'
      ctx.fill()
      ctx.strokeStyle = '#0f172a'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(z.x - 21, y - z.r - 15, 42, 8)
      ctx.fillStyle = '#22c55e'
      ctx.fillRect(z.x - 20, y - z.r - 14, 40, 6)
      return
    }

    // Otherwise it takes on the floor colour, leaving only a faint outline.
    ctx.save()
    ctx.globalAlpha = 0.9
    ctx.beginPath()
    ctx.arc(z.x, y, z.r, 0, Math.PI * 2)
    ctx.fillStyle = this.map.color
    ctx.fill()
    ctx.globalAlpha = 0.18
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.restore()
  }

  private drawBug(b: Enemy) {
    const ctx = this.ctx
    this.drawStatusRing(b)
    const flap = Math.sin(b.wobble * 22) * 0.6
    const bodyY = this.textures === 'enhanced' ? b.y - UNIT_LIFT * 2 : b.y
    this.drawReachingHands(b, bodyY, this.enemySkinColor('#ffa41b'), '#8a4b00')
    ctx.save()
    // In the 3D pack the bug floats a little above its ground shadow.
    ctx.translate(b.x, bodyY)
    ctx.fillStyle = 'rgba(255, 213, 128, 0.45)'
    for (const side of [-1, 1]) {
      ctx.save()
      ctx.rotate(side * (0.7 + flap * side))
      ctx.beginPath()
      ctx.ellipse(0, -b.r * 1.3, b.r * 0.5, b.r * 1.1, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    ctx.beginPath()
    ctx.arc(0, 0, b.r, 0, Math.PI * 2)
    ctx.fillStyle = '#ffa41b'
    ctx.fill()
    ctx.strokeStyle = '#8a4b00'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.restore()
    this.drawMutationSkin(b, bodyY, b.r)
  }

  private drawMapLabel() {
    const ctx = this.ctx
    const m = this.map
    ctx.font = 'bold 64px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    ctx.fillText(m.name.toUpperCase(), m.width / 2, 140)
    ctx.fillText(m.name.toUpperCase(), m.width / 2, m.height - 100)
    ctx.textAlign = 'left'
  }

  /** Floating speech bubble over player 1 during the Hive Mother reveal. */
  private drawRevealBubble() {
    const speaker = this.alivePlayers[0] ?? this.players[0]
    if (!speaker) return
    const ctx = this.ctx
    const text = BOSS_REVEAL_LINES[this.boss?.kind ?? 'hive-mother']
    ctx.save()
    ctx.font = 'bold 15px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const w = ctx.measureText(text).width + 28
    const h = 34
    const x = speaker.x
    const y = speaker.y - speaker.r - 44
    ctx.globalAlpha = Math.min(1, this.bubbleTimer * 2)
    ctx.fillStyle = 'rgba(8,12,20,0.88)'
    ctx.strokeStyle = '#fb923c'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(x - w / 2, y - h / 2, w, h, 10)
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x - 8, y + h / 2)
    ctx.lineTo(x + 8, y + h / 2)
    ctx.lineTo(x, y + h / 2 + 12)
    ctx.closePath()
    ctx.fillStyle = 'rgba(8,12,20,0.88)'
    ctx.fill()
    ctx.fillStyle = '#fde68a'
    ctx.fillText(text, x, y)
    ctx.restore()
  }

  private drawPlayer(p: Player) {
    const ctx = this.ctx
    ctx.save()
    ctx.translate(p.x, this.textures === 'enhanced' ? p.y - UNIT_LIFT : p.y)
    if (p.down) ctx.globalAlpha = 0.4

    if (this.isCloaked(p)) {
      // Leaf cloud while Camouflage Blend is running.
      ctx.globalAlpha = 0.55
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + p.abilityActive * 1.6
        const d = p.r + 12 + Math.sin(p.abilityActive * 4 + i) * 5
        ctx.beginPath()
        ctx.ellipse(Math.cos(a) * d, Math.sin(a) * d, 7, 4, a, 0, Math.PI * 2)
        ctx.fillStyle = i % 2 ? '#4ade80' : '#a3e635'
        ctx.fill()
      }
    }
    if (p.character.id === 'army-retiree' && p.abilityActive > 0) {
      ctx.beginPath()
      ctx.arc(0, 0, p.r + 8, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255,77,77,0.85)'
      ctx.lineWidth = 3
      ctx.stroke()
    }

    const melee = p.weapon.melee
    const kick = p.recoil * 5
    ctx.save()
    ctx.rotate(p.angle)
    if (melee) {
      // The blade travels across the 90° arc; a fading trail marks the slash.
      const swinging = p.swinging
      const t = swinging ? p.swing : 0.5
      const bladeA = p.swingDir * (t - 0.5) * melee.arc
      const startA = p.swingDir * -0.5 * melee.arc
      if (swinging) {
        const from = Math.min(startA, bladeA)
        const to = Math.max(startA, bladeA)
        const grad = ctx.createRadialGradient(0, 0, p.r, 0, 0, p.r + melee.reach)
        grad.addColorStop(0, 'rgba(255,255,255,0)')
        grad.addColorStop(1, `rgba(255,255,255,${0.28 * (1 - t)})`)
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.arc(0, 0, p.r + melee.reach, from, to)
        ctx.closePath()
        ctx.fillStyle = grad
        ctx.fill()
        ctx.beginPath()
        ctx.arc(0, 0, p.r + melee.reach * 0.85, from, to)
        ctx.strokeStyle = `rgba(226,232,240,${0.75 * (1 - t * 0.6)})`
        ctx.lineWidth = 5
        ctx.lineCap = 'round'
        ctx.stroke()
      }
      ctx.save()
      ctx.rotate(bladeA)
      ctx.fillStyle = p.weapon.color
      ctx.fillRect(p.r - 2, -2.5, melee.reach * 0.8, 5)
      ctx.fillStyle = '#1f2937'
      ctx.fillRect(p.r - 6, -4, 8, 8)
      ctx.restore()
    } else {
      ctx.fillStyle = '#e5e7eb'
      ctx.fillRect(p.r - 4 - kick, -4, 22, 8)
    }
    ctx.restore()

    drawCharacterSkin(ctx, p.character.id, p.r, p.angle, p.hurtCooldown > 0)
    this.drawPlayerHands(p, kick)

    if (this.players.length > 1) {
      ctx.fillStyle = p.id === 1 ? '#34d399' : '#60a5fa'
      ctx.font = 'bold 12px ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(p.down ? `P${p.id} DOWN` : `P${p.id}`, 0, -p.r - 8)
      ctx.textAlign = 'left'
    }
    ctx.restore()
  }

  /**
   * Both fists gripping the weapon along the aim line, snapping backwards for
   * a moment after each shot. Drawn inside the player's translated frame.
   */
  private drawPlayerHands(p: Player, kick: number) {
    const ctx = this.ctx
    const grips: { fwd: number; side: number }[] = [
      { fwd: p.r + 12, side: -3 },
      { fwd: p.r + 1, side: 4 },
    ]
    const melee = p.weapon.melee
    // Hands ride along with a melee blade as it sweeps across its arc.
    const swingOffset =
      melee && p.swinging ? p.swingDir * (p.swing - 0.5) * melee.arc : 0
    ctx.save()
    ctx.rotate(p.angle + swingOffset)
    for (const g of grips) {
      const hx = g.fwd - (melee ? 0 : kick)
      ctx.beginPath()
      ctx.moveTo(p.r * 0.4, g.side * 1.6)
      ctx.lineTo(hx, g.side)
      ctx.strokeStyle = 'rgba(15,23,42,0.7)'
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(hx, g.side, 4.5, 0, Math.PI * 2)
      ctx.fillStyle = '#e8b98a'
      ctx.fill()
      ctx.strokeStyle = '#7c4a21'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawCrosshair() {
    if (this.state !== 'playing') return
    const ctx = this.ctx

    const p2 = this.players[1]
    if (p2 && !p2.down) {
      // Show where player 2's auto-aim is pointing.
      const len = 70
      ctx.save()
      this.applyWorldTransform()
      ctx.strokeStyle = 'rgba(96,165,250,0.55)'
      ctx.lineWidth = 2
      ctx.setLineDash([8, 8])
      ctx.beginPath()
      ctx.moveTo(p2.x, p2.y)
      ctx.lineTo(p2.x + Math.cos(p2.angle) * len, p2.y + Math.sin(p2.angle) * len)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
    }

    const { x, y } = this.mouseScreen
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(x, y, 10, 0, Math.PI * 2)
    ctx.moveTo(x - 16, y)
    ctx.lineTo(x - 4, y)
    ctx.moveTo(x + 4, y)
    ctx.lineTo(x + 16, y)
    ctx.moveTo(x, y - 16)
    ctx.lineTo(x, y - 4)
    ctx.moveTo(x, y + 4)
    ctx.lineTo(x, y + 16)
    ctx.stroke()
  }

  /**
   * The radar is a schematic, not a view: it is drawn in screen space with no
   * fog mask, so the full map geometry stays readable however dark the arena.
   */
  private drawMinimap() {
    const ctx = this.ctx
    const m = this.map
    const mw = 240
    const mh = (mw * m.height) / m.width
    const mx = this.viewW - mw - 20
    // The touch pad owns the bottom corners, so the map moves out of its way.
    const my = touchStick.visible ? 20 : this.viewH - mh - 20
    const s = mw / m.width

    ctx.save()
    ctx.globalAlpha = 0.9
    ctx.fillStyle = '#050807'
    ctx.fillRect(mx - 6, my - 6, mw + 12, mh + 12)
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'
    ctx.lineWidth = 2
    ctx.strokeRect(mx - 6, my - 6, mw + 12, mh + 12)

    ctx.fillStyle = m.color
    ctx.fillRect(mx, my, mw, mh)

    ctx.fillStyle = m.wallColor
    for (const w of m.walls) {
      ctx.fillRect(mx + w.x * s, my + w.y * s, Math.max(1, w.w * s), Math.max(1, w.h * s))
    }

    if (this.mission?.type === 'protect') {
      ctx.strokeStyle = '#3ddc84'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(mx + m.extraction.x * s, my + m.extraction.y * s, 6, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = '#e2e8f0'
      for (const sv of this.survivors) {
        if (sv.hp <= 0) continue
        ctx.beginPath()
        ctx.arc(mx + sv.x * s, my + sv.y * s, 3, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    for (const e of this.enemies) {
      // Camo stalkers stay off the radar until they break cover.
      if (e.kind === 'camo' && !e.revealed) continue
      ctx.fillStyle = e.kind === 'bug' ? '#ffa41b' : e.kind === 'runner' ? '#ff1e1e' : '#d62828'
      ctx.beginPath()
      ctx.arc(mx + e.x * s, my + e.y * s, e.kind === 'zombie' ? 2.5 : 2, 0, Math.PI * 2)
      ctx.fill()
    }

    // A cloaked Stalker drops off the radar too.
    if (this.boss && !this.boss.cloaked) {
      ctx.fillStyle = this.boss.kind === 'runner-alpha' ? '#f43f5e' : '#f0871b'
      ctx.beginPath()
      ctx.arc(mx + this.boss.x * s, my + this.boss.y * s, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#fff1a8'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    ctx.fillStyle = '#a78bfa'
    for (const t of this.turrets) {
      ctx.beginPath()
      ctx.arc(mx + t.x * s, my + t.y * s, 3, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = '#7c5c2b'
    for (const b of this.barricades) {
      ctx.fillRect(mx + b.x * s, my + b.y * s, Math.max(1, b.w * s), Math.max(1, b.h * s))
    }

    for (const p of this.players) {
      ctx.fillStyle = p.down ? '#64748b' : p.character.color
      ctx.beginPath()
      ctx.arc(mx + p.x * s, my + p.y * s, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = p.id === 1 ? '#34d399' : '#60a5fa'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.fillText(m.name, mx + 4, my + 14)
    ctx.restore()
  }
}

/** Shortest distance from a point to the segment a→b, for swept hit tests. */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const len = dx * dx + dy * dy
  const t = len === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / len, 0, 1)
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t))
}

/** Signed shortest angle from `b` to `a`, in radians. */
function angleDelta(a: number, b: number) {
  let d = a - b
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}
