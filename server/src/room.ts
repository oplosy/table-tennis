import { randomBytes, randomInt } from 'node:crypto'
import type { WebSocket } from 'ws'
import {
  Match, TICK_RATE, Timeline, clampIntent, defaultConfig, other, secondsToTicks,
  type Action, type ClientMessage, type MatchClock, type MatchConfig, type RoomInfo, type RoomStatus,
  type ServerMessage, type Side,
} from '@rally/core'
import { currentTick, nowTicks } from './clock'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const SYNC_INTERVAL = secondsToTicks(0.5)
/** A disconnected player forfeits after this long. */
export const FORFEIT_TICKS = secondsToTicks(30)
/** How far ahead of the server a client's clock may claim an action happened. */
const MAX_LEAD_TICKS = secondsToTicks(0.4)

export interface Seat {
  side: Side
  token: string
  name: string
  socket: WebSocket | null
  ready: boolean
  rematch: boolean
  disconnectedAt: number
}

export const newRoomCode = () => Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')
const newToken = () => randomBytes(24).toString('hex')
const finite = (value: unknown, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function cleanName(name: unknown, fallback: string) {
  const text = typeof name === 'string' ? name.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16) : ''
  return text || fallback
}

/** Rebuilds an action from untrusted input, keeping only known, bounded fields. */
export function sanitizeAction(raw: unknown, side: Side): Action | null {
  if (!raw || typeof raw !== 'object') return null
  const action = raw as Record<string, unknown>
  const intent = clampIntent(action.intent as never)
  if (action.kind === 'serve') return { kind: 'serve', side, x: clamp(finite(action.x), -1, 1), intent }
  if (action.kind === 'hit') {
    const c = (action.contact ?? {}) as Record<string, unknown>
    const contact = { x: finite(c.x, NaN), y: finite(c.y, NaN), z: finite(c.z, NaN) }
    if (![contact.x, contact.y, contact.z].every(Number.isFinite)) return null
    return { kind: 'hit', side, contact, intent, offCenter: clamp(finite(action.offCenter), 0, 1) }
  }
  return null
}

class MatchSession {
  readonly config: MatchConfig
  readonly timeline: Timeline
  offset = 0
  paused = false
  private pausedAt = 0
  private lastSync = 0

  constructor(config: MatchConfig) {
    this.config = config
    const start = currentTick()
    this.timeline = new Timeline(new Match(config, Match.initialState(config, start)), 1.5)
    this.lastSync = start
  }

  get clock(): MatchClock { return { offset: this.offset, paused: this.paused } }
  get matchTick() { return currentTick() - this.offset }
  get finished() { return this.timeline.state.phase === 'match_over' }

  /** Advances the simulation to real time. Returns true when a sync should be broadcast. */
  advance() {
    if (this.paused || this.finished) return false
    this.timeline.advanceTo(this.matchTick)
    if (this.finished) return true
    if (this.timeline.tick - this.lastSync >= SYNC_INTERVAL) { this.lastSync = this.timeline.tick; return true }
    return false
  }

  pause() {
    if (this.paused) return
    this.timeline.advanceTo(this.matchTick)
    this.paused = true
    this.pausedAt = currentTick()
  }

  resume() {
    if (!this.paused) return
    this.offset += currentTick() - this.pausedAt
    this.paused = false
  }

  forfeit(loser: Side) {
    const state = this.timeline.state
    state.winner = other(loser)
    state.phase = 'match_over'
    state.phaseTick = state.tick
  }
}

/** One private table: two seats, a lobby and at most one running match. */
export class Room {
  readonly code: string
  readonly seats: Partial<Record<Side, Seat>> = {}
  status: RoomStatus = 'lobby'
  session: MatchSession | null = null
  lastActivity = Date.now()
  readonly bestOf: number
  readonly timeScale: number

  constructor(code: string, options: { bestOf?: number; timeScale?: number } = {}) {
    this.code = code
    this.bestOf = [1, 3, 5].includes(options.bestOf ?? 3) ? (options.bestOf ?? 3) : 3
    this.timeScale = clamp(finite(options.timeScale, 0.6), 0.4, 0.85)
  }

  info(): RoomInfo {
    const players = (['home', 'away'] as const).flatMap((side) => {
      const seat = this.seats[side]
      return seat ? [{ side, name: seat.name, connected: seat.socket !== null, ready: seat.ready }] : []
    })
    return { code: this.code, players, status: this.status, bestOf: this.bestOf, timeScale: this.timeScale }
  }

  /** Takes the first free seat; returns null when the room is full. */
  claimSeat(name: string): Seat | null {
    const side: Side | null = !this.seats.home ? 'home' : !this.seats.away ? 'away' : null
    if (!side) return null
    const seat: Seat = { side, token: newToken(), name, socket: null, ready: false, rematch: false, disconnectedAt: currentTick() }
    this.seats[side] = seat
    this.touch()
    this.broadcastRoom()
    return seat
  }

  seatForToken(token: string) {
    return Object.values(this.seats).find((seat) => seat && seat.token === token) ?? null
  }

  get connectedCount() { return Object.values(this.seats).filter((seat) => seat?.socket).length }

  attach(seat: Seat, socket: WebSocket) {
    if (seat.socket && seat.socket !== socket) seat.socket.close(4000, 'replaced by a newer connection')
    seat.socket = socket
    this.touch()
    this.send(seat, { type: 'welcome', side: seat.side, room: this.info(), tick: nowTicks() })
    if (this.session) {
      this.send(seat, { type: 'start', config: this.session.config, state: this.session.timeline.match.snapshot(), clock: this.session.clock })
      if (this.bothConnected) this.session.resume()
      this.broadcastSync()
    }
    this.broadcastRoom()
  }

