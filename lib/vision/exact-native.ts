/**
 * Native-art bank for roadmap-6 exact matching (PLAN §9-G).
 *
 * Wiki sprites are NN upscales of native pixel art by a per-sprite rational k.
 * Rendered overrides are already native (k=1). Inverse-NN downsample with a
 * brute-forced phase recovers the native RGBA; variants whose round-trip
 * agreement is poor (fallback / smooth-resample, no override) stay exempt.
 */
import type { RGBAImage } from './types'

const PHASE_STEP = 0.1
const ROUNDTRIP_MIN = 0.85
const NATIVE_K1_SLACK = 2

export interface NativeArt {
  width: number
  height: number
  data: Uint8Array // RGBA, length = width*height*4
  opaque: Uint8Array // 1 where alpha === 255
  nOpaque: number
}

interface BBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

function alphaBBox(img: RGBAImage): BBox | null {
  let x0 = img.width
  let x1 = -1
  let y0 = img.height
  let y1 = -1
  const d = img.data
  const w = img.width
  for (let y = 0; y < img.height; y++) {
    const row = y * w * 4
    for (let x = 0; x < w; x++) {
      if (d[row + x * 4 + 3] > 0) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 }
}

function cropToArt(img: RGBAImage, box: BBox): NativeArt {
  const width = box.x1 - box.x0
  const height = box.y1 - box.y0
  const data = new Uint8Array(width * height * 4)
  const opaque = new Uint8Array(width * height)
  let nOpaque = 0
  const d = img.data
  const w = img.width
  for (let y = 0; y < height; y++) {
    const src = ((box.y0 + y) * w + box.x0) * 4
    data.set(d.subarray(src, src + width * 4), y * width * 4)
    const row = y * width * 4
    const oRow = y * width
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] === 255) {
        opaque[oRow + x] = 1
        nOpaque++
      }
    }
  }
  return { width, height, data, opaque, nOpaque }
}

function sampleNative(
  src: Uint8ClampedArray,
  srcW: number,
  box: BBox,
  nW: number,
  nH: number,
  k: number,
  ox: number,
  oy: number
): Uint8Array {
  const W = box.x1 - box.x0
  const H = box.y1 - box.y0
  const out = new Uint8Array(nW * nH * 4)
  for (let y = 0; y < nH; y++) {
    let iy = Math.floor(oy + (y + 0.5) * k)
    if (iy < 0) iy = 0
    else if (iy > H - 1) iy = H - 1
    const srcRow = (box.y0 + iy) * srcW
    const dstRow = y * nW * 4
    for (let x = 0; x < nW; x++) {
      let ix = Math.floor(ox + (x + 0.5) * k)
      if (ix < 0) ix = 0
      else if (ix > W - 1) ix = W - 1
      const s = (srcRow + box.x0 + ix) * 4
      const o = dstRow + x * 4
      out[o] = src[s]
      out[o + 1] = src[s + 1]
      out[o + 2] = src[s + 2]
      out[o + 3] = src[s + 3]
    }
  }
  return out
}

function roundtripAgree(
  src: Uint8ClampedArray,
  srcW: number,
  box: BBox,
  nat: Uint8Array,
  nW: number,
  nH: number,
  k: number,
  ox: number,
  oy: number
): number {
  const W = box.x1 - box.x0
  const H = box.y1 - box.y0
  let n = 0
  let hit = 0
  for (let y = 0; y < H; y++) {
    let gy = Math.floor((y - oy) / k)
    if (gy < 0) gy = 0
    else if (gy > nH - 1) gy = nH - 1
    const srcRow = (box.y0 + y) * srcW
    const natRow = gy * nW * 4
    for (let x = 0; x < W; x++) {
      const s = (srcRow + box.x0 + x) * 4
      if (src[s + 3] !== 255) continue
      n++
      let gx = Math.floor((x - ox) / k)
      if (gx < 0) gx = 0
      else if (gx > nW - 1) gx = nW - 1
      const o = natRow + gx * 4
      if (nat[o] === src[s] && nat[o + 1] === src[s + 1] && nat[o + 2] === src[s + 2]) hit++
    }
  }
  return n === 0 ? 0 : hit / n
}

/**
 * Recover native RGBA from a template image.
 * Returns null when the art is not a faithful NN upscale (exact pass skips it).
 */
