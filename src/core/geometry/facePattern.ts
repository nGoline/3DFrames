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

/** Effectively no wrapping, for coordinates that are already bounded. */
const UNBOUNDED = 1e6

/**
 * Latewood band width as a fraction of the ring spacing.
 *
 * The single most important number here: wood reads as wood because a narrow,
 * hard latewood line is separated by a broad, plain band of earlywood. Even
 * ridges — which is what a plain sine or triangle wave gives you — read as
 * corrugation instead.
 */
const LATEWOOD = 0.24

interface WoodGrain {
  /** Millimetres between growth rings. */
  spacing: number
  /** How far the rings wander along the length. Wide sweeps give cathedral figure. */
  sweep: number
  /** Wander cells around the perimeter; fewer means longer, lazier arcs. */
  cells: number
  octaves: number
  /** Strength of the open pores, oak's signature and walnut's much less so. */
  pores: number
}

/**
 * Flat-sawn timber.
 *
 * Growth rings run *along* a moulding, so the height field has to vary quickly
 * across the width and only slowly along the length — get that the wrong way
 * round and it reads as corrugated iron. Three things do the work: a narrow
 * latewood groove against broad flat earlywood, irregular ring spacing, and a
 * slow sweep along the grain, which is what throws the cathedral arches you see
 * where a saw crosses the rings at a shallow angle.
 */
function wood(perimeter: number, amp: number, grain: WoodGrain): Displacer {
  const { spacing, sweep, cells, octaves, pores } = grain
  return (along, across) => {
    // `across` runs over the rings; `along` follows them.
    const an = (along / perimeter) * cells

    const wander = (fbm(an, 0.37, cells, octaves) - 0.5) * 2 * sweep
    // Rings are never evenly spaced; jitter their position by where they fall.
    const jitter = (noise(across / (spacing * 3.1), 11.7, UNBOUNDED) - 0.5) * spacing * 0.55
    const t = fract((across + wander + jitter) / spacing)

    const late = t < LATEWOOD ? Math.pow(Math.sin((t / LATEWOOD) * Math.PI), 1.4) : 0
    // Scattered open pores, cut only where the noise peaks. The along-the-grain
    // coordinate has to go in x, which is the axis the lattice wraps on, or the
    // pores do not meet where the frame closes on itself.
    const pore = pores > 0 ? Math.max(0, noise(an * 5, across * 2.6, cells * 5) - 0.62) / 0.38 : 0
    // A little life in the earlywood so it is not dead flat between the lines.
    const figure = fbm(an * 2, across / (spacing * 6), cells * 2, 2) - 0.5

    return amp * Math.min(1, Math.max(0, 0.82 * late + pores * pore + 0.1 * figure + 0.05))
  }
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

  /**
   * Tilt every pattern by `angle`, in one place, by handing each one rotated
   * surface coordinates. Doing it per-pattern meant most of them quietly
   * ignored the control.
   */
  const tilted = (f: Displacer | null): Displacer | null => {
    if (!f || face.angle === 0) return f
    return (s, u) => f(s * cos - u * sin, s * sin + u * cos)
  }

  return tilted(basePattern())

  function basePattern(): Displacer | null {
      switch (face.pattern) {
      case 'oak':
        // Tight, fairly straight rings with strong open pores.
        return wood(perimeter, amp, {
          spacing: scale * 0.7,
          // Oak runs fairly straight: a small sweep over a long wavelength.
          sweep: scale * 0.55,
          cells: Math.max(2, Math.round(perimeter / (scale * 34))),
          octaves: 3,
          pores: 0.22,
        })

      case 'walnut':
        // Wider rings, far more wander, and almost no visible pore.
        return wood(perimeter, amp, {
          spacing: scale * 1.35,
          // Walnut is the opposite: broad rings that swing across the face.
          sweep: scale * 2.6,
          cells: Math.max(2, Math.round(perimeter / (scale * 22))),
          octaves: 4,
          pores: 0.06,
        })

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
