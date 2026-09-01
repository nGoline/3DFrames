import type { BuildResult, FrameConfig, Part, Vec2 } from './types.ts'
import { buildOpeningPath, densifyPath, miterFrames, offsetPath, pathLengths } from './shapes.ts'
import { buildProfile, normaliseParams } from './profiles.ts'
import { createDisplacer } from './geometry/facePattern.ts'
import { sweep } from './geometry/sweep.ts'
import { planSplit } from './geometry/split.ts'
import { buildJoint } from './geometry/joints.ts'
import { buildAccessories, hangerOutline } from './geometry/accessories.ts'
import { boundsOf, toTriangleSoup, volumeOf, type RawMesh } from './geometry/mesh.ts'
import { textOutline } from './geometry/text.ts'
import { fromManifold, toManifold, type Kernel } from './manifold.ts'

/**
 * Everything `buildFrame` needs from its host. Injecting them keeps the whole
 * geometry pipeline runnable outside a browser, which is how `npm run smoke`
 * checks that every part comes out as a valid solid.
 */
export interface BuildDeps {
  kernel: Kernel
  loadFont: (id: string) => Promise<import('opentype.js').Font>
}

const COLORS = {
  frame: '#c08a52',
  snapkit: '#6b7f8f',
  accessory: '#8a8f7a',
  backer: '#9aa0a6',
}

/** How far above the face a raised glyph is allowed to reach, for the cut column. */
const TALL = 500

/**
 * Turn a configuration into a set of printable parts.
 *
 * The pipeline is: sweep the moulding → cut it into bed-sized runs → punch the
 * snap-key pockets → apply text → add accessories. Booleans only ever happen on
 * geometry that is already a closed solid, so nothing here needs mesh repair.
 */
