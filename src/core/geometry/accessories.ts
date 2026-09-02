import type { Accessories, BuildPlate, ProfileParams, Vec2 } from '../types.ts'
import type { MiterFrame } from '../shapes.ts'
import { offsetPath } from '../shapes.ts'
import type { RawMesh } from './mesh.ts'
import { basisTransform, extrudePolygon, transformMesh } from './primitives.ts'
import { concat } from './joints.ts'
import { springFor, type SpringSpec } from '../spring.ts'

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
  plate: BuildPlate
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

/* -------------------------------------------------------------------------
 * Spring clips
 *
 * The way a real frame holds artwork in: small sprung strips pushed into slots
 * in the rabbet wall, bearing on the back of the stack and pressing it forward
 * against the rabbet ceiling. Unlike a printed backing panel this works at any
 * frame size and with any backing material, so it is the option that still
 * makes sense on a poster frame.
 *
 * The slot is tilted a few degrees so a dead-flat clip has to bend to sit in
 * it — that is where the spring force comes from. Printing the clip flat rather
 * than pre-bent also puts the layer lines along the leaf, which is the strong
 * direction in bending.
 * ---------------------------------------------------------------------- */

/** Slot length along the rail. */
const CLIP_SLOT_W = 9
/** Material kept under the slot's lowest corner. */
const FLOOR_MM = 0.8
/** Material kept between the top of the slot and the back of the artwork. */
const HEADROOM_MM = 0.3
/** How far the leaf reaches past the rabbet wall, over the artwork. */
const CLIP_REACH_MM = 12

export interface ClipFit {
  thickness: number
  /** How far the slot reaches into the moulding from the rabbet wall. */
  depth: number
  /** Slot height and where its mouth sits above the back face. */
  height: number
  z0: number
  /** Slot tilt, as a gradient. Derived, not fixed — see `clipFit`. */
  tilt: number
  /** Straight span of the leaf, from the rabbet wall to its tip. */
  span: number
  /** The spring the leaf actually is. */
  spring: SpringSpec
}

/**
 * The shallowest rabbet that can hold `artwork` and still leave the clip
 * somewhere to live behind it.
 *
 * Solved from the placement below: the slot has to clear the floor, clear the
 * back of the artwork, and still let the leaf rest a full squeeze proud of it.
 */
export function minimumRabbetDepth(profile: ProfileParams, artwork: number): number {
  const probe = leafFor(profile)
  const slotDepth = slotDepthFor(profile)
  if (slotDepth === null) return artwork + 4
  const h = probe.thickness + 0.4
  const k = slotDepth / (slotDepth + probe.span)
  // Substituting the tilt below into `floor + slotDepth·tanθ + h + headroom ≤
  // rabbet − artwork` and solving for the rabbet:
  //   X ≥ [floor + k·(squeeze − floor − thickness) + h + headroom] / (1 − k)
  const x =
    (FLOOR_MM + k * (probe.squeeze - FLOOR_MM - probe.thickness) + h + HEADROOM_MM) / (1 - k)
  return artwork + Math.max(x, probe.squeeze + 1)
}

const slotDepthFor = (profile: ProfileParams): number | null => {
  const depth = Math.min(6, profile.width - profile.rabbetWidth - 1.5)
  return depth < 3 ? null : depth
}

/**
 * The leaf is deliberately not scaled off the rabbet depth. That is the number
 * `minimumRabbetDepth` exists to compute, and letting the spring depend on it
 * makes the answer depend on itself. Thickness is set by what prints reliably —
 * about three perimeters — and the span by how far it has to reach.
 */
const LEAF_THICKNESS_MM = 1.4
const LEAF_WIDTH_MM = 4.4

const leafFor = (profile: ProfileParams) =>
  springFor({
    thickness: LEAF_THICKNESS_MM,
    width: LEAF_WIDTH_MM,
    span: profile.rabbetWidth + CLIP_REACH_MM,
  })

/**
 * Where the clip sits, derived from what is actually going in the frame.
 *
 * The leaf has to rest one full squeeze proud of the back of the artwork, so
 * that fitting the artwork deflects it by exactly that much and it presses with
 * the force the spring was designed around. Tilting the slot is what raises the
 * leaf, so the tilt is solved for rather than fixed:
 *
 *   floor + slotDepth·tanθ + thickness + span·tanθ = (rabbet − artwork) + squeeze
 *
 * A thin paper print needs a steeper tilt than a 4 mm backing, which is exactly
 * the behaviour that was missing: the number you type for the artwork is what
 * the clip is positioned around.
 */
