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
  TabletEffectDef,
  RecognitionResult,
  OptimizeLastResult,
} from '@/types'
import { buildGridRows, slotToPosition, slotToKey } from '@/lib/gridUtils'
import { calculateEffectsWithShield } from '@/lib/effectEngine'
import { nextRotation } from '@/lib/rotationUtils'
import { getTabletEffect } from '@/data/tabletEffects'
import { ARTIFACT_MAP } from '@/data/artifacts'
import { TABLET_MAP } from '@/data/tablets'
import { generateId } from '@/lib/utils'

const DEFAULT_SLOT_NUM = 34

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

  // Actions
  setSlotNum: (num: number) => void
  placeItem: (item: PlacedItem, slotIndex: number) => void
  removeItem: (slotIndex: number) => void
  swapItems: (from: number, to: number) => void
  rotateTablet: (slotIndex: number) => void
  toggleLock: (slotIndex: number) => void
  recalculate: () => void
  setGridFromWorker: (slots: GridSlot[]) => void
  loadFromRecognition: (results: RecognitionResult[]) => void
  setOptimizing: (v: boolean) => void
  setFilterSet: (v: string) => void
  setFilterTier: (v: string) => void
  setSearchQuery: (v: string) => void
  setDragPreviewEffects: (effects: EffectMap | null) => void
  setLastOptimize: (result: OptimizeLastResult | null) => void
  clearGrid: () => void

  // Helpers
  createArtifact: (data: ArtifactData, level: number) => PlacedArtifact
  createTablet: (data: TabletData, isCustom?: boolean, customEffects?: { dx: number; dy: number; value: number }[]) => PlacedTablet
}

export const useInventoryStore = create<InventoryState>((set, get) => {
  const initialGridRows = buildGridRows(DEFAULT_SLOT_NUM)
  const initialSlots: GridSlot[] = new Array(DEFAULT_SLOT_NUM).fill(null)

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

    setSlotNum: (num: number) => {
      const clamped = Math.max(6, Math.min(60, num))
      const gridRows = buildGridRows(clamped)
      const oldSlots = get().slots
      const newSlots: GridSlot[] = new Array(clamped).fill(null)
      // Preserve items that fit in the new grid
      for (let i = 0; i < Math.min(oldSlots.length, clamped); i++) {
        newSlots[i] = oldSlots[i]
      }
      set({ slotNum: clamped, gridRows, slots: newSlots })
      get().recalculate()
    },

    placeItem: (item: PlacedItem, slotIndex: number) => {
      const slots = [...get().slots]
      if (slotIndex < 0 || slotIndex >= slots.length) return
      slots[slotIndex] = item
      set({ slots })
      get().recalculate()
    },

    removeItem: (slotIndex: number) => {
      const slots = [...get().slots]
      if (slotIndex < 0 || slotIndex >= slots.length) return
      slots[slotIndex] = null
      set({ slots })
      get().recalculate()
    },

    swapItems: (from: number, to: number) => {
      const slots = [...get().slots]
      if (from < 0 || from >= slots.length || to < 0 || to >= slots.length) return
      const temp = slots[from]
      slots[from] = slots[to]
      slots[to] = temp
      set({ slots })
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

    loadFromRecognition: (results: RecognitionResult[]) => {
      const slots: GridSlot[] = new Array(get().slotNum).fill(null)

      for (const res of results) {
        if (res.slotIndex >= slots.length) continue

        if (res.type === 'ARTIFACT' && res.matchedValue) {
          const artifactData = ARTIFACT_MAP.get(res.matchedValue)
          if (artifactData) {
            // Screenshots carry no HUD level (res.level 0). Default current
            // enhance to catalog max so the optimizer does not treat the
            // board as destroyed. data.level remains the max cap.
            const level = res.level > 0 ? res.level : artifactData.level
            slots[res.slotIndex] = get().createArtifact(artifactData, level)
          }
        } else if (res.type === 'TABLET' && res.matchedValue) {
          const tabletData = TABLET_MAP.get(res.matchedValue)
          if (tabletData) {
            const tablet = get().createTablet(tabletData)
            slots[res.slotIndex] = res.rotation !== undefined
              ? { ...tablet, rotation: res.rotation }
              : tablet
          }
        }
      }

      set({ slots })
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
      set({ slots, effectMap: {} })
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
