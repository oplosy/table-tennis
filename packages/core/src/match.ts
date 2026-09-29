import {
  AUTO_SERVE_TICKS, CONTACT_TOLERANCE, DEAD_BALL_TICKS, GAME_BREAK_TICKS, HIT_MAX_Y, HIT_MIN_Y, RALLY_STALL_TICKS,
  TICK_RATE, TOSS_SPEED, other, type Side,
} from './constants'
import { cloneBall, distance, integrate, stepBall, type BallState, type Contact, type Vec3 } from './physics'
import { Rng } from './random'
import { NEUTRAL_INTENT, clampIntent, clampSkill, isSmash, planServe, planShot, tossOrigin, type ShotIntent, type ShotSkill } from './shot'

export type Phase = 'pre_serve' | 'toss' | 'rally' | 'dead' | 'game_over' | 'match_over'
export type PointReason = 'serve_fault' | 'net' | 'out' | 'double_bounce' | 'missed' | 'own_side' | 'stall'
/** What the rules are waiting for next during a live ball. */
export type Expect = 'server_side' | 'receiver_side' | 'hit'

export interface MatchConfig {
  bestOf: number
  pointsToWin: number
  /** Simulated seconds per real second; < 1 slows the game down without changing trajectories. */
  timeScale: number
  seed: number
  firstServer: Side
  skill: Record<Side, ShotSkill>
}

export interface MatchState {
  tick: number
  phase: Phase
  phaseTick: number
  ball: BallState
  lastHitter: Side
  expect: Expect
  isServe: boolean
  netTouch: boolean
  hits: number
  lastContactTick: number
  server: Side
  gameFirstServer: Side
  points: Record<Side, number>
  games: Record<Side, number>
  gameIndex: number
  pointWinner: Side | null
  pointReason: PointReason | null
  winner: Side | null
  serveIntent: ShotIntent | null
  rng: number
}

export type MatchEvent =
  | { type: 'bounce'; tick: number; side: Side; x: number; z: number; speed: number }
  | { type: 'net'; tick: number; cord: boolean; speed: number }
  | { type: 'floor'; tick: number; speed: number }
  | { type: 'toss'; tick: number; side: Side }
  | { type: 'serve'; tick: number; side: Side; power: number }
  | { type: 'hit'; tick: number; side: Side; power: number; smash: boolean; spin: number }
  | { type: 'dead'; tick: number; winner: Side | null; reason: PointReason | 'let' }
  | { type: 'point'; tick: number; winner: Side; reason: PointReason; points: Record<Side, number> }
  | { type: 'game'; tick: number; winner: Side; games: Record<Side, number> }
  | { type: 'match'; tick: number; winner: Side }
  | { type: 'next_serve'; tick: number; server: Side }

export const DEFAULT_SKILL: ShotSkill = { accuracy: 0.6, netAssist: 0.6 }

export function defaultConfig(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return {
    bestOf: 3,
    pointsToWin: 11,
    timeScale: 0.6,
    seed: 1,
    firstServer: 'home',
    skill: { home: DEFAULT_SKILL, away: DEFAULT_SKILL },
    ...overrides,
  }
}

export function sanitizeConfig(config: MatchConfig): MatchConfig {
  const bestOf = [1, 3, 5, 7].includes(config.bestOf) ? config.bestOf : 3
  const pointsToWin = [5, 7, 11, 21].includes(config.pointsToWin) ? config.pointsToWin : 11
  const timeScale = Number.isFinite(config.timeScale) ? Math.min(1, Math.max(0.3, config.timeScale)) : 0.6
  return {
    bestOf, pointsToWin, timeScale,
    seed: Number.isFinite(config.seed) ? config.seed | 0 : 1,
    firstServer: config.firstServer === 'away' ? 'away' : 'home',
    skill: { home: clampSkill(config.skill?.home), away: clampSkill(config.skill?.away) },
  }
}

export function cloneState(s: MatchState): MatchState {
  return {
    ...s,
    ball: cloneBall(s.ball),
    points: { ...s.points },
    games: { ...s.games },
    serveIntent: s.serveIntent ? { ...s.serveIntent } : null,
  }
}

/** Service order: two serves each, alternating every point from deuce. */
export function serverFor(points: Record<Side, number>, first: Side, pointsToWin: number): Side {
  const played = points.home + points.away
  const deuce = 2 * (pointsToWin - 1)
  if (played >= deuce) return played % 2 === 0 ? first : other(first)
  return Math.floor(played / 2) % 2 === 0 ? first : other(first)
}

export function heldBall(server: Side, x = 0): BallState {
  return { p: tossOrigin(server, x), v: { x: 0, y: 0, z: 0 }, w: { x: 0, y: 0, z: 0 } }
}

