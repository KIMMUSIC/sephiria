'use client'

import { useDroppable, useDraggable } from '@dnd-kit/core'
import { cn } from '@/lib/utils'
import ArtifactCard from '@/components/items/ArtifactCard'
import TabletCard from '@/components/items/TabletCard'
import EffectOverlay from '@/components/grid/EffectOverlay'
import type { GridSlot } from '@/types'

interface GridCellProps {
  slotIndex: number
  item: GridSlot
  effectValue: number | 'ignore' | undefined
  onDoubleClick: (slotIndex: number) => void
  onContextMenu: (e: React.MouseEvent, slotIndex: number) => void
  onClick?: (slotIndex: number) => void
  lowConfidence?: boolean
}

export default function GridCell({
  slotIndex,
  item,
  effectValue,
  onDoubleClick,
  onContextMenu,
  onClick,
  lowConfidence,
}: GridCellProps) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `cell-${slotIndex}`,
    data: { slotIndex },
  })

  const { setNodeRef: setDragRef, attributes, listeners, isDragging } = useDraggable({
    id: `drag-cell-${slotIndex}`,
    disabled: !item,
    data: { source: 'grid', slotIndex },
  })

  // Merge droppable + draggable refs
  const setRef = (node: HTMLDivElement | null) => {
    setDropRef(node)
    setDragRef(node)
  }

  return (
    <div
      ref={setRef}
      {...attributes}
      {...listeners}
      className={cn(
        'relative bg-sephiria-cell border border-sephiria-border rounded-md',
        'w-[80px] h-[80px] flex items-center justify-center cursor-pointer',
        'transition-all duration-100',
        isOver && 'border-sephiria-accent bg-sephiria-accent/20 scale-105',
        isDragging && 'opacity-40',
        !item && 'hover:bg-sephiria-grid',
      )}
      onClick={() => onClick?.(slotIndex)}
      onDoubleClick={() => onDoubleClick(slotIndex)}
      onContextMenu={(e) => onContextMenu(e, slotIndex)}
    >
      {/* Item content */}
      {item?.type === 'ARTIFACT' && (
        <ArtifactCard artifact={item} size="md" showLevel />
      )}
      {item?.type === 'TABLET' && (
        <TabletCard tablet={item} size="md" />
      )}

      {/* Empty cell indicator */}
      {!item && (
        <div className="w-full h-full flex items-center justify-center">
          <span className="text-sephiria-border/40 text-xs select-none">{slotIndex + 1}</span>
        </div>
      )}

      {lowConfidence && (
        <span className="absolute top-0.5 right-0.5 z-10 rounded bg-yellow-500 px-1 py-px text-[9px] font-bold leading-tight text-black pointer-events-none">
          확인
        </span>
      )}

      {/* Effect overlay */}
      <EffectOverlay effectValue={effectValue} item={item} />
    </div>
  )
}
