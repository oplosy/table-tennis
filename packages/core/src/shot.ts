import { HALF_LENGTH, HALF_WIDTH, NET_CLEAR_Y, SURFACE_Y, TOSS_BEHIND_END, TOSS_START_HEIGHT, sideSign, type Side } from './constants'
import { cloneBall, integrate, stepBall, topspinAxis, type BallState, type Contact, type Vec3 } from './physics'
import type { Rng } from './random'

/**
 * What a player is trying to do with a stroke. Controllers (mouse, AI, network)
 * only ever produce intents; the physics that realise them is shared, so the
 * server can recompute every shot from the same five numbers.
 */
export interface ShotIntent {
  /** -1 … 1 across the opponent's half, from the hitter's point of view mirrored to world x. */
  aimX: number
  /** 0 = just over the net, 1 = at the end line. */
  depth: number
  /** 0 … 1 swing speed. */
  power: number
  /** -1 heavy backspin … 1 heavy topspin. */
  spin: number
  /** -1 … 1 sidespin. */
  curve: number
}

/** How reliably a controller executes an intent. */
export interface ShotSkill {
  /** 0 … 1: scales random placement error. */
  accuracy: number
  /** 0 … 1: how much the arc is lifted to clear the net. */
  netAssist: number
}

export const NEUTRAL_INTENT: ShotIntent = { aimX: 0, depth: 0.6, power: 0.35, spin: 0.3, curve: 0 }

const clamp = (value: number, min: number, max: number) => (Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : (min + max) / 2)

export function clampIntent(intent: Partial<ShotIntent> | undefined): ShotIntent {
  const source = intent ?? {}
  return {
    aimX: clamp(source.aimX ?? 0, -1, 1),
    depth: clamp(source.depth ?? 0.6, 0, 1),
    power: clamp(source.power ?? 0.35, 0, 1),
    spin: clamp(source.spin ?? 0.3, -1, 1),
    curve: clamp(source.curve ?? 0, -1, 1),
  }
}

export const clampSkill = (skill: Partial<ShotSkill> | undefined): ShotSkill => ({
  accuracy: clamp(skill?.accuracy ?? 0.6, 0, 1),
  netAssist: clamp(skill?.netAssist ?? 0.5, 0, 1),
})

interface Probe { dist: number; netY: number | null }
const MAX_FLIGHT = 3

/** Flies a ball without table or net and reports where it first comes down onto the table plane. */
function probe(start: BallState, dt: number, ux: number, uz: number): Probe {
  const b = cloneBall(start)
  const cx = start.p.x, cz = start.p.z
  let netY: number | null = null
  const steps = Math.ceil(MAX_FLIGHT / dt)
  for (let i = 0; i < steps; i += 1) {
    const px = b.p.x, py = b.p.y, pz = b.p.z
    integrate(b, dt)
    if (netY === null && (pz > 0) !== (b.p.z > 0)) {
      const f = pz / (pz - b.p.z)
      netY = py + (b.p.y - py) * f
    }
    if (py > SURFACE_Y && b.p.y <= SURFACE_Y && b.v.y < 0) {
      const f = (py - SURFACE_Y) / (py - b.p.y)
      const lx = px + (b.p.x - px) * f
      const lz = pz + (b.p.z - pz) * f
      return { dist: (lx - cx) * ux + (lz - cz) * uz, netY }
    }
    if (b.p.y < 0) return { dist: -1e9, netY }
  }
  return { dist: 1e9, netY }
}

interface Launch { vy: number; reached: boolean; netY: number | null }

/** Finds the vertical launch speed that brings the ball down `target` metres away along (ux, uz). */
function solveVertical(p: Vec3, h: number, ux: number, uz: number, w: Vec3, target: number, dt: number): Launch {
  const make = (vy: number): BallState => ({ p: { ...p }, v: { x: ux * h, y: vy, z: uz * h }, w: { ...w } })
  let lo = -h * 0.8 - 2
  let hi = Math.min(h * 1.1, 9) + 1
  const high = probe(make(hi), dt, ux, uz)
  if (high.dist < target) return { vy: hi, reached: false, netY: high.netY }
  const low = probe(make(lo), dt, ux, uz)
  if (low.dist > target) return { vy: lo, reached: true, netY: low.netY }
  let result = high
  for (let i = 0; i < 26; i += 1) {
    const mid = (lo + hi) / 2
    const r = probe(make(mid), dt, ux, uz)
    if (r.dist < target) lo = mid
    else { hi = mid; result = r }
  }
  return { vy: hi, reached: true, netY: result.netY }
}

