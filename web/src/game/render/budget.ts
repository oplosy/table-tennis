/** Frames at or beyond this are stalls (hidden tab, debugger), not a slow GPU. */
const STALL_SECONDS = 0.1

/**
 * Watches frame times and reports once when the machine cannot hold the
 * frame rate, so the renderer can drop its most expensive effect.
 */
export class FrameBudget {
  private seen = 0
  private sum = 0
  private count = 0
  private tripped = false

  /**
   * @param limitMs average frame time that counts as too slow (18 ms ≈ 55 fps)
   * @param warmup frames skipped at the start, while shaders compile and the HDRI bakes
   * @param window frames averaged per verdict, so a short hitch does not trip it
   */
  constructor(private readonly limitMs = 18, private readonly warmup = 90, private readonly window = 120) {}

  /** Feed one frame time in seconds. Returns true exactly once, when the budget is exceeded. */
  sample(dt: number): boolean {
    if (this.tripped || dt >= STALL_SECONDS) return false
    this.seen += 1
    if (this.seen <= this.warmup) return false
    this.sum += dt
    this.count += 1
    if (this.count < this.window) return false
    const average = (this.sum / this.count) * 1000
    this.sum = 0
    this.count = 0
    this.tripped = average > this.limitMs
    return this.tripped
  }
}
