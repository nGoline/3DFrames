import type { Part } from './types.ts'
import type { Affine } from './geometry/primitives.ts'
import { transformMesh } from './geometry/primitives.ts'

/**
 * Print orientation.
 *
 * A frame lying face-up puts the rabbet ceiling out over thin air: a ledge
 * cantilevered right around the aperture, which needs support and prints badly.
 * Turning a straight rail onto its outer face removes that overhang entirely —
 * the cross-section only ever loses area as the print rises — and gives a flat,
 * broad first layer at the same time.
 *
 * Curved runs cannot be laid on their outer face, because that surface is
 * cylindrical and would touch the bed along a single line, so they stay face-up
 * and are flagged as needing support.
 */

/**
 * Rotation that lays a straight rail on its outer face: the rail's length runs
 * along X, its outward direction points down, and the frame's Z becomes Y.
 *
 * `tangent` must be wound so that tangent × outward = +Z. Feed it the other way
 * round and this is a reflection, not a rotation — see `determinant`.
 */
export function onOuterFace(
  tangent: [number, number],
  outward: [number, number],
): number[] {
  return [
    tangent[0], tangent[1], 0,
    0, 0, 1,
    -outward[0], -outward[1], 0,
  ]
}

/**
 * Determinant of a 3×3 rotation. Anything negative is a reflection, which would
 * mirror the part and invert every face — a mirrored rail has its rabbet on the
 * wrong side and will not assemble.
 */
export function determinant(m: number[]): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  )
}

/** Rotation that stands a prism on its cross-section: X becomes up. */
export const onEnd = (): number[] => [0, 1, 0, 0, 0, 1, 1, 0, 0]

export const UPRIGHT: number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/**
 * Turn a 3×3 rotation into a full transform that also drops the part onto the
 * bed and centres it, so every exported part arrives ready to slice.
 */
export function seat(rotation: number[], positions: Float32Array): Affine {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2]
    const rx = rotation[0] * x + rotation[1] * y + rotation[2] * z
    const ry = rotation[3] * x + rotation[4] * y + rotation[5] * z
    const rz = rotation[6] * x + rotation[7] * y + rotation[8] * z
    if (rx < minX) minX = rx
    if (rx > maxX) maxX = rx
    if (ry < minY) minY = ry
    if (ry > maxY) maxY = ry
    if (rz < minZ) minZ = rz
  }
  if (!positions.length) return [...rotation.slice(0, 3), 0, ...rotation.slice(3, 6), 0, ...rotation.slice(6, 9), 0]
  return [
    rotation[0], rotation[1], rotation[2], -(minX + maxX) / 2,
    rotation[3], rotation[4], rotation[5], -(minY + maxY) / 2,
    rotation[6], rotation[7], rotation[8], -minZ,
  ]
}

/**
 * A part's geometry in its print orientation.
 *
 * If the transform ever turns out to be a reflection, the triangle winding is
 * reversed to compensate rather than silently exporting an inside-out solid.
 * Nothing should produce one — but this has been the source of enough bugs to
 * be worth catching in one place.
 */
export function orientForPrint(part: Part): Float32Array {
  const out = transformMesh(
    { vertProperties: part.positions, triVerts: new Uint32Array() },
    part.print,
  ).vertProperties

  const rotation = [
    part.print[0], part.print[1], part.print[2],
    part.print[4], part.print[5], part.print[6],
    part.print[8], part.print[9], part.print[10],
  ]
  if (determinant(rotation) < 0) {
    // Swap two corners of every triangle to restore outward-facing normals.
    for (let i = 0; i < out.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        const a = out[i + k]
        out[i + k] = out[i + 3 + k]
        out[i + 3 + k] = a
      }
    }
  }
  return out
}
