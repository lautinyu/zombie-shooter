export type StructureKind = 'building' | 'barrier'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
  /** Buildings get brickwork and windows; barriers are plain map edges. */
  kind?: StructureKind
}

export type MapId =
  | 'streets'
  | 'warehouse'
  | 'hive'
  | 'refuge'
  | 'alley'
  | 'rooftop'
  | 'highway'
  | 'deadend'
  | 'fogward'
  | 'glacier'
  | 'cryolab'
  | 'camp'
  | 'frozencore'
  | 'abandonedlab'
  | 'concourse'
  | 'reactor'
  | 'canopy'
  | 'thicket'
  | 'valley'
  | 'marshlands'
  | 'infiltration'
  | 'canopycrown'
  | 'rustflats'
  | 'rusthighway'
  | 'boneyard'
  | 'refinery'
  | 'dunes'
  | 'ironhold'
  | 'impactbasin'
  | 'hollowspire'
  | 'harvester'

/** Ground texture painted under everything else. */
export type FloorStyle =
  | 'asphalt'
  | 'wood'
  | 'organic'
  | 'dirt'
  | 'ice'
  | 'snow'
  | 'jungle'
  | 'sand'

export interface GameMap {
  id: MapId
  name: string
  width: number
  height: number
  /** Ground fill for the whole instance. */
  color: string
  wallColor: string
  wallEdge: string
  floor: FloorStyle
  /** Accent used for roofs, window glow and floor detailing. */
  accent: string
  walls: Rect[]
  /** Where escorted survivors run to. */
  extraction: { x: number; y: number }
  /** Fixed Spore Hive nests for 'overgrowth' missions. */
  hives?: { x: number; y: number }[]
  /** Fixed supply crate drops for 'supply' missions. */
  crates?: { x: number; y: number }[]
  /** Primeval Crystals feeding the Canopy Leviathan, one per arena corner. */
  crystals?: { x: number; y: number }[]
  /** Traversable pits that slow anything wading through them. */
  mud?: Rect[]
  /** Forced player start, used by the linear extraction valley. */
  spawn?: { x: number; y: number }
}

const BORDER = 30

/** Interior walls: flat partitions rather than windowed exterior buildings. */
function partitions(rects: Omit<Rect, 'kind'>[]): Rect[] {
  return rects.map((r) => ({ ...r, kind: 'barrier' as const }))
}

function border(width: number, height: number): Rect[] {
  return [
    { x: 0, y: 0, w: width, h: BORDER, kind: 'barrier' },
    { x: 0, y: height - BORDER, w: width, h: BORDER, kind: 'barrier' },
    { x: 0, y: 0, w: BORDER, h: height, kind: 'barrier' },
    { x: width - BORDER, y: 0, w: BORDER, h: height, kind: 'barrier' },
  ]
}

const STREETS: GameMap = {
  id: 'streets',
  name: 'The Streets',
  width: 1900,
  height: 1500,
  color: '#23262a',
  wallColor: '#8b5a2b',
  wallEdge: '#5c3a1c',
  floor: 'asphalt',
  accent: '#ffd479',
  extraction: { x: 1740, y: 750 },
  walls: [
    ...border(1900, 1500),
    { x: 200, y: 180, w: 320, h: 170 },
    { x: 760, y: 150, w: 190, h: 360 },
    { x: 1220, y: 240, w: 380, h: 150 },
    { x: 220, y: 600, w: 170, h: 400 },
    { x: 600, y: 760, w: 400, h: 130 },
    { x: 1300, y: 640, w: 150, h: 420 },
    { x: 180, y: 1200, w: 360, h: 150 },
    { x: 780, y: 1120, w: 150, h: 300 },
    { x: 1080, y: 1220, w: 420, h: 130 },
  ],
}

const WAREHOUSE: GameMap = {
  id: 'warehouse',
  name: 'The Warehouse',
  width: 1700,
  height: 1400,
  color: '#3a2d20',
  wallColor: '#9a6a34',
  wallEdge: '#63421d',
  floor: 'wood',
  accent: '#ffcf8a',
  extraction: { x: 1540, y: 700 },
  // Four storage rooms around a cross of hallways; every room has a doorway.
  walls: [
    ...border(1700, 1400),
    ...partitions([
      // Spine between the west and east rooms, broken by hallway openings.
      { x: 780, y: 120, w: 40, h: 240 },
      { x: 780, y: 440, w: 40, h: 200 },
      { x: 780, y: 760, w: 40, h: 210 },
      { x: 780, y: 1060, w: 40, h: 220 },

      // Room walls north of the east–west hallway.
      { x: 120, y: 600, w: 300, h: 40 },
      { x: 520, y: 600, w: 260, h: 40 },
      { x: 820, y: 600, w: 300, h: 40 },
      { x: 1240, y: 600, w: 340, h: 40 },

      // Room walls south of it.
      { x: 120, y: 760, w: 260, h: 40 },
      { x: 480, y: 760, w: 300, h: 40 },
      { x: 820, y: 760, w: 340, h: 40 },
      { x: 1260, y: 760, w: 320, h: 40 },

      // Partitions that turn each room into short aisles.
      { x: 300, y: 180, w: 40, h: 280 },
      { x: 340, y: 180, w: 220, h: 40 },
      { x: 1160, y: 180, w: 40, h: 300 },
      { x: 940, y: 440, w: 260, h: 40 },
      { x: 300, y: 940, w: 40, h: 260 },
      { x: 340, y: 940, w: 240, h: 40 },
      { x: 1160, y: 920, w: 40, h: 300 },
      { x: 940, y: 1180, w: 260, h: 40 },

      // Loose crates for cover — square footprints, not aisle-length shelving.
      { x: 560, y: 320, w: 70, h: 70 },
      { x: 1000, y: 250, w: 70, h: 70 },
      { x: 620, y: 1000, w: 70, h: 70 },
      { x: 1320, y: 1030, w: 70, h: 70 },
      { x: 1380, y: 300, w: 70, h: 70 },
      { x: 200, y: 1280, w: 70, h: 70 },
    ]),
  ],
}

