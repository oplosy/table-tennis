import { beforeAll, describe, expect, it } from 'vitest'
import { getBounds, type Document } from '@gltf-transform/core'
import { HALF_LENGTH, HALF_WIDTH, NET_HALF_WIDTH, NET_TOP, PADDLE_MAX_DEPTH, PADDLE_MAX_X, TABLE_HEIGHT, TABLE_THICKNESS } from '@rally/core'
import arenaGlb from '../../assets/models/arena.glb?inline'
import paddleGlb from '../../assets/models/paddle.glb?inline'
import tableGlb from '../../assets/models/table.glb?inline'
import { boundsOf, inlineBytes, materialNames, nodeNamed as boundsNode, readGlb } from '../../test/glb'
import { COURT_HALF_X, COURT_HALF_Z } from './arena'

/** The models must agree with the simulation to the millimetre, or the ball would bounce on air. */
const MM = 0.001
const BUDGET_BYTES = 6 * 1024 * 1024

describe('table.glb', () => {
  let table: Document
  beforeAll(async () => { table = await readGlb(tableGlb) })

  it('has a regulation playing surface at the height the physics uses', () => {
    const { min, max } = boundsOf(table, 'table_top')
    expect(max[0]).toBeCloseTo(HALF_WIDTH, 3)
    expect(min[0]).toBeCloseTo(-HALF_WIDTH, 3)
    expect(max[2]).toBeCloseTo(HALF_LENGTH, 3)
    expect(min[2]).toBeCloseTo(-HALF_LENGTH, 3)
    expect(Math.abs(max[1] - TABLE_HEIGHT)).toBeLessThan(MM)
    expect(Math.abs(min[1] - (TABLE_HEIGHT - TABLE_THICKNESS))).toBeLessThan(MM)
  })

  it('stands on the floor and stays under the playing surface', () => {
    const { min, max } = boundsOf(table, 'table_frame')
    expect(Math.abs(min[1])).toBeLessThan(MM)
    expect(max[1]).toBeLessThanOrEqual(TABLE_HEIGHT - TABLE_THICKNESS + MM)
    expect(max[0]).toBeLessThanOrEqual(HALF_WIDTH)
    expect(max[2]).toBeLessThanOrEqual(HALF_LENGTH)
  })

  it('puts the net posts where the net hangs', () => {
    const centres = ['net_post_L', 'net_post_R'].map((name) => {
      const { min, max } = boundsOf(table, name)
      expect(Math.abs((min[2] + max[2]) / 2)).toBeLessThan(MM)
      expect(max[1]).toBeGreaterThanOrEqual(NET_TOP - MM)
      expect(max[1]).toBeLessThan(NET_TOP + 0.02)
      return (min[0] + max[0]) / 2
    })
    expect(Math.abs(centres[0])).toBeCloseTo(NET_HALF_WIDTH, 2)
    expect(centres[0]).toBeCloseTo(-centres[1], 3)
  })

  it('names the materials the game recolours and tunes', () => {
    expect(materialNames(table)).toEqual(expect.arrayContaining(['table_surface', 'table_lines', 'metal']))
  })

  it('carries baked ambient occlusion as vertex colours', () => {
    for (const mesh of table.getRoot().listMeshes()) {
      for (const primitive of mesh.listPrimitives()) expect(primitive.listSemantics(), mesh.getName()).toContain('COLOR_0')
    }
  })

  it('is centred on the origin', () => {
    const scene = table.getRoot().getDefaultScene() ?? table.getRoot().listScenes()[0]
    const { min, max } = getBounds(scene)
    expect(Math.abs(min[0] + max[0])).toBeLessThan(2 * MM)
    expect(Math.abs(min[2] + max[2])).toBeLessThan(2 * MM)
  })
})

describe('paddle.glb', () => {
  let paddle: Document
  beforeAll(async () => { paddle = await readGlb(paddleGlb) })

  it('has a real-size blade centred on the origin, facing along z', () => {
    const { min, max } = boundsOf(paddle, 'blade')
    const width = max[0] - min[0]
    const thickness = max[2] - min[2]
    expect(width).toBeGreaterThan(0.148)
    expect(width).toBeLessThan(0.16)
    expect(thickness).toBeGreaterThan(0.009)
    expect(thickness).toBeLessThan(0.012)
    expect(Math.abs(min[0] + max[0])).toBeLessThan(MM)
    expect(Math.abs(min[2] + max[2])).toBeLessThan(MM)
    expect(max[1]).toBeGreaterThan(0.075)
    expect(max[1]).toBeLessThan(0.085)
  })

  it('hangs the handle below the blade, as the grip animation assumes', () => {
    const { min, max } = boundsOf(paddle, 'handle')
    expect(max[1]).toBeLessThan(-0.06)
    expect(min[1]).toBeGreaterThan(-0.2)
    expect(min[1]).toBeLessThan(-0.17)
    expect(Math.abs(min[0] + max[0])).toBeLessThan(MM)
    expect(Math.abs(min[2] + max[2])).toBeLessThan(MM)
  })

  it('puts the forehand rubber on +z and the backhand on -z', () => {
    const side = (material: string) => {
      const primitive = paddle.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).find((p) => p.getMaterial()?.getName() === material)
      if (!primitive) throw new Error(`No geometry uses ${material}`)
      const position = primitive.getAttribute('POSITION')!
      return { min: position.getMin([0, 0, 0])[2], max: position.getMax([0, 0, 0])[2] }
    }
    expect(side('rubber_forehand').min).toBeGreaterThan(0)
    expect(side('rubber_backhand').max).toBeLessThan(0)
  })

  it('names the materials the game recolours per player', () => {
    expect(materialNames(paddle)).toEqual(expect.arrayContaining(['rubber_forehand', 'rubber_backhand', 'wood', 'handle', 'accent']))
  })
})

