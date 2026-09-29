import type { Side } from './constants'
import type { MatchConfig, MatchState } from './match'
import type { PaddlePose } from './paddle'
import type { Action } from './timeline'

/**
 * Wire protocol for online play. Every message is one JSON object with a
 * `type`. The server owns a global tick clock; match ticks are the global tick
 * minus `clock.offset`, which grows while a match is paused.
 */
export const PROTOCOL_VERSION = 2

export interface PlayerInfo { side: Side; name: string; connected: boolean; ready: boolean }
export type RoomStatus = 'lobby' | 'playing' | 'finished'
export interface RoomInfo { code: string; players: PlayerInfo[]; status: RoomStatus; bestOf: number; timeScale: number }
export interface MatchClock { offset: number; paused: boolean }

export interface RoomTicket { code: string; token: string; side: Side }
export interface CreateRoomRequest { name?: string; bestOf?: number; timeScale?: number }
export interface JoinRoomRequest { name?: string }

export type ClientMessage =
  | { type: 'hello'; v: number; code: string; token: string }
  | { type: 'ready'; ready: boolean }
  | { type: 'ping'; t: number }
  | { type: 'paddle'; tick: number; pose: PaddlePose }
  | { type: 'action'; tick: number; action: Action }
  | { type: 'rematch' }

export type ServerMessage =
  | { type: 'welcome'; side: Side; room: RoomInfo; tick: number }
  | { type: 'room'; room: RoomInfo }
  | { type: 'start'; config: MatchConfig; state: MatchState; clock: MatchClock }
  | { type: 'pong'; t: number; tick: number }
  | { type: 'paddle'; side: Side; tick: number; pose: PaddlePose }
  | { type: 'action'; tick: number; action: Action }
  | { type: 'sync'; state: MatchState; clock: MatchClock }
  | { type: 'error'; message: string }
