import opentype from 'opentype.js'
import type { Vec2 } from '../types.ts'

export interface FontOption {
  id: string
  label: string
  /** How the name reads once it is cut into the moulding. */
  blurb: string
}

/**
 * The same four faces the interface itself is set in, so choosing a caption
 * face costs no extra download. The files are resolved by the host — see
 * `src/fontLoader.ts` — which keeps this module runnable under Node.
 */
export const FONTS: FontOption[] = [
  { id: 'inter', label: 'Inter', blurb: 'Even weight, prints cleanly small' },
  { id: 'playfair', label: 'Playfair', blurb: 'High-contrast serif' },
  { id: 'bebas', label: 'Bebas', blurb: 'Condensed capitals' },
  { id: 'caveat', label: 'Caveat', blurb: 'Handwritten, needs 10 mm or more' },
]

export interface TextOutline {
  /** Closed contours in millimetres, centred on the origin, Y up. */
  contours: Vec2[][]
  width: number
  height: number
}

/**
 * Convert a string into closed contours sized so its capitals are exactly
 * `capHeight` millimetres tall.
 *
 * opentype gives us Y-down curves; we flatten the béziers, flip to Y-up, and
 * centre the result so callers can place it by its middle. Counters (the holes
 * in "o" and "A") come back as their own contours and are resolved later by the
 * non-zero fill rule.
 */
export function textOutline(
  font: opentype.Font,
  content: string,
  capHeight: number,
  curveSegments = 8,
): TextOutline | null {
  const text = content.trim()
  if (!text) return null

  // Measure real cap height at a reference size rather than trusting metrics,
  // which vary a lot between families.
  const probe = font.getPath('H', 0, 0, 100).getBoundingBox()
  const capAt100 = Math.abs(probe.y1 - probe.y2) || 72
  const fontSize = (capHeight / capAt100) * 100

  const path = font.getPath(text, 0, 0, fontSize)
  const contours: Vec2[][] = []
  let current: Vec2[] = []
  let cursor: Vec2 = [0, 0]
  let start: Vec2 = [0, 0]

  const push = (p: Vec2) => {
    const last = current[current.length - 1]
    if (last && Math.abs(last[0] - p[0]) < 1e-6 && Math.abs(last[1] - p[1]) < 1e-6) return
    current.push(p)
  }
  const close = () => {
    if (current.length >= 3) contours.push(current)
    current = []
  }

  for (const cmd of path.commands) {
    switch (cmd.type) {
      case 'M':
        close()
        cursor = [cmd.x, -cmd.y]
        start = cursor
        push(cursor)
        break
      case 'L':
        cursor = [cmd.x, -cmd.y]
        push(cursor)
        break
      case 'Q':
        for (let i = 1; i <= curveSegments; i++) {
          const t = i / curveSegments
          const mt = 1 - t
          push([
            mt * mt * cursor[0] + 2 * mt * t * cmd.x1 + t * t * cmd.x,
            mt * mt * cursor[1] + 2 * mt * t * -cmd.y1 + t * t * -cmd.y,
          ])
        }
        cursor = [cmd.x, -cmd.y]
        break
      case 'C':
        for (let i = 1; i <= curveSegments; i++) {
          const t = i / curveSegments
          const mt = 1 - t
          push([
            mt ** 3 * cursor[0] + 3 * mt * mt * t * cmd.x1 + 3 * mt * t * t * cmd.x2 + t ** 3 * cmd.x,
            mt ** 3 * cursor[1] + 3 * mt * mt * t * -cmd.y1 + 3 * mt * t * t * -cmd.y2 + t ** 3 * -cmd.y,
          ])
        }
        cursor = [cmd.x, -cmd.y]
        break
      case 'Z':
        cursor = start
        close()
        break
    }
  }
  close()
  if (!contours.length) return null

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const c of contours) {
    for (const [x, y] of c) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  return {
    contours: contours.map((c) => c.map(([x, y]) => [x - cx, y - cy] as Vec2)),
    width: maxX - minX,
    height: maxY - minY,
  }
}