export async function buildFrame(config: FrameConfig, deps: BuildDeps): Promise<BuildResult> {
  const { kernel } = deps
  const notes: string[] = []
  const warnings: string[] = []

  const profileParams = normaliseParams(config.profile)
  const profile = buildProfile(config.profilePreset, profileParams, config.quality)
  // Give the splitter somewhere to cut: seams can only land on path vertices,
  // so long rails need interior points before they can be divided.
  const path = densifyPath(
    buildOpeningPath(config.shape, config.interiorWidth, config.interiorHeight, config.quality),
    Math.min(config.plate.x, config.plate.y) / 3,
  )
  const frames = miterFrames(path.points)
  const { at, total } = pathLengths(path.points)
  const displacer = createDisplacer(config.face, total)

  const outerPath = offsetPath(path.points, frames, profileParams.width)
  const xs = outerPath.map((p) => p[0])
  const ys = outerPath.map((p) => p[1])
  const bounds = {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
  }
  const outerSize: [number, number] = [bounds.maxX - bounds.minX, bounds.maxY - bounds.minY]

  const plan = planSplit(path, frames, profileParams.width, config.plate)
  notes.push(...plan.notes)
  warnings.push(...plan.warnings)

  if (profileParams.depth > config.plate.z) {
    warnings.push(
      `The moulding is ${profileParams.depth.toFixed(1)} mm thick but the printer's Z limit is ${config.plate.z} mm.`,
    )
  }

  // ---- Frame segments -----------------------------------------------------
  // Arc length has to keep increasing along a run even where it wraps past the
  // start of the path, or the surface pattern would jump at the seam.
  const arcAlong = (indices: number[]) => {
    let lap = 0
    return indices.map((j, k) => {
      if (k > 0 && j < indices[k - 1]) lap += total
      return at[j] + lap
    })
  }

  let segments = plan.segments.map((seg) =>
    toManifold(
      kernel,
      sweep({
        points: seg.indices.map((j) => path.points[j]),
        frames: seg.indices.map((j) => frames[j]),
        arc: arcAlong(seg.indices),
        profile,
        faceStart: 3,
        displacer,
        closed: plan.single,
      }),
    ),
  )

  // ---- Snap kit -----------------------------------------------------------
  const keys: RawMesh[] = []
  // How far a key may reach from each seam: it has to stop well short of the
  // seam at the other end of the shortest neighbouring segment.
  const reachAt = (index: number): number => {
    const seams = plan.seams
    if (seams.length < 2) return Infinity
    const k = seams.indexOf(index)
    const gap = (from: number, to: number) => {
      const d = at[to] - at[from]
      return d > 0 ? d : d + total
    }
    const next = gap(index, seams[(k + 1) % seams.length])
    const prev = gap(seams[(k - 1 + seams.length) % seams.length], index)
    return 0.42 * Math.min(next, prev)
  }

  for (const seam of plan.seams) {
    const joint = buildJoint(path.points[seam], frames[seam], profile, config.joint, reachAt(seam))
    if (!joint) {
      warnings.push('The moulding is too slender for a snap key here — the seam will need glue.')
      continue
    }
    const pocket = toManifold(kernel, joint.pocket)
    segments = segments.map((seg) => (boxesOverlap(seg, pocket) ? seg.subtract(pocket) : seg))
    keys.push(joint.key)
  }
  if (keys.length) {
    notes.push(
      `Print ${keys.length} snap ${keys.length === 1 ? 'key' : 'keys'} with a ${config.joint.tolerance.toFixed(2)} mm fit clearance.`,
    )
  }

  // ---- Text ---------------------------------------------------------------
  if (config.text.content.trim()) {
    try {
      segments = await applyText(deps, segments, config, path.points, frames, profileParams, plan, bounds, warnings)
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : 'Text could not be applied.')
    }
  }

  // ---- Assemble the parts list -------------------------------------------
  const parts: Part[] = []
  segments.forEach((seg, i) => {
    parts.push(
      makePart(
        `frame-${i}`,
        plan.single ? 'Frame' : `Frame segment ${i + 1}`,
        'frame',
        fromManifold(seg),
      ),
    )
  })
  keys.forEach((key, i) => parts.push(makePart(`key-${i}`, `Snap key ${i + 1}`, 'snapkit', key)))

  const ctx = { points: path.points, frames, profile: profileParams, bounds }
  const accessories = buildAccessories(config.accessories, ctx)
  notes.push(...accessories.notes)
  for (const acc of accessories.parts) {
    parts.push(makePart(acc.id, acc.name, acc.kind, acc.mesh))
  }
  const hanger = config.accessories.hanger ? hangerOutline(ctx) : null
  if (config.accessories.hanger && !hanger) {
    warnings.push('The moulding is too narrow for a keyhole hanger — skipped.')
  }
  if (hanger) {
    const spec = hanger
    const plate = new kernel.CrossSection([spec.outer as [number, number][]], 'NonZero')
      .subtract(new kernel.CrossSection(spec.holes as [number, number][][], 'NonZero'))
      .extrude(spec.thickness)
    parts.push(makePart('hanger', 'Keyhole hanger', 'accessory', spec.place(fromManifold(plate))))
    notes.push('The hanger plate glues to the back of the top rail; hang it on a screw head.')
  }

  const tallest = parts.reduce((a, p) => Math.max(a, p.bounds.max[2] - p.bounds.min[2]), 0)
  if (tallest > config.plate.z) {
    warnings.push(`A part is ${tallest.toFixed(1)} mm tall, over the printer's ${config.plate.z} mm Z limit.`)
  }

  return {
    parts,
    notes: tally(notes),
    warnings: tally(warnings),
    outerSize,
    volumeCm3: parts.reduce((sum, p) => sum + volumeOf(p.positions), 0) / 1000,
  }
}

/**
 * Collapse repeated messages. Per-seam problems otherwise report themselves
 * once for every seam, which buries anything else that went wrong.
 */
function tally(messages: string[]): string[] {
  const counts = new Map<string, number>()
  for (const message of messages) counts.set(message, (counts.get(message) ?? 0) + 1)
  return [...counts].map(([message, n]) => (n > 1 ? `${message} (${n} seams)` : message))
}

