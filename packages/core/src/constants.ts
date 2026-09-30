// World units are metres and seconds of *simulated* time. The origin sits on the
// floor under the centre of the net: +y is up, x runs across the table and z
// runs along it. The home player defends z > 0, the away player z < 0.

export type Side = 'home' | 'away'
export const SIDES: readonly Side[] = ['home', 'away']
export const other = (side: Side): Side => (side === 'home' ? 'away' : 'home')
/** Sign of the half of the table a side defends (+1 home, -1 away). */
export const sideSign = (side: Side) => (side === 'home' ? 1 : -1)
export const sideOfZ = (z: number): Side => (z >= 0 ? 'home' : 'away')

/** Fixed simulation ticks per *real* second. Every client and the server agree on it. */
export const TICK_RATE = 240

// ITTF table dimensions.
export const TABLE_LENGTH = 2.74
export const TABLE_WIDTH = 1.525
export const TABLE_HEIGHT = 0.76
export const TABLE_THICKNESS = 0.025
export const HALF_LENGTH = TABLE_LENGTH / 2
export const HALF_WIDTH = TABLE_WIDTH / 2

export const NET_HEIGHT = 0.1525
export const NET_OVERHANG = 0.1525
export const NET_HALF_WIDTH = HALF_WIDTH + NET_OVERHANG
export const NET_CORD_RADIUS = 0.004
export const NET_TOP = TABLE_HEIGHT + NET_HEIGHT

export const BALL_RADIUS = 0.02
/** Height of the ball centre when it touches the table. */
export const SURFACE_Y = TABLE_HEIGHT + BALL_RADIUS
/** Minimum centre height needed to clear the net cord. */
export const NET_CLEAR_Y = NET_TOP + BALL_RADIUS + NET_CORD_RADIUS

// Aerodynamics for a 40 mm, 2.7 g ball: drag = 0.5·ρ·Cd·A / m.
export const GRAVITY = 9.81
export const DRAG = 0.12
export const MAGNUS = 0.0032
export const SPIN_DECAY = 0.3

export const TABLE_RESTITUTION = 0.88
export const TABLE_FRICTION = 0.22
export const FLOOR_RESTITUTION = 0.5
export const NET_BODY_DAMPING = 0.12
export const NET_CORD_RESTITUTION = 0.3

// Where a paddle may be held, measured from the net along the player's half.
export const PADDLE_MIN_DEPTH = 0.25
export const PADDLE_MAX_DEPTH = HALF_LENGTH + 1.9
export const PADDLE_MAX_X = HALF_WIDTH + 0.9
export const PADDLE_REST_Y = TABLE_HEIGHT + 0.16
/** Vertical window in which a ball can be struck. */
export const HIT_MIN_Y = TABLE_HEIGHT - 0.25
export const HIT_MAX_Y = TABLE_HEIGHT + 1.1
/** Largest distance between a claimed contact point and the simulated ball. */
export const CONTACT_TOLERANCE = 0.3

// Timings in ticks (real time).
export const secondsToTicks = (seconds: number) => Math.round(seconds * TICK_RATE)
export const DEAD_BALL_TICKS = secondsToTicks(1.25)
export const GAME_BREAK_TICKS = secondsToTicks(3)
export const AUTO_SERVE_TICKS = secondsToTicks(10)
export const RALLY_STALL_TICKS = secondsToTicks(5)

// Serve toss: the ball leaves the free hand just behind the end line and is
// struck on the way down.
export const TOSS_BEHIND_END = 0.22
export const TOSS_START_HEIGHT = TABLE_HEIGHT + 0.24
export const TOSS_SPEED = 2.3
