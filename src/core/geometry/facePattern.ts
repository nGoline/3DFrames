import type { FaceDesign } from '../types.ts'

/**
 * Face designs are surface relief, not textures: they displace the swept
 * geometry itself so the pattern survives the trip to STL and shows up in the
 * print. Every pattern is a height field in "surface coordinates":
 *
 *   s — distance travelled along the frame's path, in millimetres.
 *   u — distance outward from the sight edge, in millimetres.
 *
 * The displacement must be seamless where the path closes on itself, so all
 * patterns are built from whole numbers of repeats around the perimeter.
 */
export type Displacer = (s: number, u: number) => number

const fract = (x: number) => x - Math.floor(x)
const smooth = (t: number) => t * t * (3 - 2 * t)

/** Hash of an integer lattice point, wrapped in x so patterns tile seamlessly. */
function hash(ix: number, iy: number, period: number): number {
  const x = ((ix % period) + period) % period
  const n = Math.sin(x * 127.1 + iy * 311.7) * 43758.5453
  return fract(n)
}

/** Value noise on a lattice that repeats every `period` units in x. */
function noise(x: number, y: number, period: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = smooth(x - ix)
  const fy = smooth(y - iy)
  const a = hash(ix, iy, period)
  const b = hash(ix + 1, iy, period)
  const c = hash(ix, iy + 1, period)
  const d = hash(ix + 1, iy + 1, period)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

/** Fractal sum of value noise; `period` doubles with each octave to stay tiling. */
function fbm(x: number, y: number, period: number, octaves: number): number {
  let sum = 0
  let amp = 0.5
  let freq = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq, period * freq)
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm
}

/** Symmetric triangle wave in [0, 1] with unit period. */
const triangle = (x: number) => {
  const t = fract(x)
  return t < 0.5 ? t * 2 : 2 - t * 2
}

/**
 * Build the height field for a face design.
 *
 * `perimeter` is the closed length of the path being swept; repeat counts are
 * rounded to integers against it so the pattern meets itself exactly.
 */
export function createDisplacer(face: FaceDesign, perimeter: number): Displacer | null {
  if (face.pattern === 'none' || face.depth <= 0) return null

  const scale = Math.max(0.5, face.scale)
  const amp = face.depth
  const theta = (face.angle * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)

  // Repeats around the perimeter, forced to a whole number so the seam closes.
  const repeats = Math.max(1, Math.round(perimeter / scale))
  const kS = (repeats * 2 * Math.PI) / perimeter // radians of pattern per mm of s
  const kU = (2 * Math.PI) / scale
  // Lattice period in the noise domain, matching `repeats` cells around.
  const noisePeriod = repeats

  /** Rotate surface coordinates so `angle` tilts the pattern across the face. */
  const rot = (s: number, u: number): [number, number] => [
    (s * cos - u * sin) * (repeats / perimeter),
    (s * sin + u * cos) / scale,
  ]

  switch (face.pattern) {
    case 'oak':
      // Grain runs lengthwise: slow variation along s, tight rings across u.
      return (s, u) => {
        const [a, b] = rot(s, u)
        const rings = fbm(a * 2, b * 0.6, noisePeriod * 2, 3)
        const ridged = 1 - Math.abs(2 * fract(rings * 3.5 + b * 0.9) - 1)
        return amp * (0.35 * rings + 0.65 * ridged * ridged)
      }

    case 'walnut':
      // Coarser, swirlier figure with occasional dark cathedral arcs.
      return (s, u) => {
        const [a, b] = rot(s, u)
        const swirl = fbm(a * 1.4, b * 0.35, noisePeriod * 2, 4)
        const arcs = 1 - Math.abs(2 * fract(swirl * 2.2 + b * 0.45) - 1)
        return amp * (0.5 * swirl + 0.5 * Math.pow(arcs, 1.6))
      }

    case 'linen':
      // Over-under weave: two out-of-phase crosshatches.
      return (s, u) => {
        const a = s * kS
        const b = u * kU
        return amp * 0.5 * (Math.abs(Math.sin(a)) * 0.5 + Math.abs(Math.sin(b)) * 0.5 + 0.5)
      }

    case 'fluted':
      // Parallel semicircular grooves running the length of the moulding.
      return (_s, u) => {
        const t = triangle(u / scale)
        return amp * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)))
      }

    case 'chevron':
      // Zigzag, the classic herringbone frame.
      return (s, u) => {
        const zig = triangle((s * repeats) / perimeter + triangle(u / (scale * 2)) * 0.5)
        return amp * zig
      }

    case 'hammered':
      // Irregular pein dimples, isotropic in both directions.
      return (s, u) => {
        const a = (s * repeats) / perimeter
        const b = u / scale
        const n = fbm(a * 3, b * 3, noisePeriod * 3, 2)
        return amp * Math.pow(n, 1.5)
      }

    case 'beadboard': {
      // Rounded beads separated by a narrow quirk, across the face width.
      return (_s, u) => {
        const t = fract(u / scale)
        if (t > 0.86) return 0
        const x = t / 0.86
        return amp * Math.sin(x * Math.PI)
      }
    }

    case 'knurled':
      // Diamond crosshatch, as on a machined knob.
      return (s, u) => {
        const a = s * kS
        const b = u * kU
        return amp * 0.5 * (Math.sin(a + b) * Math.sin(a - b) + 1)
      }

    default:
      return null
  }
}

export const FACE_PATTERNS: { id: FaceDesign['pattern']; label: string; blurb: string }[] = [
  { id: 'none', label: 'Smooth', blurb: 'No surface relief' },
  { id: 'oak', label: 'Oak', blurb: 'Fine lengthwise grain' },
  { id: 'walnut', label: 'Walnut', blurb: 'Coarse swirling figure' },
  { id: 'linen', label: 'Linen', blurb: 'Woven crosshatch' },
  { id: 'fluted', label: 'Fluted', blurb: 'Parallel round grooves' },
  { id: 'chevron', label: 'Chevron', blurb: 'Herringbone zigzag' },
  { id: 'hammered', label: 'Hammered', blurb: 'Irregular pein dimples' },
  { id: 'beadboard', label: 'Beadboard', blurb: 'Beads with a quirk' },
  { id: 'knurled', label: 'Knurled', blurb: 'Machined diamond' },
]
