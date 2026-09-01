import type { Vec2 } from '../types.ts'

/** The smallest rectangle enclosing a point set, at any rotation. */
export interface MinRect {
  width: number
  height: number
  /** Rotation of the rectangle's long axis, in radians. */
  angle: number
  /** Centre of the rectangle, in the input's coordinates. */
  centre: [number, number]
}

/** Andrew's monotone chain convex hull, counter-clockwise. */
export function convexHull(points: Vec2[]): Vec2[] {
  if (points.length < 3) return [...points]
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

  const half = (source: Vec2[]) => {
    const out: Vec2[] = []
    for (const p of source) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop()
      out.push(p)
    }
    out.pop()
    return out
  }
  return [...half(pts), ...half([...pts].reverse())]
}

/**
 * Minimum-area enclosing rectangle by rotating calipers.
 *
 * The optimal rectangle always shares an edge with the convex hull, so it is
 * enough to test the hull's own edge directions.
 */
export function minAreaRect(points: Vec2[]): MinRect {
  const hull = convexHull(points)
  if (hull.length < 2) return { width: 0, height: 0, angle: 0, centre: [0, 0] }

  let best: MinRect = { width: Infinity, height: Infinity, angle: 0, centre: [0, 0] }
  let bestArea = Infinity
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0])
    const cos = Math.cos(-angle)
    const sin = Math.sin(-angle)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const p of hull) {
      const x = p[0] * cos - p[1] * sin
      const y = p[0] * sin + p[1] * cos
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    const w = maxX - minX
    const h = maxY - minY
    const area = w * h
    if (area < bestArea) {
      bestArea = area
      // Rotate the rectangle's centre back into the input's frame.
      const cx = (minX + maxX) / 2
      const cy = (minY + maxY) / 2
      const back = Math.cos(angle)
      const backSin = Math.sin(angle)
      best = {
        width: Math.max(w, h),
        height: Math.min(w, h),
        // Report the angle of the *long* axis, whichever side that turned out to be.
        angle: w >= h ? angle : angle + Math.PI / 2,
        centre: [cx * back - cy * backSin, cx * backSin + cy * back],
      }
    }
  }
  return best
}

/**
 * Can a `w × h` part be placed on a `plateX × plateY` bed?
 *
 * With `allowTilt` (Smart Orientation) the part may be rotated to any angle,
 * not just 90°, which is what lets a long moulding run corner-to-corner across
 * a square bed — often the difference between three segments and two.
 */
export function fitsOnPlate(
  w: number,
  h: number,
  plateX: number,
  plateY: number,
  allowTilt: boolean,
): boolean {
  const p = Math.max(w, h)
  const q = Math.min(w, h)
  const A = Math.max(plateX, plateY)
  const B = Math.min(plateX, plateY)

  if (p <= A && q <= B) return true
  if (!allowTilt) return false
  // A tilted fit is only possible when the short side already fits.
  if (q > B || p <= A) return false

  const p2 = p * p
  const q2 = q * q
  const disc = p2 + q2 - A * A
  if (disc < 0) return false
  // Standard condition for fitting a rectangle into a smaller one at an angle.
  const required = (2 * p * q * A + (p2 - q2) * Math.sqrt(disc)) / (p2 + q2)
  return B >= required
}
