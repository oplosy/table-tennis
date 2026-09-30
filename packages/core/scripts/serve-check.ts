import { Rng, TICK_RATE, cloneBall, planServe, stepBall, tossOrigin, type Contact } from '../src/index'

const dt = 0.6 / TICK_RATE
const rng = new Rng(5)
let ok = 0
const fails: string[] = []
for (let i = 0; i < 300; i += 1) {
  const intent = { aimX: rng.range(-1, 1), depth: rng.range(0, 1), power: rng.range(0, 1), spin: rng.range(-1, 1), curve: rng.range(-1, 1) }
  const x = rng.range(-0.6, 0.6)
  const ball = cloneBall(planServe(tossOrigin('home', x), 'home', intent, { accuracy: 1, netAssist: 0.5 }, rng, dt))
  const seq: string[] = []
  const contacts: Contact[] = []
  for (let t = 0; t < 1500 && seq.length < 3; t += 1) {
    contacts.length = 0
    stepBall(ball, dt, contacts)
    for (const c of contacts) seq.push(c.kind === 'table' ? c.side : c.kind)
  }
  const good = seq[0] === 'home' && seq[1] === 'away'
  if (good) ok += 1
  else fails.push(`${seq.join(',')} ${JSON.stringify(Object.fromEntries(Object.entries(intent).map(([k, v]) => [k, +v.toFixed(2)])))} x=${x.toFixed(2)}`)
}
console.log(`legal serves ${ok}/300`)
console.log(fails.slice(0, 25).join('\n'))
