import { create } from 'zustand'
import type {
  GridSlot,
  GridRow,
  EffectMap,
  PlacedItem,
  PlacedArtifact,
  PlacedTablet,
  ArtifactData,
  ArtifactPriority,
  TabletData,
  Tier,
  FusedSource,
  FusedTabletRecipe,
  RecognitionResult,
  ItemType,
  OptimizeLastResult,
} from '@/types'
import { buildGridRows, slotToKey } from '@/lib/gridUtils'
import { calculateBoardEffects } from '@/lib/effectEngine'
import { finalLevelOf } from '@/lib/optimizerScore'
import { nextRotation } from '@/lib/rotationUtils'
import { getTabletEffect } from '@/data/tabletEffects'
import { ARTIFACT_MAP } from '@/data/artifacts'
import { TABLET_MAP } from '@/data/tablets'
import { generateId } from '@/lib/utils'
import { isLowConfidence } from '@/lib/vision/confidence'
import type { CellPrediction } from '@/lib/vision/types'

const DEFAULT_SLOT_NUM = 34

const TIER_RANK: Record<Tier, number> = {
  common: 0,
  advanced: 1,
  rare: 2,
  legend: 3,
  solid: 4,
}

/** Widening of RecognitionResult — extra fields are optional so the old call shape still type-checks. */
export interface RecognitionIngest extends RecognitionResult {
  rotation?: 0 | 1 | 2 | 3
  candidates?: CellPrediction['candidates']
}

export interface CellRecognitionMeta {
  matchedValue: string | null
  type: ItemType | null
  rotation: 0 | 1 | 2 | 3
  confidence: number
  candidates?: CellPrediction['candidates']
  lowConfidence: boolean
  overridden: boolean
}

export interface RecognitionPick {
  value: string
  type: ItemType
  rotation?: 0 | 1 | 2 | 3
}

interface InventoryState {
  // Grid
  slots: GridSlot[]
  slotNum: number
  gridRows: GridRow[]

  // Computed
  effectMap: EffectMap
  /** Cells whose artifact `<제약>` is waived by 고양 / 이음 / 환대. */
  constraintIgnore: Set<string>

  /**
   * 칸별 인벤토리 레벨. 길이는 항상 slotNum, 기본 0. 석판 효과가 아니라 칸에 각인된
   * 값이다:
   *   "인벤토리가 -12칸 줄어들지만, '석판 각인' 기능이 활성화 됩니다. 석판을 소모하여
   *    해당하는 인벤토리 칸에 효과를 남깁니다" — namu.wiki/w/세피리아/재능 (생존 20)
   *   친타마니 돌: "부서진 곳의 인벤토리 레벨 +3" — data/artifacts.json
   */
  cellLevels: number[]
  /** 하얀 종이로 노리는 목표 콤보 슬러그. null 이면 목표 없음. */
  targetCombo: string | null
  /** 그리드 셀 에디터가 열린 칸. null 이면 닫힘. */
  editorSlot: number | null

  // 석판 합성 products, available in the palette
  fusedTablets: FusedTabletRecipe[]

  // UI
  isOptimizing: boolean
  filterSet: string | 'all'
  filterTier: string | 'all'
  searchQuery: string
  /**
   * The whole board as it would look mid-drag. Kept as slots rather than an
   * EffectMap so the grid can preview 제약 무시 and 제약 미충족 too, not just levels.
   */
  dragPreviewSlots: GridSlot[] | null
  lastOptimize: OptimizeLastResult | null

  // Recognition confirm UI (Phase 4). Empty until a screenshot is applied.
  recognitionMeta: Record<number, CellRecognitionMeta>
  pickerSlot: number | null

  /**
   * Bumped by resetAll. Components holding their own local state — the uploader's
   * phase, the palette's filters — watch this to clear themselves, since the store
   * cannot reach into their useState.
   */
  resetToken: number