/**
 * The authoritative rules engine. It is fully deterministic: the same config,
 * starting state and sequence of (tick, action) pairs always produce the same
 * result, which lets the server and both browsers run it in lockstep.
 */
export class Match {
  readonly config: MatchConfig
  readonly dt: number
  state: MatchState
  private events: MatchEvent[] = []
  private contacts: Contact[] = []

  constructor(config: MatchConfig, state?: MatchState) {
    this.config = sanitizeConfig(config)
    this.dt = this.config.timeScale / TICK_RATE
    this.state = state ? cloneState(state) : Match.initialState(this.config, 0)
  }

  static initialState(config: MatchConfig, tick: number): MatchState {
    return {
      tick,
      phase: 'pre_serve',
      phaseTick: tick,
      ball: heldBall(config.firstServer),
      lastHitter: config.firstServer,
      expect: 'server_side',
      isServe: false,
      netTouch: false,
      hits: 0,
      lastContactTick: tick,
      server: config.firstServer,
      gameFirstServer: config.firstServer,
      points: { home: 0, away: 0 },
      games: { home: 0, away: 0 },
      gameIndex: 0,
      pointWinner: null,
      pointReason: null,
      winner: null,
      serveIntent: null,
      rng: config.seed >>> 0,
    }
  }

  snapshot() { return cloneState(this.state) }
  restore(state: MatchState) { this.state = cloneState(state) }

  /** True when `side` is the player who must play the ball next. */
  canHit(side: Side) {
    const s = this.state
    return s.phase === 'rally' && s.expect === 'hit' && side !== s.lastHitter
  }

  /** Receiver of the current shot, or the server before the serve. */
  get sideToPlay(): Side {
    const s = this.state
    if (s.phase === 'pre_serve' || s.phase === 'toss') return s.server
    return other(s.lastHitter)
  }

  /** Returns and clears the events produced since the last call (by steps, serves and hits). */
  takeEvents(): MatchEvent[] {
    const events = this.events
    this.events = []
    return events
  }

  /** Advances one tick. Events are collected until `takeEvents` is called. */
  step() {
    const s = this.state
    s.tick += 1
    switch (s.phase) {
      case 'pre_serve':
        if (s.tick - s.phaseTick >= AUTO_SERVE_TICKS) this.serve(s.server, 0, NEUTRAL_INTENT)
        break
      case 'toss':
        this.stepToss()
        break
      case 'rally':
      case 'dead':
      case 'game_over':
      case 'match_over':
        this.stepLiveBall()
        break
    }
    if (s.phase === 'rally' && s.tick - s.lastContactTick > RALLY_STALL_TICKS) this.dead(other(this.sideToPlay), 'stall')
    if (s.phase === 'dead' && s.tick - s.phaseTick >= DEAD_BALL_TICKS) this.award()
    else if (s.phase === 'game_over' && s.tick - s.phaseTick >= GAME_BREAK_TICKS) this.nextGame()
  }

  /** Starts the serve toss. Returns false if `side` may not serve now. */
  serve(side: Side, x: number, intent: ShotIntent): boolean {
    const s = this.state
    if (s.phase !== 'pre_serve' || side !== s.server) return false
    s.ball = heldBall(side, Number.isFinite(x) ? x : 0)
    s.ball.v.y = TOSS_SPEED
    s.serveIntent = clampIntent(intent)
    this.enter('toss')
    this.events.push({ type: 'toss', tick: s.tick, side })
    return true
  }

  /**
   * Applies a stroke by `side` at `contact`, struck `offCenter` (0 … 1) away
   * from the paddle's sweet spot. Returns false for illegal or implausible hits.
   */
  hit(side: Side, contact: Vec3, intent: ShotIntent, offCenter = 0): boolean {
    const s = this.state
    if (!this.canHit(side)) return false
    if (![contact.x, contact.y, contact.z, offCenter].every(Number.isFinite)) return false
    if (contact.y < HIT_MIN_Y || contact.y > HIT_MAX_Y) return false
    if (distance(contact, s.ball.p) > CONTACT_TOLERANCE) return false
    const clean = clampIntent(intent)
    const rng = new Rng(s.rng)
    const quality = Math.min(1, Math.max(0, offCenter))
    s.ball = planShot({ ...contact }, side, clean, this.config.skill[side], rng, this.dt, s.ball, quality)
    s.rng = rng.state
    s.lastHitter = side
    s.expect = 'receiver_side'
    s.isServe = false
    s.netTouch = false
    s.hits += 1
    s.lastContactTick = s.tick
    this.events.push({ type: 'hit', tick: s.tick, side, power: clean.power, smash: isSmash(contact, clean), spin: clean.spin })
    return true
  }

