export interface GridParams {
  /** Top-left X of grid area */
  originX: number
  /** Top-left Y of grid area */
  originY: number
  /** Total grid width */
  gridWidth: number
  /** Total grid height */
  gridHeight: number
  /** Number of columns (fixed 6) */
  cols: number
  /** Number of total slots */
  slotNum: number
}

export interface CellCrop {
  slotIndex: number
  x: number
  y: number
  width: number
  height: number
}

export function computeCellCrops(params: GridParams): CellCrop[] {
  const { originX, originY, gridWidth, gridHeight, cols, slotNum } = params
  const rows = Math.ceil(slotNum / cols)
  const cellW = gridWidth / cols
  const cellH = gridHeight / rows
  const crops: CellCrop[] = []

  for (let i = 0; i < slotNum; i++) {
    const row = Math.floor(i / cols)
    const col = i % cols
    crops.push({
      slotIndex: i,
      x: originX + col * cellW,
      y: originY + row * cellH,
      width: cellW,
      height: cellH,
    })
  }
  return crops
}

/**
 * Crop the center of a cell (icon region, ~55% center).
 */
export function cropCellIcon(
  ctx: CanvasRenderingContext2D,
  crop: CellCrop,
  targetSize: number
): ImageData {
  const marginX = crop.width * 0.22
  const marginY = crop.height * 0.22
  const iconX = crop.x + marginX
  const iconY = crop.y + marginY
  const iconW = crop.width - marginX * 2
  const iconH = crop.height - marginY * 2

  const tempCanvas = document.createElement('canvas')
  tempCanvas.width = targetSize
  tempCanvas.height = targetSize
  const tempCtx = tempCanvas.getContext('2d')!
  tempCtx.drawImage(ctx.canvas, iconX, iconY, iconW, iconH, 0, 0, targetSize, targetSize)
  return tempCtx.getImageData(0, 0, targetSize, targetSize)
}

/**
 * Check if a cell is empty: low color variance = uniform background.
 */
export function isCellEmpty(imageData: ImageData, threshold = 18): boolean {
  const d = imageData.data
  const len = d.length / 4
  let sumR = 0, sumG = 0, sumB = 0
  for (let i = 0; i < len; i++) {
    sumR += d[i * 4]; sumG += d[i * 4 + 1]; sumB += d[i * 4 + 2]
  }
  const mR = sumR / len, mG = sumG / len, mB = sumB / len
  let v = 0
  for (let i = 0; i < len; i++) {
    v += (d[i * 4] - mR) ** 2 + (d[i * 4 + 1] - mG) ** 2 + (d[i * 4 + 2] - mB) ** 2
  }
  return Math.sqrt(v / len) < threshold
}

// ── Auto Grid Detection ──

/**
 * Auto-detect grid by finding the largest dark rectangular area.
 * The game inventory cells are dark purple (~RGB 50-70, 30-50, 55-75).
 */
export function autoDetectGrid(
  img: HTMLImageElement,
  slotNum: number
): GridParams | null {
  const canvas = document.createElement('canvas')
  const w = img.naturalWidth
  const h = img.naturalHeight
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, w, h).data

  // Build a binary mask: is pixel "dark game cell" color?
  // Game cell bg is approximately HSL hue 270-310, low saturation, low lightness
  const mask = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    const l = (max + min) / 2
    // Dark pixel in the purple-blue range typical of game cells
    if (l > 20 && l < 100 && b >= g && r < 100) {
      mask[i] = 1
    }
  }

  // Find bounding box of the largest dense region using column/row projections
  const colDensity = new Float32Array(w)
  const rowDensity = new Float32Array(h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        colDensity[x]++
        rowDensity[y]++
      }
    }
  }

  // Normalize
  for (let x = 0; x < w; x++) colDensity[x] /= h
  for (let y = 0; y < h; y++) rowDensity[y] /= w

  // Find continuous high-density region (>30% of pixels match)
  const THRESH = 0.25
  const xRange = findDenseRange(colDensity, THRESH)
  const yRange = findDenseRange(rowDensity, THRESH)

  if (!xRange || !yRange) return null

  const gridWidth = xRange.end - xRange.start
  const gridHeight = yRange.end - yRange.start

  // Sanity: grid should be at least 30% of image in both dimensions
  if (gridWidth < w * 0.3 || gridHeight < h * 0.3) return null

  return {
    originX: xRange.start,
    originY: yRange.start,
    gridWidth,
    gridHeight,
    cols: 6,
    slotNum,
  }
}

function findDenseRange(
  density: Float32Array,
  threshold: number
): { start: number; end: number } | null {
  let bestStart = 0, bestEnd = 0, bestLen = 0
  let start = -1

  for (let i = 0; i < density.length; i++) {
    if (density[i] >= threshold) {
      if (start < 0) start = i
    } else {
      if (start >= 0) {
        const len = i - start
        if (len > bestLen) {
          bestLen = len
          bestStart = start
          bestEnd = i
        }
        start = -1
      }
    }
  }
  // Handle edge case
  if (start >= 0) {
    const len = density.length - start
    if (len > bestLen) {
      bestStart = start
      bestEnd = density.length
    }
  }

  if (bestEnd - bestStart < 10) return null
  return { start: bestStart, end: bestEnd }
}

/**
 * Draw grid overlay on a canvas.
 */
export function drawGridOverlay(
  ctx: CanvasRenderingContext2D,
  params: GridParams,
  scaleX: number,
  scaleY: number
): void {
  const { originX, originY, gridWidth, gridHeight, cols, slotNum } = params
  const rows = Math.ceil(slotNum / cols)
  const cellW = gridWidth / cols
  const cellH = gridHeight / rows

  ctx.strokeStyle = 'rgba(139, 92, 246, 0.8)'
  ctx.lineWidth = 2

  for (let r = 0; r < rows; r++) {
    const colsInRow = r === rows - 1 ? (slotNum % cols || cols) : cols
    for (let c = 0; c < colsInRow; c++) {
      const x = (originX + c * cellW) * scaleX
      const y = (originY + r * cellH) * scaleY
      const w = cellW * scaleX
      const h = cellH * scaleY
      ctx.strokeRect(x, y, w, h)
    }
  }

  // Outer border (thicker)
  ctx.strokeStyle = 'rgba(139, 92, 246, 0.5)'
  ctx.lineWidth = 3
  ctx.strokeRect(
    originX * scaleX,
    originY * scaleY,
    gridWidth * scaleX,
    gridHeight * scaleY
  )
}
