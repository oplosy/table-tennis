import { describe, expect, it } from 'vitest'
import {
  AIController, AI_PROFILES, HALF_LENGTH, Match, NEUTRAL_INTENT, Rng, TICK_RATE, Timeline, cloneBall, defaultConfig,
  planServe, planShot, serverFor, stepBall, tickWithControllers, tossOrigin, type Action, type Contact, type Side,
} from '../src/index'

const dt = 0.6 / TICK_RATE

function bounces(ball: ReturnType<typeof cloneBall>, limit = 3) {
  const b = cloneBall(ball)
  const seq: string[] = []
  const contacts: Contact[] = []
  for (let i = 0; i < 2000 && seq.length < limit; i += 1) {
    contacts.length = 0
    stepBall(b, dt, contacts)
    for (const c of contacts) seq.push(c.kind === 'table' ? c.side : c.kind)
  }
  return seq
}

function playAI(seed: number, until: (match: Match) => boolean) {
  const home = new AIController('home', AI_PROFILES.hard, seed)
  const away = new AIController('away', AI_PROFILES.hard, seed + 1)
  const match = new Match(defaultConfig({ seed, bestOf: 1 }))
  const log: Array<{ tick: number; action: Action }> = []
  while (!until(match)) log.push(...tickWithControllers(match, [home, away], (s) => (s === 'home' ? home.pose : away.pose)).actions)
  return { match, log }
}

describe('service order', () => {
  it('changes every two points and every point from deuce', () => {
    const order = Array.from({ length: 24 }, (_, n) => serverFor({ home: Math.ceil(n / 2), away: Math.floor(n / 2) }, 'home', 11))
    expect(order.slice(0, 8)).toEqual(['home', 'home', 'away', 'away', 'home', 'home', 'away', 'away'])
    expect(order.slice(20, 24)).toEqual(['home', 'away', 'home', 'away'])
  })
})

describe('shot planning', () => {
  it('produces legal serves for any intent', () => {
    const rng = new Rng(3)
    for (let i = 0; i < 60; i += 1) {
      const side: Side = i % 2 ? 'home' : 'away'
      const intent = { aimX: rng.range(-1, 1), depth: rng.range(0, 1), power: rng.range(0, 1), spin: rng.range(-1, 1), curve: rng.range(-1, 1) }
      const serve = planServe(tossOrigin(side, rng.range(-0.6, 0.6)), side, intent, { accuracy: 1, netAssist: 0.5 }, rng, dt)
      expect(bounces(serve, 2)).toEqual([side, side === 'home' ? 'away' : 'home'])
    }
  })

  it('lands comfortable strokes on the far half', () => {
    const rng = new Rng(9)
    let good = 0
    for (let i = 0; i < 100; i += 1) {
      const contact = { x: rng.range(-0.5, 0.5), y: 0.95, z: HALF_LENGTH + rng.range(0.1, 0.6) }
      const shot = planShot(contact, 'home', { ...NEUTRAL_INTENT, aimX: rng.range(-0.8, 0.8) }, { accuracy: 1, netAssist: 0.6 }, rng, dt)
      if (bounces(shot, 1)[0] === 'away') good += 1
    }
    expect(good).toBeGreaterThanOrEqual(97)
  })
})

describe('match', () => {
  it('is deterministic for a given seed', () => {
    const a = playAI(11, (m) => m.state.tick > 240 * 40)
    const b = playAI(11, (m) => m.state.tick > 240 * 40)
    expect(a.match.state).toEqual(b.match.state)
    expect(a.log.length).toBeGreaterThan(5)
  })

  it('plays a full game to a winner with a two point lead', () => {
    const { match } = playAI(21, (m) => m.state.phase === 'match_over' || m.state.tick > 240 * 60 * 30)
    const { points, winner } = match.state
    expect(winner).not.toBeNull()
    const w = points[winner!]
    const l = points[winner === 'home' ? 'away' : 'home']
    expect(w).toBeGreaterThanOrEqual(11)
    expect(w - l).toBeGreaterThanOrEqual(2)
  })

  it('rejects hits from the wrong player or far from the ball', () => {
    const match = new Match(defaultConfig())
    expect(match.hit('away', match.state.ball.p, NEUTRAL_INTENT)).toBe(false)
    match.serve('home', 0, NEUTRAL_INTENT)
    while (match.state.phase === 'toss') match.step()
    while (!match.canHit('away')) match.step()
    expect(match.hit('home', match.state.ball.p, NEUTRAL_INTENT)).toBe(false)
    const far = { ...match.state.ball.p, x: match.state.ball.p.x + 1 }
    expect(match.hit('away', far, NEUTRAL_INTENT)).toBe(false)
  })

  it('awards the point to the receiver when a serve hits the net', () => {
    const match = new Match(defaultConfig())
    match.serve('home', 0, NEUTRAL_INTENT)
    while (match.state.phase === 'toss') match.step()
    // Replace the serve with a ball driven straight into the net.
    match.state.ball = { p: { x: 0, y: 0.85, z: 0.4 }, v: { x: 0, y: 0, z: -6 }, w: { x: 0, y: 0, z: 0 } }
    match.state.expect = 'receiver_side'
    const events = []
    for (let i = 0; i < 600 && match.state.phase === 'rally'; i += 1) { match.step(); events.push(...match.takeEvents()) }
    expect(events.find((e) => e.type === 'dead')).toMatchObject({ winner: 'away' })
  })
})

describe('timeline', () => {
  it('replays late actions to the same result as live play', () => {
    const live = playAI(31, (m) => m.state.tick > 240 * 25)
    const replica = new Timeline(new Match(defaultConfig({ seed: 31, bestOf: 1 })), 1.5)
    const lag = 30
    let next = 0
    for (let tick = 1; tick <= live.match.state.tick; tick += 1) {
      replica.advanceTo(tick)
      // Deliver each action `lag` ticks after it happened.
      while (next < live.log.length && live.log[next].tick + lag <= tick) {
        const { tick: at, action } = live.log[next]
        expect(replica.submit(at, action).accepted).toBe(true)
        next += 1
      }
    }
    while (next < live.log.length) { replica.submit(live.log[next].tick, live.log[next].action); next += 1 }
    expect(replica.state).toEqual(live.match.state)
  })
})