  // Actions
  setSlotNum: (num: number) => void
  placeItem: (item: PlacedItem, slotIndex: number) => void
  removeItem: (slotIndex: number) => void
  swapItems: (from: number, to: number) => void
  rotateTablet: (slotIndex: number) => void
  toggleLock: (slotIndex: number) => void
  recalculate: () => void
  setGridFromWorker: (slots: GridSlot[]) => void
  loadFromRecognition: (results: RecognitionIngest[]) => void
  setPickerSlot: (slot: number | null) => void
  overrideRecognizedCell: (slotIndex: number, pick: RecognitionPick | null) => void
  setOptimizing: (v: boolean) => void
  setFilterSet: (v: string) => void
  setFilterTier: (v: string) => void
  setSearchQuery: (v: string) => void
  setDragPreviewSlots: (slots: GridSlot[] | null) => void
  setLastOptimize: (result: OptimizeLastResult | null) => void
  clearGrid: () => void
  resetAll: () => void

  // 칸 레벨 / 목표 콤보 / 셀 에디터
  setCellLevel: (slotIndex: number, level: number) => void
  setTargetCombo: (slug: string | null) => void
  setEditorSlot: (slot: number | null) => void

  // 인챈트 / 우선순위 / 목표 강화
  setArtifactEnchant: (slotIndex: number, level: number) => void
  setArtifactPriority: (slotIndex: number, priority: ArtifactPriority) => void
  setArtifactTargetLevel: (slotIndex: number, target: number | null) => void
  resetArtifactGoals: () => void

  // 석판 합성
  addFusedTablet: (sources: FusedSource[], name: string) => FusedTabletRecipe | null
  removeFusedTablet: (value: string) => void

  // Helpers
  createArtifact: (data: ArtifactData, level: number) => PlacedArtifact
  createTablet: (
    data: TabletData,
    isCustom?: boolean,
    customEffects?: { dx: number; dy: number; value: number }[]
  ) => PlacedTablet
  createFusedTablet: (recipe: FusedTabletRecipe) => PlacedTablet
}

