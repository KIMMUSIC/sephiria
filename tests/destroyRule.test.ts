import { beforeEach, describe, expect, it } from 'vitest'
import { ARTIFACT_MAP } from '@/data/artifacts'
import { positionToSlot } from '@/lib/gridUtils'
import {
  DESTRUCTION_SCORE,
  evaluateBoard,
  isArtifactDestroyed,
} from '@/lib/optimizerScore'
import { useInventoryStore } from '@/store/inventoryStore'
import type { ArtifactData, PlacedArtifact, PlacedTablet } from '@/types'

function minusOneTablet(): PlacedTablet {
  return {
    instanceId: 't-minus-1',
    type: 'TABLET',
    data: {
      value: 'advent',
      ko_label: 'advent',
      eng_label: 'advent',
      tier: 'rare',
      image: '',
      rotate: true,
    },
    effectDef: { type: 'simple', effects: [{ dx: 0, dy: 1, value: -1 }] },
    rotation: 0,
    isCustom: false,
  }
}

function dummyArtifactData(maxLevel: number): ArtifactData {
  return {
    id: 1,
    value: 'dummy',
    label_kor: 'dummy',
    label_eng: 'dummy',
    tier: 'common',
    level: maxLevel,
    image: '',
    effect: { sets: [], content: '' },
    description: '',
  }
}

describe('isArtifactDestroyed', () => {
  it('treats level 0 as alive and -1 as destroyed', () => {
    expect(isArtifactDestroyed(1)).toBe(false)
    expect(isArtifactDestroyed(0)).toBe(false)
    expect(isArtifactDestroyed(-1)).toBe(true)
  })
})

describe('destroy rule via recognition + effects', () => {
  beforeEach(() => {
    const store = useInventoryStore.getState()
    store.setSlotNum(34)
    store.clearGrid()
  })

  it('places a level-0 catalog artifact via loadFromRecognition as alive', () => {
    const smoke = ARTIFACT_MAP.get('smoke_screen')
    expect(smoke?.level).toBe(0)

    useInventoryStore.getState().loadFromRecognition([
      {
        slotIndex: 0,
        matchedValue: 'smoke_screen',
        type: 'ARTIFACT',
        level: 0,
        confidence: 1,
      },
    ])

    const { slots, gridRows } = useInventoryStore.getState()
    const placed = slots[0] as PlacedArtifact
    expect(placed.type).toBe('ARTIFACT')
    expect(placed.data.value).toBe('smoke_screen')
    expect(placed.level).toBe(0)
    expect(placed.currentLevel).toBe(0)
    expect(isArtifactDestroyed(placed.currentLevel)).toBe(false)
    expect(evaluateBoard(slots, gridRows)).not.toBe(DESTRUCTION_SCORE)
  })

  it('keeps a base-1 artifact alive at currentLevel 0 after a -1 tablet effect', () => {
    const store = useInventoryStore.getState()
    const artSlot = positionToSlot(3, 2, store.gridRows)
    const tabSlot = positionToSlot(2, 2, store.gridRows)
    expect(artSlot).not.toBeNull()
    expect(tabSlot).not.toBeNull()

    store.placeItem(store.createArtifact(dummyArtifactData(5), 1), artSlot!)
    store.placeItem(minusOneTablet(), tabSlot!)

    const placed = useInventoryStore.getState().slots[artSlot!] as PlacedArtifact
    expect(placed.level).toBe(1)
    expect(placed.currentLevel).toBe(0)
    expect(isArtifactDestroyed(placed.currentLevel)).toBe(false)

    const { slots, gridRows } = useInventoryStore.getState()
    expect(evaluateBoard(slots, gridRows)).not.toBe(DESTRUCTION_SCORE)
    expect(Math.floor(evaluateBoard(slots, gridRows))).toBe(0)
  })

  it('destroys at currentLevel -1 and applies the evaluateBoard penalty', () => {
    const store = useInventoryStore.getState()
    const artSlot = positionToSlot(3, 2, store.gridRows)
    const tabSlot = positionToSlot(2, 2, store.gridRows)
    expect(artSlot).not.toBeNull()
    expect(tabSlot).not.toBeNull()

    store.placeItem(store.createArtifact(dummyArtifactData(5), 0), artSlot!)
    store.placeItem(minusOneTablet(), tabSlot!)

    const placed = useInventoryStore.getState().slots[artSlot!] as PlacedArtifact
    expect(placed.level).toBe(0)
    expect(placed.currentLevel).toBe(-1)
    expect(isArtifactDestroyed(placed.currentLevel)).toBe(true)

    const { slots, gridRows } = useInventoryStore.getState()
    expect(evaluateBoard(slots, gridRows)).toBe(DESTRUCTION_SCORE)
  })

  // A screenshot carries no 인챈트 information and every artifact starts at 0:
  //   "기본 레벨은 0이고 인챈트와 석판의 효과로 현재 레벨을 상한까지 올릴 수 있다"
  //   — namu.wiki/w/세피리아/아티팩트
  // The catalog `level` is the star cap, not a starting value.
  it('overrideRecognizedCell ingests enchant 0; the catalog level stays a cap', () => {
    const necklace = ARTIFACT_MAP.get('eye_crystal_necklace')
    const smoke = ARTIFACT_MAP.get('smoke_screen')
    expect(necklace).toBeDefined()
    expect(necklace!.level).toBeGreaterThan(0)
    expect(smoke?.level).toBe(0)

    useInventoryStore.getState().overrideRecognizedCell(0, {
      value: 'eye_crystal_necklace',
      type: 'ARTIFACT',
    })
    const normal = useInventoryStore.getState().slots[0] as PlacedArtifact
    expect(normal.data.value).toBe('eye_crystal_necklace')
    expect(normal.level).toBe(0)
    expect(normal.currentLevel).toBe(0)
    expect(normal.data.level).toBe(necklace!.level)
    expect(isArtifactDestroyed(normal.currentLevel)).toBe(false)

    useInventoryStore.getState().overrideRecognizedCell(1, {
      value: 'smoke_screen',
      type: 'ARTIFACT',
    })
    const unique = useInventoryStore.getState().slots[1] as PlacedArtifact
    expect(unique.data.value).toBe('smoke_screen')
    expect(unique.level).toBe(0)
    expect(unique.currentLevel).toBe(0)
    expect(isArtifactDestroyed(unique.currentLevel)).toBe(false)
  })
})
