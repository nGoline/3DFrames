import type { Accessories, ProfileParams, Vec2 } from '../types.ts'
import type { MiterFrame } from '../shapes.ts'
import { offsetPath } from '../shapes.ts'
import type { RawMesh } from './mesh.ts'
import { basisTransform, box, extrudePolygon, transformMesh } from './primitives.ts'

export interface AccessoryPart {
  id: string
  name: string
  kind: 'accessory' | 'backer'
  mesh: RawMesh
}

/** Clearance between a printed part and the pocket it drops into. */
const FIT_MM = 0.4
/** Depth reserved at the front of the rabbet for the artwork and glazing. */
const ARTWORK_MM = 1
/** How far the retainer bars are printed over-length, so they grip. */
const INTERFERENCE_MM = 0.6

export interface AccessoryContext {
  points: Vec2[]
  frames: MiterFrame[]
  profile: ProfileParams
  /** Bounding box of the assembled frame in plan. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

/**
 * The fittings that go with a frame.
 *
 * Everything here is positioned relative to the frame lying face-up with its
 * back on Z = 0, which is how the viewer shows it. Depth inside the rabbet is
 * budgeted front to back: artwork against the rabbet ceiling, backing panel
 * behind it, retainer bars behind that, filling flush to the back face.
 */
export function buildAccessories(
  want: Accessories,
  ctx: AccessoryContext,
): { parts: AccessoryPart[]; notes: string[] } {
  const parts: AccessoryPart[] = []
  const notes: string[] = []
  const { profile } = ctx

  // Front of the stack: everything behind this is fittings.
  const stackTop = Math.max(0, profile.rabbetDepth - ARTWORK_MM)
  const backerThickness = want.backer ? Math.max(1.2, Math.min(2.4, stackTop * 0.6)) : 0
  const backerBase = stackTop - backerThickness

  if (want.backer) {
    // Sits in the rabbet void, clear of the rabbet walls on every side.
    const outline = offsetPath(ctx.points, ctx.frames, profile.rabbetWidth - FIT_MM)
    parts.push({
      id: 'backer',
      name: 'Backing panel',
      kind: 'backer',
      mesh: translateZ(extrudePolygon(outline, backerThickness), backerBase),
    })
    notes.push(
      `Backing panel is ${backerThickness.toFixed(1)} mm thick, leaving ${ARTWORK_MM.toFixed(1)} mm of rabbet at the front for the artwork and glazing.`,
    )
  }

  if (want.clips) {
    const thickness = backerBase
    // The bar has to reach across the rabbet — wall to wall, not just across
    // the aperture — plus a little, so it springs in and stays put. Measured
    // against the true rabbet, not the clearance-reduced outline the backing
    // panel uses, or the interference comes out negative.
    const rabbet = offsetPath(ctx.points, ctx.frames, profile.rabbetWidth)
    const placed: AccessoryPart[] = []
    if (thickness >= 0.8) {
      for (const [i, t] of [0.3, 0.7].entries()) {
        const y = ctx.bounds.minY + (ctx.bounds.maxY - ctx.bounds.minY) * t
        const chord = horizontalChord(rabbet, y)
        if (!chord || chord[1] - chord[0] < 20) continue
        const half = (chord[1] - chord[0] + INTERFERENCE_MM) / 2
        const mid = (chord[0] + chord[1]) / 2
        placed.push({
          id: `clip-${i}`,
          name: `Retainer bar ${i + 1}`,
          kind: 'accessory',
          mesh: box([mid - half, y - 5, 0], [mid + half, y + 5, thickness]),
        })
      }
    }
    if (placed.length) {
      parts.push(...placed)
      notes.push(
        `Retainer bars are ${thickness.toFixed(1)} mm thick and printed ${INTERFERENCE_MM} mm over-length, so they spring across the rabbet and hold the stack forward.`,
      )
    } else {
      notes.push('The rabbet is too shallow or too small for retainer bars — skipped.')
    }
  }

  if (want.easel) parts.push(...deskStands(ctx))

  return { parts, notes }
}

/**
 * A pair of slotted feet the bottom rail drops into.
 *
 * The body sits behind the frame — only the slot's front lip comes round to the
 * face — and the base is cut at a slight angle so the frame leans back instead
 * of standing dead upright, which would tip at the first knock.
 */
function deskStands(ctx: AccessoryContext): AccessoryPart[] {
  const { profile } = ctx
  const LEAN_DEG = 10

  const slot = profile.depth + 2 * FIT_MM
  const lip = 3
  const behind = 26
  const seat = Math.min(14, Math.max(8, profile.width * 0.7)) // how far the rail sits in
  const below = 18
  const legWidth = 34

  const lean = (behind + slot + lip) * Math.tan((LEAN_DEG * Math.PI) / 180)

  // Local (X = up the frame, Y = toward the frame's face). The slot occupies
  // Y ∈ [0, slot]; the body reaches back to Y = −behind and forward to the lip.
  const poly: Vec2[] = [
    [-below + lean, -behind],
    [-below, slot + lip],
    [seat, slot + lip],
    [seat, slot],
    [0, slot],
    [0, 0],
    [seat, 0],
    [seat, -behind],
  ]

  const spread = (ctx.bounds.maxX - ctx.bounds.minX) * 0.28

  return [-1, 1].map((side, i) => {
    const origin: [number, number, number] = [
      side * spread - legWidth / 2,
      ctx.bounds.minY, // local X = 0 is the slot floor, where the rail rests
      (profile.depth - slot) / 2, // centre the slot on the moulding's thickness
    ]
    // local X → world +Y, local Y → world +Z, extrusion → world +X
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
 * A keyhole hanger plate for the back of the top rail, scaled to whatever rail
 * it has to sit on. Returned as an outline plus its hole so the caller can
 * punch it with a proper polygon boolean.
 */
export function hangerOutline(ctx: AccessoryContext): {
  outer: Vec2[]
  holes: Vec2[][]
  thickness: number
  place: (mesh: RawMesh) => RawMesh
} | null {
  // Keep the plate inside the rail it is glued to.
  const plateH = Math.min(20, ctx.profile.width - 2)
  if (plateH < 9) return null
  const k = plateH / 20
  const plateW = 34 * k
  const thickness = Math.min(3, ctx.profile.depth * 0.35)

  const outer: Vec2[] = [
    [-plateW / 2, -plateH / 2],
    [plateW / 2, -plateH / 2],
    [plateW / 2, plateH / 2],
    [-plateW / 2, plateH / 2],
  ]

  // A wide entry at the bottom narrowing to the slot it hangs on.
  const hole: Vec2[] = []
  const r = 4 * k
  for (let i = 0; i <= 20; i++) {
    const a = Math.PI * 1.5 + (i / 20) * Math.PI * 2 * 0.72
    hole.push([r * Math.cos(a), -3 * k + r * Math.sin(a)])
  }
  hole.push([2 * k, 6.5 * k], [-2 * k, 6.5 * k])

  const yTop = ctx.bounds.maxY - ctx.profile.width / 2
  return {
    outer,
    holes: [hole],
    thickness,
    // Flat against the back face of the top rail.
    place: (mesh) => translateY(translateZ(mesh, -thickness), yTop),
  }
}

/** The span of a closed polygon at a given Y, or null if the line misses it. */
function horizontalChord(poly: Vec2[], y: number): [number, number] | null {
  const xs: number[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (a[1] > y === b[1] > y) continue
    xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]))
  }
  if (xs.length < 2) return null
  return [Math.min(...xs), Math.max(...xs)]
}

function translateZ(mesh: RawMesh, dz: number): RawMesh {
  return transformMesh(mesh, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, dz])
}

function translateY(mesh: RawMesh, dy: number): RawMesh {
  return transformMesh(mesh, [1, 0, 0, 0, 0, 1, 0, dy, 0, 0, 1, 0])
}
