import type { Vec2 } from '../types.ts'
import { MeshBuilder, type RawMesh } from './mesh.ts'
import { triangulatePolygon } from './triangulate.ts'

/** A 3×4 affine transform, row-major: [m00..m03, m10..m13, m20..m23]. */
export type Affine = number[]

export const IDENTITY: Affine = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]

/**
 * Build an affine transform from an orthonormal basis and an origin, mapping
 * local (x, y, z) onto `origin + x·ax + y·ay + z·az`. Used to place joint
 * hardware into a seam's own coordinate frame.
 */
export function basisTransform(
  ax: [number, number, number],
  ay: [number, number, number],
  az: [number, number, number],
  origin: [number, number, number],
): Affine {
  return [
    ax[0], ay[0], az[0], origin[0],
    ax[1], ay[1], az[1], origin[1],
    ax[2], ay[2], az[2], origin[2],
  ]
}

/** Extrude a closed 2D polygon along +Z into a capped prism. */
export function extrudePolygon(poly: Vec2[], height: number): RawMesh {
  const builder = new MeshBuilder()
  const n = poly.length
  if (n < 3 || height <= 0) return builder.build()

  const ccw = signedArea(poly) >= 0 ? poly : [...poly].reverse()
  const bottom = ccw.map((p) => builder.addVertex(p[0], p[1], 0))
  const top = ccw.map((p) => builder.addVertex(p[0], p[1], height))

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    builder.addQuad(bottom[i], bottom[j], top[j], top[i])
  }
  const tris = triangulatePolygon(ccw)
  for (let t = 0; t < tris.length; t += 3) {
    builder.addTriangle(bottom[tris[t + 2]], bottom[tris[t + 1]], bottom[tris[t]])
    builder.addTriangle(top[tris[t]], top[tris[t + 1]], top[tris[t + 2]])
  }
  return builder.build()
}

/** An axis-aligned box spanning the given corners. */
export function box(
  min: [number, number, number],
  max: [number, number, number],
): RawMesh {
  const poly: Vec2[] = [
    [min[0], min[1]],
    [max[0], min[1]],
    [max[0], max[1]],
    [min[0], max[1]],
  ]
  return translateMesh(extrudePolygon(poly, max[2] - min[2]), [0, 0, min[2]])
}

/** A cylinder about the Z axis, from z = 0 to z = height. */
export function cylinder(radius: number, height: number, segments = 24): RawMesh {
  const poly: Vec2[] = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    poly.push([radius * Math.cos(a), radius * Math.sin(a)])
  }
  return extrudePolygon(poly, height)
}

export function transformMesh(mesh: RawMesh, m: Affine): RawMesh {
  const v = mesh.vertProperties
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i += 3) {
    const x = v[i], y = v[i + 1], z = v[i + 2]
    out[i] = m[0] * x + m[1] * y + m[2] * z + m[3]
    out[i + 1] = m[4] * x + m[5] * y + m[6] * z + m[7]
    out[i + 2] = m[8] * x + m[9] * y + m[10] * z + m[11]
  }
  return { vertProperties: out, triVerts: mesh.triVerts }
}

export function translateMesh(mesh: RawMesh, t: [number, number, number]): RawMesh {
  return transformMesh(mesh, [1, 0, 0, t[0], 0, 1, 0, t[1], 0, 0, 1, t[2]])
}

export function signedArea(poly: Vec2[]): number {
  let sum = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return sum / 2
}

/**
 * The largest axis-aligned rectangle that fits entirely inside a simple
 * polygon, found by rasterising and running the classic largest-rectangle-in-a-
 * histogram scan. Joint pockets are sized from this, which is what lets a
 * pocket be placed safely inside *any* edge profile, however it is shaped.
 */
export function largestInscribedRect(
  poly: Vec2[],
  resolution = 64,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const xs = poly.map((p) => p[0])
  const ys = poly.map((p) => p[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const cols = resolution
  const rows = resolution
  const dx = (maxX - minX) / cols
  const dy = (maxY - minY) / rows
  if (dx <= 0 || dy <= 0) return null

  // Mark cells whose centre lies inside the polygon.
  const inside: boolean[][] = []
  for (let r = 0; r < rows; r++) {
    const row: boolean[] = []
    const y = minY + (r + 0.5) * dy
    for (let c = 0; c < cols; c++) {
      row.push(pointInPolygon(minX + (c + 0.5) * dx, y, poly))
    }
    inside.push(row)
  }

  let best = { area: 0, x0: 0, y0: 0, x1: 0, y1: 0 }
  const heights = new Array(cols).fill(0)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) heights[c] = inside[r][c] ? heights[c] + 1 : 0
    // Largest rectangle in this histogram, tracked with a monotonic stack.
    const stack: number[] = []
    for (let c = 0; c <= cols; c++) {
      const h = c === cols ? 0 : heights[c]
      while (stack.length && heights[stack[stack.length - 1]] >= h) {
        const top = stack.pop()!
        const height = heights[top]
        const left = stack.length ? stack[stack.length - 1] + 1 : 0
        const area = height * (c - left)
        if (area > best.area) {
          // Only cell *centres* were tested, so the guaranteed-solid rectangle
          // runs centre to centre — half a cell in from each boundary.
          best = {
            area,
            x0: minX + (left + 0.5) * dx,
            x1: minX + (c - 0.5) * dx,
            y0: minY + (r - height + 1.5) * dy,
            y1: minY + (r + 0.5) * dy,
          }
        }
      }
      stack.push(c)
    }
  }
  return best.area > 0 && best.x1 > best.x0 && best.y1 > best.y0 ? best : null
}

export function pointInPolygon(x: number, y: number, poly: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
