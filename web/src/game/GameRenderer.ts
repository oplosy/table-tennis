import * as THREE from 'three'
// Bundled as a hashed asset so the server can cache it forever.
import environmentUrl from '../assets/env/arena_1k.hdr?url'
import arenaUrl from '../assets/models/arena.glb?url'
import lightmapUrl from '../assets/models/arena_lightmap.webp?url'
import paddleUrl from '../assets/models/paddle.glb?url'
import tableUrl from '../assets/models/table.glb?url'
import { HALF_LENGTH, TABLE_HEIGHT, sideSign, type MatchEvent, type Side, type Vec3 } from '@rally/core'
import { FrameBudget } from './render/budget'
import { loadEnvironment, pmremBaker, type EnvironmentHandle } from './render/environment'
import { createPostFx, type PostFx } from './render/postfx'
import { canDraw, renderProfile, type RenderProfile } from './render/profile'
import { adoptArenaModel, createArena, createLights } from './world/arena'
import { gltfSource, loadModels, type ModelsHandle } from './world/assets'
import { BallView } from './world/ball'
import { Effects } from './world/effects'
import { PaddleView } from './world/paddle'
import { Scoreboard, boardFor } from './world/scoreboard'
import { adoptTableModel, castTableShadows, createNet, createTable, type NetView } from './world/table'
import type { GameSession } from './session/Session'
import type { Quality } from '../state/settings'

const HOME_COLORS = { forehand: '#d8262f', backhand: '#15171c', handle: '#b88a52', accent: '#ff6a3d' }
const AWAY_COLORS = { forehand: '#d8262f', backhand: '#15171c', handle: '#3c4a63', accent: '#39c2ff' }

