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
        'relative flex h-[80px] w-[80px] cursor-pointer items-center justify-center',
        'rounded-inner border border-sephiria-border bg-sephiria-cell',
        'transition-transform duration-200 ease-seph',
        isOver && 'scale-105 border-sephiria-accent bg-sephiria-accent-soft',
        isDragging && 'opacity-40',
        !item && 'hover:bg-sephiria-grid',
      )}
      onClick={() => onClick?.(slotIndex)}
      onDoubleClick={() => onDoubleClick(slotIndex)}
      onContextMenu={(e) => onContextMenu(e, slotIndex)}
    >
      {item?.type === 'ARTIFACT' && (
        <ArtifactCard artifact={item} size="md" showLevel />
      )}
      {item?.type === 'TABLET' && (
        <TabletCard tablet={item} size="md" />
      )}

      {!item && (
        <div className="flex h-full w-full items-center justify-center">
          <span className="select-none text-xs tabular-nums text-sephiria-border">
            {slotIndex + 1}
          </span>
        </div>
      )}

      {lowConfidence && (
        <span className="pointer-events-none absolute right-0.5 top-0.5 z-[10] rounded bg-sephiria-confirm px-1 py-px text-[9px] font-bold leading-tight text-sephiria-confirm-fg">
          확인
        </span>
      )}

      <EffectOverlay effectValue={effectValue} item={item} />
    </div>
  )
}
