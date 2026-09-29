import {
  HIT_MAX_Y, HIT_MIN_Y, PADDLE_MAX_DEPTH, PADDLE_MAX_X, PADDLE_MIN_DEPTH, PADDLE_REST_Y, sideSign, type Side,
} from './constants'
import type { Vec3 } from './physics'

/** Paddle centre in world space. Only x and z matter for contact; y follows the ball. */
export type PaddlePose = Vec3

export const restPose = (side: Side): PaddlePose => ({ x: 0, y: PADDLE_REST_Y, z: sideSign(side) * 1.95 })

/** Keeps a paddle on its own half of the playing area. */
export function clampPose(side: Side, pose: PaddlePose): PaddlePose {
  const sign = sideSign(side)
  const depth = Math.min(PADDLE_MAX_DEPTH, Math.max(PADDLE_MIN_DEPTH, pose.z * sign))
  return {
    x: Math.min(PADDLE_MAX_X, Math.max(-PADDLE_MAX_X, pose.x)),
    y: Math.min(HIT_MAX_Y, Math.max(HIT_MIN_Y, pose.y)),
    z: depth * sign,
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * Swept test between the ball and the paddle's vertical plane (constant z) over
 * one tick. When the two pass each other within reach it returns the contact
 * point and how far off-centre (0 … 1) the ball met the paddle.
 */
export function sweepContact(
  prevBall: Vec3, ball: Vec3, prevPaddle: PaddlePose, paddle: PaddlePose, reach: number,
): { point: Vec3; offCenter: number } | null {
  const before = prevBall.z - prevPaddle.z
  const after = ball.z - paddle.z
  if (before === after || before * after > 0) return null
  const f = before / (before - after)
  const bx = lerp(prevBall.x, ball.x, f)
  const px = lerp(prevPaddle.x, paddle.x, f)
  const offset = Math.abs(bx - px)
  if (offset > reach) return null
  const by = lerp(prevBall.y, ball.y, f)
  if (by < HIT_MIN_Y || by > HIT_MAX_Y) return null
  return { point: { x: bx, y: by, z: lerp(prevBall.z, ball.z, f) }, offCenter: offset / reach }
}