const HIVE: GameMap = {
  id: 'hive',
  name: 'The Infected Hive',
  width: 1800,
  height: 1600,
  color: '#241a2b',
  wallColor: '#6d3f7a',
  wallEdge: '#3f2049',
  floor: 'organic',
  accent: '#e0a3ff',
  extraction: { x: 1620, y: 1440 },
  walls: [
    ...border(1800, 1600),
    // Chambered hive tunnels
    { x: 300, y: 300, w: 55, h: 500 },
    { x: 300, y: 300, w: 500, h: 55 },
    { x: 1000, y: 300, w: 500, h: 55 },
    { x: 1445, y: 300, w: 55, h: 500 },
    { x: 300, y: 1000, w: 55, h: 300 },
    { x: 300, y: 1245, w: 500, h: 55 },
    { x: 1000, y: 1245, w: 500, h: 55 },
    { x: 1445, y: 1000, w: 55, h: 300 },
    { x: 780, y: 640, w: 260, h: 260 },
  ],
}

const REFUGE: GameMap = {
  id: 'refuge',
  name: 'Ridgeline Refuge',
  width: 1800,
  height: 1400,
  color: '#1c3326',
  wallColor: '#7c6a3f',
  wallEdge: '#4d4126',
  floor: 'dirt',
  accent: '#ffe3a3',
  extraction: { x: 1620, y: 200 },
  walls: [
    ...border(1800, 1400),
    // Fenced compound with a shelter in the middle
    { x: 260, y: 260, w: 700, h: 50 },
    { x: 260, y: 260, w: 50, h: 420 },
    { x: 260, y: 900, w: 50, h: 240 },
    { x: 260, y: 1090, w: 620, h: 50 },
    { x: 1180, y: 1090, w: 360, h: 50 },
    { x: 1490, y: 620, w: 50, h: 520 },
    { x: 1180, y: 420, w: 360, h: 50 },
    { x: 720, y: 620, w: 380, h: 200 },
  ],
}

/** Path 1: claustrophobic back alleys behind the quarantine line. */
const ALLEY: GameMap = {
  id: 'alley',
  name: 'City Alleys',
  width: 1500,
  height: 1300,
  color: '#1d2024',
  wallColor: '#6f5340',
  wallEdge: '#42301f',
  floor: 'asphalt',
  accent: '#ffcf8a',
  extraction: { x: 1360, y: 1160 },
  walls: [
    ...border(1500, 1300),
    // Long tenement blocks leaving narrow lanes between them.
    { x: 140, y: 140, w: 380, h: 220 },
    { x: 640, y: 140, w: 240, h: 380 },
    { x: 1000, y: 140, w: 360, h: 200 },
    { x: 140, y: 520, w: 300, h: 240 },
    { x: 1080, y: 460, w: 280, h: 300 },
    { x: 560, y: 660, w: 320, h: 190 },
    { x: 140, y: 920, w: 340, h: 240 },
    { x: 620, y: 1000, w: 260, h: 160 },
    { x: 1020, y: 920, w: 200, h: 240 },
    ...partitions([
      { x: 460, y: 400, w: 90, h: 90 },
      { x: 940, y: 700, w: 90, h: 90 },
      { x: 520, y: 900, w: 70, h: 70 },
    ]),
  ],
}

/** Path 2: wide open rooftops where the swarm owns the sky. */
const ROOFTOP: GameMap = {
  id: 'rooftop',
  name: 'The Rooftops',
  width: 1900,
  height: 1500,
  color: '#3b3f45',
  wallColor: '#8d9299',
  wallEdge: '#4d5359',
  floor: 'wood',
  accent: '#cde5ff',
  extraction: { x: 1740, y: 1340 },
  walls: [
    ...border(1900, 1500),
    ...partitions([
      // Low parapets, vents and stair housings — plenty of open sky.
      { x: 420, y: 300, w: 260, h: 40 },
      { x: 1180, y: 300, w: 300, h: 40 },
      { x: 300, y: 700, w: 40, h: 260 },
      { x: 1560, y: 620, w: 40, h: 300 },
      { x: 780, y: 640, w: 220, h: 140 },
      { x: 620, y: 1120, w: 320, h: 40 },
      { x: 1240, y: 1080, w: 40, h: 260 },
      { x: 980, y: 260, w: 80, h: 80 },
      { x: 500, y: 980, w: 80, h: 80 },
    ]),
  ],
}

