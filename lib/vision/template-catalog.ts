import type { ItemKind, RGBAImage, TemplateSource } from './types'

/**
 * Environment-free template assembly (PLAN §9-G / Phase 5).
 *
 * Callers inject `decode(pathOrUrl)` so this module stays browser-clean:
 * the Node harness passes a sharp-backed decoder, the browser loader
 * passes fetch + createImageBitmap. Wiki sprites come from the
 * `artifacts` / `tablets` lists the caller supplies (directory listing
 * or natives.file — NOT necessarily data/*.json, which currently lags
 * the on-disk catalog: 241/54 vs 267/60).
 */

export interface CatalogArtifact {
  value: string
  /** Path or URL forwarded to `decode`. */
  image: string
}

export interface CatalogTablet {
  value: string
  image: string
  rotate?: boolean
}

export interface SpriteNativeEntry {
  native: [number, number]
  lowConfidence?: boolean
  file?: string
}

export interface SpriteNativesDoc {
  sprites: Record<string, SpriteNativeEntry>
}

export interface RenderedOverride {
  value: string
  file: string
  kind: 'replace' | 'extra' | 'extra-depleted'
  native: [number, number]
  source?: string
  notes?: string
}

export interface RenderedOverridesDoc {
  overrides?: RenderedOverride[]
}

export type DecodeImage = (pathOrUrl: string) => Promise<RGBAImage>

export interface BuildTemplateSourcesArgs {
  artifacts: CatalogArtifact[]
  tablets: CatalogTablet[]
  natives: SpriteNativesDoc
  overrides?: RenderedOverridesDoc | null
  decode: DecodeImage
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const n = Math.min(limit, items.length)
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (;;) {
        const i = next++
        if (i >= items.length) return
        out[i] = await fn(items[i], i)
      }
    })
  )
  return out
}

function altExtPath(image: string): string | null {
  if (/\.webp$/i.test(image)) return image.replace(/\.webp$/i, '.png')
  if (/\.png$/i.test(image)) return image.replace(/\.png$/i, '.webp')
  return null
}

async function decodeWithFallback(decode: DecodeImage, image: string): Promise<RGBAImage> {
  try {
    return await decode(image)
  } catch (first) {
    const alt = altExtPath(image)
    if (!alt) throw first
    try {
      return await decode(alt)
    } catch {
      throw first
    }
  }
}

/**
 * Assemble wiki templates (native sizes attached; missing natives are a
 * hard error) then apply `data/rendered-overrides.json`:
 *   - replace: swap image AND native, nativeUncertain=false
 *   - extra / extra-depleted: additional TemplateSource, wiki retained
 */
export async function buildTemplateSources(
  args: BuildTemplateSourcesArgs
): Promise<TemplateSource[]> {
  const { artifacts, tablets, natives, overrides, decode } = args

  const wiki: { value: string; image: string; type: ItemKind; rotatable: boolean }[] = [
    ...artifacts.map((a) => ({
      value: a.value,
      image: a.image,
      type: 'ARTIFACT' as ItemKind,
      rotatable: false,
    })),
    ...tablets.map((t) => ({
      value: t.value,
      image: t.image,
      type: 'TABLET' as ItemKind,
      rotatable: t.rotate === true,
    })),
  ]

  const templates = await mapPool(wiki, 16, async (entry) => {
    const catalog = natives.sprites[entry.value]
    if (!catalog) {
      throw new Error(
        `sprite-natives catalog has no entry for "${entry.value}" — run npm run build:sprite-natives`
      )
    }
    return {
      value: entry.value,
      type: entry.type,
      image: await decodeWithFallback(decode, entry.image),
      rotatable: entry.rotatable,
      native: catalog.native,
      nativeUncertain: catalog.lowConfidence === true,
    } satisfies TemplateSource
  })

  return applyRenderedOverrides(templates, overrides, decode)
}

async function applyRenderedOverrides(
  templates: TemplateSource[],
  doc: RenderedOverridesDoc | null | undefined,
  decode: DecodeImage
): Promise<TemplateSource[]> {
  if (!doc?.overrides?.length) return templates
  const out = templates.slice()
  const extras: TemplateSource[] = []
  for (const o of doc.overrides) {
    const img = await decodeWithFallback(decode, o.file)
    const baseIdx = out.findIndex((t) => t.value === o.value)
    if (baseIdx < 0) {
      throw new Error(`rendered-overrides: no wiki template for "${o.value}"`)
    }
    const base = out[baseIdx]
    if (o.kind === 'replace') {
      out[baseIdx] = {
        ...base,
        image: img,
        native: o.native,
        nativeUncertain: false,
      }
    } else if (o.kind === 'extra-depleted' || o.kind === 'extra') {
      extras.push({
        value: o.value,
        type: base.type,
        image: img,
        rotatable: base.rotatable,
        native: o.native,
        nativeUncertain: false,
      })
    } else {
      throw new Error(
        `rendered-overrides: unknown kind "${(o as RenderedOverride).kind}" for ${o.value}`
      )
    }
  }
  return out.concat(extras)
}
