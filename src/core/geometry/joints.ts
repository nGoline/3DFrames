import type { JointConfig, ProfilePoint, Vec2 } from '../types.ts'
import type { MiterFrame } from '../shapes.ts'
import type { RawMesh } from './mesh.ts'
import {
  basisTransform,
  extrudePolygon,
  largestInscribedRect,
  transformMesh,
  translateMesh,
} from './primitives.ts'

/** Material left between a joint and the outside world, per side. */
const WALL_MM = 1.2
/** Extra socket depth so the joint seats on its shoulder, not on its tip. */
const LEAD_MM = 0.6

const MIN_WIDTH = 4
const MIN_LENGTH = 6
const MIN_HEIGHT = 2.4
const MAX_WIDTH = 18
const MAX_LENGTH = 26
const MAX_HEIGHT = 9
/** Preferred length-to-width ratio. */
const ASPECT = 1.7
/**
 * Gap at which the barb's shoulder engages, in mm.
 *
 * This is the whole point of where the barb sits. Put it partway down the tenon
 * and the shoulder catches while the mitre is still open — the joint latches,
 * but latches held apart. At the tip, with the socket's relief at its far end,
 * it can only engage once the seam is shut.
 */
const LATCH_MM = 0.15
/** Thinnest a snap arm may be and still print reliably. */
const MIN_ARM = 0.9
/** Thickest an arm may be and still bend by hand. */
const MAX_ARM = 2

export interface SeamJoint {
  /**
   * Male half, to union into the segment on the near side of the seam. Null for
   * the loose-key style.
   */
  tenon: RawMesh | null
  /** Female half, to subtract from the segment the tenon reaches into. */
  mortise: RawMesh | null
  /** Recess cut into both segments, for the loose-key style. */
  recess: RawMesh | null
  /** The loose butterfly, for the loose-key style. */
  key: RawMesh | null
  /** True when the tenon has flexing arms rather than being a plain spline. */
  snaps: boolean
  size: { length: number; width: number; height: number }
}

/**
 * Build the hardware for one seam.
 *
 * The seam face is the plane the two segments were cut on. Its in-plane axes
 * are the mitre direction — stretched by the mitre scale, which is why a 45°
 * corner presents a face √2 wider than the moulding — and the frame's Z. Both
 * halves are sized from the largest rectangle that actually fits inside that
 * face, so they stay buried in solid material whatever the profile looks like.
 *
 * The subtlety is that a joint set perpendicular to a mitre does not travel
 * along the rail. It cuts across it: a point `t` millimetres from the seam sits
 * at
 *
 *     u = (a + drift · |t|) / scale,      drift = √(scale² − 1)
 *
 * so as the joint reaches into a segment it walks steadily toward the outer
 * edge of the moulding — `drift` is 0 at a mid-rail seam and 1 at a 90° corner.
 * The whole swept footprint is what has to fit, not just the cut plane.
 *
 * `reach` caps how far the joint may extend along the path, so it cannot punch
 * out of the far end of a short segment.
 *
 * Both styles are assemblable by pushing the two segments straight together,
 * which rules out any shape whose cavity is wider than its mouth unless
 * something can flex.
 */
export function buildJoint(
  point: Vec2,
  frame: MiterFrame,
  profile: ProfilePoint[],
  joint: JointConfig,
  reach = Infinity,
): SeamJoint | null {
  // The cut face, in (along-mitre, height) coordinates.
  const face: Vec2[] = profile.map((p) => [frame.scale * p.u, p.v])
  const rect = largestInscribedRect(face)
  if (!rect) return null

  const tol = Math.max(0, joint.tolerance)
  const scale = frame.scale
  const drift = Math.sqrt(Math.max(0, scale * scale - 1))

  const aLo = rect.x0 + WALL_MM
  const aHi = rect.x1 - WALL_MM
  const zLo = rect.y0 + WALL_MM
  const zHi = rect.y1 - WALL_MM
  const aSpan = aHi - aLo
  const zSpan = zHi - zLo
  if (aSpan < MIN_WIDTH || zSpan < MIN_HEIGHT) return null

  // World axes of the seam: n runs across the joint, `dir` lies in the face.
  const dir: [number, number, number] = [frame.dir[0], frame.dir[1], 0]
  // Chosen so that n × dir = +Z: a left-handed basis would mirror the part and
  // export it inside-out.
  const n: [number, number, number] = [frame.dir[1], -frame.dir[0], 0]
  const up: [number, number, number] = [0, 0, 1]

  return joint.style === 'key'
    ? butterfly({ point, dir, n, up, aLo, aSpan, zLo, zHi, drift, tol, reach, scale })
    : snapTenon({ point, dir, n, up, aLo, aSpan, zLo, zSpan, drift, tol, reach, scale })
}

interface Placement {
  point: Vec2
  dir: [number, number, number]
  n: [number, number, number]
  up: [number, number, number]
  aLo: number
  aSpan: number
  drift: number
  tol: number
  reach: number
  scale: number
}

