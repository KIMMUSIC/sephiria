import type { RGBAImage } from './types'

/**
 * Browser/worker RGBA decode. Kept free of catalog JSON so the main-thread
 * uploader can decode a screenshot without bundling the sprite catalogs.
 */
const decodeCache = new Map<string, Promise<RGBAImage>>()

export function toPublicUrl(pathOrUrl: string): string {
  if (/^https?:/i.test(pathOrUrl) || pathOrUrl.startsWith('blob:') || pathOrUrl.startsWith('data:')) {
    return pathOrUrl
  }
  const normalized = pathOrUrl.replace(/\\/g, '/')
  if (normalized.startsWith('/')) return normalized
  return '/' + normalized.replace(/^public\//, '')
}

async function bitmapToRGBA(bitmap: ImageBitmap): Promise<RGBAImage> {
  const w = bitmap.width
  const h = bitmap.height
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('OffscreenCanvas 2d unavailable')
    ctx.drawImage(bitmap, 0, 0)
    const id = ctx.getImageData(0, 0, w, h)
    return { width: w, height: h, data: new Uint8ClampedArray(id.data) }
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d unavailable')
    ctx.drawImage(bitmap, 0, 0)
    const id = ctx.getImageData(0, 0, w, h)
    return { width: w, height: h, data: new Uint8ClampedArray(id.data) }
  }
  throw new Error('no canvas available to decode bitmap')
}

export async function decodeBrowserUrl(pathOrUrl: string): Promise<RGBAImage> {
  const url = toPublicUrl(pathOrUrl)
  let hit = decodeCache.get(url)
  if (!hit) {
    hit = (async () => {
      const resp = await fetch(url)
      if (!resp.ok) throw new Error(`sprite fetch failed ${resp.status}: ${url}`)
      const blob = await resp.blob()
      const bitmap = await createImageBitmap(blob, {
        colorSpaceConversion: 'none',
        premultiplyAlpha: 'none',
      })
      try {
        return await bitmapToRGBA(bitmap)
      } finally {
        bitmap.close()
      }
    })()
    decodeCache.set(url, hit)
  }
  return hit
}

export async function decodeBrowserBlob(blob: Blob): Promise<RGBAImage> {
  const bitmap = await createImageBitmap(blob, {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  })
  try {
    return await bitmapToRGBA(bitmap)
  } finally {
    bitmap.close()
  }
}
