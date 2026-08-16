import type { CellPrediction } from './types'

/**
 * Low-confidence badge (PLAN §5 Phase 4-1).
 *
 * Matcher `confidence` is the analysis-by-synthesis score
 * `1 - residual/plate` (not a calibrated probability). Remaining
 * fixture errors sit at ~0.06–0.27; clean PNG hits are typically ≥0.3.
 *
 * Default: flag a non-empty cell when score < 0.25. When the engine
 * supplies top-3 `candidates`, also flag a thin top1−top2 gap (< 0.05)
 * so a modest but unique winner is not punished and a high score with
 * a near-tie still asks for a click. Feature-detect `candidates` —
 * the UI must work when the field is absent.
 *
 * Empty cells are never flagged.
 */
export const LOW_SCORE = 0.25
export const LOW_GAP = 0.05

export function isLowConfidence(pred: {
  matchedValue: string | null
  confidence: number
  candidates?: CellPrediction['candidates']
}): boolean {
  if (pred.matchedValue == null) return false
  if (pred.confidence < LOW_SCORE) return true
  const c = pred.candidates
  if (c && c.length >= 2) return c[0].score - c[1].score < LOW_GAP
  return false
}