describe('arena.glb', () => {
  let arena: Document
  beforeAll(async () => { arena = await readGlb(arenaGlb) })

  it('lays the floor at the height the ball bounces on', () => {
    const { min, max } = boundsOf(arena, 'floor')
    expect(Math.abs(max[1])).toBeLessThan(MM)
    expect(min[0]).toBeLessThan(-COURT_HALF_X)
    expect(max[0]).toBeGreaterThan(COURT_HALF_X)
    expect(min[2]).toBeLessThan(-COURT_HALF_Z)
    expect(max[2]).toBeGreaterThan(COURT_HALF_Z)
  })

  it('surrounds the court with barriers', () => {
    const { min, max } = boundsOf(arena, 'barriers')
    expect(max[1]).toBeGreaterThan(0.7)
    expect(max[1]).toBeLessThan(0.8)
    for (const [value, half] of [[-min[0], COURT_HALF_X], [max[0], COURT_HALF_X], [-min[2], COURT_HALF_Z], [max[2], COURT_HALF_Z]]) {
      expect(value).toBeGreaterThanOrEqual(half)
      expect(value).toBeLessThan(half + 0.5)
    }
  })

  it('keeps the stands behind the barriers and the lamps overhead', () => {
    const stands = boundsOf(arena, 'stands')
    expect(stands.min[0]).toBeLessThan(-COURT_HALF_X - 1)
    expect(stands.max[0]).toBeGreaterThan(COURT_HALF_X + 1)
    expect(boundsOf(arena, 'lamps').min[1]).toBeGreaterThan(6)
  })

  it('leaves the space the players move in empty', () => {
    const reachX = PADDLE_MAX_X + 0.3
    const reachZ = PADDLE_MAX_DEPTH + 0.3
    const open = ['floor', 'barriers', 'stands', 'hall']
    for (const node of arena.getRoot().listNodes()) {
      if (open.includes(node.getName()) || !node.getMesh()) continue
      const { min, max } = boundsOf(arena, node.getName())
      const clear = min[0] > reachX || max[0] < -reachX || min[2] > reachZ || max[2] < -reachZ || min[1] > 3
      expect(clear, `${node.getName()} intrudes into the play area`).toBe(true)
    }
  })

  it('names the surfaces the game textures itself', () => {
    expect(materialNames(arena)).toEqual(expect.arrayContaining(['court', 'barrier_face_A', 'barrier_face_B', 'barrier_face_C', 'lamp', 'screen', 'backdrop_logo']))
  })

  it('carries baked light: a lightmap UV set on big surfaces, vertex colours on cluttered ones', () => {
    const attributes = (name: string) => boundsNode(arena, name).getMesh()!.listPrimitives().map((p) => p.listSemantics())
    for (const name of ['floor', 'barriers', 'hall', 'backwall_home', 'backwall_away', 'umpire_desk']) {
      for (const semantics of attributes(name)) expect(semantics, name).toContain('TEXCOORD_1')
    }
    for (const name of ['stands', 'rig', 'lamps', 'backstage_home', 'backstage_away']) {
      for (const semantics of attributes(name)) expect(semantics, name).toContain('COLOR_0')
    }
  })

  it('faces a screen towards the court from behind each end', () => {
    const home = boundsOf(arena, 'screen_home')
    const away = boundsOf(arena, 'screen_away')
    expect(home.min[2]).toBeGreaterThan(COURT_HALF_Z + 2)
    expect(away.max[2]).toBeLessThan(-COURT_HALF_Z - 2)
    for (const { min, max } of [home, away]) {
      expect(min[1]).toBeGreaterThan(1)
      expect(max[0] - min[0]).toBeCloseTo(6, 1)
      expect(Math.abs(min[0] + max[0])).toBeLessThan(MM)
    }
  })
})

describe('asset budget', () => {
  it('keeps models and textures within 6 MB', () => {
    const files = import.meta.glob('../../assets/models/*', { query: '?inline', eager: true, import: 'default' }) as Record<string, string>
    const total = Object.values(files).reduce((sum, dataUrl) => sum + inlineBytes(dataUrl).length, 0)
    expect(total).toBeGreaterThan(0)
    expect(total).toBeLessThanOrEqual(BUDGET_BYTES)
  })
})
