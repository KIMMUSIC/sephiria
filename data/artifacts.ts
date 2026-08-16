import type { ArtifactData } from '@/types'
import rawArtifacts from './artifacts.json'
import { publicMediaPath } from './mediaPaths'

export const ARTIFACTS: ArtifactData[] = (rawArtifacts as ArtifactData[]).map((a) => ({
  ...a,
  image: publicMediaPath(a.image, 'artifacts', a.value),
}))

export const ARTIFACT_MAP = new Map<string, ArtifactData>(
  ARTIFACTS.map((a) => [a.value, a])
)

export const ARTIFACT_SETS = Array.from(
  new Set(ARTIFACTS.flatMap((a) => a.effect.sets ?? []))
)