/**
 * An integrated snap: a tenon on one segment that pushes into a socket in the
 * other and clicks.
 *
 * The tenon is split lengthwise into two arms so they can squeeze together, and
 * carries a barb near the tip. The socket is a plain throat for the first part
 * of its depth and then opens into a relief: the barb is forced through the
 * throat, springs out into the relief, and its shoulder then bears on the step
 * if you try to pull the seam apart. Nothing is loose and nothing needs glue.
 *
 * Where the moulding is too shallow for arms that will actually bend, the same
 * tenon is emitted without the split or the barb — a plain spline, which still
 * aligns the seam but wants glue.
 */
function snapTenon(
  p: Placement & { zLo: number; zSpan: number },
): SeamJoint | null {
  const { aLo, aSpan, zLo, zSpan, drift, tol, scale } = p

  // Height, arms and barb. The socket relief needs the barb's depth on each
  // side, so solve for a height that leaves room for it.
  let height = Math.min(MAX_HEIGHT, zSpan - 2 * tol)
  let arm = clamp(height * 0.28, MIN_ARM, MAX_ARM)
  let slot = height - 2 * arm
  let snaps = slot >= 0.8
  let barb = snaps ? Math.min(0.4, arm * 0.22) : 0
  if (snaps) {
    const over = height + 2 * barb + 2 * tol - zSpan
    if (over > 0) {
      height -= over
      arm = clamp(height * 0.28, MIN_ARM, MAX_ARM)
      slot = height - 2 * arm
      snaps = slot >= 0.8
      barb = snaps ? Math.min(0.4, arm * 0.22) : 0
    }
  }
  if (height < MIN_HEIGHT) return null

  // The tenon reaches into one segment only, so the whole of its length — not
  // half of it — is subject to the mitre drift.
  const reachLimit = Math.max(0, p.reach / scale - LEAD_MM)
  const headroom = aSpan - 2 * tol - drift * LEAD_MM
  let width = Math.min(MAX_WIDTH, headroom / (1 + ASPECT * drift))
  const length = Math.min(MAX_LENGTH, ASPECT * width, reachLimit)
  width = Math.min(MAX_WIDTH, aSpan - 2 * tol - drift * (length + LEAD_MM))
  if (width < MIN_WIDTH || length < MIN_LENGTH) return null

  const socketWidth = width + 2 * tol
  const socketLength = length + LEAD_MM
  // Centre the swept footprint — not the tenon itself — inside the safe band.
  const swept = socketWidth + drift * socketLength
  const aCentre = aLo + (aSpan - swept) / 2 + socketWidth / 2
  const zCentre = zLo + zSpan / 2

  // Local frame for a prism extruded along the mitre. The axis order is
  // (up, across-the-joint, along-the-mitre) because that is the ordering for
  // which up × n = dir: the obvious (n, up, dir) is left-handed and would
  // mirror the tenon, exporting it inside-out and pointing the wrong way.
  const origin: [number, number, number] = [
    p.point[0] + p.dir[0] * (aCentre - width / 2),
    p.point[1] + p.dir[1] * (aCentre - width / 2),
    zCentre,
  ]
  const m = basisTransform(p.up, p.n, p.dir, origin)
  const socketOrigin: [number, number, number] = [
    p.point[0] + p.dir[0] * (aCentre - socketWidth / 2),
    p.point[1] + p.dir[1] * (aCentre - socketWidth / 2),
    zCentre,
  ]
  const mSocket = basisTransform(p.up, p.n, p.dir, socketOrigin)

  // The socket's step sits just short of where the barb's crest comes to rest,
  // so the shoulder engages only once the seam is closed.
  const relief = crestStart(length, Math.min(1.5, length * 0.2)) - LATCH_MM
  return {
    tenon: transformMesh(extrudePolygon(flip(tenonProfile(length, height / 2, barb, slot)), width), m),
    mortise: transformMesh(
      extrudePolygon(flip(socketProfile(socketLength, height / 2 + tol, barb, relief)), socketWidth),
      mSocket,
    ),
    recess: null,
    key: null,
    snaps,
    size: { length, width, height },
  }
}

/**
 * Outline of the tenon in (along-the-joint, height), extruded along the mitre.
 *
 * Reading from the root: a plain shank, a ramp out to the barb near the tip,
 * the barb itself, then a chamfer that starts the squeeze. The slot up the
 * middle is open at the tip, which is what lets the two arms close.
 */
function tenonProfile(length: number, half: number, barb: number, slot: number): Vec2[] {
  const ramp = Math.min(1.5, length * 0.2)
  const chamfer = Math.min(0.8, barb + 0.3)
  const out = half + barb
  const s = slot / 2
  const crest = crestStart(length, ramp)
  const slotStart = Math.min(crest * 0.5, length * 0.25)

  const pts: Vec2[] = [
    [0, -half],
    [crest - ramp, -half],
    [crest, -out],
    [length - chamfer, -out],
    [length, -out + chamfer],
  ]
  if (slot > 0) {
    pts.push([length, -s], [slotStart, -s], [slotStart, s], [length, s])
  }
  pts.push(
    [length, out - chamfer],
    [length - chamfer, out],
    [crest, out],
    [crest - ramp, half],
    [0, half],
  )
  return pts
}