export function deriveNativeArt(img: RGBAImage, native: [number, number]): NativeArt | null {
  const box = alphaBBox(img)
  if (!box) return null
  const bw = box.x1 - box.x0
  const bh = box.y1 - box.y0
  const nW = Math.max(1, native[0])
  const nH = Math.max(1, native[1])

  // Rendered / harvested templates are already native resolution.
  if (Math.abs(bw - nW) <= NATIVE_K1_SLACK && Math.abs(bh - nH) <= NATIVE_K1_SLACK) {
    const art = cropToArt(img, box)
    return art.nOpaque >= 4 ? art : null
  }

  const kx = bw / nW
  const ky = bh / nH
  if (!(kx >= 1.4 && ky >= 1.4 && kx <= 5 && ky <= 5)) return null
  const k = (kx + ky) / 2

  let bestNat: Uint8Array | null = null
  let bestAgree = -1
  for (let oy = 0; oy < k - 1e-9; oy += PHASE_STEP) {
    for (let ox = 0; ox < k - 1e-9; ox += PHASE_STEP) {
      const nat = sampleNative(img.data, img.width, box, nW, nH, k, ox, oy)
      const agree = roundtripAgree(img.data, img.width, box, nat, nW, nH, k, ox, oy)
      if (agree > bestAgree) {
        bestAgree = agree
        bestNat = nat
      }
    }
  }
  if (!bestNat || bestAgree < ROUNDTRIP_MIN) return null

  const opaque = new Uint8Array(nW * nH)
  let nOpaque = 0
  for (let i = 0; i < nW * nH; i++) {
    if (bestNat[i * 4 + 3] === 255) {
      opaque[i] = 1
      nOpaque++
    }
  }
  if (nOpaque < 4) return null
  return { width: nW, height: nH, data: bestNat, opaque, nOpaque }
}

/** `np.rot90(a, -k)` — clockwise, same convention as plate-matcher rotateSquare. */
export function rotateNativeArt(art: NativeArt, k: number): NativeArt {
  if (k === 0) return art
  let cur = art
  for (let step = 0; step < k; step++) {
    const s = cur.width
    const t = cur.height
    // clockwise: (x,y) -> (t-1-y, x) wait: square rotate used
    // src = ((s-1-x)*s + y) for square. For non-square: dest(x,y) = src(y, t-1-x)?
    // square: dest(x,y) = src(s-1-x, y) in (col=y, row=s-1-x) → (x',y')=(y, s-1-x)
    // dest width = old height, dest height = old width.
    const outW = t
    const outH = s
    const data = new Uint8Array(outW * outH * 4)
    const opaque = new Uint8Array(outW * outH)
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const srcX = y
        const srcY = t - 1 - x
        const si = (srcY * s + srcX) * 4
        const di = (y * outW + x) * 4
        data[di] = cur.data[si]
        data[di + 1] = cur.data[si + 1]
        data[di + 2] = cur.data[si + 2]
        data[di + 3] = cur.data[si + 3]
        const oi = y * outW + x
        opaque[oi] = cur.opaque[srcY * s + srcX]
      }
    }
    cur = { width: outW, height: outH, data, opaque, nOpaque: cur.nOpaque }
  }
  return cur
}

export interface ExactPatch {
  width: number
  height: number
  rgb: Uint32Array // r | g<<8 | b<<16 for every pixel
  opaque: Uint8Array
  nOpaque: number
  // opaque pixel lists for the inner loop
  ox: Int32Array
  oy: Int32Array
  orgb: Uint32Array
}

/** Integer-S nearest-neighbour upscale (pixel repeat). */
export function nnUpscale(art: NativeArt, s: number): ExactPatch {
  const width = art.width * s
  const height = art.height * s
  const rgb = new Uint32Array(width * height)
  const opaque = new Uint8Array(width * height)
  const ox = new Int32Array(art.nOpaque * s * s)
  const oy = new Int32Array(art.nOpaque * s * s)
  const orgb = new Uint32Array(art.nOpaque * s * s)
  let n = 0
  for (let y = 0; y < art.height; y++) {
    for (let x = 0; x < art.width; x++) {
      const i = y * art.width + x
      const p = i * 4
      const packed = art.data[p] | (art.data[p + 1] << 8) | (art.data[p + 2] << 16)
      const isO = art.opaque[i]
      for (let dy = 0; dy < s; dy++) {
        const yy = y * s + dy
        const row = yy * width
        for (let dx = 0; dx < s; dx++) {
          const xx = x * s + dx
          const j = row + xx
          rgb[j] = packed
          if (isO) {
            opaque[j] = 1
            ox[n] = xx
            oy[n] = yy
            orgb[n] = packed
            n++
          }
        }
      }
    }
  }
  return { width, height, rgb, opaque, nOpaque: n, ox, oy, orgb }
}

