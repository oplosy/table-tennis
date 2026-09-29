import type { MatchEvent } from '@rally/core'
import { Sound } from './audio/Sound'
import { GameRenderer } from './GameRenderer'
import { DemoSession } from './session/LocalSession'
import type { GameSession } from './session/Session'
import type { Quality } from '../state/settings'

/**
 * One renderer for the whole app: the canvas stays mounted while pages swap
 * the session (demo rally behind menus, local match, online match).
 */
class Stage {
  renderer: GameRenderer | null = null
  readonly sound = new Sound()
  private session: GameSession | null = null
  private demo: DemoSession | null = null
  private unsubscribe: (() => void) | null = null

  mount(canvas: HTMLCanvasElement, quality: Quality) {
    this.renderer = new GameRenderer(canvas, quality)
    this.unsubscribe = this.renderer.onEvents((events) => this.onEvents(events))
    this.renderer.start()
    this.renderer.setSession(this.session ?? this.showDemo())
  }

  unmount() {
    this.unsubscribe?.()
    this.renderer?.dispose()
    this.renderer = null
  }

  /** Makes `session` the one on screen; `null` returns to the demo rally. */
  setSession(session: GameSession | null) {
    if (this.session && this.session !== session) this.session.dispose()
    this.session = session
    this.renderer?.setSession(session ?? this.showDemo())
  }

  get current() { return this.session }

  private showDemo() {
    this.demo ??= new DemoSession()
    return this.demo
  }

  private onEvents(events: MatchEvent[]) {
    const listener = this.session?.localSide ?? null
    if (this.session) this.sound.play(events, listener)
    else this.sound.play(events.filter((e) => e.type === 'bounce' || e.type === 'hit' || e.type === 'serve'), null)
  }
}

export const stage = new Stage()

if (import.meta.env.DEV) (window as unknown as { rally: Stage }).rally = stage
