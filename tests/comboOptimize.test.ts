import { describe, expect, it } from 'vitest'
import { buildGridRows, positionToSlot } from '@/lib/gridUtils'
import { comboCounts, WHITE_PAPER_VALUE } from '@/lib/comboEngine'
import { buildScoreWeights, evaluateBoard } from '@/lib/optimizerScore'
import { ARTIFACT_MAP } from '@/data/artifacts'
import type { BoardConfig, GridSlot, PlacedArtifact } from '@/types'

const ROWS = buildGridRows(42)
const at = (r: number, c: number) => positionToSlot(r, c, ROWS)!
const A = (v: string, i: number): PlacedArtifact => ({
  instanceId: `a-${v}-${i}`, type: 'ARTIFACT', data: ARTIFACT_MAP.get(v)!,
  level: 0, currentLevel: 0, isLocked: false, priority: 'normal', targetLevel: null,
})

// 워커(workers/optimizer.worker.ts)의 mutate + SA 루프를 그대로 옮긴 것.
function mutate(slots: GridSlot[]): GridSlot[] {
  const s = slots.slice()
  const idx = s.map((_, i) => i)
  const i1 = idx[Math.floor(Math.random() * idx.length)]
  const i2 = idx[Math.floor(Math.random() * idx.length)]
  const t = s[i1]; s[i1] = s[i2]; s[i2] = t
  return s
}

function anneal(start: GridSlot[], config: BoardConfig, ms = 3000): GridSlot[] {
  const w = buildScoreWeights(start, config)
  const scale = w.baseUnit || 1
  let cur = start.slice(), best = start.slice()
  let curS = evaluateBoard(cur, ROWS, w, config), bestS = curS
  let temp = 100
  const t0 = Date.now()
  while (temp > 0.01 && Date.now() - t0 < ms) {
    const n = mutate(cur)
    const ns = evaluateBoard(n, ROWS, w, config)
    const d = ns - curS
    if (d > 0 || Math.random() < Math.exp(d / scale / temp)) { cur = n; curS = ns }
    if (curS > bestS) { best = cur.slice(); bestS = curS }
    temp *= 0.9996
  }
  return best
}

/**
 * 사용자가 보고한 회귀의 끝단 재현.
 *
 * 증상: 하얀 종이 목표 콤보를 바람노래로 잡고 최적화를 돌리면 종이가 엉뚱한 자리로
 * 가거나 양옆에 콤보가 없어 효과가 죽었다.
 *
 * 원인 둘:
 *  1. whitePaperOpportunities 가 '현재 총합 + 1' 로 판정해, 종이 몫이 이미 들어간
 *     총합 위에 한 장을 더 얹는 도달 불가능한 목표를 제안했다 (tests/combo.test.ts).
 *  2. comboGoal 밴드가 단계 수만 세서 임계값 사이에서 점수가 평평했다. 바람노래는
 *     2/4/6/8/10 이라 스택 6과 7이 같은 3단계고, 그러면 종이가 붙든 말든 점수가
 *     같아 최적화기가 종이를 아무 데나 두었다. 아래 두 번째 테스트가 그 지점이다.
 */
describe('end-to-end: 하얀 종이 목표 콤보', () => {
  const SEVEN = ['windpool_shawl','compression_band','thornbush','gold_cloak','vane','sheet_music_bree','silver_bracelet']

  function scattered(): GridSlot[] {
    const s: GridSlot[] = new Array(42).fill(null)
    // 바람노래 7개를 서로 떨어뜨려 두고, 종이는 저 멀리.
    const spots = [[0,0],[0,3],[1,1],[2,4],[3,0],[4,3],[5,1]]
    SEVEN.forEach((v,i) => { s[at(spots[i][0], spots[i][1])] = A(v, i) })
    s[at(6,3)] = A(WHITE_PAPER_VALUE, 99)
    return s
  }

  it('목표를 지정하면 종이가 바람노래 둘 사이로 이동해 8스택을 만든다', () => {
    const start = scattered()
    expect(comboCounts(start, ROWS).get('spring_song')!.total).toBe(7)

    const out = anneal(start, { targetCombo: 'spring_song' })
    const after = comboCounts(out, ROWS).get('spring_song')!
    expect(after.whitePaper).toBe(1)
    expect(after.total).toBe(8)
  })

  it('도달 불가능한 목표(기본 6)에서도 종이를 그 콤보에 붙여 둔다', () => {
    const s: GridSlot[] = new Array(42).fill(null)
    const spots = [[0,0],[0,3],[1,1],[2,4],[3,0],[4,3]]
    SEVEN.slice(0,6).forEach((v,i) => { s[at(spots[i][0], spots[i][1])] = A(v, i) })
    s[at(6,3)] = A(WHITE_PAPER_VALUE, 99)

    const out = anneal(s, { targetCombo: 'spring_song' })
    expect(comboCounts(out, ROWS).get('spring_song')!.whitePaper).toBe(1)
  })
})
