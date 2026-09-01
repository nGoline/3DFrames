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
 * are the mitre direction (stretched by the mitre scale, which is why a 45°
 * corner presents a face √2 wider than the moulding) and the frame's Z. The
 * pocket is sized from the largest rectangle that actually fits inside that
 * face, so it stays buried in solid material for any edge profile.
 */
export function buildJoint(
  point: Vec2,
  frame: MiterFrame,
  profile: ProfilePoint[],
  joint: JointConfig,
): SeamJoint | null {
  // The cut face, in (along-mitre, height) coordinates.
  const face: Vec2[] = profile.map((p) => [frame.scale * p.u, p.v])
  const rect = largestInscribedRect(face)
  if (!rect) return null

  const aSpan = rect.x1 - rect.x0 - 2 * WALL_MM
  const zSpan = rect.y1 - rect.y0 - 2 * WALL_MM
  if (aSpan < 3 || zSpan < 1.5) return null

  const aCentre = (rect.x0 + rect.x1) / 2
  const zCentre = (rect.y0 + rect.y1) / 2
  const tol = Math.max(0, joint.tolerance)

  // World axes of the seam: n runs across the joint, `dir` lies in the face.
  const dir: [number, number, number] = [frame.dir[0], frame.dir[1], 0]
  // Chosen so that n × dir = +Z: a left-handed basis would mirror the key and
  // export it inside-out. The joint is symmetric about the seam, so the sign of
  // n is otherwise free.
  const n: [number, number, number] = [frame.dir[1], -frame.dir[0], 0]
  const up: [number, number, number] = [0, 0, 1]

  if (joint.style === 'dowel') {
    const radius = Math.min(2.5, zSpan / 2, aSpan / 4)
    const length = Math.min(20, Math.max(8, radius * 6))
    const spacing = Math.min(aSpan - radius * 2, radius * 5)
    const origin: [number, number, number] = [
      point[0] + dir[0] * aCentre - n[0] * (length / 2),
      point[1] + dir[1] * aCentre - n[1] * (length / 2),
      zCentre,
    ]
    // Local frame: x along the mitre, y up, z across the joint.
    const m = basisTransform(dir, up, n, origin)
    const pins = (r: number, len: number) =>
      concat(
        transformMesh(translateMesh(cylinder(r, len, 24), [-spacing / 2, 0, 0]), m),
        transformMesh(translateMesh(cylinder(r, len, 24), [spacing / 2, 0, 0]), m),
      )
    return {
      pocket: pins(radius + tol, length + 0.6),
      key: pins(radius, length),
      size: { length, width: radius * 2, height: radius * 2 },
    }
  }

  const width = Math.min(18, Math.max(5, aSpan))
  const height = Math.min(8, Math.max(1.6, zSpan))
  const length = Math.min(30, Math.max(10, width * 1.7))
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
      extrudePolygon(bowtie(length + 0.6, width + 2 * tol, waist + 2 * tol), height + 2 * tol),
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
