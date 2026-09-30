// n8ao ships JavaScript only; this covers the part of its API we use.
declare module 'n8ao' {
  import type { Camera, Color, Scene } from 'three'
  import { Pass } from 'postprocessing'

  export type N8AOQualityMode = 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'

  export interface N8AOConfiguration {
    aoRadius: number
    distanceFalloff: number
    intensity: number
    halfRes: boolean
    depthAwareUpsampling: boolean
    transparencyAware: boolean
    gammaCorrection: boolean
    screenSpaceRadius: boolean
    color: Color
  }

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number)
    configuration: N8AOConfiguration
    setQualityMode(mode: N8AOQualityMode): void
  }
}