function makePart(id: string, name: string, kind: Part['kind'], mesh: RawMesh): Part {
  const positions = toTriangleSoup(mesh)
  return { id, name, kind, positions, color: COLORS[kind], bounds: boundsOf(positions) }
}

/** Cheap rejection test so we only run booleans on parts that can actually touch. */
function boxesOverlap(a: { boundingBox(): { min: number[]; max: number[] } }, b: { boundingBox(): { min: number[]; max: number[] } }): boolean {
  const x = a.boundingBox()
  const y = b.boundingBox()
  for (let i = 0; i < 3; i++) if (x.min[i] > y.max[i] || x.max[i] < y.min[i]) return false
  return true
}

/**
 * Emboss or engrave the caption on the rail.
 *
 * Raised text is clipped to each segment's own footprint before it is unioned,
 * so a caption that runs across a seam is divided between the two pieces
 * instead of being duplicated onto both.
 */
async function applyText(
  deps: BuildDeps,
  segments: ReturnType<typeof toManifold>[],
  config: FrameConfig,
  points: Vec2[],
  frames: ReturnType<typeof miterFrames>,
  profileParams: FrameConfig['profile'],
  plan: ReturnType<typeof planSplit>,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  warnings: string[],
) {
  const { kernel } = deps
  const font = await deps.loadFont(config.text.font)
  const outline = textOutline(font, config.text.content, config.text.size, config.quality >= 2 ? 12 : 6)
  if (!outline) return segments

  const railWidth = profileParams.width
  const maxWidth = bounds.maxX - bounds.minX - 2 * railWidth
  if (outline.width > maxWidth) {
    warnings.push(
      `The caption is ${outline.width.toFixed(0)} mm wide but only ${maxWidth.toFixed(0)} mm of rail is available. Reduce the text size.`,
    )
  }

  const top = config.text.placement === 'top'
  const railCentreY = top ? bounds.maxY - railWidth / 2 : bounds.minY + railWidth / 2
  // Height of the face where the caption sits, so the lettering lands on the
  // surface rather than floating above a sloped profile.
  const faceZ = faceHeightAt(config, railWidth / 2)

  const section = new kernel.CrossSection(
    outline.contours.map((c) => c.map(([x, y]) => [x, y + railCentreY] as [number, number])),
    'NonZero',
  )

  if (config.text.style === 'engraved') {
    const cutter = section.extrude(config.text.depth + TALL).translate(0, 0, faceZ - config.text.depth)
    return segments.map((seg) => seg.subtract(cutter))
  }

  const glyphs = section.extrude(faceZ + config.text.depth - 0.8).translate(0, 0, 0.8)
  return segments.map((seg, i) => {
    const footprint = segmentFootprint(points, frames, profileParams.width, plan, i)
    if (!footprint) return seg.add(glyphs)
    const column = new kernel.CrossSection([footprint], 'NonZero').extrude(TALL).translate(0, 0, -TALL / 2)
    const piece = glyphs.intersect(column)
    return piece.isEmpty() ? seg : seg.add(piece)
  })
}

/** The plan-view outline of one segment: inner edge out, outer edge back. */
function segmentFootprint(
  points: Vec2[],
  frames: ReturnType<typeof miterFrames>,
  width: number,
  plan: ReturnType<typeof planSplit>,
  index: number,
): [number, number][] | null {
  if (plan.single) return null
  const run = plan.segments[index]?.indices
  if (!run) return null
  const inner = run.map((j) => points[j])
  const outer = offsetPath(
    run.map((j) => points[j]),
    run.map((j) => frames[j]),
    width,
  )
  return [...inner, ...outer.reverse()] as [number, number][]
}

/** Height of the decorative face at a given distance out from the sight edge. */
function faceHeightAt(config: FrameConfig, u: number): number {
  const profile = buildProfile(config.profilePreset, normaliseParams(config.profile), config.quality)
  let best = 0
  for (const p of profile) {
    if (Math.abs(p.u - u) < config.profile.width * 0.25) best = Math.max(best, p.v)
  }
  return best || normaliseParams(config.profile).depth
}
