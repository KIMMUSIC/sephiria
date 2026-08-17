'use client'

import { useState, useCallback } from 'react'
import type { DragStartEvent, DragOverEvent, DragEndEvent } from '@dnd-kit/core'
import { useInventoryStore } from '@/store/inventoryStore'
import type { ArtifactData, FusedTabletRecipe, TabletData } from '@/types'

interface DragPayload {
  source: 'palette' | 'grid'
  slotIndex?: number
  itemData?: ArtifactData | TabletData
  itemType?: 'ARTIFACT' | 'TABLET'
  level?: number
  /** Present when the dragged tablet is a 석판 합성 product from the palette. */
  fusedRecipe?: FusedTabletRecipe
}

export interface UseDragAndDropReturn {
  handleDragStart: (event: DragStartEvent) => void
  handleDragOver: (event: DragOverEvent) => void
  handleDragEnd: (event: DragEndEvent) => void
  activeId: string | null
}

export function useDragAndDrop(): UseDragAndDropReturn {
  const [activeId, setActiveId] = useState<string | null>(null)

  const {
    slots,
    gridRows,
    placeItem,
    swapItems,
    createArtifact,
    createTablet,
    createFusedTablet,
    setDragPreviewSlots,
  } = useInventoryStore()

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      setActiveId(String(event.active.id))

      const activeData = event.active.data.current as DragPayload

      if (activeData.source === 'palette' && activeData.itemData && activeData.itemType) {
        // Calculate preview effects for the palette item placed at slot 0 as a baseline
        // Real preview updates happen in handleDragOver
        setDragPreviewSlots(null)
      }
    },
    [setDragPreviewSlots]
  )

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event

      if (!over) {
        setDragPreviewSlots(null)
        return
      }

      const activeData = active.data.current as DragPayload

      const overData = over.data.current as { slotIndex: number }
      const targetSlot = overData?.slotIndex

      if (targetSlot === undefined || targetSlot === null) {
        setDragPreviewSlots(null)
        return
      }

      if (activeData.source === 'palette' && activeData.itemData && activeData.itemType) {
        // Build a preview grid with the palette item placed at the target slot
        const previewSlots = [...slots]
        let previewItem = null

        if (activeData.itemType === 'ARTIFACT') {
          previewItem = createArtifact(activeData.itemData as ArtifactData, activeData.level ?? 0)
        } else if (activeData.itemType === 'TABLET') {
          previewItem = activeData.fusedRecipe
            ? createFusedTablet(activeData.fusedRecipe)
            : createTablet(activeData.itemData as TabletData)
        }

        if (previewItem) {
          previewSlots[targetSlot] = previewItem
          setDragPreviewSlots(previewSlots)
        }
      } else if (activeData.source === 'grid' && activeData.slotIndex !== undefined) {
        // Build a preview grid with the swap applied
        const fromSlot = activeData.slotIndex
        if (fromSlot === targetSlot) {
          setDragPreviewSlots(null)
          return
        }
        const previewSlots = [...slots]
        const temp = previewSlots[fromSlot]
        previewSlots[fromSlot] = previewSlots[targetSlot]
        previewSlots[targetSlot] = temp
        setDragPreviewSlots(previewSlots)
      }
    },
    [slots, createArtifact, createTablet, createFusedTablet, setDragPreviewSlots]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null)
      setDragPreviewSlots(null)

      const { active, over } = event
      if (!over) return

      const activeData = active.data.current as DragPayload

      const overData = over.data.current as { slotIndex: number }
      const targetSlot = overData?.slotIndex

      if (targetSlot === undefined || targetSlot === null) return

      if (activeData.source === 'palette') {
        // Palette → grid empty slot: create and place
        if (activeData.itemType === 'ARTIFACT' && activeData.itemData) {
          const artifact = createArtifact(
            activeData.itemData as ArtifactData,
            activeData.level ?? 0
          )
          placeItem(artifact, targetSlot)
        } else if (activeData.itemType === 'TABLET' && activeData.itemData) {
          const tablet = activeData.fusedRecipe
            ? createFusedTablet(activeData.fusedRecipe)
            : createTablet(activeData.itemData as TabletData)
          placeItem(tablet, targetSlot)
        }
      } else if (activeData.source === 'grid') {
        const fromSlot = activeData.slotIndex
        if (fromSlot === undefined || fromSlot === targetSlot) return
        swapItems(fromSlot, targetSlot)
      }
    },
    [createArtifact, createTablet, createFusedTablet, placeItem, swapItems, setDragPreviewSlots]
  )

  return { handleDragStart, handleDragOver, handleDragEnd, activeId }
}
