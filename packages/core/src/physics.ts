import {
  BALL_RADIUS, DRAG, FLOOR_RESTITUTION, GRAVITY, HALF_LENGTH, HALF_WIDTH, MAGNUS, NET_BODY_DAMPING,
  NET_CORD_RADIUS, NET_CORD_RESTITUTION, NET_HALF_WIDTH, NET_TOP, SPIN_DECAY, SURFACE_Y, TABLE_FRICTION,
  TABLE_HEIGHT, TABLE_RESTITUTION, sideOfZ, type Side,
} from './constants'

// Only +, -, *, / and sqrt are used here so that every IEEE-754 engine (V8 in
// the browser and in Node) produces bit-identical trajectories.

export interface Vec3 { x: number; y: number; z: number }
/** Position, linear velocity and angular velocity (rad/s) of the ball. */
export interface BallState { p: Vec3; v: Vec3; w: Vec3 }

export type Contact =
  | { kind: 'table'; side: Side; x: number; z: number; speed: number }
  | { kind: 'net'; cord: boolean; x: number; y: number; speed: number }
  | { kind: 'floor'; x: number; z: number; speed: number }

export const vec = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })
export const copyVec = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z })
export const cloneBall = (b: BallState): BallState => ({ p: copyVec(b.p), v: copyVec(b.v), w: copyVec(b.w) })
export const length = (v: Vec3) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
export const distance = (a: Vec3, b: Vec3) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)

/** Free flight: gravity, quadratic drag and the Magnus force from spin. */
export function integrate(b: BallState, dt: number) {
  const { v, w, p } = b
  const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
  const ax = -DRAG * speed * v.x + MAGNUS * (w.y * v.z - w.z * v.y)
  const ay = -DRAG * speed * v.y + MAGNUS * (w.z * v.x - w.x * v.z) - GRAVITY
  const az = -DRAG * speed * v.z + MAGNUS * (w.x * v.y - w.y * v.x)
  v.x += ax * dt; v.y += ay * dt; v.z += az * dt
  p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt
  const decay = 1 - SPIN_DECAY * dt
  w.x *= decay; w.y *= decay; w.z *= decay
}

/**
 * Advances the ball by one step and resolves net, table and floor contacts.
 * Contacts are swept against the previous position so fast balls never tunnel.
 */
export function stepBall(b: BallState, dt: number, contacts?: Contact[]) {
  const px = b.p.x, py = b.p.y, pz = b.p.z
  integrate(b, dt)
  if (collideNet(b, px, py, pz, contacts)) return
  collideTable(b, px, py, pz, contacts)
  collideFloor(b, contacts)
}

/** Topspin/backspin axis for a ball travelling with horizontal velocity (vx, vz). */
export function topspinAxis(vx: number, vz: number): Vec3 {
  const h = Math.sqrt(vx * vx + vz * vz) || 1
  return { x: vz / h, y: 0, z: -vx / h }
}

function collideTable(b: BallState, px: number, py: number, pz: number, contacts?: Contact[]) {
  const { p, v, w } = b
  if (!(py > SURFACE_Y && p.y <= SURFACE_Y && v.y < 0)) return
  const f = (py - SURFACE_Y) / (py - p.y)
  const cx = px + (p.x - px) * f
  const cz = pz + (p.z - pz) * f
  if (Math.abs(cx) > HALF_WIDTH || Math.abs(cz) > HALF_LENGTH) return

  const vyIn = v.y
  const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
  p.y = SURFACE_Y + (SURFACE_Y - p.y) * TABLE_RESTITUTION
  v.y = -vyIn * TABLE_RESTITUTION

  // Slip velocity of the contact point: v_t + ω × r with r = (0, -R, 0).
  const ux = v.x + w.z * BALL_RADIUS
  const uz = v.z - w.x * BALL_RADIUS
  const slip = Math.sqrt(ux * ux + uz * uz)
  if (slip > 1e-9) {
    // Full grip on a thin hollow sphere removes 2/5 of the slip; friction caps it.
    const maxImpulse = TABLE_FRICTION * (1 + TABLE_RESTITUTION) * -vyIn
    const scale = Math.min(1, maxImpulse / (0.4 * slip))
    const dvx = -0.4 * ux * scale
    const dvz = -0.4 * uz * scale
    v.x += dvx; v.z += dvz
    w.x += (-1.5 * dvz) / BALL_RADIUS
    w.z += (1.5 * dvx) / BALL_RADIUS
  }
  contacts?.push({ kind: 'table', side: sideOfZ(cz), x: cx, z: cz, speed })
}

function collideNet(b: BallState, px: number, py: number, pz: number, contacts?: Contact[]) {
  const { p, v, w } = b
  const side = pz > 0 ? 1 : pz < 0 ? -1 : (v.z > 0 ? -1 : 1)
  const plane = side * BALL_RADIUS
  // The ball surface reaches the net plane when its centre crosses ±R.
  if (!((pz - plane) * side > 0 && (p.z - plane) * side <= 0)) return false
  const f = (pz - plane) / (pz - p.z)
  const cx = px + (p.x - px) * f
  const cy = py + (p.y - py) * f
  if (Math.abs(cx) > NET_HALF_WIDTH + BALL_RADIUS) return false
  if (cy < TABLE_HEIGHT || cy > NET_TOP + BALL_RADIUS + NET_CORD_RADIUS) return false
  const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)

  if (cy < NET_TOP - BALL_RADIUS * 0.5) {
    // Straight into the mesh: the net swallows almost all of the pace.
    p.x = cx; p.y = cy; p.z = plane
    v.z = -v.z * NET_BODY_DAMPING
    v.x *= 0.5; v.y *= 0.5
    w.x *= 0.3; w.y *= 0.3; w.z *= 0.3
    contacts?.push({ kind: 'net', cord: false, x: cx, y: cy, speed })
    return true
  }

  // Clips the cord: reflect around the normal from the cord to the ball centre.
  const reach = BALL_RADIUS + NET_CORD_RADIUS
  const ny = Math.max(-1, Math.min(1, (cy - NET_TOP) / reach))
  const nz = side * Math.sqrt(Math.max(0, 1 - ny * ny))
  const vn = v.y * ny + v.z * nz
  if (vn < 0) {
    const j = (1 + NET_CORD_RESTITUTION) * vn
    v.y -= j * ny; v.z -= j * nz
    v.x *= 0.85
    w.x *= 0.6; w.y *= 0.6; w.z *= 0.6
  }
  p.x = cx; p.y = NET_TOP + ny * reach; p.z = nz * reach
  contacts?.push({ kind: 'net', cord: true, x: cx, y: cy, speed })
  return true
}

function collideFloor(b: BallState, contacts?: Contact[]) {
  const { p, v, w } = b
  if (!(p.y <= BALL_RADIUS && v.y < 0)) return
  const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
  p.y = BALL_RADIUS + (BALL_RADIUS - p.y) * FLOOR_RESTITUTION
  v.y = -v.y * FLOOR_RESTITUTION
  v.x *= 0.75; v.z *= 0.75
  w.x *= 0.5; w.y *= 0.5; w.z *= 0.5
  contacts?.push({ kind: 'floor', x: p.x, z: p.z, speed })
}
