import { other, type Side } from './constants'
import type { Match, MatchEvent } from './match'
import { sweepContact, type PaddlePose } from './paddle'
import type { Vec3 } from './physics'
import type { ShotIntent } from './shot'
import type { Action } from './timeline'

/** Anything that holds a paddle: the mouse, the AI or a remote player. */
export interface Controller {
  readonly side: Side
  readonly reach: number
  pose: PaddlePose
  prevPose: PaddlePose
  /** Runs before the match steps; returns a serve request when ready to serve. */
  update(match: Match): { x: number; intent: ShotIntent } | null
  /** Called at the moment of contact to choose the stroke. */
  intent(contact: Vec3, opponent: PaddlePose, match: Match): ShotIntent
}

/** How a tick is executed; online play routes these through a rollback timeline. */
export interface TickOps {
  step(): void
  apply(action: Action): boolean
}

export interface TickResult {
  events: MatchEvent[]
  /** Local serve/hit decisions made this tick, with the tick they were applied at. */
  actions: Array<{ tick: number; action: Action }>
}

export const directOps = (match: Match): TickOps => ({
  step: () => match.step(),
  apply: (action) => action.kind === 'serve'
    ? match.serve(action.side, action.x, action.intent)
    : match.hit(action.side, action.contact, action.intent, action.offCenter),
})

/**
 * Advances a match by one tick with locally controlled paddles. `opponentPose`
 * supplies the pose of a side that has no local controller (online play).
 */
export function tickWithControllers(
  match: Match,
  controllers: Controller[],
  opponentPose: (side: Side) => PaddlePose,
  ops: TickOps = directOps(match),
): TickResult {
  const actions: TickResult['actions'] = []
  for (const controller of controllers) {
    const serve = controller.update(match)
    if (!serve) continue
    const action: Action = { kind: 'serve', side: controller.side, x: serve.x, intent: serve.intent }
    const tick = match.state.tick
    if (ops.apply(action)) actions.push({ tick, action })
  }
  const before = { ...match.state.ball.p }
  ops.step()
  for (const controller of controllers) {
    if (!match.canHit(controller.side)) continue
    const sweep = sweepContact(before, match.state.ball.p, controller.prevPose, controller.pose, controller.reach)
    if (!sweep) continue
    const opponent = controllers.find((c) => c.side !== controller.side)?.pose ?? opponentPose(other(controller.side))
    const intent = controller.intent(sweep.point, opponent, match)
    const action: Action = { kind: 'hit', side: controller.side, contact: sweep.point, intent, offCenter: sweep.offCenter }
    const tick = match.state.tick
    if (ops.apply(action)) actions.push({ tick, action })
  }
  return { events: match.takeEvents(), actions }
}
