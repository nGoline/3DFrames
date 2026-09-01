import type { ProfilePoint, Vec2 } from '../types.ts'
import type { MiterFrame } from '../shapes.ts'
import type { Displacer } from './facePattern.ts'
import { MeshBuilder, type RawMesh } from './mesh.ts'
import { triangulatePolygon } from './triangulate.ts'

/** Profile points below this height are left untouched so the back face stays flat. */
const FLAT_BASE_MM = 0.6
/**
 * Width of the undisturbed margin along the outer edge of the moulding.
 *
 * Straight rails are printed lying on that outer face, so it is the first
 * layer. The arris where it meets the decorative face has a normal that points
 * partly forward, so relief applied there drags the whole face off the bed and
 * leaves the rail balancing on one edge. Fading the relief out before the edge
 * keeps the contact patch flat and full width.
 */
const OUTER_MARGIN_MM = 1.2

export interface SweepInput {
  /** Path vertices for this run, in order. */
  points: Vec2[]
  /** Mitre frame per path vertex, from `miterFrames` on the *full* path. */
  frames: MiterFrame[]
  /** Distance along the full path at each vertex, for pattern continuity. */
  arc: number[]
  /** Closed cross-section, counter-clockwise in (u, v). */
  profile: ProfilePoint[]
  /** Index in `profile` where the decorative face begins; earlier points are the rabbet. */
  faceStart: number
  /** Surface relief, or null for a smooth face. */
  displacer: Displacer | null
  /** True for a whole frame, false for a cut segment (which gets end caps). */
  closed: boolean
}

/**
 * Sweep a cross-section around a path by offsetting the path outward.
 *
 * The result is a single watertight surface: for a closed path it is a torus
 * with no caps at all, which is why whole frames come out manifold by
 * construction rather than by cleanup. Open runs get flat mitre caps at each
 * end, wound to face outward along the run.
 */
export function sweep(input: SweepInput): RawMesh {
  const { points, frames, arc, profile, faceStart, displacer, closed } = input
  const nPath = points.length
  const nProf = profile.length
  if (nPath < 2 || nProf < 3) return { vertProperties: new Float32Array(), triVerts: new Uint32Array() }

  const normals = profileNormals(profile)
  const builder = new MeshBuilder()

  // The outer edge is the bed when a rail prints on its side; keep it clean.
  const uMax = profile.reduce((m, p) => Math.max(m, p.u), 0)
  const margin = Math.min(OUTER_MARGIN_MM, uMax * 0.12)
  const edgeFade = (u: number) => {
    if (margin <= 0) return 1
    const t = Math.min(1, Math.max(0, (uMax - u) / margin))
    return t * t * (3 - 2 * t)
  }

  // grid[j][i] — one vertex per (path vertex, profile point) pair.
  const grid: number[][] = []
  for (let j = 0; j < nPath; j++) {
    const [px, py] = points[j]
    const { dir, scale } = frames[j]
    const s = arc[j]
    const row: number[] = []
    for (let i = 0; i < nProf; i++) {
      const { u, v } = profile[i]
      let x = px + dir[0] * scale * u
      let y = py + dir[1] * scale * u
      let z = v

      if (displacer && i >= faceStart && v > FLAT_BASE_MM) {
        const [nu, nv] = normals[i]
        // Only surfaces that face forward carry relief, and the amount fades
        // smoothly to nothing as a surface turns to face sideways or backward.
        const mask = Math.max(0, nv) * edgeFade(u)
        if (mask > 0) {
          // Cut *into* the face, so nominal outer dimensions stay exact.
          const d = -displacer(s, u) * mask
          x += dir[0] * nu * d
          y += dir[1] * nu * d
          z += nv * d
        }
      }

      row.push(builder.addVertex(x, y, Math.max(0, z)))
    }
    grid.push(row)
  }

  const lastSpan = closed ? nPath : nPath - 1
  for (let j = 0; j < lastSpan; j++) {
    const a = grid[j]
    const b = grid[(j + 1) % nPath]
    for (let i = 0; i < nProf; i++) {
      const i2 = (i + 1) % nProf
      // Wound so the normal is (path tangent) × (profile tangent), which points
      // out of the solid for a counter-clockwise path and profile.
      builder.addQuad(a[i], b[i], b[i2], a[i2])
    }
  }

  if (!closed) {
    const tris = triangulatePolygon(profile.map((p) => [p.u, p.v] as Vec2))
    // A counter-clockwise (u, v) winding maps to a normal of -tangent in 3D,
    // so the start cap is used as-is and the end cap is reversed.
    for (let t = 0; t < tris.length; t += 3) {
      builder.addTriangle(grid[0][tris[t]], grid[0][tris[t + 1]], grid[0][tris[t + 2]])
      const e = grid[nPath - 1]
      builder.addTriangle(e[tris[t + 2]], e[tris[t + 1]], e[tris[t]])
    }
  }

  return builder.build()
}

/** Outward unit normal at each profile point, averaged from its two edges. */
function profileNormals(profile: ProfilePoint[]): Vec2[] {
  const n = profile.length
  const edge: Vec2[] = profile.map((p, i) => {
    const q = profile[(i + 1) % n]
    const du = q.u - p.u
    const dv = q.v - p.v
    const len = Math.hypot(du, dv) || 1
    return [dv / len, -du / len]
  })
  return profile.map((_, i) => {
    const a = edge[(i - 1 + n) % n]
    const b = edge[i]
    const x = a[0] + b[0]
    const y = a[1] + b[1]
    const len = Math.hypot(x, y)
    return len < 1e-9 ? b : ([x / len, y / len] as Vec2)
  })
}
