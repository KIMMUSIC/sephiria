// ── Coordinates ──
export type Position = { row: number; col: number }

// ── Tablet Effect (relative to tablet body) ──
export interface Effect {
  dx: number   // column offset
  dy: number   // row offset (negative = up)
  value: number // -1 ~ +5
  flag?: 'ignore' // bypasses tablet shield
}

// ── Tiers ──
export type Tier = 'common' | 'advanced' | 'rare' | 'legend' | 'solid'

// ── Item Types ──
export type ItemType = 'ARTIFACT' | 'TABLET'

// ── Artifact static data (from sephiria.wiki) ──
export interface ArtifactData {
  id: number
  value: string
  label_kor: string
  label_eng: string
  tier: Tier
  level: number // maxLevel
  image: string
  effect: {
    sets: string[]
    content: string
  }
  description: string
}

// ── Tablet static data ──
export interface TabletData {
  value: string
  ko_label: string
  eng_label: string
  tier: Tier
  image: string
  rotate?: boolean
}

// ── Tablet effect definitions ──
export interface SimpleTabletEffect {
  type: 'simple'
  effects: Effect[]
}

export interface ComplexTabletEffect {
  type: 'complex'
  description: string
}

export type TabletEffectDef = SimpleTabletEffect | ComplexTabletEffect

// ── Placed items (instances on the grid) ──
export interface PlacedArtifact {
  instanceId: string
  type: 'ARTIFACT'
  data: ArtifactData
  level: number        // user-set enhancement level
  currentLevel: number // computed after tablet effects
  isLocked: boolean    // excluded from optimizer mutations
}

export interface PlacedTablet {
  instanceId: string
  type: 'TABLET'
  data: TabletData
  effectDef: TabletEffectDef
  rotation: 0 | 1 | 2 | 3 // 0=0°, 1=90°, 2=180°, 3=270°
  isCustom: boolean
  customEffects?: Effect[] // user-drawn effects for custom tablets
}

export type PlacedItem = PlacedArtifact | PlacedTablet

// ── Grid structure ──
export type GridSlot = PlacedItem | null

export interface GridRow {
  rowIndex: number
  cols: number // columns in this row (6 for full rows, ≤6 for last)
}

// ── Effect map: "row-col" → cumulative effect value or 'ignore' ──
export type EffectMap = Record<string, number | 'ignore'>

// ── SA Optimizer config ──
export interface SAConfig {
  initialTemp: number
  coolingRate: number
  minTemp: number
  maxTimeMs: number
}

export const DEFAULT_SA_CONFIG: SAConfig = {
  initialTemp: 100,
  coolingRate: 0.9996,
  minTemp: 0.01,
  maxTimeMs: 8000,
}

export interface OptimizeLastResult {
  beforeScore: number
  afterScore: number
  iterations: number
}

// ── Worker messages ──
export interface OptimizeRequest {
  type: 'start'
  slots: GridSlot[]
  gridRows: GridRow[]
  config: SAConfig
}

export interface OptimizeProgress {
  type: 'progress'
  iteration: number
  bestScore: number
  temp: number
}

export interface OptimizeResult {
  type: 'result'
  slots: GridSlot[]
  score: number
  iterations: number
}

export type WorkerMessage = OptimizeProgress | OptimizeResult

// ── Recognition result (template matching) ──
export interface RecognitionResult {
  slotIndex: number
  matchedValue: string | null
  type: ItemType | null
  level: number
  confidence: number
  rotation?: 0 | 1 | 2 | 3
}

// ── Upload phase ──
export type UploadPhase =
  | 'idle'
  | 'uploading'
  | 'recognizing'
  | 'validating'
  | 'complete'
  | 'error'

// ── Vision Worker (plate-matcher + grid-calibrate) ──

export interface TemplateData {
  value: string
  type: ItemType
  label: string
  buffer: ArrayBuffer
  width: number
  height: number
  rotatable?: boolean
}

export interface DetectedCell {
  row: number
  col: number
  x: number
  y: number
  width: number
  height: number
  cropBuffer: ArrayBuffer
}

export interface CellRect {
  x: number
  y: number
  width: number
  height: number
}

export interface VisionMatchCandidate {
  value: string
  type: ItemType
  rotation: 0 | 1 | 2 | 3
  confidence: number
}

export interface VisionMatchResult {
  row: number
  col: number
  matchedValue: string | null
  type: ItemType | null
  confidence: number
  rotation: 0 | 1 | 2 | 3
  candidates?: VisionMatchCandidate[]
}

/** Manually specified grid area (fallback uploader): skips auto calibration. */
export interface ManualGridSpec {
  originX: number
  originY: number
  gridWidth: number
  gridHeight: number
  rows: number
  cols: number
  /** Real slot count; trailing cells of the last row beyond this are skipped. */
  totalSlots: number
}

export type VisionRequest =
  | { type: 'init' }
  | { type: 'load-templates'; templates: TemplateData[] }
  | { type: 'detect'; buffer: ArrayBuffer; width: number; height: number; manualGrid?: ManualGridSpec }
  | { type: 'match'; cells: { row: number; col: number; cropBuffer: ArrayBuffer }[] }

export type VisionResponse =
  | { type: 'ready' }
  | { type: 'templates-loaded'; count: number }
  | { type: 'progress'; stage: string; percent: number }
  | { type: 'detect-result'; cells: DetectedCell[]; rects: CellRect[]; matchResults?: VisionMatchResult[] }
  | { type: 'detect-failed'; reason: string }
  | { type: 'match-result'; results: VisionMatchResult[] }
  | { type: 'error'; message: string }

export type SmartUploadPhase =
  | 'idle'
  | 'initializing'
  | 'detecting'
  | 'highlighting'
  | 'reviewing'
  | 'complete'
  | 'fallback'
