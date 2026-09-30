// Headless AI-vs-AI matches used to tune the physics and the difficulty levels.
// Usage: npm run bench -- [homeDifficulty] [awayDifficulty] [matches]
import { AIController, AI_PROFILES, Match, defaultConfig, tickWithControllers, type Difficulty, type MatchEvent } from '../src/index'

const [homeLevel = 'medium', awayLevel = 'medium', countArg = '20'] = process.argv.slice(2)
const matches = Number(countArg)
const reasons = new Map<string, number>()
const rallies: number[] = []
const wins = { home: 0, away: 0 }
let ticks = 0
const started = performance.now()

for (let m = 0; m < matches; m += 1) {
  const home = new AIController('home', AI_PROFILES[homeLevel as Difficulty], 100 + m)
  const away = new AIController('away', AI_PROFILES[awayLevel as Difficulty], 900 + m)
  const match = new Match(defaultConfig({
    seed: 7 + m, bestOf: 1, firstServer: m % 2 ? 'away' : 'home',
    skill: { home: home.profile.skill, away: away.profile.skill },
  }))
  let hits = 0
  while (match.state.phase !== 'match_over' && ticks < 5e8) {
    const { events } = tickWithControllers(match, [home, away], (side) => (side === 'home' ? home.pose : away.pose))
    ticks += 1
    for (const event of events as MatchEvent[]) {
      if (event.type === 'hit' || event.type === 'serve') hits += 1
      if (event.type === 'dead') {
        reasons.set(event.reason, (reasons.get(event.reason) ?? 0) + 1)
        rallies.push(hits)
        hits = 0
      }
    }
  }
  if (match.state.winner) wins[match.state.winner] += 1
}

const avg = rallies.reduce((a, b) => a + b, 0) / Math.max(1, rallies.length)
console.log(`${homeLevel} vs ${awayLevel}: ${matches} games, wins`, wins)
console.log(`points ${rallies.length}, average strokes per point ${avg.toFixed(2)}, max ${rallies.reduce((a, b) => Math.max(a, b), 0)}`)
console.log('point endings', Object.fromEntries([...reasons.entries()].sort((a, b) => b[1] - a[1])))
console.log(`simulated ${(ticks / 240 / 60).toFixed(1)} min of play in ${((performance.now() - started) / 1000).toFixed(1)} s`)