  detach(seat: Seat, socket: WebSocket) {
    if (seat.socket !== socket) return
    seat.socket = null
    seat.disconnectedAt = currentTick()
    if (this.status === 'lobby') seat.ready = false
    if (this.session && this.status === 'playing') {
      this.session.pause()
      this.broadcastSync()
    }
    this.touch()
    this.broadcastRoom()
  }

  handle(seat: Seat, message: ClientMessage) {
    this.touch()
    switch (message.type) {
      case 'ping':
        this.send(seat, { type: 'pong', t: finite(message.t), tick: nowTicks() })
        break
      case 'ready':
        if (this.status !== 'lobby') break
        seat.ready = message.ready === true
        this.broadcastRoom()
        if (this.bothReady) this.startMatch()
        break
      case 'rematch':
        if (this.status !== 'finished') break
        seat.rematch = true
        this.broadcastRoom()
        if (this.seats.home?.rematch && this.seats.away?.rematch && this.bothConnected) this.startMatch()
        break
      case 'paddle': {
        const peer = this.seats[other(seat.side)]
        const pose = message.pose ?? {}
        if (!peer || !this.session) break
        this.send(peer, {
          type: 'paddle', side: seat.side, tick: finite(message.tick),
          pose: { x: clamp(finite(pose.x), -3, 3), y: clamp(finite(pose.y), 0, 3), z: clamp(finite(pose.z), -5, 5) },
        })
        break
      }
      case 'action':
        this.handleAction(seat, message.tick, message.action)
        break
    }
  }

  private handleAction(seat: Seat, rawTick: unknown, rawAction: unknown) {
    const session = this.session
    if (!session || this.status !== 'playing' || session.paused) return
    const action = sanitizeAction(rawAction, seat.side)
    const tick = Math.round(finite(rawTick, -1))
    session.timeline.advanceTo(session.matchTick)
    const timeline = session.timeline
    if (!action || tick < timeline.horizon || tick > timeline.tick + MAX_LEAD_TICKS) { this.sendSync(seat); return }
    const result = timeline.submit(tick, action)
    if (!result.accepted) { this.sendSync(seat); return }
    const peer = this.seats[other(seat.side)]
    if (peer) this.send(peer, { type: 'action', tick, action })
    this.checkFinished()
  }

  /** Called by the server loop. */
  update() {
    const session = this.session
    if (!session) return
    if (session.paused && this.status === 'playing') {
      const gone = (['home', 'away'] as const).find((side) => !this.seats[side]?.socket)
      if (gone && currentTick() - this.seats[gone]!.disconnectedAt > FORFEIT_TICKS) {
        session.forfeit(gone)
        this.broadcastSync()
        this.checkFinished()
      }
      return
    }
    if (session.advance()) this.broadcastSync()
    this.checkFinished()
  }

  private checkFinished() {
    if (this.status === 'playing' && this.session?.finished) {
      this.status = 'finished'
      for (const seat of Object.values(this.seats)) if (seat) { seat.rematch = false; seat.ready = false }
      this.broadcastRoom()
    }
  }

  private get bothConnected() { return Boolean(this.seats.home?.socket && this.seats.away?.socket) }
  private get bothReady() { return this.bothConnected && Boolean(this.seats.home?.ready && this.seats.away?.ready) }

  private startMatch() {
    const config = defaultConfig({
      bestOf: this.bestOf,
      timeScale: this.timeScale,
      seed: randomInt(1, 2 ** 31 - 1),
      firstServer: randomInt(2) === 0 ? 'home' : 'away',
    })
    this.session = new MatchSession(config)
    this.status = 'playing'
    for (const seat of Object.values(this.seats)) if (seat) { seat.ready = false; seat.rematch = false }
    this.broadcast({ type: 'start', config, state: this.session.timeline.match.snapshot(), clock: this.session.clock })
    this.broadcastRoom()
  }

  private sendSync(seat: Seat) {
    if (!this.session) return
    this.send(seat, { type: 'sync', state: this.session.timeline.match.snapshot(), clock: this.session.clock })
  }

  private broadcastSync() {
    if (!this.session) return
    this.broadcast({ type: 'sync', state: this.session.timeline.match.snapshot(), clock: this.session.clock })
  }

  broadcastRoom() { this.broadcast({ type: 'room', room: this.info() }) }

  private broadcast(message: ServerMessage) {
    for (const seat of Object.values(this.seats)) if (seat) this.send(seat, message)
  }

  private send(seat: Seat, message: ServerMessage) {
    if (seat.socket && seat.socket.readyState === seat.socket.OPEN) seat.socket.send(JSON.stringify(message))
  }

  private touch() { this.lastActivity = Date.now() }
}

export class RoomRegistry {
  private rooms = new Map<string, Room>()

  create(options: { bestOf?: number; timeScale?: number }) {
    let code = newRoomCode()
    while (this.rooms.has(code)) code = newRoomCode()
    const room = new Room(code, options)
    this.rooms.set(code, room)
    return room
  }

  get(code: string) { return this.rooms.get(code.trim().toUpperCase()) ?? null }
  get size() { return this.rooms.size }
  all() { return this.rooms.values() }

  /** Drops rooms nobody has touched for a while. */
  prune(idleMs = 10 * 60 * 1000) {
    const now = Date.now()
    for (const [code, room] of this.rooms) if (room.connectedCount === 0 && now - room.lastActivity > idleMs) this.rooms.delete(code)
  }
}

export const LOOP_INTERVAL_MS = 1000 / (TICK_RATE / 4)
