import type { Vec2 } from '../types.ts'

/**
 * Ear-clipping triangulation for simple (non self-intersecting) polygons.
 *
 * Frame cross-sections are small — tens of points — and always simple, so the
 * O(n²) clipper is more than fast enough and keeps the sweep synchronous and
 * dependency-free. Returns index triples into the input array, wound
 * counter-clockwise.
 */
export function triangulatePolygon(points: Vec2[]): number[] {
  const n = points.length
  if (n < 3) return []

  const indices = points.map((_, i) => i)
  if (area(points, indices) < 0) indices.reverse()

  const out: number[] = []
  let guard = n * n
  while (indices.length > 3 && guard-- > 0) {
    let clipped = false
    for (let i = 0; i < indices.length; i++) {
      const prev = indices[(i - 1 + indices.length) % indices.length]
      const curr = indices[i]
      const next = indices[(i + 1) % indices.length]
      if (!isEar(points, indices, prev, curr, next)) continue
      out.push(prev, curr, next)
      indices.splice(i, 1)
      clipped = true
      break
    }
    // Degenerate input: bail out with what we have rather than spinning.
    if (!clipped) break
  }
  if (indices.length === 3) out.push(indices[0], indices[1], indices[2])
  return out
}

function area(points: Vec2[], indices: number[]): number {
  let sum = 0
  for (let i = 0; i < indices.length; i++) {
    const a = points[indices[i]]
    const b = points[indices[(i + 1) % indices.length]]
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return sum / 2
}

const cross = (a: Vec2, b: Vec2, c: Vec2) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

function isEar(points: Vec2[], indices: number[], pi: number, ci: number, ni: number): boolean {
  const a = points[pi]
  const b = points[ci]
  const c = points[ni]
  if (cross(a, b, c) <= 1e-9) return false // reflex or collinear
  for (const idx of indices) {
    if (idx === pi || idx === ci || idx === ni) continue
    if (pointInTriangle(points[idx], a, b, c)) return false
  }
  return true
}

function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = cross(a, b, p)
  const d2 = cross(b, c, p)
  const d3 = cross(c, a, p)
  return d1 >= 0 && d2 >= 0 && d3 >= 0
}
