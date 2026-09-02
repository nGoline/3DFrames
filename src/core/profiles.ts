import type { ProfilePoint, ProfileParams, ProfilePreset } from './types.ts'

/**
 * Edge profiles are authored as a cross-section in "profile space":
 *
 *      v (mm above the build plate)
 *      ^
 *      |   ___________ front face
 *      |  /           \
 *      | |             |
 *      | |        _____|  <- rabbet ceiling
 *      | |_______|
 *      +-----------------> u (mm outward from the sight edge)
 *      u=0                u=width
 *
 * Every preset supplies only the decorative silhouette — the polyline running
 * from the back outer corner (u = width, v = 0) round to the sight edge at
 * u = 0. The rabbet and back face are identical for all presets and are added
 * by `buildProfile`, so a new style only has to describe the part you can see.
 */

/**
 * What a face builder is given. `budget` is how far the decorative face may
 * drop below the front plane before it would break into the rabbet — presets
 * scale their relief against it rather than against total thickness, because a
 * deep rabbet can leave far less material at the front than the thickness
 * suggests, and a drop past the rabbet ceiling folds the outline through itself.
 */
type FaceParams = ProfileParams & { budget: number }
type FaceBuilder = (p: FaceParams, segments: number) => ProfilePoint[]

/** Material kept at the front of the rabbet, so the face never breaks through. */
const FRONT_WALL_MM = 1.2

/** How far the face may be cut down from the front plane. */
export const faceBudget = (p: ProfileParams): number =>
  Math.max(0.4, Math.min(p.depth * 0.62, p.depth - p.rabbetDepth - FRONT_WALL_MM))

const SEGMENTS_BY_QUALITY = [10, 18, 30, 48]

export const segmentsForQuality = (quality: number): number =>
  SEGMENTS_BY_QUALITY[Math.max(0, Math.min(3, quality))]

/** Sample a circular arc between two angles, inclusive of both ends. */
function arc(
  cu: number,
  cv: number,
  radius: number,
  fromDeg: number,
  toDeg: number,
  segments: number,
): ProfilePoint[] {
  const pts: ProfilePoint[] = []
  for (let i = 0; i <= segments; i++) {
    const a = ((fromDeg + (toDeg - fromDeg) * (i / segments)) * Math.PI) / 180
    pts.push({ u: cu + radius * Math.cos(a), v: cv + radius * Math.sin(a) })
  }
  return pts
}

/**
 * A cosine easing between two heights across a span of `u`, used for coves and
 * ogees. `bulge` > 0 pushes the curve above the straight line, < 0 below.
 */
function sweepCurve(
  uFrom: number,
  uTo: number,
  vFrom: number,
  vTo: number,
  bulge: number,
  segments: number,
): ProfilePoint[] {
  const pts: ProfilePoint[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const eased = (1 - Math.cos(t * Math.PI)) / 2
    const u = uFrom + (uTo - uFrom) * t
    const v = vFrom + (vTo - vFrom) * eased + bulge * Math.sin(t * Math.PI)
    pts.push({ u, v })
  }
  return pts
}

