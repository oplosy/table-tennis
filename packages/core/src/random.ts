/** mulberry32: tiny seeded PRNG whose whole state is one 32-bit integer. */
export function nextRandom(state: number): [value: number, state: number] {
  const next = (state + 0x6d2b79f5) | 0
  let t = next
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next]
}

/** Mutable wrapper around a seeded stream; `state` can be stored in snapshots. */
export class Rng {
  constructor(public state: number) {}
  next() {
    const [value, state] = nextRandom(this.state)
    this.state = state
    return value
  }
  /** Approximately normal (Irwin–Hall, n = 4), arithmetic only so it stays deterministic. */
  gaussian() {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.732
  }
  range(min: number, max: number) { return min + (max - min) * this.next() }
}
