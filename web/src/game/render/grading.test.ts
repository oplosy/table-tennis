import { describe, expect, it } from 'vitest'
import { GradingEffect } from './grading'

describe('GradingEffect', () => {
  it('exposes contrast and saturation as uniforms', () => {
    const effect = new GradingEffect({ contrast: 0.12, saturation: 0.2 })
    expect(effect.uniforms.get('contrast')?.value).toBe(0.12)
    expect(effect.uniforms.get('saturation')?.value).toBe(0.2)
  })

  it('grades in display space, where mid-grey is 0.5', () => {
    expect(new GradingEffect({ contrast: 0, saturation: 0 }).inputColorSpace).toBe('srgb')
  })
})
