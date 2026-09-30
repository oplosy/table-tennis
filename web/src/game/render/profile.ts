import type { Quality } from '../../state/settings'

/** Everything the renderer and post chain need to know about a quality tier. */
export interface RenderProfile {
  tier: Quality
  pixelRatioCap: number
  shadowMapSize: number
  softShadows: boolean
  /** Composer MSAA samples; 0 turns it off. */
  msaaSamples: number
  ao: boolean
  fxaa: boolean
  bloom: { intensity: number; threshold: number; levels: number }
  grading: { contrast: number; saturation: number; vignette: number }
}

// Shared by both tiers so switching quality changes cost, not the look.
const GRADING = { contrast: 0.12, saturation: 0.12, vignette: 0.35 }
const BLOOM_THRESHOLD = 0.9

/** Desktop gets the full chain; "Fast" keeps phones at 60 fps. */
export function renderProfile(quality: Quality): RenderProfile {
  if (quality === 'high') {
    return {
      tier: 'high', pixelRatioCap: 2, shadowMapSize: 2048, softShadows: true, msaaSamples: 4, ao: true, fxaa: false,
      bloom: { intensity: 0.7, threshold: BLOOM_THRESHOLD, levels: 7 },
      grading: { ...GRADING },
    }
  }
  return {
    tier: 'low', pixelRatioCap: 1.25, shadowMapSize: 1024, softShadows: false, msaaSamples: 0, ao: false, fxaa: true,
    bloom: { intensity: 0.6, threshold: BLOOM_THRESHOLD, levels: 4 },
    grading: { ...GRADING },
  }
}