function spinVector(ux: number, uz: number, topspin: number, sidespin: number): Vec3 {
  const axis = topspinAxis(ux, uz)
  return { x: axis.x * topspin, y: sidespin, z: axis.z * topspin }
}

export const isSmash = (contact: Vec3, intent: ShotIntent) => intent.power > 0.72 && contact.y > SURFACE_Y + 0.28

/**
 * How hard a ball is to control: fast, heavily spun balls and contact away
 * from the sweet spot all widen the error of the return.
 */
export function shotDifficulty(incoming: BallState, offCenter: number) {
  const { v, w } = incoming
  const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
  const spin = Math.sqrt(w.x * w.x + w.y * w.y + w.z * w.z)
  return 1 + speed / 14 + spin / 220 + 1.3 * Math.min(1, Math.max(0, offCenter))
}

/**
 * Turns a stroke intent at a contact point into the ball's outgoing state.
 * `incoming` is the ball just before contact and `offCenter` (0 … 1) how far
 * from the middle of the paddle it was struck.
 */
export function planShot(
  contact: Vec3, side: Side, rawIntent: ShotIntent, rawSkill: ShotSkill, rng: Rng, dt: number,
  incoming?: BallState, offCenter = 0,
): BallState {
  const intent = clampIntent(rawIntent)
  const skill = clampSkill(rawSkill)
  const dir = -sideSign(side)
  const { power } = intent
  const smash = isSmash(contact, intent)
  const chop = intent.spin < -0.25

  let h = smash ? 11 + (5 * (power - 0.72)) / 0.28 : 4.2 + 6.3 * power
  if (chop) h = Math.min(h, 3.6 + 2.4 * power)

  const error = (1 - 0.85 * skill.accuracy) * (incoming ? shotDifficulty(incoming, offCenter) : 1)
  let tx = intent.aimX * (HALF_WIDTH - 0.1) + rng.gaussian() * (0.03 + 0.14 * power * power) * error
  let depthError = rng.gaussian() * (0.04 + 0.25 * power * power * power) * error
  // Occasionally a stroke goes badly wrong: framed, mistimed or over-hit.
  if (rng.next() < 0.16 * error * (0.4 + power + (smash ? 0.5 : 0))) {
    tx += rng.gaussian() * 0.35
    // Low contacts tend to find the net, big swings tend to sail long.
    const intoNet = contact.y < SURFACE_Y + 0.12 ? 0.7 : 0.55 - 0.25 * power
    depthError += rng.next() < intoNet ? -rng.range(0.45, 0.9) : rng.range(0.3, 0.7)
  }
  const tz = dir * (0.45 + 0.8 * intent.depth + depthError)
  const topspin = smash ? 40 + 60 * power : intent.spin >= 0 ? 25 + 130 * intent.spin : 90 * intent.spin
  const sidespin = 55 * intent.curve

  const dx = tx - contact.x, dz = tz - contact.z
  const distance = Math.sqrt(dx * dx + dz * dz) || 1
  const ux = dx / distance, uz = dz / distance
  const w = spinVector(ux, uz, topspin, sidespin)

  const margin = 0.012 + 0.07 * skill.netAssist
  const assistSteps = Math.round(skill.netAssist * 5)
  let launch = solveVertical(contact, h, ux, uz, w, distance, dt)
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (!launch.reached) { h *= 1.12; launch = solveVertical(contact, h, ux, uz, w, distance, dt); continue }
    const clearance = launch.netY === null ? Infinity : launch.netY - NET_CLEAR_Y
    if (clearance >= margin || attempt >= assistSteps) break
    h *= 0.9
    launch = solveVertical(contact, h, ux, uz, w, distance, dt)
  }
  return { p: { ...contact }, v: { x: ux * h, y: launch.vy, z: uz * h }, w }
}

/** Where the free hand holds the ball before the toss. */
export function tossOrigin(side: Side, x: number): Vec3 {
  return { x: clamp(x, -HALF_WIDTH + 0.1, HALF_WIDTH - 0.1), y: TOSS_START_HEIGHT, z: sideSign(side) * (HALF_LENGTH + TOSS_BEHIND_END) }
}

