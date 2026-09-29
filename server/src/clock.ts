import { TICK_RATE } from '@rally/core'

const origin = performance.now()

/** Global server tick: fractional ticks since the process started. */
export const nowTicks = () => ((performance.now() - origin) * TICK_RATE) / 1000
export const currentTick = () => Math.floor(nowTicks())
