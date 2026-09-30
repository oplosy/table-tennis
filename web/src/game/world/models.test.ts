import { beforeAll, describe, expect, it } from 'vitest'
import { getBounds, type Document } from '@gltf-transform/core'
import { HALF_LENGTH, HALF_WIDTH, NET_HALF_WIDTH, NET_TOP, TABLE_HEIGHT, TABLE_THICKNESS } from '@rally/core'
import tableGlb from '../../assets/models/table.glb?inline'
import { boundsOf, inlineBytes, materialNames, readGlb } from '../../test/glb'

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

  it('is centred on the origin', () => {
    const scene = table.getRoot().getDefaultScene() ?? table.getRoot().listScenes()[0]
    const { min, max } = getBounds(scene)
    expect(Math.abs(min[0] + max[0])).toBeLessThan(2 * MM)
    expect(Math.abs(min[2] + max[2])).toBeLessThan(2 * MM)
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
