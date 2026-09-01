import type { Accessories, ProfileParams, Vec2 } from '../types.ts'
import type { MiterFrame } from '../shapes.ts'
import { offsetPath } from '../shapes.ts'
import type { RawMesh } from './mesh.ts'
import { basisTransform, extrudePolygon, transformMesh } from './primitives.ts'
import { concat } from './joints.ts'

export interface AccessoryPart {
  id: string
  name: string
  kind: 'accessory' | 'backer'
  mesh: RawMesh
}

/** Clearance between a printed part and the pocket it drops into. */
const FIT_MM = 0.4
/** Depth reserved at the front of the rabbet for the artwork and glazing. */
const ARTWORK_MM = 0.6
/** How far the backing panel's rib stands proud, and so how far it must flex. */
const CATCH_MM = 0.6

export interface AccessoryContext {
  points: Vec2[]
  frames: MiterFrame[]
  profile: ProfileParams
  /** Bounding box of the assembled frame in plan. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

/** Where the snap groove sits inside the rabbet, in millimetres from the back. */
export interface BackerFit {
  /** Panel thickness. */
  thickness: number
  /** Z range the panel occupies. */
  z0: number
  z1: number
  /** Z range of the rib and its groove. */
  ribZ0: number
  ribZ1: number
}

/**
 * Work out the stack inside the rabbet, front to back: artwork against the
 * rabbet ceiling, then the panel, with its rib landing halfway up the panel.
 * Returns null when the rabbet is too shallow to hold a panel at all.
 */
export function backerFit(profile: ProfileParams): BackerFit | null {
  const usable = profile.rabbetDepth - ARTWORK_MM
  if (usable < 1.4) return null
  const thickness = Math.min(2.4, Math.max(1.2, usable * 0.7))
  const z1 = profile.rabbetDepth - ARTWORK_MM
  const z0 = z1 - thickness
  if (z0 < 0.2) return null
  const rib = Math.min(1.2, thickness * 0.55)
  const centre = (z0 + z1) / 2
  return { thickness, z0, z1, ribZ0: centre - rib / 2, ribZ1: centre + rib / 2 }
}

/**
 * The groove the panel's rib snaps into, to be subtracted from the frame.
 *
 * Cut as a disc reaching `CATCH_MM` past the rabbet wall: everything inside the
 * rabbet is already void, so only the ring of material between the wall and the
 * disc is actually removed.
 */
export function backerGroove(ctx: AccessoryContext, fit: BackerFit, tolerance: number): RawMesh {
  const outline = offsetPath(ctx.points, ctx.frames, ctx.profile.rabbetWidth + CATCH_MM + tolerance)
  const z0 = fit.ribZ0 - tolerance
  const z1 = fit.ribZ1 + tolerance
  return translateZ(extrudePolygon(outline, z1 - z0), z0)
}

/**
 * The fittings that go with a frame.
 *
 * Everything here is positioned relative to the frame lying face-up with its
 * back on Z = 0, which is how the viewer shows it.
 */
export function buildAccessories(
  want: Accessories,
  ctx: AccessoryContext,
): { parts: AccessoryPart[]; notes: string[] } {
  const parts: AccessoryPart[] = []
  const notes: string[] = []
  const { profile } = ctx

  if (want.backer) {
    const fit = backerFit(profile)
    if (!fit) {
      notes.push('The rabbet is too shallow for a backing panel — skipped. Try a deeper rabbet.')
    } else {
      // The panel proper, plus a rib right round its edge that catches in the
      // frame's groove. Pushed in from the back, the panel bows just enough for
      // the rib to clear the rabbet wall, then springs into the groove and
      // holds the artwork forward against the rabbet ceiling.
      const panel = offsetPath(ctx.points, ctx.frames, profile.rabbetWidth - FIT_MM)
      const ribbed = offsetPath(ctx.points, ctx.frames, profile.rabbetWidth + CATCH_MM - FIT_MM)
      parts.push({
        id: 'backer',
        name: 'Backing panel',
        kind: 'backer',
        mesh: concat(
          translateZ(extrudePolygon(panel, fit.thickness), fit.z0),
          translateZ(extrudePolygon(ribbed, fit.ribZ1 - fit.ribZ0), fit.ribZ0),
        ),
      })
      notes.push(
        `The ${fit.thickness.toFixed(1)} mm backing panel snaps into a groove round the rabbet — press it in from the back until it clicks. It holds the artwork forward with ${ARTWORK_MM.toFixed(1)} mm of clearance at the front.`,
      )
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

function translateZ(mesh: RawMesh, dz: number): RawMesh {
  return transformMesh(mesh, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, dz])
}

function translateY(mesh: RawMesh, dy: number): RawMesh {
  return transformMesh(mesh, [1, 0, 0, 0, 0, 1, 0, dy, 0, 0, 1, 0])
}
