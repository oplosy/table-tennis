import {
  Match, TICK_RATE, Timeline, other, restPose, tickWithControllers,
  type Action, type MatchClock, type MatchConfig, type MatchEvent, type MatchState, type PaddlePose,
  type ServerMessage, type Side, type TickOps,
} from '@rally/core'
import type { Connection } from '../../net/connection'
import { MouseController } from '../input/MouseController'
import { GameSession } from './Session'

const PADDLE_SEND_INTERVAL = TICK_RATE / 30
/** Remote paddles are shown slightly in the past so samples can be interpolated. */
const REMOTE_DELAY = TICK_RATE * 0.06
/** Beyond this the client stops simulating and waits for a sync. */
const MAX_STEPS_PER_FRAME = TICK_RATE

const eventKey = (e: MatchEvent) => `${e.type}:${e.tick}:${'side' in e ? e.side : ''}`

/**
 * Online match. Both browsers and the server run the same deterministic
 * simulation; only serves and hits travel over the network, stamped with the
 * tick they happened at. Late actions are applied by rewinding the timeline.
 */
export class OnlineSession extends GameSession {
  readonly localSide: Side
  readonly match: Match
  readonly timeline: Timeline
  private readonly connection: Connection
  private clock: MatchClock
  private remote: Array<{ tick: number; pose: PaddlePose }> = []
  private remoteOverride: { pose: PaddlePose; until: number } | null = null
  private presented = new Map<string, number>()
  private pending: MatchEvent[] = []
  private lastPaddleSend = 0
  private unsubscribe: () => void
  /** Called for remote strokes so the view can swing the opponent's paddle. */
  onRemoteHit: ((side: Side, power: number) => void) | null = null

  constructor(connection: Connection, side: Side, config: MatchConfig, state: MatchState, clock: MatchClock, assist: boolean) {
    super(new MouseController(side, 0.24))
    this.assist = assist
    this.localSide = side
    this.connection = connection
    this.clock = clock
    this.match = new Match(config, state)
    this.timeline = new Timeline(this.match, 1.5)
    this.unsubscribe = connection.subscribe((message) => this.receive(message))
  }

  get serverPaused() { return this.clock.paused }

  paddle(side: Side): PaddlePose {
    if (side === this.localSide) return this.controller!.pose
    return this.remotePose()
  }

  private get targetTick() {
    return this.connection.clock.tick() - this.clock.offset
  }

  update(): MatchEvent[] {
    if (this.clock.paused) return this.flush([])
    const target = this.targetTick
    const whole = Math.floor(target)
    let count = whole - this.timeline.tick
    this.fraction = count >= 0 ? target - whole : 0
    if (count > MAX_STEPS_PER_FRAME) count = MAX_STEPS_PER_FRAME
    const ops: TickOps = {
      step: () => this.timeline.step(),
      apply: (action) => this.applyLocal(action),
    }
    const events = count > 0
      ? this.runTicks(count, () => tickWithControllers(this.match, [this.controller!], (s) => this.paddle(s), ops).events)
      : []
    if (this.timeline.tick - this.lastPaddleSend >= PADDLE_SEND_INTERVAL) {
      this.lastPaddleSend = this.timeline.tick
      this.connection.send({ type: 'paddle', tick: this.timeline.tick, pose: this.controller!.pose })
    }
    return this.flush(events)
  }

  private applyLocal(action: Action) {
    const tick = this.timeline.tick
    const result = this.timeline.submit(tick, action)
    this.pending.push(...result.events)
    if (result.accepted) this.connection.send({ type: 'action', tick, action })
    return result.accepted
  }

  private receive(message: ServerMessage) {
    switch (message.type) {
      case 'action': {
        const { action, tick } = message
        if (action.side === this.localSide) return
        const result = this.timeline.submit(tick, action)
        this.pending.push(...result.events)
        if (action.kind === 'hit') {
          this.remoteOverride = { pose: { ...action.contact }, until: performance.now() + 220 }
          this.onRemoteHit?.(action.side, action.intent.power)
        }
        break
      }
      case 'paddle':
        if (message.side === this.localSide) return
        this.remote.push({ tick: message.tick, pose: message.pose })
        if (this.remote.length > 40) this.remote.shift()
        break
      case 'sync':
        this.clock = message.clock
        this.pending.push(...this.timeline.resync(message.state))
        break
    }
  }

  /** Presents each event once, even if a rewind replays it. */
  private flush(events: MatchEvent[]) {
    const fresh: MatchEvent[] = []
    for (const event of [...this.pending, ...events]) {
      const key = eventKey(event)
      if (this.presented.has(key)) continue
      this.presented.set(key, event.tick)
      fresh.push(event)
    }
    this.pending = []
    if (this.presented.size > 400) {
      const horizon = this.timeline.tick - TICK_RATE * 3
      for (const [key, tick] of this.presented) if (tick < horizon) this.presented.delete(key)
    }
    fresh.sort((a, b) => a.tick - b.tick)
    this.emit(fresh)
    return fresh
  }

  private remotePose(): PaddlePose {
    const side = other(this.localSide)
    if (this.remoteOverride && performance.now() < this.remoteOverride.until) return this.remoteOverride.pose
    if (this.remote.length === 0) return restPose(side)
    const at = this.timeline.tick - REMOTE_DELAY
    for (let i = this.remote.length - 1; i > 0; i -= 1) {
      const a = this.remote[i - 1], b = this.remote[i]
      if (a.tick <= at && b.tick >= at) {
        const f = b.tick === a.tick ? 1 : (at - a.tick) / (b.tick - a.tick)
        return { x: a.pose.x + (b.pose.x - a.pose.x) * f, y: a.pose.y + (b.pose.y - a.pose.y) * f, z: a.pose.z + (b.pose.z - a.pose.z) * f }
      }
    }
    return this.remote[this.remote.length - 1].pose
  }

  dispose() {
    super.dispose()
    this.unsubscribe()
  }
}