/** Path 3: a barricaded stretch of highway used as an evacuation lane. */
const HIGHWAY: GameMap = {
  id: 'highway',
  name: 'The Evac Highway',
  width: 2000,
  height: 1200,
  color: '#26282c',
  wallColor: '#7b7f86',
  wallEdge: '#464a50',
  floor: 'asphalt',
  accent: '#ffe08a',
  extraction: { x: 1840, y: 600 },
  walls: [
    ...border(2000, 1200),
    ...partitions([
      // Jersey barriers and stalled traffic forming a guarded corridor.
      { x: 240, y: 300, w: 320, h: 44 },
      { x: 700, y: 300, w: 380, h: 44 },
      { x: 1240, y: 300, w: 420, h: 44 },
      { x: 240, y: 860, w: 380, h: 44 },
      { x: 780, y: 860, w: 340, h: 44 },
      { x: 1300, y: 860, w: 400, h: 44 },
      { x: 520, y: 520, w: 120, h: 70 },
      { x: 980, y: 620, w: 120, h: 70 },
      { x: 1480, y: 500, w: 120, h: 70 },
      { x: 300, y: 640, w: 120, h: 70 },
    ]),
  ],
}

/** Runner Alpha arena: a debris-choked dead end. */
const DEADEND: GameMap = {
  id: 'deadend',
  name: 'The Dead End',
  width: 1500,
  height: 1200,
  color: '#191b1f',
  wallColor: '#6b4a34',
  wallEdge: '#3d2919',
  floor: 'asphalt',
  accent: '#ff9d6b',
  extraction: { x: 1340, y: 1060 },
  walls: [
    ...border(1500, 1200),
    { x: 120, y: 120, w: 260, h: 260 },
    { x: 1120, y: 120, w: 260, h: 260 },
    { x: 120, y: 820, w: 260, h: 260 },
    { x: 1120, y: 820, w: 260, h: 260 },
    ...partitions([
      // Skips and rubble piles the Alpha vaults over.
      { x: 560, y: 220, w: 140, h: 90 },
      { x: 840, y: 460, w: 120, h: 120 },
      { x: 480, y: 700, w: 150, h: 100 },
      { x: 900, y: 880, w: 130, h: 90 },
    ]),
  ],
}

/** Camo Stalker arena: a fogged-in loading dock. */
const FOGWARD: GameMap = {
  id: 'fogward',
  name: 'The Fog Ward',
  width: 1600,
  height: 1400,
  color: '#20262b',
  wallColor: '#5f6b6f',
  wallEdge: '#333c40',
  floor: 'wood',
  accent: '#a8e6d6',
  extraction: { x: 1440, y: 1240 },
  walls: [
    ...border(1600, 1400),
    ...partitions([
      { x: 320, y: 300, w: 340, h: 44 },
      { x: 940, y: 300, w: 340, h: 44 },
      { x: 320, y: 1060, w: 340, h: 44 },
      { x: 940, y: 1060, w: 340, h: 44 },
      { x: 300, y: 520, w: 44, h: 360 },
      { x: 1260, y: 520, w: 44, h: 360 },
      // Stacked dock pallets to break line of sight.
      { x: 620, y: 560, w: 120, h: 120 },
      { x: 880, y: 740, w: 120, h: 120 },
      { x: 480, y: 860, w: 100, h: 100 },
      { x: 1000, y: 460, w: 100, h: 100 },
    ]),
  ],
}

/** Chapter 2: the frozen approach to the Project Horizon facility. */
const GLACIER: GameMap = {
  id: 'glacier',
  name: 'Glacier Approach',
  width: 1900,
  height: 1500,
  color: '#33505f',
  wallColor: '#9fc7dd',
  wallEdge: '#4d7a94',
  floor: 'snow',
  accent: '#e0f2fe',
  extraction: { x: 1740, y: 1340 },
  walls: [
    ...border(1900, 1500),
    { x: 240, y: 220, w: 300, h: 200 },
    { x: 980, y: 180, w: 340, h: 180 },
    { x: 1520, y: 420, w: 240, h: 260 },
    { x: 200, y: 780, w: 260, h: 240 },
    { x: 720, y: 640, w: 320, h: 200 },
    { x: 1180, y: 900, w: 300, h: 220 },
    ...partitions([
      // Ice ridges and frozen crates scattered along the approach.
      { x: 620, y: 320, w: 120, h: 90 },
      { x: 1420, y: 1100, w: 140, h: 90 },
      { x: 520, y: 1140, w: 200, h: 80 },
      { x: 900, y: 1240, w: 120, h: 90 },
    ]),
  ],
}

/** Chapter 2: a sealed cryo lab used for the Hold the Line siege. */
const CRYOLAB: GameMap = {
  id: 'cryolab',
  name: 'Cryo Lab',
  width: 1300,
  height: 1100,
  color: '#2b4655',
  wallColor: '#8fb6cc',
  wallEdge: '#3f5b6b',
  floor: 'ice',
  accent: '#bae6fd',
  extraction: { x: 1160, y: 960 },
  // One sealed chamber: pillars and cryo pods for cover, no way out.
  walls: [
    ...border(1300, 1100),
    ...partitions([
      { x: 300, y: 260, w: 110, h: 110 },
      { x: 880, y: 260, w: 110, h: 110 },
      { x: 300, y: 720, w: 110, h: 110 },
      { x: 880, y: 720, w: 110, h: 110 },
      { x: 590, y: 500, w: 120, h: 120 },
      { x: 120, y: 520, w: 90, h: 70 },
      { x: 1090, y: 520, w: 90, h: 70 },
    ]),
  ],
}

