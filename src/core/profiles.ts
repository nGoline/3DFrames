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

type FaceBuilder = (p: ProfileParams, segments: number) => ProfilePoint[]

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
  classic: ({ width, depth, relief }, seg) => {
    const lip = width * 0.18
    const bead = width * 0.14
    const hollow = depth * 0.3 * relief
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
  ogee: ({ width, depth, relief }, seg) => {
    const drop = depth * 0.42 * relief
    const mid = width * 0.5
    return [
      { u: width, v: 0 },
      { u: width, v: depth },
      ...sweepCurve(width, mid, depth, depth - drop * 0.5, -drop * 0.45, seg),
      ...sweepCurve(mid, 0, depth - drop * 0.5, depth - drop, drop * 0.45, seg).slice(1),
    ]
  },

  /** A single concave dish scooped across the whole face. */
  scoop: ({ width, depth, relief }, seg) => {
    const sag = depth * 0.45 * relief
    return [
      { u: width, v: 0 },
      { u: width, v: depth },
      ...sweepCurve(width, 0, depth, depth, -sag, seg).slice(1),
    ]
  },

  /** A flat face tilted down toward the artwork, the way a mount board sits. */
  bevel: ({ width, depth, relief }) => [
    { u: width, v: 0 },
    { u: width, v: depth },
    { u: 0, v: depth - depth * 0.5 * relief },
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
  step: ({ width, depth, relief }) => {
    const steps = 3
    const pts: ProfilePoint[] = [
      { u: width, v: 0 },
      { u: width, v: depth },
    ]
    const totalDrop = depth * 0.5 * relief
    for (let i = 1; i <= steps; i++) {
      const u = width * (1 - i / steps)
      const vTop = depth - (totalDrop * (i - 1)) / steps
      const vBottom = depth - (totalDrop * i) / steps
      pts.push({ u, v: vTop }, { u, v: vBottom })
    }
    pts.push({ u: 0, v: depth - totalDrop })
    return pts
  },

  /** Architectural crown: tall outer fillet, deep cove, bead at the sight line. */
  crown: ({ width, depth, relief }, seg) => {
    const fillet = width * 0.12
    const bead = width * 0.16
    const cove = depth * 0.55 * relief
    return [
      { u: width, v: 0 },
      { u: width, v: depth },
      { u: width - fillet, v: depth },
      ...arc(width - fillet, depth - cove, cove, 90, 0, seg).slice(1),
      ...sweepCurve(width - fillet + cove, bead, depth - cove, depth - cove * 0.25, -cove * 0.3, seg),
      ...arc(bead, depth - cove * 0.25, bead * 0.9, -90, 90, Math.max(4, Math.round(seg / 2))).slice(1),
      { u: 0, v: depth - cove * 0.25 },
    ]
  },

  /**
   * Deep, narrow, and square — a modern gallery box with a recessed reveal
   * around the artwork.
   */
  gallery: ({ width, depth, relief }) => {
    const reveal = width * 0.3 * relief
    return [
      { u: width, v: 0 },
      { u: width, v: depth },
      { u: reveal, v: depth },
      { u: reveal, v: depth * 0.75 },
      { u: 0, v: depth * 0.75 },
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
  const face = (FACES[preset === 'custom' ? 'flat' : preset] ?? FACES.flat)(p, seg)

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
