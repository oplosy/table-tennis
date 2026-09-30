import { describe, expect, it } from 'vitest'
import { Match, defaultConfig } from '@rally/core'
import { boardFor, sameScore, scoreView, shortName } from './scoreboard'

const NAMES = { home: 'Mesut', away: 'Club player' }

describe('scoreView', () => {
  it('reads names, points, games and the server from the match', () => {
    const match = new Match(defaultConfig({ firstServer: 'away' }))
    match.state.points = { home: 7, away: 9 }
    match.state.games = { home: 1, away: 0 }
    expect(scoreView(match.state, NAMES)).toEqual({
      names: { home: 'MESUT', away: 'CLUB PLAYER' }, points: { home: 7, away: 9 }, games: { home: 1, away: 0 }, server: 'away', winner: null,
    })
  })

  it('shows the winner instead of a server once the match is over', () => {
    const match = new Match(defaultConfig())
    match.state.winner = 'home'
    const view = scoreView(match.state, NAMES)
    expect(view.server).toBeNull()
    expect(view.winner).toBe('home')
  })

  it('does not share its numbers with the live match state', () => {
    const match = new Match(defaultConfig())
    const view = scoreView(match.state, NAMES)
    match.state.points.home = 5
    expect(view.points.home).toBe(0)
  })
})

describe('shortName', () => {
  it('upper-cases names for the board', () => {
    expect(shortName('Mesut')).toBe('MESUT')
  })

  it('cuts names that would not fit and marks the cut', () => {
    expect(shortName('Bartholomew Featherstonehaugh')).toBe('BARTHOLOMEW F…')
    expect(shortName('Bartholomew Featherstonehaugh').length).toBeLessThanOrEqual(14)
  })

  it('falls back to a dash for an empty name', () => {
    expect(shortName('   ')).toBe('—')
  })
})

describe('boardFor', () => {
  const match = new Match(defaultConfig())

  it('shows the score of a match somebody is playing', () => {
    expect(boardFor({ localSide: 'away', match }, NAMES)?.names.home).toBe('MESUT')
  })

  it('shows the wordmark behind menus, where the demo rally has no players', () => {
    expect(boardFor({ localSide: null, match }, NAMES)).toBeNull()
  })

  it('shows the wordmark until the players are known', () => {
    expect(boardFor({ localSide: 'home', match }, null)).toBeNull()
    expect(boardFor(null, NAMES)).toBeNull()
  })
})

describe('sameScore', () => {
  const view = () => scoreView(new Match(defaultConfig()).state, NAMES)

  it('treats equal boards as unchanged, so nothing is repainted', () => {
    expect(sameScore(view(), view())).toBe(true)
    expect(sameScore(null, null)).toBe(true)
  })

  it('notices a point, a game, the server, the winner and a name changing', () => {
    const changed = [
      { ...view(), points: { home: 1, away: 0 } },
      { ...view(), games: { home: 0, away: 1 } },
      { ...view(), server: 'away' as const },
      { ...view(), winner: 'home' as const },
      { ...view(), names: { home: 'OTHER', away: 'CLUB PLAYER' } },
    ]
    for (const other of changed) expect(sameScore(view(), other)).toBe(false)
    expect(sameScore(view(), null)).toBe(false)
  })
})
