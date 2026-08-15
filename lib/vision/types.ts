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
  candidates?: Array<{
    value: string
    type: ItemKind
    rotation: 0 | 1 | 2 | 3
    confidence: number
  }>
}

export interface RecognizeOptions {
  rows: number
  cols: number
  totalSlots: number
  /** Grid rect in SOURCE image coordinates. Fractional — must not be rounded. */
  grid?: { originX: number; originY: number; gridWidth: number; gridHeight: number }
}

export interface TemplateSource {
  value: string
  type: ItemKind
  image: RGBAImage
  rotatable: boolean
}

export interface Recognizer {
  readonly name: string
  loadTemplates(templates: TemplateSource[]): Promise<void> | void
  recognize(img: RGBAImage, opts: RecognizeOptions): Promise<CellPrediction[]>
}
