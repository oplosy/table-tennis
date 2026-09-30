import { describe, expect, it } from 'vitest'
import { renderProfile } from './profile'

describe('renderProfile', () => {
  it('gives desktop the full chain', () => {
    expect(renderProfile('high')).toMatchObject({
      tier: 'high', pixelRatioCap: 2, shadowMapSize: 2048, softShadows: true, msaaSamples: 4, ao: true, fxaa: false,
    })
  })

  it('keeps the fast tier cheap', () => {
    const low = renderProfile('low')
    expect(low).toMatchObject({
      tier: 'low', pixelRatioCap: 1.25, shadowMapSize: 1024, softShadows: false, msaaSamples: 0, ao: false, fxaa: true,
    })
    expect(low.bloom.levels).toBeLessThan(renderProfile('high').bloom.levels)
  })

  it('grades both tiers alike so switching quality keeps the look', () => {
    const low = renderProfile('low')
    const high = renderProfile('high')
    expect(low.grading).toEqual(high.grading)
    expect(low.bloom.threshold).toBe(high.bloom.threshold)
  })

  it('returns a fresh object each call', () => {
    const a = renderProfile('high')
    a.bloom.intensity = 99
    expect(renderProfile('high').bloom.intensity).not.toBe(99)
  })
})
