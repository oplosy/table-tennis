import { useEffect, useRef, type ReactNode } from 'react'
import type { Side } from '@rally/core'

export function Sheet({ title, children, onClose, label }: { title: string; children: ReactNode; onClose?: () => void; label?: string }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('button, input')?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && onClose) { event.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true); previous?.focus?.() }
  }, [onClose])
  return (
    <div className="scrim" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose?.() }}>
      <section ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label={label ?? title}>
        <h2>{title}</h2>
        {children}
      </section>
    </div>
  )
}

export function HelpSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="How to play" onClose={onClose}>
      <ul className="help-list">
        <li><b>Move</b><span>Your paddle follows the mouse (or your finger). Get behind the ball after it bounces on your side.</span></li>
        <li><b>Hit</b><span>Contact is automatic. The paddle glows when the ball is in reach.</span></li>
        <li><b>Power</b><span>Swing towards the net as you meet the ball. Faster swing, faster ball, more topspin, more risk.</span></li>
        <li><b>Aim</b><span>Swipe sideways while hitting, or meet the ball with the edge of the paddle to angle it.</span></li>
        <li><b>Chop</b><span>Pull the paddle back towards you at contact for a short backspin push.</span></li>
        <li><b>Smash</b><span>A high ball plus a hard forward swing is a smash.</span></li>
        <li><b>Serve</b><span>Hold click or space, release to toss. The longer you hold, the deeper and faster the serve.</span></li>
        <li><b>Rules</b><span>Games to 11, win by 2. Serve changes every 2 points, every point from 10–10. A serve that clips the net and lands is a let.</span></li>
      </ul>
      <div className="actions"><button className="go" onClick={onClose}><span>Got it</span></button></div>
    </Sheet>
  )
}

export function ResultSheet({ winner, me, names, games, points, bestOf, actions }: {
  winner: Side | null
  bestOf: number
  me: Side
  names: Record<Side, string>
  games: Record<Side, number>
  points: Record<Side, number>
  actions: ReactNode
}) {
  const won = winner === me
  const title = winner === null ? 'Match over' : won ? 'You win' : `${names[winner]} wins`
  const other: Side = me === 'home' ? 'away' : 'home'
  return (
    <Sheet title={title} label="Match result">
      <div className="final">
        {[me, other].map((side) => (
          <div key={side} style={{ display: 'contents' }}>
            <span className={`name ${winner === side ? 'win' : ''}`}>{names[side]}</span>
            <span className="games">{bestOf > 1 ? games[side] : points[side]}</span>
          </div>
        ))}
      </div>
      <div className="actions">{actions}</div>
    </Sheet>
  )
}