const FACES: Record<Exclude<ProfilePreset, 'custom'>, FaceBuilder> = {
  /** A plain rectangular batten. The reference every other style deviates from. */
  flat: ({ width, depth }) => [
    { u: width, v: 0 },
    { u: width, v: depth },
    { u: 0, v: depth },
  ],

  /**
   * Traditional moulding: a raised outer lip, a broad hollow, then a small bead
   * standing proud of the sight edge.
   */
  classic: ({ width, depth, relief, budget }, seg) => {
    const lip = width * 0.18
    const bead = width * 0.14
    const hollow = budget * 0.6 * relief
    return [
      { u: width, v: 0 },
      { u: width, v: depth },
      { u: width - lip, v: depth },
      { u: width - lip, v: depth - hollow * 0.55 },
      ...sweepCurve(width - lip, bead, depth - hollow * 0.55, depth - hollow * 0.35, -hollow * 0.5, seg),
      { u: bead, v: depth - hollow * 0.1 },
      { u: bead * 0.45, v: depth },
      { u: 0, v: depth },
    ]
  },

  /** A continuous S-curve falling from the outer edge to the aperture. */
  ogee: ({ width, depth, relief, budget }, seg) => {
    const drop = budget * 0.85 * relief
    const mid = width * 0.5
    return [
      { u: width, v: 0 },
      { u: width, v: depth },
      ...sweepCurve(width, mid, depth, depth - drop * 0.5, -drop * 0.45, seg),
      ...sweepCurve(mid, 0, depth - drop * 0.5, depth - drop, drop * 0.45, seg).slice(1),
    ]
  },

  /** A single concave dish scooped across the whole face. */
  scoop: ({ width, depth, relief, budget }, seg) => {
    const sag = budget * 0.9 * relief
    return [
      { u: width, v: 0 },
      { u: width, v: depth },
      ...sweepCurve(width, 0, depth, depth, -sag, seg).slice(1),
    ]
  },

  /** A flat face tilted down toward the artwork, the way a mount board sits. */
  bevel: ({ width, depth, relief, budget }) => [
    { u: width, v: 0 },
    { u: width, v: depth },
    { u: 0, v: depth - budget * relief },
  ],

  /** Softened outer arris — kind to fingers and to first-layer adhesion. */
  roundover: ({ width, depth, relief }, seg) => {
    const r = Math.min(width * 0.45, depth * 0.45) * relief
    return [
      { u: width, v: 0 },
      { u: width, v: depth - r },
      ...arc(width - r, depth - r, r, 0, 90, Math.max(3, Math.round(seg / 2))),
      { u: 0, v: depth },
    ]
  },

  /** Concentric rectangular terraces, a very forgiving shape to print. */
  step: ({ width, depth, relief, budget }) => {
    const steps = 3
    const pts: ProfilePoint[] = [
      { u: width, v: 0 },
      { u: width, v: depth },
    ]
    const totalDrop = budget * relief
    for (let i = 1; i <= steps; i++) {
      const u = width * (1 - i / steps)
      const vTop = depth - (totalDrop * (i - 1)) / steps
      const vBottom = depth - (totalDrop * i) / steps
      pts.push({ u, v: vTop }, { u, v: vBottom })
    }
    pts.push({ u: 0, v: depth - totalDrop })
    return pts
  },

  /**
   * Architectural crown: a fillet at the outer edge, a deep concave cove
   * sweeping down and in, and a small bead standing proud at the sight line.
   *
   * The cove is a quarter circle centred level with the front face, which is
   * what keeps the hollow from ever rising above it, and its radius is bounded
   * by both the thickness and the run left after the bead — a cove larger than
   * either would loop back out through the side of the moulding.
   */
  crown: ({ width, depth, relief, budget }, seg) => {
    const fillet = width * 0.1
    let beadRadius = Math.min(width * 0.075, depth * 0.18)
    let beadCentre = beadRadius + width * 0.05
    const maxCove = Math.min(budget, width - fillet - beadCentre - beadRadius - 0.5)
    const cove = Math.max(0.5, maxCove * (0.35 + 0.65 * relief))
    // The bead sits on the shelf the cove lands on, so it can be no taller.
    beadRadius = Math.min(beadRadius, cove * 0.8)
    beadCentre = beadRadius + width * 0.05
    const shelf = depth - cove

    return [
      { u: width, v: 0 },
      { u: width, v: depth },
      { u: width - fillet, v: depth },
      ...arc(width - fillet - cove, depth, cove, 0, -90, seg).slice(1),
      { u: beadCentre + beadRadius, v: shelf },
      ...arc(beadCentre, shelf, beadRadius, 0, 180, Math.max(4, Math.round(seg / 2))).slice(1),
      { u: 0, v: shelf },
    ]
  },

  /**
   * Deep, narrow, and square — a modern gallery box with a recessed reveal
   * around the artwork.
   */
  gallery: ({ width, depth, relief, budget }) => {
    const reveal = width * 0.3 * relief
    const floor = depth - Math.min(depth * 0.25, budget)
    return [
      { u: width, v: 0 },
      { u: width, v: depth },
      { u: reveal, v: depth },
      { u: reveal, v: floor },
      { u: 0, v: floor },
    ]
  },
}

export const PROFILE_PRESETS: { id: ProfilePreset; label: string; blurb: string }[] = [
  { id: 'classic', label: 'Classic', blurb: 'Traditional lip, hollow and bead' },
  { id: 'flat', label: 'Flat', blurb: 'Plain rectangular batten' },
  { id: 'ogee', label: 'Ogee', blurb: 'Continuous S-curve face' },
  { id: 'scoop', label: 'Scoop', blurb: 'Single concave dish' },
  { id: 'bevel', label: 'Bevel', blurb: 'Face angled toward the art' },
  { id: 'roundover', label: 'Roundover', blurb: 'Softened outer edge' },
  { id: 'step', label: 'Stepped', blurb: 'Concentric terraces' },
  { id: 'crown', label: 'Crown', blurb: 'Architectural cove moulding' },
  { id: 'gallery', label: 'Gallery', blurb: 'Deep box with a reveal' },
  { id: 'custom', label: 'Custom', blurb: 'Flat face, your dimensions' },
]

/**
 * Assemble the full closed cross-section: rabbet, back face, then the preset's
 * decorative silhouette. Returned counter-clockwise in the (u, v) plane, which
 * the sweep relies on to get outward-facing normals.
 */
export function buildProfile(
  preset: ProfilePreset,
  params: ProfileParams,
  quality: number,
): ProfilePoint[] {
  const p = normaliseParams(params)
  const seg = segmentsForQuality(quality)
  const face = (FACES[preset === 'custom' ? 'flat' : preset] ?? FACES.flat)(
    { ...p, budget: faceBudget(p) },
    seg,
  )

  const pts: ProfilePoint[] = [
    { u: 0, v: p.rabbetDepth },
    { u: p.rabbetWidth, v: p.rabbetDepth },
    { u: p.rabbetWidth, v: 0 },
    ...face,
  ]
  return dedupe(pts)
}

/**
 * Keep the numbers physically buildable: the rabbet has to leave a wall behind
 * it, and it must not eat the whole thickness of the moulding.
 */
export function normaliseParams(p: ProfileParams): ProfileParams {
  const width = Math.max(4, p.width)
  const depth = Math.max(3, p.depth)
  return {
    width,
    depth,
    rabbetWidth: Math.min(Math.max(1, p.rabbetWidth), width - 2),
    rabbetDepth: Math.min(Math.max(1, p.rabbetDepth), depth - 1.2),
    relief: Math.min(1, Math.max(0, p.relief)),
  }
}

/** Drop points that coincide, which would create zero-area triangles. */
function dedupe(pts: ProfilePoint[]): ProfilePoint[] {
  const out: ProfilePoint[] = []
  const eps = 1e-4
  for (const pt of pts) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.u - pt.u) < eps && Math.abs(last.v - pt.v) < eps) continue
    out.push(pt)
  }
  const first = out[0]
  const last = out[out.length - 1]
  if (out.length > 1 && Math.abs(first.u - last.u) < eps && Math.abs(first.v - last.v) < eps) {
    out.pop()
  }
  return out
}
