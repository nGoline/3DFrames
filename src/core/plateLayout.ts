import type { BuildPlate, Part } from './types.ts'
import { minAreaRect } from './geometry/packing.ts'
import { orientForPrint } from './print.ts'

export interface Placement {
  part: Part
  /** The part's geometry in print orientation, before this placement. */
  positions: Float32Array
  /** Rotation about Z, in radians. */
  angle: number
  /** Translation applied after rotation, in millimetres. */
  offset: [number, number, number]
  /** Which plate this part lands on, counting from zero. */
  plate: number
  /** True when the part cannot be placed at any angle. */
  overflow: boolean
}

export interface PlateLayout {
  placements: Placement[]
  plates: number
  /** True when parts had to be turned off-axis to fit. */
  diagonal: boolean
}

const GAP = 6

/** Space left between plates when a kit needs more than one. */
export const PLATE_GAP = 40

interface Measured {
  part: Part
  /** The part already turned into its print orientation, sitting on Z = 0. */
  positions: Float32Array
  /** Long-axis angle and size of the part's tightest bounding rectangle. */
  angle: number
  centre: [number, number]
  length: number
  width: number
}

/**
 * Lay the kit out the way you would actually print it.
 *
 * Parts that fit square on the bed are shelf-packed. When a rail is longer than
 * the bed — which is the normal case for anything poster-sized — the whole set
 * is turned to the bed's diagonal and packed as parallel strips, because that is
 * both what a slicer's arrange does and what makes the promise on the tin true.
 * Anything that still will not fit spills onto another plate.
 */
export function layoutOnPlate(parts: Part[], plate: BuildPlate): PlateLayout {
  // Everything here works on print orientation, not assembled position: a rail
  // lying on its outer face has a quite different footprint from one lying flat.
  const measured: Measured[] = parts.map((part) => {
    const positions = orientForPrint(part)
    const hull: [number, number][] = []
    for (let i = 0; i < positions.length; i += 3) hull.push([positions[i], positions[i + 1]])
    const rect = minAreaRect(hull)
    return { part, positions, angle: rect.angle, centre: rect.centre, length: rect.width, width: rect.height }
  })

  const squareFit = (m: Measured) =>
    (m.length <= plate.x && m.width <= plate.y) || (m.length <= plate.y && m.width <= plate.x)

  const needsTilt = plate.smartOrientation && measured.some((m) => !squareFit(m))
  return needsTilt ? stripPack(measured, plate) : shelfPack(measured, plate, squareFit)
}

/** Axis-aligned shelf packing: tallest first, new row when the bed runs out. */
function shelfPack(
  measured: Measured[],
  plate: BuildPlate,
  squareFit: (m: Measured) => boolean,
): PlateLayout {
  const sorted = [...measured].sort((a, b) => b.width - a.width)
  const out: Placement[] = []
  let plateIndex = 0
  let cursorX = 0
  let cursorY = 0
  let shelfHeight = 0

  for (const item of sorted) {
    // Turn the long axis along X, then across if that fits the bed better.
    let angle = -item.angle
    let w = item.length
    let h = item.width
    if (w > plate.x && h <= plate.x && w <= plate.y) {
      angle += Math.PI / 2
      ;[w, h] = [h, w]
    }

    if (cursorX > 0 && cursorX + w > plate.x) {
      cursorX = 0
      cursorY += shelfHeight + GAP
      shelfHeight = 0
    }
    if (cursorY + h > plate.y && cursorY > 0) {
      plateIndex++
      cursorX = 0
      cursorY = 0
      shelfHeight = 0
    }

    out.push({
      part: item.part,
      positions: item.positions,
      angle,
      offset: place(item, angle, cursorX + w / 2 - plate.x / 2, cursorY + h / 2 - plate.y / 2),
      plate: plateIndex,
      overflow: !squareFit(item),
    })
    cursorX += w + GAP
    shelfHeight = Math.max(shelfHeight, h)
  }
  return { placements: out, plates: plateIndex + 1, diagonal: false }
}

/**
 * Parallel strips along the bed's diagonal — the arrangement that gets the most
 * length out of a square bed.
 */
function stripPack(measured: Measured[], plate: BuildPlate): PlateLayout {
  const theta = Math.atan2(plate.y, plate.x)
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)

  /**
   * The run of bed available to a strip whose edges sit `t0` and `t1`
   * millimetres off the centre line, measured along the diagonal.
   *
   * The limits move linearly with `t`, so intersecting the two edges gives the
   * exact interval the whole strip can occupy — checking only the middle would
   * let a part's corners hang off the bed.
   */
  const loAt = (t: number) => Math.max((-plate.x / 2 + t * sin) / cos, (-plate.y / 2 - t * cos) / sin)
  const hiAt = (t: number) => Math.min((plate.x / 2 + t * sin) / cos, (plate.y / 2 - t * cos) / sin)
  const band = (t0: number, t1: number) => {
    const lo = Math.max(loAt(t0), loAt(t1))
    const hi = Math.min(hiAt(t0), hiAt(t1))
    return { centre: (lo + hi) / 2, length: Math.max(0, hi - lo) }
  }

  // Longest first, working outward from the centre line where the bed is widest.
  const sorted = [...measured].sort((a, b) => b.length - a.length)
  const out: Placement[] = []
  let plateIndex = 0
  let usedPos = 0
  let usedNeg = 0

  /** Straddle the centre line, where the diagonal is longest. */
  const openPlate = (item: Measured, index: number) => {
    const strip = band(-item.width / 2, item.width / 2)
    usedPos = item.width / 2 + GAP
    usedNeg = -item.width / 2 - GAP
    return placement(item, theta, strip.centre, 0, index, strip.length < item.length)
  }

  for (const item of sorted) {
    // The first part on a plate takes the centre line — that is the only place
    // the very longest rails fit at all.
    if (usedPos === 0 && usedNeg === 0) {
      out.push(openPlate(item, plateIndex))
      continue
    }

    let placed = false
    for (let attempt = 0; attempt < 2 && !placed; attempt++) {
      // Try whichever side of the centre line is currently tighter.
      const positive = usedPos <= -usedNeg ? attempt === 0 : attempt === 1
      const from = positive ? usedPos : usedNeg
      const to = positive ? usedPos + item.width : usedNeg - item.width
      const strip = band(from, to)
      if (strip.length < item.length) continue

      out.push(placement(item, theta, strip.centre, (from + to) / 2, plateIndex, false))
      if (positive) usedPos += item.width + GAP
      else usedNeg -= item.width + GAP
      placed = true
    }

    if (!placed) {
      plateIndex++
      out.push(openPlate(item, plateIndex))
    }
  }
  return { placements: out, plates: plateIndex + 1, diagonal: true }
}

/** Place a part along the diagonal at distance `s`, offset `t` from the centre line. */
function placement(
  item: Measured,
  theta: number,
  s: number,
  t: number,
  plateIndex: number,
  overflow: boolean,
): Placement {
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const angle = theta - item.angle
  return {
    part: item.part,
    positions: item.positions,
    angle,
    offset: place(item, angle, s * cos - t * sin, s * sin + t * cos),
    plate: plateIndex,
    overflow,
  }
}

/** Translation that lands a part's bounding-rect centre on a target point. */
function place(item: Measured, angle: number, targetX: number, targetY: number): [number, number, number] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const [cx, cy] = item.centre
  return [
    targetX - (cx * cos - cy * sin),
    targetY - (cx * sin + cy * cos),
    0, // print orientation already sits the part on the bed
  ]
}
