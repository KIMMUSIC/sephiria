import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ARTIFACTS, ARTIFACT_SETS } from '@/data/artifacts'
import { TABLETS } from '@/data/tablets'
import { COMBO_KO, COMBO_ORDER, TIER_KO } from '@/data/wikiLabels'
import { publicMediaPath } from '@/data/mediaPaths'
import type { Tier } from '@/types'

const publicRoot = resolve(process.cwd(), 'public')

describe('wiki labels', () => {
  it('maps every catalog combo slug to the namu wiki Korean name', () => {
    for (const slug of ARTIFACT_SETS) {
      expect(COMBO_KO[slug], slug).toBeTruthy()
      expect(COMBO_KO[slug]).not.toBe(slug)
    }
    expect(COMBO_KO.extrium).toBe('먹구름')
    expect(COMBO_KO.spring_song).toBe('바람노래')
    expect(COMBO_KO.firmness).toBe('견고')
  })

  it('uses wiki rarity names, not English loanwords', () => {
    const tiers: Tier[] = ['common', 'advanced', 'rare', 'legend', 'solid']
    expect(tiers.map((t) => TIER_KO[t])).toEqual(['일반', '고급', '희귀', '전설', '결속'])
  })

  it('lists combos in wiki section order', () => {
    expect(COMBO_ORDER).toHaveLength(20)
    expect(new Set(COMBO_ORDER)).toEqual(new Set(ARTIFACT_SETS))
  })
})

describe('publicMediaPath', () => {
  it('keeps the wiki filename when it differs from value', () => {
    expect(
      publicMediaPath('https://img.sephiria.wiki/artifacts/calges_2.png', 'artifacts', 'calges')
    ).toBe('/images/artifacts/calges_2.png')
    expect(
      publicMediaPath(
        'https://img.sephiria.wiki/artifacts/lightningboomerang.png',
        'artifacts',
        'lightning_boomerang'
      )
    ).toBe('/images/artifacts/lightningboomerang.png')
    expect(
      publicMediaPath('/slabs/home-town.png', 'slabs', 'home_town')
    ).toBe('/images/slabs/home-town.png')
  })

  it('resolves every catalog image to a file that exists on disk', () => {
    for (const a of ARTIFACTS) {
      expect(existsSync(resolve(publicRoot, a.image.slice(1))), a.value + ' ' + a.image).toBe(true)
    }
    for (const t of TABLETS) {
      expect(existsSync(resolve(publicRoot, t.image.slice(1))), t.value + ' ' + t.image).toBe(true)
    }
  })
})
