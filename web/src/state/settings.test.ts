import { describe, expect, it, vi } from 'vitest'
import { defaultQuality } from './settings'

describe('defaultQuality', () => {
  it('starts touch devices on the fast tier', () => {
    const matchMedia = vi.fn(() => ({ matches: true }))
    expect(defaultQuality(matchMedia)).toBe('low')
    expect(matchMedia).toHaveBeenCalledWith('(pointer: coarse)')
  })

  it('starts mouse-driven devices on the high tier', () => {
    expect(defaultQuality(() => ({ matches: false }))).toBe('high')
  })

  it('falls back to high where media queries are unavailable', () => {
    expect(defaultQuality(undefined)).toBe('high')
  })
})