/**
 * Owns the WebGL renderer, the scene and the camera. Each animation frame it
 * advances the active session to real time and mirrors its state into 3D.
 */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 120)
  private readonly canvas: HTMLCanvasElement
  private readonly ball = new BallView()
  private readonly paddles: Record<Side, PaddleView>
  private readonly net: NetView
  private readonly effects = new Effects()
  private readonly environment: EnvironmentHandle
  private readonly models: ModelsHandle
  private readonly scoreboard = new Scoreboard()
  private names: Record<Side, string> | null = null
  readonly postfx: PostFx
  private readonly profile: RenderProfile
  private readonly raycaster = new THREE.Raycaster()
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(TABLE_HEIGHT + 0.1))
  private session: GameSession | null = null
  private frameHandle = 0
  private lastFrame = 0
  private shake = 0
  private heat = 0
  private lookAt = new THREE.Vector3(0, TABLE_HEIGHT, 0)
  private ballOffset = new THREE.Vector3()
  private lastBall = new THREE.Vector3()
  private orbit = 0
  private resizeObserver: ResizeObserver
  private eventListeners = new Set<(events: MatchEvent[]) => void>()
  private touchMode = false
  private drawable = false
  private readonly budget = new FrameBudget()

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    this.canvas = canvas
    this.profile = renderProfile(quality)
    // Anti-aliasing and tone mapping live in the post chain (render/postfx.ts).
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.profile.pixelRatioCap))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NoToneMapping
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = this.profile.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap

    this.environment = loadEnvironment(this.scene, environmentUrl, pmremBaker(this.renderer))
    this.scene.background = new THREE.Color('#060911')
    this.scene.fog = new THREE.Fog('#060911', 14, 34)

    const arena = createArena(quality)
    const table = createTable()
    this.scene.add(arena, createLights(this.profile), table)
    this.net = createNet()
    this.paddles = { home: new PaddleView('home', HOME_COLORS), away: new PaddleView('away', AWAY_COLORS) }
    this.scene.add(this.net.group, this.paddles.home.root, this.paddles.away.root, this.ball.group, this.effects.group)
    // The procedural world above is what shows until the Blender models arrive.
    let bakedFloor = false
    this.models = loadModels({ table: tableUrl, paddle: paddleUrl, arena: arenaUrl, lightmap: lightmapUrl }, gltfSource(), {
      table: (model) => adoptTableModel(table, this.net, model, bakedFloor),
      paddle: (model) => { this.paddles.home.adopt(model); this.paddles.away.adopt(model) },
      arena: (model, lightmap) => {
        adoptArenaModel(arena, model, lightmap, this.scoreboard)
        // The table's floor shadow is now in the lightmap, whichever table is showing.
        bakedFloor = true
        castTableShadows(table, false)
      },
    })
    this.postfx = createPostFx(this.renderer, this.scene, this.camera, this.profile)

    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas)
    this.resize()
    this.camera.position.set(0, 2.2, 4.4)
  }

  setSession(session: GameSession | null) {
    this.session = session
    this.ball.resetTrail()
    this.ballOffset.set(0, 0, 0)
  }

  /** Player names for the hall's screens; `null` (menus, demo rally) shows the wordmark instead. */
  setNames(names: Record<Side, string> | null) { this.names = names }

  /** Presentation events (sounds, HUD) after effects were applied. */
  onEvents(listener: (events: MatchEvent[]) => void) {
    this.eventListeners.add(listener)
    return () => { this.eventListeners.delete(listener) }
  }

  start() {
    const loop = (now: number) => {
      this.frameHandle = requestAnimationFrame(loop)
      this.frame(now)
    }
    this.frameHandle = requestAnimationFrame(loop)
  }

  dispose() {
    cancelAnimationFrame(this.frameHandle)
    this.resizeObserver.disconnect()
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of materials) {
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose()
          material.dispose()
        }
      }
    })
    this.models.dispose()
    this.scoreboard.dispose()
    this.postfx.dispose()
    this.environment.dispose()
    this.renderer.dispose()
    // A canvas that left the page takes its context along; browsers only allow a handful
    // and would otherwise keep this one until garbage collection. A canvas still in the
    // page (React's development remount) will be mounted again and must keep it.
    if (!this.canvas.isConnected) this.renderer.forceContextLoss()
  }

  /** Development aid: renders `ms` of synthetic time in 1/60 s frames. */
  simulate(ms: number) {
    let now = this.lastFrame || performance.now()
    for (let t = 0; t < ms; t += 1000 / 60) { now += 1000 / 60; this.frame(now) }
  }

  private frame(now: number) {
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 1 / 60
    this.lastFrame = now
    const session = this.session
    if (session) {
      const events = session.update(now)
      if (events.length) this.present(events)
      const frame = session.frame()
      const s = session.match.state

      // Hide small snaps caused by network corrections behind a quick blend.
      const actual = new THREE.Vector3(frame.ball.x, frame.ball.y, frame.ball.z)
      const jump = actual.distanceTo(this.lastBall)
      if (session.localSide && s.phase === 'rally' && jump > 0.12 && jump < 1.5) this.ballOffset.subVectors(this.lastBall, actual)
      this.ballOffset.multiplyScalar(Math.exp(-dt * 14))
      const shown = actual.clone().add(this.ballOffset)
      this.lastBall.copy(shown)

      this.ball.setVisible(s.phase !== 'game_over' || s.tick - s.phaseTick < 60)
      this.heat = Math.max(0, this.heat - dt * 1.5)
      this.ball.update(shown, frame.velocity, frame.spin, dt, this.camera, this.heat)
      for (const side of ['home', 'away'] as const) this.paddles[side].update(frame.paddles[side], shown, dt, frame.ready[side])
      this.effects.showLanding(frame.landing)
      this.updateCamera(session, shown, dt)
    }
    // Read every frame rather than on events: a reconnect or rematch changes the score without any.
    this.scoreboard.show(boardFor(this.session, this.names))
    this.net.update(dt)
    this.effects.update(dt)
    if (this.drawable) {
      // Integrated GPUs cannot afford ambient occlusion at 60 fps: drop it for the session.
      if (this.postfx.ambientOcclusion && this.budget.sample(dt)) this.postfx.setAmbientOcclusion(false)
      this.postfx.render(dt)
    }
  }

  private present(events: MatchEvent[]) {
    for (const event of events) {
      switch (event.type) {
        case 'bounce': this.effects.bounce(event.x, event.z, Math.min(1, event.speed / 10)); break
        case 'net': this.net.shake(Math.min(1, event.speed / 6)); break
        case 'hit':
          this.paddles[event.side].swing(event.power)
          this.effects.flash(this.session!.match.state.ball.p, event.power)
          if (event.smash) { this.heat = 1; if (event.side !== this.session?.localSide) this.shake = 0.6 }
          break
        case 'serve': this.paddles[event.side].swing(0.4); break
        case 'toss': this.ball.resetTrail(); break
        case 'next_serve': this.ball.resetTrail(); break
      }
    }
    for (const listener of this.eventListeners) listener(events)
  }

  /** Remote strokes arrive before their replayed `hit` event; swing immediately. */
  swing(side: Side, power: number) { this.paddles[side].swing(power) }

  private updateCamera(session: GameSession, ball: Vec3, dt: number) {
    const side = session.localSide
    const desired = new THREE.Vector3()
    const focus = new THREE.Vector3()
    if (side) {
      const s = sideSign(side)
      const paddle = session.paddle(side)
      const aspect = this.camera.aspect
      const portrait = aspect < 1
      // Portrait screens: climb higher and look down so the table fills the height.
      const back = portrait ? 2.1 + (1 - aspect) * 1.5 : 2.15
      desired.set(paddle.x * (portrait ? 0.15 : 0.32), portrait ? 2.75 : 1.72, s * (HALF_LENGTH + back))
      focus.set(paddle.x * 0.12 + ball.x * 0.08, TABLE_HEIGHT - (portrait ? 0.1 : -0.02), portrait ? s * 0.15 : -s * 0.75)
      this.camera.fov = portrait ? 66 : 50
    } else {
      // Attract mode: slow orbit that keeps the whole table in frame.
      this.orbit += dt * 0.05
      const radius = 4.6
      desired.set(Math.sin(this.orbit) * radius, 2.1 + Math.sin(this.orbit * 0.7) * 0.25, Math.cos(this.orbit) * radius)
      focus.set(ball.x * 0.2, TABLE_HEIGHT, ball.z * 0.15)
      this.camera.fov = 42
    }
    const follow = 1 - Math.exp(-dt * 5)
    this.camera.position.lerp(desired, follow)
    this.lookAt.lerp(focus, follow)
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5)
      const amount = this.shake * this.shake * 0.03
      this.camera.position.x += (Math.random() - 0.5) * amount
      this.camera.position.y += (Math.random() - 0.5) * amount
    }
    this.camera.lookAt(this.lookAt)
    this.camera.updateProjectionMatrix()
  }

  private resize() {
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    this.drawable = canDraw(width, height)
    if (!this.drawable) return
    this.postfx.setSize(width, height)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  // Pointer → paddle target on a horizontal plane just above the table.
  private onPointerMove = (event: PointerEvent) => {
    this.touchMode = event.pointerType === 'touch'
    const controller = this.session?.controller
    if (!controller) return
    const rect = this.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(ndc, this.camera)
    const hit = new THREE.Vector3()
    if (!this.raycaster.ray.intersectPlane(this.plane, hit)) return
    // On touch screens the finger would hide the paddle: hold it a little ahead.
    const lead = this.touchMode ? -sideSign(controller.side) * 0.28 : 0
    controller.setTarget(hit.x, hit.z + lead)
  }

  private onPointerDown = (event: PointerEvent) => {
    this.onPointerMove(event)
    this.session?.controller?.press()
  }

  private onPointerUp = () => { this.session?.controller?.release() }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.code === 'Space' && !event.repeat && this.session?.controller) { event.preventDefault(); this.session.controller.press() }
  }

  private onKeyUp = (event: KeyboardEvent) => {
    if (event.code === 'Space') this.session?.controller?.release()
  }
}
