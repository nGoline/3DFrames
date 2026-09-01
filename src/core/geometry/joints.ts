import type { JointConfig, ProfilePoint, Vec2 } from '../types.ts'
import type { MiterFrame } from '../shapes.ts'
import type { RawMesh } from './mesh.ts'
import {
  basisTransform,
  cylinder,
  extrudePolygon,
  largestInscribedRect,
  transformMesh,
  translateMesh,
} from './primitives.ts'

/** Material left between a pocket and the outside world, per side. */
const WALL_MM = 1.2
/** Extra pocket length so the key bottoms out on its taper, not on its ends. */
const LEAD_MM = 0.6

const MIN_WIDTH = 4
const MIN_LENGTH = 7
const MIN_HEIGHT = 1.6
const MAX_WIDTH = 18
const MAX_LENGTH = 30
const MAX_HEIGHT = 8
/** Preferred length-to-width ratio for a key. */
const ASPECT = 1.7

export interface SeamJoint {
  /** Solid to subtract from both segments meeting at this seam. */
  pocket: RawMesh
  /** The loose connector, in its assembled position. */
  key: RawMesh
  /** Nominal key size, for the parts list. */
  size: { length: number; width: number; height: number }
}

/**
 * Build the hardware for one seam.
 *
 * The seam face is the plane the two segments were cut on. Its in-plane axes
 * are the mitre direction — stretched by the mitre scale, which is why a 45°
 * corner presents a face √2 wider than the moulding — and the frame's Z. The
 * pocket is sized from the largest rectangle that actually fits inside that
 * face, so it stays buried in solid material whatever the profile looks like.
 *
 * The subtlety is that a key set perpendicular to a mitre does not travel along
 * the rail. It cuts across it: a point `t` millimetres from the seam sits at
 *
 *     u = (a + drift · |t|) / scale,      drift = √(scale² − 1)
 *
 * so as the key reaches into each segment it walks steadily toward the outer
 * edge of the moulding — `drift` is 0 at a mid-rail seam and 1 at a 90° corner.
 * Sizing against the cut plane alone lets a corner key march straight out
 * through the side of the frame, so the whole swept footprint,
 * `[aC − w/2, aC + w/2 + drift · l/2]`, is what has to fit.
 *
 * `reach` caps how far the key may extend along the path, so it cannot punch
 * out of the far end of a short segment.
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
  // Everything is sized from the pocket, which is the larger of the two and the
  // one that must not breach a surface.
  const height = Math.min(MAX_HEIGHT, zSpan - 2 * tol)
  if (height < MIN_HEIGHT) return null

  // Longest the key may be before it runs out of segment to sit in. `t`
  // converts to distance along the path by the mitre scale.
  const reachLimit = Math.max(0, (2 * reach) / scale - LEAD_MM)

  // Budget: (w + 2·tol) + drift·(l + lead)/2 ≤ aSpan, at the preferred aspect.
  const headroom = aSpan - 2 * tol - (drift * LEAD_MM) / 2
  let width = Math.min(MAX_WIDTH, headroom / (1 + (ASPECT * drift) / 2))
  let length = Math.min(MAX_LENGTH, ASPECT * width, reachLimit)
  // A capped length frees up span, so take the width back out to the budget.
  width = Math.min(MAX_WIDTH, aSpan - 2 * tol - (drift * (length + LEAD_MM)) / 2)
  if (width < MIN_WIDTH || length < MIN_LENGTH) return null

  const pocketWidth = width + 2 * tol
  const pocketLength = length + LEAD_MM
  // Centre the swept footprint — not the key itself — inside the safe band.
  const swept = pocketWidth + (drift * pocketLength) / 2
  const aCentre = aLo + (aSpan - swept) / 2 + pocketWidth / 2
  const zCentre = (zLo + zHi) / 2

  // World axes of the seam: n runs across the joint, `dir` lies in the face.
  const dir: [number, number, number] = [frame.dir[0], frame.dir[1], 0]
  // Chosen so that n × dir = +Z: a left-handed basis would mirror the key and
  // export it inside-out. The joint is symmetric about the seam, so the sign of
  // n is otherwise free.
  const n: [number, number, number] = [frame.dir[1], -frame.dir[0], 0]
  const up: [number, number, number] = [0, 0, 1]

  if (joint.style === 'dowel') {
    const radius = Math.min(2.5, height / 2)
    if (radius < 1) return null
    // Two pins if the span takes them, otherwise one down the middle.
    const spacing = width - 2 * radius >= 2 * radius + 1 ? width - 2 * radius : 0
    const origin: [number, number, number] = [
      point[0] + dir[0] * aCentre - n[0] * (length / 2),
      point[1] + dir[1] * aCentre - n[1] * (length / 2),
      zCentre,
    ]
    // Local frame: x along the mitre, y up, z across the joint.
    const m = basisTransform(dir, up, n, origin)
    const pins = (r: number, len: number) => {
      const one = (offset: number) =>
        transformMesh(translateMesh(cylinder(r, len, 24), [offset, 0, 0]), m)
      return spacing ? concat(one(-spacing / 2), one(spacing / 2)) : one(0)
    }
    return {
      pocket: pins(radius + tol, pocketLength),
      key: pins(radius, length),
      size: { length, width: spacing + 2 * radius, height: radius * 2 },
    }
  }

  // A dovetail waist gives the joint something to pull against; a plain tab
  // relies on friction and is easier to print and assemble.
  const waist = joint.style === 'dovetail' ? width * 0.62 : width

  const origin: [number, number, number] = [
    point[0] + dir[0] * aCentre,
    point[1] + dir[1] * aCentre,
    zCentre - height / 2,
  ]
  // Local frame: x across the joint, y along the mitre, z up.
  const m = basisTransform(n, dir, up, origin)

  const key = transformMesh(extrudePolygon(bowtie(length, width, waist), height), m)
  const pocket = transformMesh(
    translateMesh(
      extrudePolygon(bowtie(pocketLength, pocketWidth, waist + 2 * tol), height + 2 * tol),
      [0, 0, -tol],
    ),
    m,
  )
  return { pocket, key, size: { length, width, height } }
}

/**
 * A butterfly key: wide at both ends, pinched at the waist. Laid across a seam
 * it resists the two segments pulling apart, which is the only force a picture
 * frame joint really has to carry.
 */
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
