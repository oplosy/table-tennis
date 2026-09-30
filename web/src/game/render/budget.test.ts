import { describe, expect, it } from 'vitest'
import { FrameBudget } from './budget'

const FAST = 1 / 60
const SLOW = 1 / 45

/** Feeds `count` frames and returns how many times the budget reported being over. */
function feed(budget: FrameBudget, dt: number, count: number) {
  let trips = 0
  for (let i = 0; i < count; i += 1) if (budget.sample(dt)) trips += 1
  return trips
}

describe('FrameBudget', () => {
  it('stays quiet while frames arrive on time', () => {
    expect(feed(new FrameBudget(), FAST, 2000)).toBe(0)
  })

  it('reports once when frames stay slow', () => {
    const budget = new FrameBudget()
    expect(feed(budget, SLOW, 1000)).toBe(1)
    expect(feed(budget, SLOW, 1000)).toBe(0)
  })

  it('ignores slow frames while the scene is still warming up', () => {
    const budget = new FrameBudget()
    expect(feed(budget, SLOW, 60)).toBe(0)
    expect(feed(budget, FAST, 2000)).toBe(0)
  })

  it('ignores a short slow spell', () => {
    const budget = new FrameBudget()
    feed(budget, FAST, 300)
    expect(feed(budget, SLOW, 20)).toBe(0)
    expect(feed(budget, FAST, 600)).toBe(0)
  })

  it('ignores stalls such as a hidden tab coming back', () => {
    const budget = new FrameBudget()
    let trips = 0
    for (let i = 0; i < 2000; i += 1) if (budget.sample(i % 10 === 0 ? 0.1 : FAST)) trips += 1
    expect(trips).toBe(0)
  })
})