/** Where the barb's crest begins, measured from the tenon's root. */
function crestStart(length: number, ramp: number): number {
  const barbLength = Math.min(3, length * 0.35)
  return Math.max(ramp + 0.5, length - barbLength)
}

/**
 * The socket: a throat the barb has to be forced through for almost its whole
 * depth, opening into a relief only at the far end. The step between the two is
 * what the barb's shoulder bears on, and it sits `LATCH_MM` short of where the
 * crest lands, so it cannot engage until the mitre is closed.
 */
function socketProfile(length: number, half: number, barb: number, relief: number): Vec2[] {
  const out = half + barb
  return [
    [0, -half],
    [relief, -half],
    [relief, -out],
    [length, -out],
    [length, out],
    [relief, out],
    [relief, half],
    [0, half],
  ]
}

/**
 * A butterfly key, dropped into a recess cut across the seam from the back.
 *
 * The traditional way of pinning a mitre. It works precisely because it is
 * inserted through a face rather than edgewise — the recess is open at the back
 * of the frame, so the wide ends never have to pass through the waist. Hidden
 * once the frame is on the wall, and strong, but it is a loose part.
 */
function butterfly(p: Placement & { zLo: number; zHi: number }): SeamJoint | null {
  const { aLo, aSpan, zHi, drift, tol, scale } = p
  // The recess has to open onto the back face, so it is only available where
  // the safe band actually reaches Z = 0.
  if (p.zLo > WALL_MM + 0.5) return null

  const depth = Math.min(zHi, Math.max(2.5, zHi * 0.8))
  if (depth < MIN_HEIGHT) return null

  const reachLimit = Math.max(0, (2 * p.reach) / scale - LEAD_MM)
  const headroom = aSpan - 2 * tol - (drift * LEAD_MM) / 2
  let width = Math.min(MAX_WIDTH, headroom / (1 + (ASPECT * drift) / 2))
  const length = Math.min(MAX_LENGTH, ASPECT * width, reachLimit)
  width = Math.min(MAX_WIDTH, aSpan - 2 * tol - (drift * (length + LEAD_MM)) / 2)
  if (width < MIN_WIDTH || length < MIN_LENGTH) return null

  const recessWidth = width + 2 * tol
  const recessLength = length + LEAD_MM
  const swept = recessWidth + (drift * recessLength) / 2
  const aCentre = aLo + (aSpan - swept) / 2 + recessWidth / 2

  const origin: [number, number, number] = [
    p.point[0] + p.dir[0] * aCentre,
    p.point[1] + p.dir[1] * aCentre,
    0,
  ]
  // Local frame: x across the seam, y along the mitre, z up from the back face.
  const m = basisTransform(p.n, p.dir, p.up, origin)
  const waist = 0.62

  return {
    tenon: null,
    mortise: null,
    // Cut a little below Z = 0 so the recess is unambiguously open at the back.
    recess: transformMesh(
      translateMesh(
        extrudePolygon(bowtie(recessLength, recessWidth, recessWidth * waist), depth + 1),
        [0, 0, -1],
      ),
      m,
    ),
    key: transformMesh(extrudePolygon(bowtie(length, width, width * waist), depth), m),
    snaps: false,
    size: { length, width, height: depth },
  }
}

/** Wide at both ends, pinched at the waist: it resists the seam pulling apart. */
function bowtie(length: number, width: number, waist: number): Vec2[] {
  const l = length / 2
  const w = width / 2
  const k = waist / 2
  return [
    [-l, -w],
    [0, -k],
    [l, -w],
    [l, w],
    [0, k],
    [-l, w],
  ]
}

/** Swap a (along-the-joint, height) outline into the local frame's (x, y). */
const flip = (pts: Vec2[]): Vec2[] => pts.map(([a, b]) => [b, a] as Vec2)

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Merge two meshes into one triangle list, renumbering the second's indices. */
export function concat(a: RawMesh, b: RawMesh): RawMesh {
  const vertProperties = new Float32Array(a.vertProperties.length + b.vertProperties.length)
  vertProperties.set(a.vertProperties, 0)
  vertProperties.set(b.vertProperties, a.vertProperties.length)
  const offset = a.vertProperties.length / 3
  const triVerts = new Uint32Array(a.triVerts.length + b.triVerts.length)
  triVerts.set(a.triVerts, 0)
  for (let i = 0; i < b.triVerts.length; i++) triVerts[a.triVerts.length + i] = b.triVerts[i] + offset
  return { vertProperties, triVerts }
}