export const useInventoryStore = create<InventoryState>((set, get) => {
  const initialGridRows = buildGridRows(DEFAULT_SLOT_NUM)
  const initialSlots: GridSlot[] = new Array(DEFAULT_SLOT_NUM).fill(null)

  const placeRecognized = (
    _slotIndex: number,
    pick: RecognitionPick,
    level = 0
  ): GridSlot => {
    if (pick.type === 'ARTIFACT') {
      const data = ARTIFACT_MAP.get(pick.value)
      if (!data) return null
      // A screenshot carries no 인챈트 information, and every artifact starts at 0:
      //   "기본 레벨은 0이고 인챈트와 석판의 효과로 현재 레벨을 상한까지 올릴 수 있다"
      //   — namu.wiki/w/세피리아/아티팩트
      // The user sets their actual enchant count in the artifact list panel.
      return get().createArtifact(data, level > 0 ? level : 0)
    }
    const fused = get().fusedTablets.find((f) => f.data.value === pick.value)
    if (fused) return get().createFusedTablet(fused)
    const data = TABLET_MAP.get(pick.value)
    if (!data) return null
    const tablet = get().createTablet(data)
    const rotation = pick.rotation ?? 0
    return rotation ? { ...tablet, rotation } : tablet
  }

  const updateArtifact = (
    slotIndex: number,
    patch: (artifact: PlacedArtifact) => PlacedArtifact
  ) => {
    const slots = [...get().slots]
    const item = slots[slotIndex]
    if (!item || item.type !== 'ARTIFACT') return
    slots[slotIndex] = patch(item as PlacedArtifact)
    set({ slots })
    get().recalculate()
  }

  return {
    slots: initialSlots,
    slotNum: DEFAULT_SLOT_NUM,
    gridRows: initialGridRows,
    effectMap: {},
    constraintIgnore: new Set<string>(),
    cellLevels: new Array(DEFAULT_SLOT_NUM).fill(0),
    targetCombo: null,
    editorSlot: null,
    fusedTablets: [],
    isOptimizing: false,
    filterSet: 'all',
    filterTier: 'all',
    searchQuery: '',
    dragPreviewSlots: null,
    lastOptimize: null,
    recognitionMeta: {},
    pickerSlot: null,
    resetToken: 0,

    setSlotNum: (num: number) => {
      const clamped = Math.max(6, Math.min(60, num))
      const gridRows = buildGridRows(clamped)
      const oldSlots = get().slots
      const newSlots: GridSlot[] = new Array(clamped).fill(null)
      for (let i = 0; i < Math.min(oldSlots.length, clamped); i++) {
        newSlots[i] = oldSlots[i]
      }
      // 칸 레벨도 slots 와 같은 방식으로 리사이즈: 앞부분 보존, 새 칸은 0.
      const oldCellLevels = get().cellLevels
      const cellLevels: number[] = new Array(clamped).fill(0)
      for (let i = 0; i < Math.min(oldCellLevels.length, clamped); i++) {
        cellLevels[i] = oldCellLevels[i]
      }
      const recognitionMeta = { ...get().recognitionMeta }
      for (const key of Object.keys(recognitionMeta)) {
        if (Number(key) >= clamped) delete recognitionMeta[Number(key)]
      }
      set({ slotNum: clamped, gridRows, slots: newSlots, cellLevels, recognitionMeta })
      get().recalculate()
    },

    placeItem: (item: PlacedItem, slotIndex: number) => {
      const slots = [...get().slots]
      if (slotIndex < 0 || slotIndex >= slots.length) return
      slots[slotIndex] = item
      const recognitionMeta = { ...get().recognitionMeta }
      if (recognitionMeta[slotIndex]) {
        recognitionMeta[slotIndex] = {
          ...recognitionMeta[slotIndex],
          matchedValue: item.data.value,
          type: item.type,
          lowConfidence: false,
          overridden: true,
        }
      }
      set({ slots, recognitionMeta })
      get().recalculate()
    },

    removeItem: (slotIndex: number) => {
      const slots = [...get().slots]
      if (slotIndex < 0 || slotIndex >= slots.length) return
      slots[slotIndex] = null
      const recognitionMeta = { ...get().recognitionMeta }
      if (recognitionMeta[slotIndex]) {
        recognitionMeta[slotIndex] = {
          ...recognitionMeta[slotIndex],
          matchedValue: null,
          type: null,
          lowConfidence: false,
          overridden: true,
        }
      }
      set({ slots, recognitionMeta })
      get().recalculate()
    },

    swapItems: (from: number, to: number) => {
      const slots = [...get().slots]
      if (from < 0 || from >= slots.length || to < 0 || to >= slots.length) return
      const temp = slots[from]
      slots[from] = slots[to]
      slots[to] = temp
      const recognitionMeta = { ...get().recognitionMeta }
      const a = recognitionMeta[from]
      const b = recognitionMeta[to]
      if (a || b) {
        if (b) recognitionMeta[from] = b
        else delete recognitionMeta[from]
        if (a) recognitionMeta[to] = a
        else delete recognitionMeta[to]
      }
      set({ slots, recognitionMeta })
      get().recalculate()
    },

    rotateTablet: (slotIndex: number) => {
      const slots = [...get().slots]
      const item = slots[slotIndex]
      if (!item || item.type !== 'TABLET') return
      const tablet = item as PlacedTablet
      if (!tablet.data.rotate) return
      slots[slotIndex] = { ...tablet, rotation: nextRotation(tablet.rotation) }
      set({ slots })
      get().recalculate()
    },

    toggleLock: (slotIndex: number) => {
      const slots = [...get().slots]
      const item = slots[slotIndex]
      if (!item || item.type !== 'ARTIFACT') return
      const artifact = item as PlacedArtifact
      slots[slotIndex] = { ...artifact, isLocked: !artifact.isLocked }
      set({ slots })
    },

    recalculate: () => {
      const { slots, gridRows, cellLevels } = get()
      const { effects, constraintIgnore } = calculateBoardEffects(slots, gridRows)
      const nextSlots = slots.map((item, index) => {
        if (!item || item.type !== 'ARTIFACT') return item
        const key = slotToKey(index, gridRows)
        // 칸 레벨은 쉴드 적용이 끝난 석판 델타 위에 더한다 — 석판 효과가 아니므로
        // applyTabletShield 의 대상이 아니다 (lib/optimizerScore.ts 참고).
        const bonus = (effects[key] ?? 0) + (cellLevels[index] ?? 0)
        const currentLevel = finalLevelOf(item, bonus)
        if (item.currentLevel === currentLevel) return item
        return { ...item, currentLevel }
      })
      set({ effectMap: effects, constraintIgnore, slots: nextSlots })
    },

    setGridFromWorker: (newSlots: GridSlot[]) => {
      set({ slots: newSlots })
      get().recalculate()
    },

    loadFromRecognition: (results: RecognitionIngest[]) => {
      const slots: GridSlot[] = new Array(get().slotNum).fill(null)
      const recognitionMeta: Record<number, CellRecognitionMeta> = {}

      for (const res of results) {
        if (res.slotIndex >= slots.length) continue
        const rotation = res.rotation ?? 0
        recognitionMeta[res.slotIndex] = {
          matchedValue: res.matchedValue,
          type: res.type,
          rotation,
          confidence: res.confidence,
          candidates: res.candidates,
          lowConfidence: isLowConfidence({
            matchedValue: res.matchedValue,
            confidence: res.confidence,
            candidates: res.candidates,
          }),
          overridden: false,
        }

        if (res.type && res.matchedValue) {
          slots[res.slotIndex] = placeRecognized(
            res.slotIndex,
            { value: res.matchedValue, type: res.type, rotation },
            res.level
          )
        }
      }

      set({ slots, recognitionMeta, pickerSlot: null })
      get().recalculate()
    },

    setPickerSlot: (slot) => set({ pickerSlot: slot }),

    overrideRecognizedCell: (slotIndex, pick) => {
      const slots = [...get().slots]
      if (slotIndex < 0 || slotIndex >= slots.length) return
      const prev = get().recognitionMeta[slotIndex]
      const nextMeta: CellRecognitionMeta = {
        matchedValue: pick?.value ?? null,
        type: pick?.type ?? null,
        rotation: pick?.rotation ?? 0,
        confidence: prev?.confidence ?? 1,
        candidates: prev?.candidates,
        lowConfidence: false,
        overridden: true,
      }
      slots[slotIndex] = pick ? placeRecognized(slotIndex, pick) : null
      set({
        slots,
        recognitionMeta: { ...get().recognitionMeta, [slotIndex]: nextMeta },
        pickerSlot: null,
      })
      get().recalculate()
    },

    setOptimizing: (v) => set({ isOptimizing: v }),
    setFilterSet: (v) => set({ filterSet: v }),
    setFilterTier: (v) => set({ filterTier: v }),
    setSearchQuery: (v) => set({ searchQuery: v }),
    setDragPreviewSlots: (previewSlots) => set({ dragPreviewSlots: previewSlots }),
    setLastOptimize: (result) => set({ lastOptimize: result }),

    // ── 칸 레벨 / 목표 콤보 / 셀 에디터 ──

    setCellLevel: (slotIndex, level) => {
      const cellLevels = [...get().cellLevels]
      if (slotIndex < 0 || slotIndex >= cellLevels.length) return
      cellLevels[slotIndex] = Math.max(-9, Math.min(9, level))
      set({ cellLevels })
      get().recalculate()
    },

    setTargetCombo: (slug) => set({ targetCombo: slug }),
    setEditorSlot: (slot) => set({ editorSlot: slot }),

    clearGrid: () => {
      const slots: GridSlot[] = new Array(get().slotNum).fill(null)
      // cellLevels 는 유지한다 — 칸에 각인된 값은 아이템이 아니라 보드의 속성이다
      // ("석판을 소모하여 해당하는 인벤토리 칸에 효과를 남깁니다"
      //  — namu.wiki/w/세피리아/재능). 목표 콤보와 셀 에디터는 초기화.
      set({
        slots,
        effectMap: {},
        constraintIgnore: new Set<string>(),
        targetCombo: null,
        editorSlot: null,
        recognitionMeta: {},
        pickerSlot: null,
      })
    },

    /**
     * Back to a first-load board: no items, no recognition, no goals, no 합성 석판,
     * default slot count. Callers must block this while the optimizer is running —
     * the worker owns a snapshot of the old board and would write it back on finish.
     */
    resetAll: () => {
      set({
        slots: new Array(DEFAULT_SLOT_NUM).fill(null),
        slotNum: DEFAULT_SLOT_NUM,
        gridRows: buildGridRows(DEFAULT_SLOT_NUM),
        effectMap: {},
        constraintIgnore: new Set<string>(),
        cellLevels: new Array(DEFAULT_SLOT_NUM).fill(0),
        targetCombo: null,
        editorSlot: null,
        fusedTablets: [],
        isOptimizing: false,
        filterSet: 'all',
        filterTier: 'all',
        searchQuery: '',
        dragPreviewSlots: null,
        lastOptimize: null,
        recognitionMeta: {},
        pickerSlot: null,
        resetToken: get().resetToken + 1,
      })
    },

    // ── 인챈트 / 우선순위 / 목표 강화 ──

    setArtifactEnchant: (slotIndex, level) => {
      updateArtifact(slotIndex, (artifact) => {
        const capped = Math.max(0, Math.min(level, artifact.data.level ?? 0))
        return { ...artifact, level: capped }
      })
    },

    setArtifactPriority: (slotIndex, priority) => {
      updateArtifact(slotIndex, (artifact) =>
        // 제외 항목은 강화 목표를 갖지 않는다 — 세트 효과만 받으면 충분한 아이템이다.
        priority === 'exclude'
          ? { ...artifact, priority, targetLevel: null }
          : { ...artifact, priority }
      )
    },

    setArtifactTargetLevel: (slotIndex, target) => {
      updateArtifact(slotIndex, (artifact) => {
        if (target === null) return { ...artifact, targetLevel: null }
        const cap = artifact.data.level ?? 0
        const clamped = Math.max(0, Math.min(target, cap))
        return {
          ...artifact,
          targetLevel: clamped,
          priority: artifact.priority === 'exclude' ? 'normal' : artifact.priority,
        }
      })
    },

    resetArtifactGoals: () => {
      const slots = get().slots.map((item) => {
        if (!item || item.type !== 'ARTIFACT') return item
        const artifact = item as PlacedArtifact
        if (artifact.priority === 'normal' && artifact.targetLevel === null) return item
        return { ...artifact, priority: 'normal' as const, targetLevel: null }
      })
      set({ slots })
      get().recalculate()
    },

    // ── 석판 합성 ──

    addFusedTablet: (sources, name) => {
      // 재합성 불가: a 합성 석판 is never a material, so every source must be a catalog
      // tablet. Anything else is rejected rather than silently flattened.
      if (sources.length !== 2) return null
      const materials = sources.map((source) => {
        const data = TABLET_MAP.get(source.value)
        if (!data) return null
        // A 회전 불가 material cannot be turned before it is combined.
        const rotation = data.rotate === true ? source.rotation : 0
        return { data, source: { value: source.value, rotation } }
      })
      if (materials.some((m) => m === null)) return null
      const parts = materials as NonNullable<(typeof materials)[number]>[]

      const tier = parts.reduce<Tier>(
        (acc, p) => (TIER_RANK[p.data.tier] > TIER_RANK[acc] ? p.data.tier : acc),
        'common'
      )
      // 회전 제약도 계승된다 — one locked material locks the product.
      const rotate = parts.every((p) => p.data.rotate === true)

      const data: TabletData = {
        value: `fused_${generateId()}`,
        ko_label: name.trim() || parts.map((p) => p.data.ko_label).join('+'),
        eng_label: 'fused',
        tier,
        image: parts[0]?.data.image ?? '',
        ...(rotate ? { rotate: true } : {}),
      }

      const recipe: FusedTabletRecipe = { data, sources: parts.map((p) => p.source) }
      set({ fusedTablets: [...get().fusedTablets, recipe] })
      return recipe
    },

    removeFusedTablet: (value) => {
      set({ fusedTablets: get().fusedTablets.filter((f) => f.data.value !== value) })
    },

    // ── Factories ──

    createArtifact: (data: ArtifactData, level: number): PlacedArtifact => {
      const capped = Math.max(0, Math.min(level, data.level))
      return {
        instanceId: generateId(),
        type: 'ARTIFACT',
        data,
        level: capped,
        currentLevel: capped,
        isLocked: false,
        priority: 'normal',
        targetLevel: null,
      }
    },

    createTablet: (data: TabletData, isCustom = false, customEffects): PlacedTablet => {
      const effectDef = getTabletEffect(data.value) ?? { type: 'simple' as const, effects: [] }
      return {
        instanceId: generateId(),
        type: 'TABLET',
        data,
        effectDef,
        rotation: 0,
        isCustom,
        customEffects,
      }
    },

    createFusedTablet: (recipe: FusedTabletRecipe): PlacedTablet => ({
      instanceId: generateId(),
      type: 'TABLET',
      data: recipe.data,
      effectDef: { type: 'fused', sources: recipe.sources },
      rotation: 0,
      isCustom: false,
      fusedFrom: recipe.sources,
    }),
  }
})
