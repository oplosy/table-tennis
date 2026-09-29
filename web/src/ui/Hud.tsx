import { type ReactNode } from 'react'
import { other, type Side } from '@rally/core'
import type { GameSession } from '../game/session/Session'
import { useCallouts, useFrameValue, useScoreboard } from './hooks'

interface HudProps {
  session: GameSession
  names: Record<Side, string>
  /** Extra controls rendered top-right (pause, sound, connection). */
  corner: ReactNode
}

/** In-match overlay: broadcast score bug, callouts, serve prompt and rally count. */
export default function Hud({ session, names, corner }: HudProps) {
  const board = useScoreboard(session)
  const callout = useCallouts(session, names)
  const me = session.localSide ?? 'home'
  const them = other(me)
  const myServe = board?.phase === 'pre_serve' && board.server === me
  const charge = useFrameValue(() => session.controller?.charge ?? 0, myServe)
  if (!board) return null
  const bestOf = session.match.config.bestOf

  const row = (side: Side) => (
    <div className={`bug-row ${side === me ? 'you' : 'them'}`}>
      <span className="tag" />
      <span className="bug-name">{names[side]}{board.server === side && board.phase !== 'match_over' && <i className="serve-dot" aria-label="serving" />}</span>
      {bestOf > 1 && <span className="bug-games" aria-label="games">{board.games[side]}</span>}
      {bestOf === 1 && <span className="bug-games" />}
      <span className="bug-points" aria-label="points">{board.points[side]}</span>
    </div>
  )

  return <>
    <div className="bug" role="status" aria-live="polite">
      {row(me)}
      {row(them)}
      {bestOf > 1 && <span className="bug-note">Game {board.gameIndex + 1} · best of {bestOf}</span>}
    </div>
    <div className="corner">{corner}</div>
    {callout && (
      <div key={callout.id} className={`callout ${callout.tone}`}>
        <div className="callout-title">{callout.title}</div>
        {callout.subtitle && <div className="callout-sub">{callout.subtitle}</div>}
      </div>
    )}
    {myServe && (
      <div className="prompt">
        <p>Hold and release to serve. Longer hold, deeper serve.</p>
        <div className="charge" aria-hidden><div style={{ width: `${Math.round(charge * 100)}%` }} /></div>
      </div>
    )}
    {board.phase === 'pre_serve' && !myServe && <div className="prompt"><p>{names[board.server]} to serve</p></div>}
    {board.rally > 2 && board.phase !== 'pre_serve' && <div className="rally">Rally<strong>{board.rally}</strong></div>}
  </>
}