/** Chapter 2: an exposed camp built around a single power generator. */
const CAMP: GameMap = {
  id: 'camp',
  name: 'Generator Camp',
  width: 1700,
  height: 1400,
  color: '#35525f',
  wallColor: '#7f9aa8',
  wallEdge: '#3d5460',
  floor: 'snow',
  accent: '#d1f0ff',
  extraction: { x: 1540, y: 1240 },
  walls: [
    ...border(1700, 1400),
    { x: 220, y: 220, w: 240, h: 160 },
    { x: 1240, y: 220, w: 240, h: 160 },
    { x: 220, y: 1020, w: 240, h: 160 },
    { x: 1240, y: 1020, w: 240, h: 160 },
    ...partitions([
      // Sandbag lines ringing the generator pad, with gaps to defend.
      { x: 560, y: 420, w: 260, h: 36 },
      { x: 900, y: 420, w: 240, h: 36 },
      { x: 560, y: 944, w: 240, h: 36 },
      { x: 880, y: 944, w: 260, h: 36 },
      { x: 520, y: 520, w: 36, h: 200 },
      { x: 520, y: 800, w: 36, h: 140 },
      { x: 1144, y: 520, w: 36, h: 200 },
      { x: 1144, y: 800, w: 36, h: 140 },
    ]),
  ],
}

/** Chapter 2: the frost core chamber where the Cryo-Stalker is contained. */
const FROZEN_CORE: GameMap = {
  id: 'frozencore',
  name: 'The Frozen Core',
  width: 1600,
  height: 1300,
  color: '#294455',
  wallColor: '#a8cfe4',
  wallEdge: '#456b83',
  floor: 'ice',
  accent: '#e0f7ff',
  extraction: { x: 1440, y: 1160 },
  // A round-ish arena ringed with shattered ice pods to break line of sight.
  walls: [
    ...border(1600, 1300),
    ...partitions([
      { x: 300, y: 240, w: 90, h: 150 },
      { x: 520, y: 170, w: 90, h: 150 },
      { x: 1000, y: 170, w: 90, h: 150 },
      { x: 1220, y: 240, w: 90, h: 150 },
      { x: 180, y: 560, w: 150, h: 90 },
      { x: 1280, y: 560, w: 150, h: 90 },
      { x: 300, y: 930, w: 90, h: 150 },
      { x: 520, y: 1000, w: 90, h: 150 },
      { x: 1000, y: 1000, w: 90, h: 150 },
      { x: 1220, y: 930, w: 90, h: 150 },
    ]),
  ],
}

/** Chapter 2: the derelict research wing the staff evacuated first. */
const ABANDONED_LAB: GameMap = {
  id: 'abandonedlab',
  name: 'The Abandoned Lab',
  width: 1700,
  height: 1400,
  color: '#25404d',
  wallColor: '#93b8cc',
  wallEdge: '#42606f',
  floor: 'ice',
  accent: '#cfeaff',
  extraction: { x: 1540, y: 1240 },
  // Ransacked labs off a central corridor, every room with a way in.
  walls: [
    ...border(1700, 1400),
    ...partitions([
      { x: 400, y: 200, w: 40, h: 320 },
      { x: 440, y: 200, w: 300, h: 40 },
      { x: 980, y: 200, w: 320, h: 40 },
      { x: 1260, y: 240, w: 40, h: 280 },
      { x: 220, y: 640, w: 360, h: 40 },
      { x: 780, y: 620, w: 40, h: 260 },
      { x: 1120, y: 640, w: 360, h: 40 },
      { x: 400, y: 900, w: 40, h: 300 },
      { x: 440, y: 1160, w: 320, h: 40 },
      { x: 980, y: 1160, w: 320, h: 40 },
      { x: 1260, y: 900, w: 40, h: 300 },
      // Toppled benches and specimen cabinets.
      { x: 620, y: 420, w: 90, h: 90 },
      { x: 1000, y: 800, w: 90, h: 90 },
      { x: 300, y: 820, w: 80, h: 80 },
      { x: 1400, y: 400, w: 80, h: 80 },
    ]),
  ],
}

/** Chapter 2: the long transit concourse linking the facility wings. */
const CONCOURSE: GameMap = {
  id: 'concourse',
  name: 'Sub-Zero Concourse',
  width: 2200,
  height: 1200,
  color: '#2e4a5a',
  wallColor: '#a6cbdf',
  wallEdge: '#4a7188',
  floor: 'ice',
  accent: '#e2f4ff',
  extraction: { x: 2040, y: 600 },
  walls: [
    ...border(2200, 1200),
    ...partitions([
      // Frozen check-in counters lining a wide central walkway.
      { x: 260, y: 260, w: 380, h: 44 },
      { x: 820, y: 260, w: 420, h: 44 },
      { x: 1420, y: 260, w: 420, h: 44 },
      { x: 260, y: 896, w: 420, h: 44 },
      { x: 860, y: 896, w: 400, h: 44 },
      { x: 1440, y: 896, w: 400, h: 44 },
      { x: 620, y: 480, w: 44, h: 240 },
      { x: 1180, y: 480, w: 44, h: 240 },
      { x: 1740, y: 480, w: 44, h: 240 },
      { x: 360, y: 560, w: 110, h: 90 },
      { x: 900, y: 620, w: 110, h: 90 },
      { x: 1500, y: 540, w: 110, h: 90 },
    ]),
  ],
}