  private stepToss() {
    const s = this.state
    integrate(s.ball, this.dt)
    const origin = tossOrigin(s.server, s.ball.p.x)
    if (s.ball.v.y >= 0 || s.ball.p.y > origin.y) return
    const rng = new Rng(s.rng)
    const intent = s.serveIntent ?? NEUTRAL_INTENT
    s.ball = planServe(origin, s.server, intent, this.config.skill[s.server], rng, this.dt)
    s.rng = rng.state
    s.lastHitter = s.server
    s.expect = 'server_side'
    s.isServe = true
    s.netTouch = false
    s.hits = 1
    s.lastContactTick = s.tick
    s.serveIntent = null
    this.enter('rally')
    this.events.push({ type: 'serve', tick: s.tick, side: s.server, power: intent.power })
  }

  private stepLiveBall() {
    const s = this.state
    this.contacts.length = 0
    stepBall(s.ball, this.dt, this.contacts)
    for (const contact of this.contacts) {
      if (contact.kind === 'table') this.events.push({ type: 'bounce', tick: s.tick, side: contact.side, x: contact.x, z: contact.z, speed: contact.speed })
      else if (contact.kind === 'net') this.events.push({ type: 'net', tick: s.tick, cord: contact.cord, speed: contact.speed })
      else this.events.push({ type: 'floor', tick: s.tick, speed: contact.speed })
      if (s.phase === 'rally') this.applyRules(contact)
    }
  }

  private applyRules(contact: Contact) {
    const s = this.state
    s.lastContactTick = s.tick
    const hitter = s.lastHitter
    const receiver = other(hitter)
    if (contact.kind === 'net') { s.netTouch = true; return }
    if (contact.kind === 'floor') {
      if (s.expect === 'hit') this.dead(hitter, 'missed')
      else this.dead(receiver, s.isServe ? 'serve_fault' : s.netTouch && Math.sign(s.ball.p.z) === Math.sign(hitter === 'home' ? 1 : -1) ? 'net' : 'out')
      return
    }
    switch (s.expect) {
      case 'server_side':
        if (contact.side === hitter) s.expect = 'receiver_side'
        else this.dead(receiver, 'serve_fault')
        return
      case 'receiver_side':
        if (contact.side === receiver) {
          if (s.isServe && s.netTouch) this.dead(null, 'let')
          else s.expect = 'hit'
        } else {
          this.dead(receiver, s.isServe ? 'serve_fault' : s.netTouch ? 'net' : 'own_side')
        }
        return
      case 'hit':
        this.dead(hitter, contact.side === receiver ? 'double_bounce' : 'missed')
    }
  }

  private dead(winner: Side | null, reason: PointReason | 'let') {
    const s = this.state
    s.pointWinner = winner
    s.pointReason = reason === 'let' ? null : reason
    this.enter('dead')
    this.events.push({ type: 'dead', tick: s.tick, winner, reason })
  }

  private award() {
    const s = this.state
    const winner = s.pointWinner
    if (!winner) { this.nextServe(); return }
    s.points[winner] += 1
    this.events.push({ type: 'point', tick: s.tick, winner, reason: s.pointReason ?? 'out', points: { ...s.points } })
    const lead = s.points[winner] - s.points[other(winner)]
    if (s.points[winner] >= this.config.pointsToWin && lead >= 2) {
      s.games[winner] += 1
      this.events.push({ type: 'game', tick: s.tick, winner, games: { ...s.games } })
      if (s.games[winner] > this.config.bestOf / 2) {
        s.winner = winner
        this.enter('match_over')
        this.events.push({ type: 'match', tick: s.tick, winner })
      } else {
        this.enter('game_over')
      }
      return
    }
    this.nextServe()
  }

  private nextGame() {
    const s = this.state
    s.gameIndex += 1
    s.points = { home: 0, away: 0 }
    s.gameFirstServer = other(s.gameFirstServer)
    this.nextServe()
  }

  private nextServe() {
    const s = this.state
    s.server = serverFor(s.points, s.gameFirstServer, this.config.pointsToWin)
    s.ball = heldBall(s.server)
    s.lastHitter = s.server
    s.expect = 'server_side'
    s.isServe = false
    s.netTouch = false
    s.hits = 0
    s.pointWinner = null
    s.pointReason = null
    this.enter('pre_serve')
    this.events.push({ type: 'next_serve', tick: s.tick, server: s.server })
  }

  private enter(phase: Phase) {
    this.state.phase = phase
    this.state.phaseTick = this.state.tick
  }
}
