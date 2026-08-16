export interface RGBAImage {
  width: number
  height: number
  data: Uint8ClampedArray // RGBA, length = width*height*4
}

export type ItemKind = 'ARTIFACT' | 'TABLET'

export interface CellPrediction {
  slotIndex: number
  matchedValue: string | null
  type: ItemKind | null
  rotation: 0 | 1 | 2 | 3
  confidence: number
  /**
   * Top-3 identities by final score, winner first. Present on matched cells.
   * Optional so empty cells and older callers stay unchanged.
   */
  candidates?: Array<{
    value: string
    type: ItemKind
    rotation: 0 | 1 | 2 | 3
    score: number
  }>
}

export interface RecognizeOptions {
  rows: number
  cols: number
  totalSlots: number
  /** Grid rect in SOURCE image coordinates. Fractional — must not be rounded. */
  grid?: { originX: number; originY: number; gridWidth: number; gridHeight: number }
  /**
   * Roadmap 6: run pixel-exact re-ranking in ORIGINAL screenshot space.
   * Intended for lossless captures (PNG). JPEG must leave this unset/false so
   * the exact pass is skipped and stage-2 results stay unchanged.
   */
  lossless?: boolean
}

export interface TemplateSource {
  value: string
  type: ItemKind
  image: RGBAImage
  rotatable: boolean
  /**
   * Native art size [w, h] in original game pixels (alpha bbox / k), from the
   * offline catalog `data/sprite-natives.json` (PLAN §9-G). It determines the
   * sprite's deterministic render scale. Optional at the type level so callers
   * that never reach the plate matcher can omit it, but the plate matcher
   * treats a loaded template without it as a hard error — never a silent
   * fallback.
   */
  native?: [number, number]
  /**
   * Catalog `lowConfidence` flag: the sprite's upscale factor k could not be
   * measured (lossy webp, smooth resample) or fits off-family, so `native` is
   * a guess. The matcher searches a wider scale window for these.
   */
  nativeUncertain?: boolean
}

export interface Recognizer {
  readonly name: string
  loadTemplates(templates: TemplateSource[]): Promise<void> | void
  recognize(img: RGBAImage, opts: RecognizeOptions): Promise<CellPrediction[]>
}
