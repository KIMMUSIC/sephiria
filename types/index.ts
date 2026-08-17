// ── Coordinates ──
export type Position = { row: number; col: number }

// ── Tablet Effect (relative to tablet body) ──
export interface Effect {
  dx: number   // column offset
  dy: number   // row offset (negative = up)
  value: number // -1 ~ +5
  /**
   * 제약 무시 — the cell's artifact ignores its own `<제약>`.
   * Only 환대 carries this: "두 칸에 레벨 강화와 제약 무시를 동시에 제공한다"
   * — namu.wiki/w/세피리아/석판. It is applied *in addition to* the numeric value,
   * and it also keeps this app's pre-existing tablet-shield bypass on that cell.
   */
  flag?: 'ignore'
}

// ── Tiers ──
export type Tier = 'common' | 'advanced' | 'rare' | 'legend' | 'solid'

/**
 * Artifact placement constraint (`<제약>`), parsed from `effect.content`.
 * Wiki rule: an unsatisfied 제약 disables the artifact's own 고유 effect.
 * The level is untouched and 콤보(세트) effects still apply.
 *   "제약 조건을 준수하지 않고 배치하면 아이템의 효과가 적용되지 않는다" — namu.wiki/w/세피리아
 *   "[6] 콤보 효과는 적용된다." — same page, footnote
 */
export type ConstraintKind =
  | 'inner'          // 인벤토리 안쪽
  | 'edge'           // (아이템이) 인벤토리 가장자리
  | 'top'            // 인벤토리 최상단
  | 'bottom'         // 인벤토리 최하단 / 가장 아래 칸
  | 'bothSidesEmpty' // 인벤토리 양쪽 칸이 모두 비어 있을 때

/** Optimizer intent for a single artifact. Default is 'normal'. */
export type ArtifactPriority = 'high' | 'normal' | 'exclude'

// ── Combo (태그) effects ──
/**
 * One combo threshold step. 콤보는 누적식이다:
 *   "콤보 효과의 적용 방식도 누적식으로 변경되어, 스택 10을 달성한 콤보는 2부터 10까지의
 *    모든 효과를 합산하여 적용받는다" — namu.wiki/w/세피리아/아티팩트
 * The tier tables live in data/comboEffects.ts.
 */
export interface ComboTier {
  count: number
  text: string
}

// ── Board configuration ──
export interface BoardConfig {
  /** 칸별 인벤토리 레벨. 인덱스는 slot index. 없으면 전부 0. */
  cellLevels?: number[]
  /** 하얀 종이로 노리는 목표 콤보 슬러그. null이면 목표 없음. */
  targetCombo?: string | null
}

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

/** One material inside a 석판 합성 product. */
export interface FusedSource {
  /** Catalog tablet `value`. A fused tablet can never be a material — 재합성 불가. */
  value: string
  /**
   * Rotation chosen for this material at fusion time. A rotatable tablet may be turned
   * before it is combined, so 악수 turned 90° and fused with an upright 수확 makes a
   * cross rather than a single axis. Composes with the product's own rotation.
   * Always 0 for a 회전 불가 material.
   */
  rotation: 0 | 1 | 2 | 3
}

/**
 * 석판 합성 (Tablet Combiner) product. Holds its source tablets rather than a
 * flattened pattern, because complex applicators cannot be expressed as Effect[].
 *   "합성한 석판은 증감 영역, 레벨 증감량, 제약 무시 영역, 회전 제약, 배치 제약 등
 *    재료가 된 두 석판의 모든 효과를 계승한다" — namu.wiki/w/세피리아
 * Applying every source in turn reproduces that inheritance exactly: per-cell values
 * accumulate arithmetically — including opposite signs, which cancel — 제약 무시 cells
 * union, activation conditions AND, and rotation locks if any source locks.
 */
export interface FusedTabletEffect {
  type: 'fused'
  sources: FusedSource[] // exactly the two materials, in fusion order
}

export type TabletEffectDef =
  | SimpleTabletEffect
  | ComplexTabletEffect
  | FusedTabletEffect

/**
 * A user-built 석판 합성 product, kept in the palette so it can be placed repeatedly.
 * Materials are always catalog tablets: a 합성 석판 cannot be fused again.
 */
export interface FusedTabletRecipe {
  data: TabletData
  sources: FusedSource[]
}