export function clipFit(profile: ProfileParams, artwork: number): ClipFit | null {
  const depth = slotDepthFor(profile)
  if (depth === null) return null

  const spring = leafFor(profile)
  const height = spring.thickness + 0.4

  const tilt = (profile.rabbetDepth - artwork + spring.squeeze - FLOOR_MM - spring.thickness) /
    (depth + spring.span)
  if (tilt <= 0 || tilt > 0.6) return null

  const z0 = FLOOR_MM + depth * tilt
  // The tang must not foul the back of the artwork.
  if (z0 + height + HEADROOM_MM > profile.rabbetDepth - artwork) return null

  return { thickness: spring.thickness, depth, height, z0, tilt, span: spring.span, spring }
}

/**
 * The slots, to be subtracted from the frame. Disjoint boxes, so they can be
 * handed over as one mesh.
 */
export function clipSlots(
  ctx: AccessoryContext,
  fit: ClipFit,
  where: number[],
  tolerance: number,
): RawMesh | null {
  const tilt = fit.tilt
  const wall = offsetPath(ctx.points, ctx.frames, ctx.profile.rabbetWidth)
  const h = fit.height + 2 * tolerance
  const z0 = fit.z0 - tolerance

  let merged: RawMesh | null = null
  for (const j of where) {
    const dir = ctx.frames[j].dir
    // Local (up, outward): the far end of the slot sits lower, so a flat clip
    // pushed into it points forward and has to be sprung back by the artwork.
    const poly: Vec2[] = [
      [z0, 0],
      [z0 - fit.depth * tilt, fit.depth],
      [z0 + h - fit.depth * tilt, fit.depth],
      [z0 + h, 0],
    ]
    const tangent: [number, number, number] = [-dir[1], dir[0], 0]
    const m = basisTransform(
      [0, 0, 1],
      [dir[0], dir[1], 0],
      tangent,
      [
        wall[j][0] - tangent[0] * (CLIP_SLOT_W / 2),
        wall[j][1] - tangent[1] * (CLIP_SLOT_W / 2),
        0,
      ],
    )
    const box = transformMesh(extrudePolygon(poly, CLIP_SLOT_W), m)
    merged = merged ? concat(merged, box) : box
  }
  return merged
}

/**
 * One spring clip: a tang that plugs into the slot, an S-curved leaf that gives
 * it enough length to flex in a small space, and a tip that bears on the back of
 * the artwork.
 *
 * Returned in its installed position — sitting in the slot at `at`, tilted with
 * it — along with the rotation that lays it flat again for printing, which is
 * the inverse of the one that put it there.
 */
export function buildClip(
  ctx: AccessoryContext,
  fit: ClipFit,
  tolerance: number,
  at: number,
): { mesh: RawMesh; print: number[] } {
  const tangLength = fit.depth - 0.8
  const tangWidth = CLIP_SLOT_W - 2 * tolerance - 0.2
  const armLength = fit.span
  const armWidth = 4.4
  const amplitude = 2.6
  const steps = 24

  // Centre line of the leaf: one full S, which roughly doubles its length and so
  // drops its stiffness without taking any more room.
  const centre: Vec2[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    centre.push([t * armLength, amplitude * Math.sin(t * Math.PI * 2)])
  }
  const side = (sign: number): Vec2[] =>
    centre.map(([x, y], i) => {
      const prev = centre[Math.max(0, i - 1)]
      const next = centre[Math.min(centre.length - 1, i + 1)]
      const dx = next[0] - prev[0]
      const dy = next[1] - prev[1]
      const len = Math.hypot(dx, dy) || 1
      return [x + (sign * (dy / len) * armWidth) / 2, y - (sign * (dx / len) * armWidth) / 2] as Vec2
    })

  const poly: Vec2[] = [
    ...side(1),
    ...side(-1).reverse(),
    [0, armWidth / 2],
    [0, tangWidth / 2],
    [-tangLength, tangWidth / 2],
    [-tangLength, -tangWidth / 2],
    [0, -tangWidth / 2],
  ]

  // Installed frame: local +x runs inward over the artwork (so the tang, at
  // negative x, goes outward into the slot), +y along the rail, +z the leaf's
  // thickness. Tilted with the slot so the leaf stands off the artwork.
  const dir = ctx.frames[at].dir
  const theta = Math.atan(fit.tilt)
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const ax: [number, number, number] = [-dir[0] * cos, -dir[1] * cos, sin]
  const ay: [number, number, number] = [dir[1], -dir[0], 0]
  const az: [number, number, number] = [dir[0] * sin, dir[1] * sin, cos]

  const wall = offsetPath(ctx.points, ctx.frames, ctx.profile.rabbetWidth)[at]
  const m = basisTransform(ax, ay, az, [wall[0], wall[1], fit.z0 + tolerance])

  return {
    mesh: transformMesh(extrudePolygon(poly, fit.thickness), m),
    // Rows of the inverse: an orthonormal basis transposed.
    print: [...ax, ...ay, ...az],
  }
}

