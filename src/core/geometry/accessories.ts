import type { Accessories, ProfileParams, Vec2 } from '../types.ts'
import type { MiterFrame } from '../shapes.ts'
import { offsetPath } from '../shapes.ts'
import type { RawMesh } from './mesh.ts'
import { basisTransform, box, extrudePolygon, transformMesh, translateMesh } from './primitives.ts'

export interface AccessoryPart {
  id: string
  name: string
  kind: 'accessory' | 'backer'
  mesh: RawMesh
}

/** Clearance between a printed part and the pocket it drops into. */
const FIT_MM = 0.4

export interface AccessoryContext {
  points: Vec2[]
  frames: MiterFrame[]
  profile: ProfileParams
  /** Bounding box of the assembled frame in plan. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

export function buildAccessories(
  want: Accessories,
  ctx: AccessoryContext,
): { parts: AccessoryPart[]; notes: string[] } {
  const parts: AccessoryPart[] = []
  const notes: string[] = []
  const { profile } = ctx

  if (want.backer) {
    const thickness = Math.max(1.2, Math.min(2.4, profile.rabbetDepth * 0.5))
    const outline = offsetPath(ctx.points, ctx.frames, profile.rabbetWidth - FIT_MM)
    parts.push({
      id: 'backer',
      name: 'Backing panel',
      kind: 'backer',
      mesh: extrudePolygon(outline, thickness),
    })
    notes.push(
      `Backing panel is ${thickness.toFixed(1)} mm thick, leaving ${(profile.rabbetDepth - thickness).toFixed(1)} mm of rabbet for the artwork and glazing.`,
    )
  }

  if (want.clips) {
    // Flat bars sized to wedge across the rabbet, springing the stack forward
    // against the rabbet ceiling.
    const span = ctx.bounds.maxX - ctx.bounds.minX - 2 * profile.width - 2 * profile.rabbetWidth
    const barLength = span + 0.6
    const thickness = Math.max(1, profile.rabbetDepth * 0.35)
    if (barLength > 20) {
      for (let i = 0; i < 2; i++) {
        const y = ctx.bounds.minY + (ctx.bounds.maxY - ctx.bounds.minY) * (i === 0 ? 0.3 : 0.7)
        parts.push({
          id: `clip-${i}`,
          name: `Retainer bar ${i + 1}`,
          kind: 'accessory',
          mesh: box([-barLength / 2, y - 5, 0], [barLength / 2, y + 5, thickness]),
        })
      }
      notes.push('Retainer bars are printed 0.6 mm over-length so they spring into the rabbet.')
    } else {
      notes.push('Opening is too small for retainer bars — skipped.')
    }
  }

  if (want.easel) {
    parts.push(...deskStand(ctx))
  }

  return { parts, notes }
}

/**
 * A pair of slotted feet the bottom rail drops into. Printing the stand as two
 * small blocks rather than one wide one keeps it on any bed and lets it sit
 * flat without support.
 */
function deskStand(ctx: AccessoryContext): AccessoryPart[] {
  const { profile } = ctx
  const slotWidth = profile.depth + FIT_MM * 2
  const slotDepth = Math.min(14, Math.max(8, profile.width * 0.8))
  const bodyHeight = slotDepth + 10
  const bodyDepth = slotWidth + 26 // front-to-back footprint, for stability
  const legWidth = 34
  const centre = bodyDepth * 0.42 // slot sits forward of centre so it leans back

  // A rectangle with a notch cut into its top edge, in local (X = up, Y = back).
  const poly: Vec2[] = [
    [0, 0],
    [bodyDepth, 0],
    [bodyDepth, bodyHeight],
    [centre + slotWidth / 2, bodyHeight],
    [centre + slotWidth / 2, bodyHeight - slotDepth],
    [centre - slotWidth / 2, bodyHeight - slotDepth],
    [centre - slotWidth / 2, bodyHeight],
    [0, bodyHeight],
  ].map(([a, b]) => [b, a] as Vec2) // local X = up, local Y = back

  const yBottom = ctx.bounds.minY
  const spread = (ctx.bounds.maxX - ctx.bounds.minX) * 0.28

  return [-1, 1].map((side, i) => {
    const origin: [number, number, number] = [
      side * spread - legWidth / 2,
      yBottom - (bodyHeight - slotDepth),
      profile.depth / 2 - centre,
    ]
    // local X → world +Y (up the frame), local Y → world +Z, local Z → world +X
    const m = basisTransform([0, 1, 0], [0, 0, 1], [1, 0, 0], origin)
    return {
      id: `stand-${i}`,
      name: `Desk stand ${side < 0 ? 'left' : 'right'}`,
      kind: 'accessory' as const,
      mesh: transformMesh(extrudePolygon(poly, legWidth), m),
    }
  })
}

/**
 * A keyhole hanger plate for the back of the top rail. Returned as an outline
 * plus its hole so the caller can punch it with a proper polygon boolean.
 */
export function hangerOutline(ctx: AccessoryContext): {
  outer: Vec2[]
  holes: Vec2[][]
  thickness: number
  place: (mesh: RawMesh) => RawMesh
} {
  const plateW = 34
  const plateH = 20
  const thickness = 3
  const outer: Vec2[] = [
    [-plateW / 2, -plateH / 2],
    [plateW / 2, -plateH / 2],
    [plateW / 2, plateH / 2],
    [-plateW / 2, plateH / 2],
  ]

  // Keyhole: a Ø8 entry at the bottom narrowing to a 4 mm slot it hangs on.
  const hole: Vec2[] = []
  const r = 4
  const slot = 2
  const cyLow = -3
  for (let i = 0; i <= 20; i++) {
    const a = Math.PI * 1.5 + (i / 20) * Math.PI * 2 * 0.72
    hole.push([r * Math.cos(a), cyLow + r * Math.sin(a)])
  }
  hole.push([slot, 6.5], [-slot, 6.5])

  const yTop = ctx.bounds.maxY - ctx.profile.width / 2
  return {
    outer,
    holes: [hole],
    thickness,
    // Sits flat on the back face of the top rail.
    place: (mesh) => translateMesh(mesh, [0, yTop, -thickness]),
  }
}