// ── Placed items (instances on the grid) ──
export interface PlacedArtifact {
  instanceId: string
  type: 'ARTIFACT'
  data: ArtifactData
  /**
   * 인챈트 level. Every artifact starts at 0 and each in-game enchant adds +1.
   *   "별은 아티팩트의 레벨 상한을 나타내며, 기본 레벨은 0이고 인챈트와 석판의
   *    효과로 현재 레벨을 상한까지 올릴 수 있다" — namu.wiki/w/세피리아/아티팩트
   * `data.level` is the star cap, never a starting value.
   */
  level: number
  /** level + tablet bonus, clamped above at data.level. Below -1 the artifact is 무효. */
  currentLevel: number
  isLocked: boolean    // excluded from optimizer mutations
  /** Optimizer priority band. Default 'normal'. */
  priority: ArtifactPriority
  /** Target enhancement level. null = no explicit goal (pure level-sum optimization). */
  targetLevel: number | null
}

export interface PlacedTablet {
  instanceId: string
  type: 'TABLET'
  data: TabletData
  effectDef: TabletEffectDef
  rotation: 0 | 1 | 2 | 3 // 0=0°, 1=90°, 2=180°, 3=270°
  isCustom: boolean
  customEffects?: Effect[] // user-drawn effects for custom tablets
  /** The materials this tablet came out of, when it is a 석판 합성 product. */
  fusedFrom?: FusedSource[]
}

export type PlacedItem = PlacedArtifact | PlacedTablet

// ── Grid structure ──
export type GridSlot = PlacedItem | null

export interface GridRow {
  rowIndex: number
  cols: number // columns in this row (6 for full rows, ≤6 for last)
}

// ── Effect map: "row-col" → cumulative tablet level delta ──
export type EffectMap = Record<string, number>

/**
 * One full evaluation of the board.
 *
 * `constraintIgnore` holds the cells whose artifact `<제약>` is waived. Only three
 * tablets produce it — 고양, 이음, 환대 — matching the wiki's three tablet effect types:
 *   "석판의 효과는 아티팩트 레벨 증가, 아티팩트 레벨 감소, 아티팩트 제약 조건 무시
 *    3가지가 있으며" — namu.wiki/w/세피리아/석판
 * It never blocks another tablet's level effect; 고양 is described as
 *   "심플하게 아티팩트의 제약조건을 해소하는 기능만 있는 석판" (same page).
 */
export interface BoardEffects {
  effects: EffectMap
  constraintIgnore: Set<string>
}

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
  /** Capped level sum before optimizing. */
  beforeLevelSum: number
  /** Capped level sum after optimizing. */
  afterLevelSum: number
  /** Artifacts whose 목표 강화 was reached, out of the number that set one. */
  goalsMet: number
  goalsTotal: number
  /** Artifacts whose `<제약>` is satisfied or waived, out of the number that have one. */
  constraintsMet: number
  constraintsTotal: number
  /** 도달한 콤보 단계 수 총합 (최적화 후 보드 기준). */
  comboTiers: number
  /** targetCombo 가 설정됐을 때 그 콤보가 도달한 단계 수. 목표가 없으면 null. */
  targetComboTiers: number | null
  iterations: number
}

// ── Worker messages ──
export interface OptimizeRequest {
  type: 'start'
  slots: GridSlot[]
  gridRows: GridRow[]
  config: SAConfig
  /** 칸 레벨·목표 콤보. SAConfig 와 이름이 겹치지 않도록 board 로 둔다. */
  board: BoardConfig
}

export interface OptimizeProgress {
  type: 'progress'
  iteration: number
  /** Raw banded objective — for internal comparison only, never shown as-is. */
  bestScore: number
  /** Human-readable stand-ins for the banded score. */
  bestLevelSum: number
  bestGoalsMet: number
  /** 도달한 콤보 단계 수 총합 — totalComboTiers 참고. */
  bestComboTiers: number
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
}

// ── Upload phase ──
export type UploadPhase =
  | 'idle'
  | 'uploading'
  | 'recognizing'
  | 'validating'
  | 'complete'
  | 'error'

// ── Vision Worker (OpenCV.js Auto-Grid Detection) ──

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

export interface VisionMatchResult {
  row: number
  col: number
  matchedValue: string | null
  type: ItemType | null
  confidence: number
  rotation: 0 | 1 | 2 | 3
}

export type VisionRequest =
  | { type: 'init' }
  | { type: 'load-templates'; templates: TemplateData[] }
  | { type: 'detect'; buffer: ArrayBuffer; width: number; height: number }
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
  | 'complete'
  | 'fallback'
