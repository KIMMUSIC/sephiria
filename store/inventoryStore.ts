import { create } from 'zustand'
import type {
  GridSlot,
  GridRow,
  EffectMap,
  PlacedItem,
  PlacedArtifact,
  PlacedTablet,
  ArtifactData,
  TabletData,
  RecognitionResult,
  ItemType,
  OptimizeLastResult,
} from '@/types'
import { buildGridRows, slotToKey } from '@/lib/gridUtils'
import { calculateEffectsWithShield } from '@/lib/effectEngine'
import { nextRotation } from '@/lib/rotationUtils'
import { getTabletEffect } from '@/data/tabletEffects'
import { ARTIFACT_MAP } from '@/data/artifacts'
import { TABLET_MAP } from '@/data/tablets'
import { generateId } from '@/lib/utils'
import { isLowConfidence } from '@/lib/vision/confidence'
import type { CellPrediction } from '@/lib/vision/types'

const DEFAULT_SLOT_NUM = 34

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

  // UI
  isOptimizing: boolean
  filterSet: string | 'all'
  filterTier: string | 'all'
  searchQuery: string
  dragPreviewEffects: EffectMap | null
  lastOptimize: OptimizeLastResult | null

  // Recognition confirm UI (Phase 4). Empty until a screenshot is applied.
  recognitionMeta: Record<number, CellRecognitionMeta>
  pickerSlot: number | null

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
  setDragPreviewEffects: (effects: EffectMap | null) => void
  setLastOptimize: (result: OptimizeLastResult | null) => void
  clearGrid: () => void

  // Helpers
  createArtifact: (data: ArtifactData, level: number) => PlacedArtifact
  createTablet: (
    data: TabletData,
    isCustom?: boolean,
    customEffects?: { dx: number; dy: number; value: number }[]
  ) => PlacedTablet
}

export const useInventoryStore = create<InventoryState>((set, get) => {
  const initialGridRows = buildGridRows(DEFAULT_SLOT_NUM)
  const initialSlots: GridSlot[] = new Array(DEFAULT_SLOT_NUM).fill(null)

  const placeRecognized = (
    slotIndex: number,
    pick: RecognitionPick,
    level = 0
  ): GridSlot => {
    if (pick.type === 'ARTIFACT') {
      const data = ARTIFACT_MAP.get(pick.value)
      return data ? get().createArtifact(data, level) : null
    }
    const data = TABLET_MAP.get(pick.value)
    if (!data) return null
    const tablet = get().createTablet(data)
    const rotation = pick.rotation ?? 0
    return rotation ? { ...tablet, rotation } : tablet
  }

  return {
    slots: initialSlots,
    slotNum: DEFAULT_SLOT_NUM,
    gridRows: initialGridRows,
    effectMap: {},
    isOptimizing: false,
    filterSet: 'all',
    filterTier: 'all',
    searchQuery: '',
    dragPreviewEffects: null,
    lastOptimize: null,
    recognitionMeta: {},
    pickerSlot: null,

    setSlotNum: (num: number) => {
      const clamped = Math.max(6, Math.min(60, num))
      const gridRows = buildGridRows(clamped)
      const oldSlots = get().slots
      const newSlots: GridSlot[] = new Array(clamped).fill(null)
      for (let i = 0; i < Math.min(oldSlots.length, clamped); i++) {
        newSlots[i] = oldSlots[i]
      }
      const recognitionMeta = { ...get().recognitionMeta }
      for (const key of Object.keys(recognitionMeta)) {
        if (Number(key) >= clamped) delete recognitionMeta[Number(key)]
      }
      set({ slotNum: clamped, gridRows, slots: newSlots, recognitionMeta })
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
      const { slots, gridRows } = get()
      const effectMap = calculateEffectsWithShield(slots, gridRows)
      const nextSlots = slots.map((item, index) => {
        if (!item || item.type !== 'ARTIFACT') return item
        const key = slotToKey(index, gridRows)
        const cell = effectMap[key]
        const bonus = typeof cell === 'number' ? cell : 0
        const currentLevel = item.level + bonus
        if (item.currentLevel === currentLevel) return item
        return { ...item, currentLevel }
      })
      set({ effectMap, slots: nextSlots })
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
          // PLAN/07 E-3: screenshots carry no HUD level (res.level 0).
          // Default artifacts to catalog max so the optimizer does not treat
          // a fresh recognition as destroyed.
          let ingestLevel = res.level
          if (res.type === 'ARTIFACT' && !(res.level > 0)) {
            const artifactData = ARTIFACT_MAP.get(res.matchedValue)
            if (artifactData) ingestLevel = artifactData.level
          }
          slots[res.slotIndex] = placeRecognized(
            res.slotIndex,
            { value: res.matchedValue, type: res.type, rotation },
            ingestLevel
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
    setDragPreviewEffects: (effects) => set({ dragPreviewEffects: effects }),
    setLastOptimize: (result) => set({ lastOptimize: result }),

    clearGrid: () => {
      const slots: GridSlot[] = new Array(get().slotNum).fill(null)
      set({ slots, effectMap: {}, recognitionMeta: {}, pickerSlot: null })
    },

    createArtifact: (data: ArtifactData, level: number): PlacedArtifact => ({
      instanceId: generateId(),
      type: 'ARTIFACT',
      data,
      level: Math.min(level, data.level),
      currentLevel: level,
      isLocked: false,
    }),

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
  }
})
