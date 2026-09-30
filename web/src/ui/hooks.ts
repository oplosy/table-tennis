import { useEffect, useReducer, useRef, useState } from 'react'
import { other, type MatchEvent, type MatchState, type PointReason, type Side } from '@rally/core'
import type { GameSession } from '../game/session/Session'

export interface Scoreboard {
  points: Record<Side, number>
  games: Record<Side, number>
  server: Side
  phase: MatchState['phase']
  winner: Side | null
  rally: number
  gameIndex: number
}

const read = (session: GameSession): Scoreboard => {
  const s = session.match.state
  return { points: { ...s.points }, games: { ...s.games }, server: s.server, phase: s.phase, winner: s.winner, rally: s.hits, gameIndex: s.gameIndex }
}

/** Re-renders when the session produces events; per-frame state stays out of React. */
export function useScoreboard(session: GameSession | null) {
  const [, force] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!session) return
    force()
    return session.subscribe(() => force())
  }, [session])
  return session ? read(session) : null
}

export interface Callout { id: number; title: string; subtitle?: string; tone: 'good' | 'bad' | 'neutral' }

const REASONS: Record<PointReason | 'let', string> = {
  out: 'Out', net: 'Net', missed: 'Missed', double_bounce: 'Double bounce', own_side: 'Own side',
  serve_fault: 'Fault', stall: 'Dead ball', let: 'Let',
}

/** Turns match events into short broadcast-style captions. */
export function useCallouts(session: GameSession | null, names: Record<Side, string>) {
  const [callout, setCallout] = useState<Callout | null>(null)
  const counter = useRef(0)
  const namesRef = useRef(names)
  namesRef.current = names
  useEffect(() => {
    if (!session) return
    let timer = 0
    const show = (c: Omit<Callout, 'id'>, ms = 1300) => {
      counter.current += 1
      setCallout({ ...c, id: counter.current })
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setCallout(null), ms)
    }
    const me = session.localSide
    const unsubscribe = session.subscribe((events: MatchEvent[]) => {
      for (const event of events) {
        if (event.type === 'dead') {
          if (event.reason === 'let') { show({ title: 'Let', subtitle: 'Replay the serve', tone: 'neutral' }); continue }
          const good = me ? event.winner === me : true
          const winnerName = event.winner ? namesRef.current[event.winner] : ''
          const title = event.reason === 'missed' && good ? 'Winner' : REASONS[event.reason]
          show({ title, subtitle: `Point ${winnerName}`, tone: me ? (good ? 'good' : 'bad') : 'neutral' })
        } else if (event.type === 'game') {
          const good = me ? event.winner === me : true
          show({ title: `Game ${namesRef.current[event.winner]}`, subtitle: `${event.games.home} – ${event.games.away}`, tone: good ? 'good' : 'bad' }, 2600)
        } else if (event.type === 'next_serve') {
          const s = session.match.state
          const pointsToWin = session.match.config.pointsToWin
          const lead = Math.max(s.points.home, s.points.away)
          const tied = s.points.home === s.points.away
          if (tied && lead >= pointsToWin - 1) show({ title: 'Deuce', tone: 'neutral' }, 1100)
          else if (lead >= pointsToWin - 1) {
            const leader: Side = s.points.home > s.points.away ? 'home' : 'away'
            const deciding = s.games[leader] + 1 > session.match.config.bestOf / 2
            show({ title: deciding ? 'Match point' : 'Game point', subtitle: namesRef.current[leader], tone: me ? (leader === me ? 'good' : 'bad') : 'neutral' }, 1200)
          }
        }
      }
    })
    return () => { unsubscribe(); window.clearTimeout(timer) }
  }, [session])
  return callout
}

/** Polls a value every animation frame (for the serve charge ring). */
export function useFrameValue<T>(read: () => T, active: boolean) {
  const [value, setValue] = useState<T>(read)
  const readRef = useRef(read)
  readRef.current = read
  useEffect(() => {
    if (!active) return
    let handle = 0
    const loop = () => { setValue(readRef.current()); handle = requestAnimationFrame(loop) }
    handle = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(handle)
  }, [active])
  return value
}

export const opponentOf = other