/** Chapter 3: the hollow where three Spore Hives are rooted. */
const CANOPY: GameMap = {
  id: 'canopy',
  name: 'The Spore Hollow',
  width: 1900,
  height: 1600,
  color: '#1d3020',
  wallColor: '#4b5f34',
  wallEdge: '#26331b',
  floor: 'jungle',
  accent: '#a3e635',
  extraction: { x: 1740, y: 1440 },
  hives: [
    { x: 420, y: 380 },
    { x: 1500, y: 520 },
    { x: 900, y: 1260 },
  ],
  walls: [
    ...border(1900, 1600),
    ...partitions([
      { x: 250, y: 700, w: 420, h: 80 },
      { x: 1150, y: 820, w: 420, h: 80 },
      { x: 780, y: 200, w: 80, h: 300 },
      { x: 1620, y: 1000, w: 80, h: 320 },
      { x: 220, y: 1050, w: 80, h: 300 },
      { x: 640, y: 620, w: 90, h: 90 },
      { x: 1280, y: 300, w: 90, h: 90 },
    ]),
  ],
  mud: [
    { x: 700, y: 880, w: 320, h: 220 },
    { x: 1380, y: 1180, w: 260, h: 200 },
  ],
}

/** Chapter 3: a wide maze of overgrown ruins hiding the supply drop. */
const THICKET: GameMap = {
  id: 'thicket',
  name: 'The Overgrown Thicket',
  width: 2400,
  height: 1900,
  color: '#1a2c1d',
  wallColor: '#3f5730',
  wallEdge: '#1f2b16',
  floor: 'jungle',
  accent: '#84cc16',
  extraction: { x: 2220, y: 1740 },
  crates: [
    { x: 300, y: 320 },
    { x: 2100, y: 380 },
    { x: 340, y: 1620 },
    { x: 2080, y: 1560 },
  ],
  // Hedgerows laid out as corridors and dead ends.
  walls: [
    ...border(2400, 1900),
    ...partitions([
      { x: 200, y: 520, w: 700, h: 70 },
      { x: 1080, y: 200, w: 70, h: 560 },
      { x: 1340, y: 520, w: 860, h: 70 },
      { x: 480, y: 760, w: 70, h: 520 },
      { x: 760, y: 900, w: 620, h: 70 },
      { x: 1620, y: 760, w: 70, h: 540 },
      { x: 1840, y: 980, w: 420, h: 70 },
      { x: 200, y: 1280, w: 620, h: 70 },
      { x: 1080, y: 1180, w: 70, h: 540 },
      { x: 1340, y: 1400, w: 700, h: 70 },
      { x: 620, y: 1560, w: 70, h: 300 },
      { x: 2060, y: 1120, w: 70, h: 300 },
    ]),
  ],
  mud: [
    { x: 900, y: 1000, w: 300, h: 260 },
    { x: 1700, y: 300, w: 260, h: 220 },
    { x: 260, y: 900, w: 200, h: 240 },
  ],
}

/** Chapter 3: a long linear run from the crash site to the escape hatch. */
const VALLEY: GameMap = {
  id: 'valley',
  name: 'The Sunken Valley',
  width: 3400,
  height: 1100,
  color: '#1b2b1c',
  wallColor: '#46603a',
  wallEdge: '#22301a',
  floor: 'jungle',
  accent: '#bef264',
  spawn: { x: 200, y: 550 },
  extraction: { x: 3200, y: 550 },
  walls: [
    ...border(3400, 1100),
    ...partitions([
      { x: 560, y: 30, w: 80, h: 380 },
      { x: 900, y: 690, w: 80, h: 380 },
      { x: 1280, y: 30, w: 80, h: 340 },
      { x: 1640, y: 640, w: 80, h: 430 },
      { x: 2000, y: 30, w: 80, h: 400 },
      { x: 2380, y: 660, w: 80, h: 410 },
      { x: 2740, y: 30, w: 80, h: 360 },
      { x: 1120, y: 470, w: 180, h: 80 },
      { x: 2180, y: 470, w: 180, h: 80 },
    ]),
  ],
  mud: [
    { x: 700, y: 380, w: 300, h: 340 },
    { x: 1420, y: 200, w: 280, h: 420 },
    { x: 2100, y: 500, w: 320, h: 400 },
    { x: 2820, y: 300, w: 300, h: 420 },
  ],
}

