import * as THREE from 'three'
import {
  BloomEffect, EffectComposer, EffectPass, FXAAEffect, RenderPass, ToneMappingEffect, ToneMappingMode, VignetteEffect,
} from 'postprocessing'
import { N8AOPostPass } from 'n8ao'
import { GradingEffect } from './grading'
import type { RenderProfile } from './profile'

export interface PostFx {
  /** Development aid: `false` draws straight to the canvas with the same tone mapping. */
  enabled: boolean
  render(dt: number): void
  setSize(width: number, height: number): void
  dispose(): void
}

/**
 * Scene → (N8AO) → bloom, AgX tone mapping and grading merged into one pass
 * → (FXAA). Rendering happens in half float so the lamps keep their HDR
 * values until bloom picks them up.
 */
export function createPostFx(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, profile: RenderProfile): PostFx {
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: profile.msaaSamples })
  composer.addPass(new RenderPass(scene, camera))

  if (profile.ao) {
    const ao = new N8AOPostPass(scene, camera)
    ao.setQualityMode('Medium')
    // World-space radius in metres: contact shadow under the table top, net and feet.
    Object.assign(ao.configuration, { aoRadius: 0.5, distanceFalloff: 0.5, intensity: 2.5, halfRes: true })
    composer.addPass(ao)
  }

  composer.addPass(new EffectPass(
    camera,
    new BloomEffect({
      mipmapBlur: true, luminanceThreshold: profile.bloom.threshold, luminanceSmoothing: 0.12,
      intensity: profile.bloom.intensity, levels: profile.bloom.levels,
    }),
    new ToneMappingEffect({ mode: ToneMappingMode.AGX }),
    new GradingEffect(profile.grading),
    new VignetteEffect({ offset: 0.3, darkness: profile.grading.vignette }),
  ))
  // FXAA samples neighbouring pixels, so it runs on the finished image in its own pass.
  if (profile.fxaa) composer.addPass(new EffectPass(camera, new FXAAEffect()))

  let enabled = true
  return {
    get enabled() { return enabled },
    set enabled(value: boolean) {
      enabled = value
      renderer.toneMapping = value ? THREE.NoToneMapping : THREE.AgXToneMapping
    },
    render(dt) {
      if (enabled) composer.render(dt)
      else renderer.render(scene, camera)
    },
    setSize(width, height) { composer.setSize(width, height, false) },
    dispose() { composer.dispose() },
  }
}
