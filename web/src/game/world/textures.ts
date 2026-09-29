import * as THREE from 'three'

// All textures are painted on canvases at start-up: no binary assets to ship
// and every surface stays crisp at any resolution.

function canvas(width: number, height: number) {
  const element = document.createElement('canvas')
  element.width = width
  element.height = height
  const context = element.getContext('2d')
  if (!context) throw new Error('2D canvas unavailable')
  return { element, context }
}

function finish(element: HTMLCanvasElement, options: { repeat?: [number, number]; srgb?: boolean } = {}) {
  const texture = new THREE.CanvasTexture(element)
  if (options.srgb !== false) texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  if (options.repeat) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(...options.repeat)
  }
  return texture
}

/** Soft radial falloff used for contact shadows and glows. */
export function radialTexture(inner = 'rgba(0,0,0,0.85)', outer = 'rgba(0,0,0,0)') {
  const { element, context } = canvas(128, 128)
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, inner)
  gradient.addColorStop(1, outer)
  context.fillStyle = gradient
  context.fillRect(0, 0, 128, 128)
  return finish(element, { srgb: false })
}

/** Speckled synthetic sports floor with a faint grain. */
export function floorTexture() {
  const size = 512
  const { element, context } = canvas(size, size)
  context.fillStyle = '#4f1a17'
  context.fillRect(0, 0, size, size)
  const image = context.getImageData(0, 0, size, size)
  let seed = 7
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  for (let i = 0; i < image.data.length; i += 4) {
    const n = (random() - 0.5) * 22
    image.data[i] += n
    image.data[i + 1] += n * 0.6
    image.data[i + 2] += n * 0.5
  }
  context.putImageData(image, 0, 0)
  context.globalAlpha = 0.05
  for (let i = 0; i < 900; i += 1) {
    context.fillStyle = random() > 0.5 ? '#ffffff' : '#000000'
    context.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2)
  }
  return finish(element, { repeat: [6, 6] })
}

/** Knotted net mesh: transparent cells with dark strings. */
export function netTexture() {
  const { element, context } = canvas(256, 64)
  context.clearRect(0, 0, 256, 64)
  context.strokeStyle = 'rgba(12,18,30,0.95)'
  context.lineWidth = 2
  const cell = 16
  for (let x = 0; x <= 256; x += cell) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, 64); context.stroke() }
  for (let y = 0; y <= 64; y += cell) { context.beginPath(); context.moveTo(0, y); context.lineTo(256, y); context.stroke() }
  return finish(element, { repeat: [7, 1.2] })
}

/** Court surround board with a wordmark. */
export function barrierTexture(label: string, sub: string) {
  const { element, context } = canvas(1024, 256)
  const gradient = context.createLinearGradient(0, 0, 0, 256)
  gradient.addColorStop(0, '#16336b')
  gradient.addColorStop(1, '#0c1f45')
  context.fillStyle = gradient
  context.fillRect(0, 0, 1024, 256)
  context.fillStyle = 'rgba(255,255,255,0.08)'
  context.fillRect(0, 0, 1024, 10)
  context.fillStyle = '#ffffff'
  context.font = '800 118px "Barlow Condensed", "Arial Narrow", sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(label, 512, 118)
  context.fillStyle = '#ff6a3d'
  context.font = '600 34px "Barlow Condensed", "Arial Narrow", sans-serif'
  context.fillText(sub, 512, 200)
  return finish(element)
}

/** Vertical gradient for the dark hall behind the court. */
export function hallTexture() {
  const { element, context } = canvas(16, 512)
  const gradient = context.createLinearGradient(0, 0, 0, 512)
  gradient.addColorStop(0, '#05070d')
  gradient.addColorStop(0.55, '#0b1222')
  gradient.addColorStop(1, '#131c30')
  context.fillStyle = gradient
  context.fillRect(0, 0, 16, 512)
  return finish(element)
}

/** Pimpled rubber normal-ish detail used as a roughness map on paddles. */
export function rubberTexture() {
  const { element, context } = canvas(128, 128)
  context.fillStyle = '#808080'
  context.fillRect(0, 0, 128, 128)
  context.fillStyle = '#6a6a6a'
  for (let y = 0; y < 128; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < 128; x += 6) { context.beginPath(); context.arc(x, y, 1.4, 0, Math.PI * 2); context.fill() }
  return finish(element, { srgb: false, repeat: [2, 2] })
}
