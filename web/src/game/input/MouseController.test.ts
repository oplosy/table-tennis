import { describe, expect, it } from 'vitest'
import {
  AIController, AI_PROFILES, Match, TICK_RATE, cloneBall, defaultConfig, stepBall, tickWithControllers, type Contact, type MatchEvent,
} from '@rally/core'
import { MouseController } from './MouseController'

/** Where the incoming ball will cross the plane z = `z` after bouncing on the home half. */
function crossing(match: Match, z: number) {
  const ball = cloneBall(match.state.ball)
  const contacts: Contact[] = []
  let bounced = match.state.expect === 'hit'
  for (let i = 0; i < TICK_RATE * 3; i += 1) {
    const prevZ = ball.p.z
    contacts.length = 0
    stepBall(ball, match.dt, contacts)
    if (contacts.some((c) => c.kind === 'table' && c.side === 'home')) bounced = true
    if (bounced && prevZ < z && ball.p.z >= z) return { x: ball.p.x, ticks: i }
  }
  return null
}

/**
 * A scripted "player": stands where the ball will arrive and, just before
 * contact, pushes the mouse towards the net at `swing` m/s.
 */
function play(swing: number, seconds: number) {
  const mouse = new MouseController('home', 0.26)
  const ai = new AIController('away', AI_PROFILES.medium, 4)
  const match = new Match(defaultConfig({ seed: 12, bestOf: 5, firstServer: 'away', skill: { home: { accuracy: 0.7, netAssist: 0.8 }, away: AI_PROFILES.medium.skill } }))
  const stats = { returns: 0, good: 0, errors: 0 }
  let swingFrom = 0
  for (let t = 0; t < TICK_RATE * seconds; t += 1) {
    const s = match.state
    const incoming = s.phase === 'rally' && s.lastHitter === 'away'
    if (s.phase === 'pre_serve' && s.server === 'home' && t % 60 === 0) { mouse.press(); mouse.release() }
    if (incoming) {
      const cross = crossing(match, 1.62)
      if (cross && cross.ticks > 20) { mouse.setTarget(cross.x, 1.78); swingFrom = 1.78 }
      else if (cross) { swingFrom -= swing / TICK_RATE; mouse.setTarget(cross.x, swingFrom) }
    } else {
      mouse.setTarget(0, 1.9)
    }
    const { events } = tickWithControllers(match, [mouse, ai], () => ai.pose)
    for (const e of events as MatchEvent[]) {
      if (e.type === 'hit' && e.side === 'home') stats.returns += 1
      if (e.type === 'bounce' && e.side === 'away' && match.state.lastHitter === 'home' && match.state.hits > 1) stats.good += 1
      if (e.type === 'dead' && e.winner === 'away' && match.state.lastHitter === 'home' && match.state.hits > 1) stats.errors += 1
    }
    if (match.state.phase === 'match_over') break
  }
  return stats
}

describe('MouseController strokes', () => {
  it('lands gentle blocks reliably', () => {
    const stats = play(0.5, 240)
    expect(stats.returns).toBeGreaterThan(30)
    expect(stats.good / stats.returns).toBeGreaterThan(0.85)
  })

  it('keeps brisk drives mostly on the table', () => {
    const stats = play(2.5, 240)
    expect(stats.returns).toBeGreaterThan(30)
    expect(stats.good / stats.returns).toBeGreaterThan(0.7)
  })

  it('turns a faster swing into more pace', () => {
    const slow = new MouseController('home')
    const fast = new MouseController('home')
    const match = new Match(defaultConfig())
    for (let i = 0; i < 20; i += 1) {
      slow.setTarget(0, 1.8 - i * 0.004); slow.update(match)
      fast.setTarget(0, 1.8 - i * 0.015); fast.update(match)
    }
    const contact = { x: 0, y: 0.95, z: 1.7 }
    expect(fast.intent(contact).power).toBeGreaterThan(slow.intent(contact).power)
  })
})
