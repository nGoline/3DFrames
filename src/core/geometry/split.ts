import type { BuildPlate, Vec2 } from '../types.ts'
import type { MiterFrame } from '../shapes.ts'
import type { OpeningPath } from '../shapes.ts'
import { fitsOnPlate, minAreaRect } from './packing.ts'

export interface SegmentPlan {
  /** Path vertex indices belonging to this run, in order. */
  indices: number[]
  /** Footprint of the run once laid flat, for the UI. */
  footprint: { width: number; height: number }
}

export interface SplitPlan {
  segments: SegmentPlan[]
  /** Path vertex indices where two segments meet and need a joint. */
  seams: number[]
  /** True when the whole frame prints in one piece. */
  single: boolean
  notes: string[]
  warnings: string[]
}

const MAX_SEGMENTS = 64

/**
 * Decide how to cut a frame into printable pieces.
 *
 * Seams are placed at the frame's own mitres first, because a corner is where a
 * joint is least visible and where the geometry is thickest. Runs that are
 * still too long are bisected until every piece fits the bed.
 */
export function planSplit(
  path: OpeningPath,
  frames: MiterFrame[],
  profileWidth: number,
  plate: BuildPlate,
): SplitPlan {
  const notes: string[] = []
  const warnings: string[] = []
  const n = path.points.length

  const footprintOf = (indices: number[]) => {
    const pts: Vec2[] = []
    for (const j of indices) {
      const [px, py] = path.points[j]
      const { dir, scale } = frames[j]
      pts.push([px, py])
      pts.push([px + dir[0] * scale * profileWidth, py + dir[1] * scale * profileWidth])
    }
    const rect = minAreaRect(pts)
    return { width: rect.width, height: rect.height }
  }

  const allIndices = Array.from({ length: n }, (_, i) => i)
  const whole = footprintOf(allIndices)
  if (fitsOnPlate(whole.width, whole.height, plate.x, plate.y, plate.smartOrientation)) {
    notes.push(
      `Whole frame fits the bed at ${whole.width.toFixed(0)} × ${whole.height.toFixed(0)} mm — printing in one piece.`,
    )
    return {
      segments: [{ indices: allIndices, footprint: whole }],
      seams: [],
      single: true,
      notes,
      warnings,
    }
  }

  // Start at the frame's own corners; a smooth shape gets four seams to begin.
  let seams = path.sharp.map((s, i) => (s ? i : -1)).filter((i) => i >= 0)
  if (seams.length < 2) seams = [0, 1, 2, 3].map((k) => Math.round((k * n) / 4))
  seams.sort((a, b) => a - b)

  for (let round = 0; round < 8; round++) {
    const runs = runsBetween(seams, n)
    const tooLong = runs.filter((run) => {
      const { width, height } = footprintOf(run)
      return !fitsOnPlate(width, height, plate.x, plate.y, plate.smartOrientation)
    })
    if (!tooLong.length) break
    if (seams.length * 2 > MAX_SEGMENTS) {
      warnings.push(
        'This frame needs more pieces than the generator will split it into. Try a larger bed, a narrower moulding, or a smaller opening.',
      )
      break
    }
    // Bisect every run that still overhangs the bed.
    const added: number[] = []
    for (const run of tooLong) {
      const mid = run[Math.floor(run.length / 2)]
      if (!seams.includes(mid)) added.push(mid)
    }
    if (!added.length) {
      warnings.push('A single segment is already larger than the bed — reduce the moulding width or depth.')
      break
    }
    seams = [...seams, ...added].sort((a, b) => a - b)
  }

  const segments = runsBetween(seams, n).map((indices) => ({
    indices,
    footprint: footprintOf(indices),
  }))

  const biggest = segments.reduce((a, s) => Math.max(a, s.footprint.width), 0)
  notes.push(
    `Split into ${segments.length} segments joined by ${seams.length} snap keys. Longest piece ${biggest.toFixed(0)} mm.`,
  )
  if (plate.smartOrientation && biggest > Math.max(plate.x, plate.y)) {
    notes.push('Smart Orientation is placing the longest pieces diagonally on the bed.')
  }

  return { segments, seams, single: false, notes, warnings }
}

/**
 * The vertex runs between consecutive seams, wrapping around the closed path.
 * Both endpoints are included in each run so neighbouring segments meet exactly
 * on the seam plane.
 */
function runsBetween(seams: number[], n: number): number[][] {
  const runs: number[][] = []
  for (let k = 0; k < seams.length; k++) {
    const from = seams[k]
    const to = seams[(k + 1) % seams.length]
    const indices: number[] = []
    let i = from
    for (let guard = 0; guard <= n; guard++) {
      indices.push(i)
      if (i === to && indices.length > 1) break
      i = (i + 1) % n
    }
    runs.push(indices)
  }
  return runs
}