export const EXACT_WINDOW = 4

/**
 * Fraction of opaque patch pixels whose RGB equals the source image exactly.
 * Pixels outside [cellL,cellR)×[cellT,cellB), above validY0 (TOPCUT in source),
 * or marked in the source-space nuisance mask are excluded from the denominator.
 * Returns -1 if the optimistic remaining fraction cannot beat `abortBelow`.
 */
export function exactFractionAt(
  img: RGBAImage,
  patch: ExactPatch,
  originX: number,
  originY: number,
  cellL: number,
  cellT: number,
  cellR: number,
  cellB: number,
  validY0: number,
  nuis: Uint8Array | null,
  nuisL: number,
  nuisT: number,
  nuisW: number,
  abortBelow: number
): number {
  const d = img.data
  const iw = img.width
  const ih = img.height
  const n = patch.nOpaque
  const ox = patch.ox
  const oy = patch.oy
  const orgb = patch.orgb
  let matches = 0
  let denom = 0
  for (let k = 0; k < n; k++) {
    const sx = originX + ox[k]
    const sy = originY + oy[k]
    if (sx < cellL || sx >= cellR || sy < cellT || sy >= cellB) continue
    if (sx < 0 || sy < 0 || sx >= iw || sy >= ih) continue
    if (sy < validY0) continue
    if (nuis) {
      const nx = sx - nuisL
      const ny = sy - nuisT
      if (nx >= 0 && ny >= 0 && nx < nuisW && nuis[ny * nuisW + nx]) continue
    }
    denom++
    const p = (sy * iw + sx) * 4
    if ((d[p] | (d[p + 1] << 8) | (d[p + 2] << 16)) === orgb[k]) matches++
    const nLeft = n - 1 - k
    if (abortBelow > 0 && denom + nLeft > 0 && (matches + nLeft) / (denom + nLeft) < abortBelow) {
      return -1
    }
  }
  return denom === 0 ? 0 : matches / denom
}

const COARSE_STEP = 4

/**
 * Coarse-to-fine exact search over placements that keep the patch overlapping
 * the source cell. Centroid seeds can be 10–12px off for sparse 1px-stroke
 * icons; a local ±4 window misses those. Coarse step-4 over the cell, then
 * refine ±COARSE_STEP around the best (and the seed).
 */
export function searchExact(
  img: RGBAImage,
  patch: ExactPatch,
  seedOx: number,
  seedOy: number,
  _window: number,
  cellL: number,
  cellT: number,
  cellR: number,
  cellB: number,
  validY0: number,
  nuis: Uint8Array | null,
  nuisL: number,
  nuisT: number,
  nuisW: number
): number {
  const pw = patch.width
  const ph = patch.height
  const minOx = cellL - 2
  const maxOx = cellR - pw + 2
  const minOy = cellT - 2
  const maxOy = cellB - ph + 2
  let best = 0
  let bestOx = seedOx
  let bestOy = seedOy

  const tryOff = (ox: number, oy: number) => {
    const f = exactFractionAt(
      img,
      patch,
      ox,
      oy,
      cellL,
      cellT,
      cellR,
      cellB,
      validY0,
      nuis,
      nuisL,
      nuisT,
      nuisW,
      best
    )
    if (f > best) {
      best = f
      bestOx = ox
      bestOy = oy
    }
  }

  tryOff(seedOx, seedOy)
  if (maxOx < minOx || maxOy < minOy) return best

  for (let oy = minOy; oy <= maxOy; oy += COARSE_STEP) {
    for (let ox = minOx; ox <= maxOx; ox += COARSE_STEP) {
      if (ox === seedOx && oy === seedOy) continue
      tryOff(ox, oy)
    }
  }
  const r0x = bestOx - COARSE_STEP
  const r1x = bestOx + COARSE_STEP
  const r0y = bestOy - COARSE_STEP
  const r1y = bestOy + COARSE_STEP
  for (let oy = r0y; oy <= r1y; oy++) {
    if (oy < minOy || oy > maxOy) continue
    for (let ox = r0x; ox <= r1x; ox++) {
      if (ox < minOx || ox > maxOx) continue
      if ((ox - minOx) % COARSE_STEP === 0 && (oy - minOy) % COARSE_STEP === 0) continue
      if (ox === seedOx && oy === seedOy) continue
      tryOff(ox, oy)
    }
  }
  return best
}