/** Chapter 3: a flooded basin where the mud is most of the map. */
const MARSHLANDS: GameMap = {
  id: 'marshlands',
  name: 'Toxic Marshlands',
  width: 2100,
  height: 1700,
  color: '#1b2f26',
  wallColor: '#415b36',
  wallEdge: '#22301b',
  floor: 'jungle',
  accent: '#86efac',
  extraction: { x: 1940, y: 1540 },
  walls: [
    ...border(2100, 1700),
    ...partitions([
      // Rotting boardwalks and sunken roots forming narrow dry paths.
      { x: 300, y: 380, w: 520, h: 70 },
      { x: 1120, y: 300, w: 70, h: 420 },
      { x: 1380, y: 620, w: 480, h: 70 },
      { x: 340, y: 780, w: 70, h: 440 },
      { x: 700, y: 1080, w: 520, h: 70 },
      { x: 1560, y: 1100, w: 70, h: 380 },
      { x: 820, y: 620, w: 100, h: 100 },
      { x: 1780, y: 340, w: 100, h: 100 },
    ]),
  ],
  mud: [
    { x: 460, y: 500, w: 420, h: 260 },
    { x: 1200, y: 780, w: 340, h: 300 },
    { x: 640, y: 1200, w: 380, h: 300 },
    { x: 1620, y: 260, w: 300, h: 280 },
  ],
}

/** Chapter 2: the moss-choked reactor hall feeding the whole facility. */
const REACTOR: GameMap = {
  id: 'reactor',
  name: 'The Overgrown Reactor',
  width: 1900,
  height: 1500,
  color: '#22403f',
  wallColor: '#8fbcb4',
  wallEdge: '#3d605c',
  floor: 'ice',
  accent: '#a7f3d0',
  extraction: { x: 1740, y: 1340 },
  // A ring of coolant housings around the core, open enough to be swarmed in.
  walls: [
    ...border(1900, 1500),
    ...partitions([
      { x: 820, y: 660, w: 260, h: 180 },
      { x: 420, y: 300, w: 260, h: 60 },
      { x: 1220, y: 300, w: 260, h: 60 },
      { x: 420, y: 1140, w: 260, h: 60 },
      { x: 1220, y: 1140, w: 260, h: 60 },
      { x: 300, y: 560, w: 60, h: 380 },
      { x: 1540, y: 560, w: 60, h: 380 },
      { x: 640, y: 460, w: 90, h: 90 },
      { x: 1170, y: 460, w: 90, h: 90 },
      { x: 640, y: 950, w: 90, h: 90 },
      { x: 1170, y: 950, w: 90, h: 90 },
    ]),
  ],
}

/** Chapter 3: the crown of the canopy, arena of the Canopy Leviathan. */
const CANOPY_CROWN: GameMap = {
  id: 'canopycrown',
  name: 'The Canopy Crown',
  width: 2000,
  height: 1700,
  color: '#152618',
  wallColor: '#3a5330',
  wallEdge: '#1b2814',
  floor: 'jungle',
  accent: '#a3e635',
  extraction: { x: 1840, y: 1540 },
  crystals: [
    { x: 300, y: 300 },
    { x: 1700, y: 300 },
    { x: 300, y: 1400 },
    { x: 1700, y: 1400 },
  ],
  // A wide-open arena: only stumps break line of sight, so the flame zones
  // always have somewhere to land.
  walls: [
    ...border(2000, 1700),
    ...partitions([
      { x: 520, y: 520, w: 110, h: 110 },
      { x: 1370, y: 520, w: 110, h: 110 },
      { x: 520, y: 1070, w: 110, h: 110 },
      { x: 1370, y: 1070, w: 110, h: 110 },
      { x: 940, y: 180, w: 120, h: 90 },
      { x: 940, y: 1430, w: 120, h: 90 },
    ]),
  ],
}

/** Chapter 3: the tight ruin corridors under the canopy roots. */
const INFILTRATION: GameMap = {
  id: 'infiltration',
  name: 'Canopy Infiltration',
  width: 1800,
  height: 1500,
  color: '#182a1b',
  wallColor: '#3d5530',
  wallEdge: '#1e2a15',
  floor: 'jungle',
  accent: '#bbf7d0',
  extraction: { x: 1640, y: 1340 },
  walls: [
    ...border(1800, 1500),
    ...partitions([
      // Overgrown temple walls: short rooms with staggered doorways.
      { x: 260, y: 260, w: 420, h: 60 },
      { x: 860, y: 260, w: 400, h: 60 },
      { x: 1400, y: 320, w: 60, h: 360 },
      { x: 260, y: 320, w: 60, h: 340 },
      { x: 560, y: 560, w: 400, h: 60 },
      { x: 1120, y: 600, w: 60, h: 340 },
      { x: 300, y: 860, w: 60, h: 320 },
      { x: 560, y: 1120, w: 420, h: 60 },
      { x: 1180, y: 1120, w: 380, h: 60 },
      { x: 780, y: 820, w: 110, h: 110 },
      { x: 1440, y: 880, w: 110, h: 110 },
    ]),
  ],
  mud: [
    { x: 420, y: 680, w: 240, h: 200 },
    { x: 1200, y: 340, w: 220, h: 200 },
  ],
}

/** Chapter 4: the ash-blown crossing at the edge of the machine deserts. */
const RUSTFLATS: GameMap = {
  id: 'rustflats',
  name: 'The Ashfall Crossing',
  width: 1900,
  height: 1500,
  color: '#3a2b1c',
  wallColor: '#8a6a45',
  wallEdge: '#4a3520',
  floor: 'sand',
  accent: '#fbbf24',
  extraction: { x: 1720, y: 1340 },
  walls: [
    ...border(1900, 1500),
    ...partitions([
      { x: 300, y: 320, w: 300, h: 70 },
      { x: 1240, y: 300, w: 320, h: 70 },
      { x: 260, y: 900, w: 70, h: 340 },
      { x: 1520, y: 860, w: 70, h: 360 },
      { x: 740, y: 640, w: 380, h: 80 },
      { x: 620, y: 1120, w: 260, h: 70 },
      { x: 1080, y: 1080, w: 240, h: 70 },
    ]),
  ],
}

