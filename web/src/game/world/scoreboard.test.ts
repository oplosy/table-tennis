import { describe, expect, it } from 'vitest'
import { Match, defaultConfig } from '@rally/core'
import { scoreView, shortName } from './scoreboard'

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
