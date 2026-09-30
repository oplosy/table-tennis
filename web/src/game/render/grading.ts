import { SRGBColorSpace, Uniform } from 'three'
import { BlendFunction, Effect } from 'postprocessing'

// The result is clamped at zero: the library's contrast effect lets dark pixels
// go negative, and the sRGB → linear conversion before the next effect then
// turns them into NaN, which shows up as white blocks in the dark stands.
const fragmentShader = /* glsl */ `
uniform float contrast;
uniform float saturation;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 color = max((inputColor.rgb - 0.5) * (1.0 + contrast) + 0.5, 0.0);
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = max(mix(vec3(luma), color, 1.0 + saturation), 0.0);
  outputColor = vec4(color, inputColor.a);
}
`

/** Contrast around mid-grey and saturation, applied to the tone-mapped image. 0 means no change. */
export class GradingEffect extends Effect {
  constructor({ contrast, saturation }: { contrast: number; saturation: number }) {
    super('GradingEffect', fragmentShader, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map([['contrast', new Uniform(contrast)], ['saturation', new Uniform(saturation)]]),
    })
    this.inputColorSpace = SRGBColorSpace
  }
}