/**
 * Chapter 4: the linear stretch of dead highway the rig rolls down. The
 * middle lane is deliberately wall-free so the truck's path is never blocked.
 */
const RUST_HIGHWAY: GameMap = {
  id: 'rusthighway',
  name: 'The Scorched Highway',
  width: 4400,
  height: 1200,
  color: '#332a22',
  wallColor: '#7d6244',
  wallEdge: '#413021',
  floor: 'sand',
  accent: '#f59e0b',
  spawn: { x: 300, y: 600 },
  extraction: { x: 4120, y: 600 },
  walls: [
    ...border(4400, 1200),
    // Roadside wrecks and gantries, all clear of the y 380–820 driving lane.
    ...partitions([
      { x: 640, y: 150, w: 300, h: 120 },
      { x: 1500, y: 170, w: 260, h: 110 },
      { x: 2400, y: 140, w: 320, h: 130 },
      { x: 3300, y: 165, w: 280, h: 115 },
      { x: 900, y: 930, w: 300, h: 120 },
      { x: 1900, y: 950, w: 280, h: 110 },
      { x: 2850, y: 920, w: 320, h: 130 },
      { x: 3700, y: 940, w: 260, h: 110 },
    ]),
  ],
}

/** Chapter 4: a machine graveyard of stacked hulls and cargo skeletons. */
const BONEYARD: GameMap = {
  id: 'boneyard',
  name: 'The Rust Boneyard',
  width: 2200,
  height: 1700,
  color: '#33291f',
  wallColor: '#8b6b48',
  wallEdge: '#463525',
  floor: 'sand',
  accent: '#fcd34d',
  extraction: { x: 2020, y: 1520 },
  crates: [
    { x: 320, y: 340 },
    { x: 1880, y: 380 },
    { x: 360, y: 1380 },
    { x: 1840, y: 1340 },
  ],
  walls: [
    ...border(2200, 1700),
    ...partitions([
      { x: 340, y: 560, w: 420, h: 80 },
      { x: 1120, y: 380, w: 80, h: 380 },
      { x: 1440, y: 700, w: 380, h: 80 },
      { x: 400, y: 940, w: 80, h: 360 },
      { x: 760, y: 1160, w: 400, h: 80 },
      { x: 1560, y: 1080, w: 80, h: 340 },
      { x: 860, y: 300, w: 130, h: 130 },
      { x: 1760, y: 940, w: 130, h: 130 },
    ]),
  ],
}

/** Chapter 4: the refinery yard built around a single fuel pump. */
const REFINERY: GameMap = {
  id: 'refinery',
  name: 'The Rust Refinery',
  width: 1800,
  height: 1500,
  color: '#382a20',
  wallColor: '#96703f',
  wallEdge: '#4b3722',
  floor: 'sand',
  accent: '#fbbf24',
  extraction: { x: 1620, y: 1340 },
  walls: [
    ...border(1800, 1500),
    ...partitions([
      { x: 320, y: 320, w: 260, h: 70 },
      { x: 1220, y: 320, w: 260, h: 70 },
      { x: 320, y: 1110, w: 260, h: 70 },
      { x: 1220, y: 1110, w: 260, h: 70 },
      { x: 280, y: 620, w: 70, h: 260 },
      { x: 1450, y: 620, w: 70, h: 260 },
    ]),
  ],
}

/** Chapter 4: the salt flats of the dead sea, run end to end. */
const DUNES: GameMap = {
  id: 'dunes',
  name: 'The Dead Sea Flats',
  width: 3000,
  height: 1200,
  color: '#3d3324',
  wallColor: '#8d7146',
  wallEdge: '#4a3823',
  floor: 'sand',
  accent: '#fde68a',
  spawn: { x: 260, y: 600 },
  extraction: { x: 2780, y: 600 },
  walls: [
    ...border(3000, 1200),
    ...partitions([
      { x: 620, y: 200, w: 90, h: 340 },
      { x: 980, y: 660, w: 90, h: 340 },
      { x: 1420, y: 180, w: 90, h: 380 },
      { x: 1860, y: 640, w: 90, h: 360 },
      { x: 2300, y: 220, w: 90, h: 340 },
    ]),
  ],
  // Sinkholes of powdered salt drag anything wading through them.
  mud: [
    { x: 820, y: 420, w: 280, h: 260 },
    { x: 1600, y: 380, w: 300, h: 300 },
    { x: 2320, y: 620, w: 260, h: 280 },
  ],
}

