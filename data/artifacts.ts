import type { ArtifactData } from '@/types'
import rawArtifacts from './artifacts.json'

// Map remote URLs to local paths in public/images/artifacts/
export const ARTIFACTS: ArtifactData[] = (rawArtifacts as ArtifactData[]).map((a) => {
  const ext = a.image.endsWith('.webp') ? 'webp' : 'png'
  return { ...a, image: `/images/artifacts/${a.value}.${ext}` }
})

export const ARTIFACT_MAP = new Map<string, ArtifactData>(
  ARTIFACTS.map((a) => [a.value, a])
)

export const ARTIFACT_SETS = Array.from(new Set(ARTIFACTS.flatMap((a) => a.effect.sets)))
