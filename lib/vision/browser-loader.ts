import artifactsJson from '@/data/artifacts.json'
import tabletsJson from '@/data/tablets.json'
import nativesJson from '@/data/sprite-natives.json'
import overridesJson from '@/data/rendered-overrides.json'
import {
  buildTemplateSources,
  type CatalogArtifact,
  type CatalogTablet,
  type RenderedOverridesDoc,
  type SpriteNativesDoc,
} from './template-catalog'
import { decodeBrowserUrl } from './browser-decode'
import type { RGBAImage, TemplateSource } from './types'

/**
 * Client/worker sprite loader. JSONs are bundled (data/ is not HTTP-served);
 * the ~330 wiki + override sprites are fetched from `/images/...` in parallel.
 *
 * Sprite list is taken from `sprite-natives.json` `file` paths (327 wiki
 * sprites). `data/artifacts.json` (241) and `data/tablets.json` (54) lag
 * the on-disk catalog and would silently drop items; they are still loaded
 * so tablet `rotate` flags stay available. Production templates live in the
 * worker (see workers/recognition.worker.ts).
 */

export interface LoadProgress {
  stage: string
  done: number
  total: number
}

export async function loadBrowserTemplates(
  onProgress?: (p: LoadProgress) => void
): Promise<TemplateSource[]> {
  const natives = nativesJson as unknown as SpriteNativesDoc
  const tabletsDoc = tabletsJson as { value: string; rotate?: boolean }[]
  const rotatable = new Set(tabletsDoc.filter((t) => t.rotate === true).map((t) => t.value))
  // The four catalogs are loaded together; artifacts.json is the label source
  // for the UI, not the sprite list (natives.file is).
  void (artifactsJson as { value: string }[]).length

  const artifacts: CatalogArtifact[] = []
  const tablets: CatalogTablet[] = []
  for (const [value, ent] of Object.entries(natives.sprites)) {
    const file = ent.file
    if (!file) {
      throw new Error(`sprite-natives catalog entry "${value}" has no file path`)
    }
    if (file.includes('/slabs/') || file.includes('\\slabs\\')) {
      tablets.push({ value, image: file, rotate: rotatable.has(value) })
    } else {
      artifacts.push({ value, image: file })
    }
  }

  const overrides = overridesJson as unknown as RenderedOverridesDoc
  const overrideCount = overrides.overrides?.length ?? 0
  const total = artifacts.length + tablets.length + overrideCount
  let done = 0
  onProgress?.({ stage: 'templates', done: 0, total })

  const decode = async (pathOrUrl: string): Promise<RGBAImage> => {
    const img = await decodeBrowserUrl(pathOrUrl)
    done++
    onProgress?.({ stage: 'templates', done: Math.min(done, total), total })
    return img
  }

  return buildTemplateSources({
    artifacts,
    tablets,
    natives,
    overrides,
    decode,
  })
}