/** Chapter 4: the approach to the iron gates, packed wall to wall. */
const IRONHOLD: GameMap = {
  id: 'ironhold',
  name: 'The Iron Gate Approach',
  width: 2000,
  height: 1600,
  color: '#2f2721',
  wallColor: '#7f6b52',
  wallEdge: '#3f342a',
  floor: 'sand',
  accent: '#f97316',
  extraction: { x: 1820, y: 1440 },
  walls: [
    ...border(2000, 1600),
    ...partitions([
      { x: 880, y: 700, w: 240, h: 200 },
      { x: 420, y: 380, w: 240, h: 70 },
      { x: 1340, y: 380, w: 240, h: 70 },
      { x: 420, y: 1150, w: 240, h: 70 },
      { x: 1340, y: 1150, w: 240, h: 70 },
      { x: 300, y: 700, w: 70, h: 240 },
      { x: 1630, y: 700, w: 70, h: 240 },
    ]),
  ],
}

/** New Game+ scene 1: the glassed crater the craft burned into the flats. */
const IMPACT_BASIN: GameMap = {
  id: 'impactbasin',
  name: 'The Impact Basin',
  width: 2100,
  height: 1700,
  color: '#1b1430',
  wallColor: '#6d4a9c',
  wallEdge: '#301e52',
  floor: 'organic',
  accent: '#c084fc',
  extraction: { x: 1900, y: 1520 },
  walls: [
    ...border(2100, 1700),
    ...partitions([
      { x: 480, y: 420, w: 300, h: 80 },
      { x: 1320, y: 420, w: 300, h: 80 },
      { x: 480, y: 1200, w: 300, h: 80 },
      { x: 1320, y: 1200, w: 300, h: 80 },
      { x: 980, y: 760, w: 160, h: 160 },
    ]),
  ],
  // Pools of the craft's coolant, thick enough to wade in.
  mud: [
    { x: 300, y: 760, w: 280, h: 240 },
    { x: 1520, y: 700, w: 280, h: 260 },
  ],
}

/** New Game+ scene 2: the bone-white spire the drop pods grew overnight. */
const HOLLOW_SPIRE: GameMap = {
  id: 'hollowspire',
  name: 'The Hollow Spire',
  width: 1800,
  height: 1800,
  color: '#151a2e',
  wallColor: '#7c5cc4',
  wallEdge: '#2b2250',
  floor: 'organic',
  accent: '#a78bfa',
  extraction: { x: 1620, y: 1620 },
  walls: [
    ...border(1800, 1800),
    ...partitions([
      { x: 760, y: 760, w: 280, h: 280 },
      { x: 360, y: 360, w: 90, h: 320 },
      { x: 1350, y: 360, w: 90, h: 320 },
      { x: 360, y: 1120, w: 90, h: 320 },
      { x: 1350, y: 1120, w: 90, h: 320 },
      { x: 700, y: 300, w: 400, h: 80 },
      { x: 700, y: 1420, w: 400, h: 80 },
    ]),
  ],
}

/** New Game+ scene 3: the harvesting field directly under the craft. */
const HARVESTER: GameMap = {
  id: 'harvester',
  name: 'The Harvest Field',
  width: 2400,
  height: 1800,
  color: '#101a24',
  wallColor: '#4c7f9c',
  wallEdge: '#1d3546',
  floor: 'organic',
  accent: '#22d3ee',
  extraction: { x: 2200, y: 1620 },
  walls: [
    ...border(2400, 1800),
    ...partitions([
      { x: 520, y: 520, w: 200, h: 200 },
      { x: 1660, y: 520, w: 200, h: 200 },
      { x: 520, y: 1080, w: 200, h: 200 },
      { x: 1660, y: 1080, w: 200, h: 200 },
      { x: 1120, y: 820, w: 180, h: 180 },
    ]),
  ],
  mud: [
    { x: 940, y: 300, w: 520, h: 200 },
    { x: 940, y: 1320, w: 520, h: 200 },
  ],
}

export const MAPS: GameMap[] = [
  STREETS,
  WAREHOUSE,
  HIVE,
  REFUGE,
  ALLEY,
  ROOFTOP,
  HIGHWAY,
  DEADEND,
  FOGWARD,
  GLACIER,
  CRYOLAB,
  CAMP,
  FROZEN_CORE,
  ABANDONED_LAB,
  CONCOURSE,
  REACTOR,
  CANOPY,
  THICKET,
  VALLEY,
  MARSHLANDS,
  INFILTRATION,
  CANOPY_CROWN,
  RUSTFLATS,
  RUST_HIGHWAY,
  BONEYARD,
  REFINERY,
  DUNES,
  IRONHOLD,
  IMPACT_BASIN,
  HOLLOW_SPIRE,
  HARVESTER,
]

/** True when the point sits inside one of the map's mud pits. */
export function inMud(map: GameMap, x: number, y: number): boolean {
  if (!map.mud) return false
  return map.mud.some((p) => x > p.x && x < p.x + p.w && y > p.y && y < p.y + p.h)
}

export function mapById(id: MapId): GameMap {
  const m = MAPS.find((mm) => mm.id === id)
  if (!m) throw new Error(`unknown map ${id}`)
  return m
}

export function circleHitsWall(map: GameMap, x: number, y: number, r: number): boolean {
  for (const w of map.walls) {
    const nx = Math.max(w.x, Math.min(x, w.x + w.w))
    const ny = Math.max(w.y, Math.min(y, w.y + w.h))
    const dx = x - nx
    const dy = y - ny
    if (dx * dx + dy * dy < r * r) return true
  }
  return false
}