/**
 * A legal serve bounces once on the server's half and then on the receiver's.
 * Horizontal speed is searched so the second bounce lands on the requested spot.
 */
export function planServe(contact: Vec3, side: Side, rawIntent: ShotIntent, rawSkill: ShotSkill, rng: Rng, dt: number): BallState {
  const intent = clampIntent(rawIntent)
  const skill = clampSkill(rawSkill)
  const dir = -sideSign(side)
  const error = 1 - 0.85 * skill.accuracy
  const tx = intent.aimX * (HALF_WIDTH - 0.14) + rng.gaussian() * 0.04 * error
  const tz = dir * (0.4 + 0.85 * intent.depth + rng.gaussian() * 0.04 * error)
  const dx = tx - contact.x, dz = tz - contact.z
  const total = Math.sqrt(dx * dx + dz * dz) || 1
  const ux = dx / total, uz = dz / total
  const w = spinVector(ux, uz, 70 * intent.spin, 45 * intent.curve)
  const legal = (dist: number) => {
    const z = contact.z + uz * dist
    return Math.abs(dist) < 1e8 && z * dir > 0 && Math.abs(z) <= HALF_LENGTH
  }

  // The first bounce goes deeper on our half for faster serves; if no legal
  // trajectory exists for it, move it back towards our end line.
  let fallback: BallState | null = null
  for (const back of [0, 0.12, 0.24]) {
    const ownDepth = Math.min(HALF_LENGTH - 0.12, 0.8 + 0.35 * intent.power + back)
    const first = (-dir * ownDepth - contact.z) / uz
    const serve = searchServe(contact, ux, uz, w, first, total, dt)
    fallback ??= serve.ball
    if (legal(serve.dist)) return serve.ball
  }
  return fallback as BallState
}

function searchServe(contact: Vec3, ux: number, uz: number, w: Vec3, first: number, total: number, dt: number) {
  const attempt = (h: number) => {
    const launch = solveVertical(contact, h, ux, uz, w, first, dt)
    const ball: BallState = { p: { ...contact }, v: { x: ux * h, y: launch.vy, z: uz * h }, w: { ...w } }
    return { h, ball, dist: secondBounce(ball, dt, ux, uz) }
  }
  // The second bounce is not monotonic in pace (slow serves find the net), so
  // scan coarsely for the closest legal serve and then refine around it.
  let best = attempt(SERVE_MIN_SPEED)
  let previous = best
  let bracket: [number, number] | null = null
  for (let h = SERVE_MIN_SPEED + SERVE_SCAN_STEP; h <= SERVE_MAX_SPEED; h += SERVE_SCAN_STEP) {
    const r = attempt(h)
    if (Math.abs(r.dist - total) < Math.abs(best.dist - total)) best = r
    if (!bracket && Math.abs(previous.dist) < 1e8 && Math.abs(r.dist) < 1e8 && previous.dist < total && r.dist >= total) bracket = [previous.h, h]
    previous = r
  }
  if (bracket) {
    let [lo, hi] = bracket
    for (let i = 0; i < 12; i += 1) {
      const mid = (lo + hi) / 2
      const r = attempt(mid)
      if (Math.abs(r.dist - total) < Math.abs(best.dist - total)) best = r
      if (r.dist < total) lo = mid
      else hi = mid
    }
  }
  return best
}

const SERVE_MIN_SPEED = 1.5
const SERVE_MAX_SPEED = 9
const SERVE_SCAN_STEP = 0.3

/** Distance along (ux, uz) of the second table bounce; net or short balls count as short. */
function secondBounce(start: BallState, dt: number, ux: number, uz: number) {
  const b = cloneBall(start)
  const contacts: Contact[] = []
  let tableHits = 0
  const steps = Math.ceil(MAX_FLIGHT / dt)
  for (let i = 0; i < steps; i += 1) {
    contacts.length = 0
    stepBall(b, dt, contacts)
    for (const c of contacts) {
      if (c.kind === 'net') return -1e9
      if (c.kind === 'floor') return (c.x - start.p.x) * ux + (c.z - start.p.z) * uz > 0 ? 1e9 : -1e9
      tableHits += 1
      if (tableHits === 2) return (c.x - start.p.x) * ux + (c.z - start.p.z) * uz
    }
  }
  return 1e9
}
