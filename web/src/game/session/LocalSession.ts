import {
  AIController, AI_PROFILES, Match, TICK_RATE, defaultConfig, other, tickWithControllers,
  type Controller, type Difficulty, type MatchEvent, type PaddlePose, type Side,
} from '@rally/core'
import { MouseController } from '../input/MouseController'
import { GameSession } from './Session'

export interface LocalOptions {
  difficulty: Difficulty
  bestOf: number
  timeScale: number
  assist: boolean
}

const MAX_CATCH_UP_MS = 100

/** Player versus the computer, simulated entirely in the browser. */
export class LocalSession extends GameSession {
  readonly localSide: Side = 'home'
  readonly match: Match
  readonly ai: AIController
  private controllers: Controller[]
  private last = -1
  private backlog = 0

  constructor(options: LocalOptions) {
    const mouse = new MouseController('home', options.assist ? 0.26 : 0.22)
    super(mouse)
    this.assist = options.assist
    const profile = AI_PROFILES[options.difficulty]
    const seed = (Math.random() * 2 ** 31) | 0
    this.ai = new AIController('away', profile, seed ^ 0x5bd1e995)
    this.match = new Match(defaultConfig({
      bestOf: options.bestOf,
      timeScale: options.timeScale,
      seed,
      firstServer: Math.random() < 0.5 ? 'home' : 'away',
      skill: {
        home: options.assist ? { accuracy: 0.7, netAssist: 0.8 } : { accuracy: 0.6, netAssist: 0.35 },
        away: profile.skill,
      },
    }))
    this.controllers = [mouse, this.ai]
  }

  paddle(side: Side): PaddlePose {
    return side === 'home' ? this.controller!.pose : this.ai.pose
  }

  update(now: number): MatchEvent[] {
    if (this.last < 0 || this.paused) { this.last = now; return [] }
    this.backlog += (Math.min(now - this.last, MAX_CATCH_UP_MS) * TICK_RATE) / 1000
    this.last = now
    const count = Math.floor(this.backlog)
    this.backlog -= count
    this.fraction = this.backlog
    const events = this.runTicks(count, () => tickWithControllers(this.match, this.controllers, (side) => this.paddle(other(side))).events)
    this.emit(events)
    return events
  }
}

/** Two computer players rallying behind the menus. Restarts forever. */
export class DemoSession extends GameSession {
  readonly localSide = null
  match: Match
  private home: AIController
  private away: AIController
  private last = -1
  private backlog = 0

  constructor() {
    super(null)
    this.assist = false
    this.home = new AIController('home', AI_PROFILES.hard, 17)
    this.away = new AIController('away', AI_PROFILES.hard, 29)
    this.match = this.newMatch()
  }

  private newMatch() {
    return new Match(defaultConfig({ bestOf: 1, timeScale: 0.62, seed: (Math.random() * 1e9) | 0, skill: { home: AI_PROFILES.hard.skill, away: AI_PROFILES.hard.skill } }))
  }

  paddle(side: Side) { return side === 'home' ? this.home.pose : this.away.pose }

  update(now: number): MatchEvent[] {
    if (this.last < 0 || this.paused) { this.last = now; return [] }
    this.backlog += (Math.min(now - this.last, MAX_CATCH_UP_MS) * TICK_RATE) / 1000
    this.last = now
    const count = Math.floor(this.backlog)
    this.backlog -= count
    this.fraction = this.backlog
    const events = this.runTicks(count, () => tickWithControllers(this.match, [this.home, this.away], (side) => this.paddle(side)).events)
    if (this.match.state.phase === 'match_over' && this.match.state.tick - this.match.state.phaseTick > TICK_RATE * 2) this.match = this.newMatch()
    this.emit(events)
    return events
  }
}
