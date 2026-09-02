import type { BuildPlate, BuildResult, FrameConfig, Part, Vec2 } from './types.ts'
import { buildOpeningPath, densifyPath, miterFrames, offsetPath, pathLengths } from './shapes.ts'
import { buildProfile, normaliseParams } from './profiles.ts'
import { sightSize } from './sizing.ts'
import { createDisplacer } from './geometry/facePattern.ts'
import { sweep } from './geometry/sweep.ts'
import { planSplit } from './geometry/split.ts'
import { buildJoint } from './geometry/joints.ts'
import { backerFit, backerGroove, buildAccessories, buildClip, clipFit, clipSlots, hangerOutline, minimumRabbetDepth } from './geometry/accessories.ts'
import { boundsOf, toTriangleSoup, volumeOf, type RawMesh } from './geometry/mesh.ts'
import { box } from './geometry/primitives.ts'
import { fitsOnPlate } from './geometry/packing.ts'
import { textOutline } from './geometry/text.ts'
import { fromManifold, toManifold, type Kernel } from './manifold.ts'
import { UPRIGHT, onEnd, onOuterFace, seat } from './print.ts'

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
    buildOpeningPath(
      config.shape,
      sightSize(config.interiorWidth, profileParams.rabbetWidth),
      sightSize(config.interiorHeight, profileParams.rabbetWidth),
      config.quality,
    ),
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

  // A snap tenon protrudes past its seam, so measure one up front and let the
  // splitter budget for it — otherwise a run that fits on paper overhangs the
  // bed once the joint is on.
  const jointAllowance = (() => {
    if (config.joint.style !== 'snap') return 0
    const scales = [1, Math.max(...frames.map((f) => f.scale))]
    let worst = 0
    for (const scale of scales) {
      const probe = buildJoint([0, 0], { dir: [1, 0], scale }, profile, config.joint)
      if (probe?.tenon) worst = Math.max(worst, probe.size.length)
    }
    return worst > 0 ? worst + 1 : 0
  })()

  const plan = planSplit(path, frames, profileParams.width, config.plate, jointAllowance)
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

  // ---- Joints -------------------------------------------------------------
  const keys: RawMesh[] = []
  // How far a joint may reach from each seam: it has to stop well short of the
  // seam at the other end of the shortest neighbouring segment.
  const reachAt = (index: number): number => {
    const seams = plan.seams
    if (seams.length < 2) return Infinity
    const k = seams.indexOf(index)
    const gap = (from: number, to: number) => {
      const d = at[to] - at[from]
      return d > 0 ? d : d + total
    }
    return 0.42 * Math.min(gap(index, seams[(k + 1) % seams.length]),
                           gap(seams[(k - 1 + seams.length) % seams.length], index))
  }

  let snapping = 0
  for (const [k, seam] of plan.seams.entries()) {
    const joint = buildJoint(path.points[seam], frames[seam], profile, config.joint, reachAt(seam))
    if (!joint) {
      warnings.push('The moulding is too slender for a joint here — this seam will need glue.')
      continue
    }
    if (joint.snaps) snapping++

    if (joint.recess && joint.key) {
      // Loose key: both segments meeting here get half the recess.
      const cut = toManifold(kernel, joint.recess)
      segments = segments.map((seg) => (boxesOverlap(seg, cut) ? seg.subtract(cut) : seg))
      keys.push(joint.key)
      continue
    }
    if (!joint.tenon || !joint.mortise) continue

    // The tenon belongs to the segment *behind* the seam and reaches into the
    // one in front of it, so work out which run lies on the +n side.
    const { dir } = frames[seam]
    const ahead = path.points[(seam + 1) % path.points.length]
    const forward = (ahead[0] - path.points[seam][0]) * dir[1] - (ahead[1] - path.points[seam][1]) * dir[0]
    const starts = k // plan.segments[k] begins at this seam
    const ends = (k - 1 + plan.segments.length) % plan.segments.length
    const female = forward > 0 ? starts : ends
    const male = forward > 0 ? ends : starts

    const socket = toManifold(kernel, joint.mortise)
    const stud = toManifold(kernel, joint.tenon)
    segments = segments.map((seg, i) => {
      if (i === female) return seg.subtract(socket)
      if (i === male) return seg.add(stud)
      return seg
    })
  }
  if (plan.seams.length) {
    notes.push(
      config.joint.style === 'key'
        ? `Print ${keys.length} butterfly ${keys.length === 1 ? 'key' : 'keys'} and drop them into the recesses from the back.`
        : snapping === plan.seams.length
          ? `Every seam is an integrated snap joint — no loose parts, and a ${config.joint.tolerance.toFixed(2)} mm clearance per side.`
          : `${snapping} of ${plan.seams.length} seams snap; the rest are plain splines and want a drop of glue.`,
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

  const ctx = { points: path.points, frames, profile: profileParams, bounds, plate: config.plate }

  // The snap-in back needs a groove round the rabbet to catch in, so cut it
  // before the segments are turned into parts.
  const fit = config.accessories.backer ? backerFit(profileParams) : null
  if (fit) {
    const groove = toManifold(kernel, backerGroove(ctx, fit, config.joint.tolerance))
    segments = segments.map((seg) => seg.subtract(groove))
  }

  // Spring clips need a slot each, placed at the middle of every segment so
  // they never land on a joint. A one-piece frame gets four, evenly spaced.
  const artwork = Math.max(0, config.artwork.thickness)
  const clip = config.accessories.clips ? clipFit(profileParams, artwork, config.joint.tolerance) : null
  if (config.accessories.clips && !clip) {
    const needed = minimumRabbetDepth(profileParams, artwork, config.joint.tolerance)
    warnings.push(
      needed > profileParams.rabbetDepth
        ? `The rabbet is ${profileParams.rabbetDepth.toFixed(1)} mm deep, which cannot hold ${artwork.toFixed(1)} mm of artwork and leave room for a clip behind it. Deepen it to at least ${needed.toFixed(1)} mm.`
        : 'The moulding is too narrow for spring clips — skipped.',
    )
  }
  if (clip) {
    notes.push(
      `Clips are set to press ${clip.spring.squeeze.toFixed(1)} mm into ${artwork.toFixed(1)} mm of artwork, about ${clip.spring.force.toFixed(1)} N each.`,
    )
  }
  const clipWhere: number[] = []
  if (clip) {
    const spots = plan.single
      ? [0, 1, 2, 3].map((k) => Math.round((k * path.points.length) / 4))
      : plan.segments.map((seg) => seg.indices[Math.floor(seg.indices.length / 2)])
    for (const j of spots) if (!clipWhere.includes(j)) clipWhere.push(j)
    const slots = clipSlots(ctx, clip, clipWhere)
    if (slots) {
      const cut = toManifold(kernel, slots)
      segments = segments.map((seg) => (boxesOverlap(seg, cut) ? seg.subtract(cut) : seg))
    }
  }


  // ---- Assemble the parts list -------------------------------------------
  const parts: Part[] = []
  let curved = 0
  segments.forEach((seg, i) => {
    const run = plan.segments[i].indices
    const straight = isStraight(run, frames)
    if (!straight) curved++
    parts.push(
      makePart(
        `frame-${i}`,
        plan.single ? 'Frame' : `Frame segment ${i + 1}`,
        'frame',
        fromManifold(seg),
        straight ? onOuterFace(straight.tangent, straight.outward) : UPRIGHT,
        !straight,
      ),
    )
  })
  notes.push(
    curved === 0
      ? 'Rails print on their outer face, so the rabbet is never an overhang and no supports are needed.'
      : `${curved} curved ${curved === 1 ? 'run prints' : 'runs print'} face up and will need support under the rabbet; the rest lie on their outer face, support free.`,
  )
  keys.forEach((key, i) => parts.push(makePart(`key-${i}`, `Butterfly key ${i + 1}`, 'snapkit', key)))

  const accessories = buildAccessories(config.accessories, ctx)
  notes.push(...accessories.notes)
  for (const acc of accessories.parts) {
    // A backing panel for anything above about 5 × 7 in is wider than a bed and
    // cannot be mitred into segments the way a rail can. Cut it into strips
    // instead: each one still spans the opening, so each still catches the
    // groove along the two edges it reaches.
    if (acc.kind === 'backer') {
      const pieces = sliceToFit(kernel, acc.mesh, config.plate)
      if (!pieces) {
        const size = boundsOf(toTriangleSoup(acc.mesh))
        notes.push(
          `A backing panel for this frame would be ${(size.max[0] - size.min[0]).toFixed(0)} × ${(size.max[1] - size.min[1]).toFixed(0)} mm — too wide for the bed however it is cut up, so it is skipped. Cut one from card or foamboard instead; the groove will still hold it.`,
        )
        continue
      }
      pieces.forEach((piece, i) => {
        parts.push(
          makePart(
            pieces.length > 1 ? `${acc.id}-${i}` : acc.id,
            pieces.length > 1 ? `${acc.name} ${i + 1}` : acc.name,
            acc.kind,
            piece,
          ),
        )
      })
      notes.push(
        pieces.length > 1
          ? `The backing panel is wider than the bed, so it comes in ${pieces.length} strips that butt together behind the artwork. Each still snaps into the groove along the edges it reaches.`
          : `The backing panel snaps into a groove round the rabbet — press it in from the back until it clicks, and it holds the artwork forward against the rabbet ceiling.`,
      )
      continue
    }
    // The desk stands are prisms; stood on their cross-section they print
    // without a single overhang. Everything else is already a flat slab.
    parts.push(makePart(acc.id, acc.name, acc.kind, acc.mesh, acc.id.startsWith('stand') ? onEnd() : UPRIGHT))
  }
  if (clip) {
    clipWhere.forEach((at, i) => {
      const made = buildClip(ctx, clip, at)
      parts.push(makePart(`clip-${i}`, `Spring clip ${i + 1}`, 'accessory', made.mesh, made.print))
    })
    notes.push(
      `${clipWhere.length} spring clips push into slots in the rabbet wall and press the artwork forward. They work with a printed back, with card, or with foamboard.`,
    )
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

function makePart(
  id: string,
  name: string,
  kind: Part['kind'],
  mesh: RawMesh,
  rotation: number[] = UPRIGHT,
  needsSupport = false,
): Part {
  const positions = toTriangleSoup(mesh)
  return {
    id,
    name,
    kind,
    positions,
    print: seat(rotation, positions),
    needsSupport,
    color: COLORS[kind],
    bounds: boundsOf(positions),
  }
}

/**
 * Cut a flat panel into as few bed-sized strips as it takes, along whichever
 * axis is longer. Strips butt together with a hair of clearance.
 *
 * Only ever cut one way. A strip still runs the full width of the opening, so
 * it still catches the groove along the two edges it reaches; tiling both ways
 * would leave the middle pieces held by nothing at all. Returns null when no
 * number of strips will fit, which is the honest answer for a poster frame.
 */
function sliceToFit(kernel: Kernel, mesh: RawMesh, plate: BuildPlate): RawMesh[] | null {
  const GAP = 0.2
  const MAX_STRIPS = 6
  const bounds = boundsOf(toTriangleSoup(mesh))
  const size = [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]]
  const fits = (a: number, b: number) => fitsOnPlate(a, b, plate.x, plate.y, plate.smartOrientation)
  if (fits(size[0], size[1])) return [mesh]

  const axis = size[0] >= size[1] ? 0 : 1
  const other = 1 - axis
  let count = 2
  while (count <= MAX_STRIPS && !fits(size[axis] / count, size[other])) count++
  // The un-split axis is itself wider than the bed; no number of strips helps.
  if (count > MAX_STRIPS) return null

  const solid = toManifold(kernel, mesh)
  const step = size[axis] / count
  const pieces: RawMesh[] = []
  for (let i = 0; i < count; i++) {
    const min: [number, number, number] = [bounds.min[0] - 1, bounds.min[1] - 1, bounds.min[2] - 1]
    const max: [number, number, number] = [bounds.max[0] + 1, bounds.max[1] + 1, bounds.max[2] + 1]
    min[axis] = bounds.min[axis] + i * step + (i === 0 ? -1 : GAP / 2)
    max[axis] = bounds.min[axis] + (i + 1) * step - (i === count - 1 ? -1 : GAP / 2)
    const strip = solid.intersect(toManifold(kernel, box(min, max)))
    if (!strip.isEmpty()) pieces.push(fromManifold(strip))
  }
  return pieces.length ? pieces : null
}

/**
 * A run is straight when every vertex shares one outward direction — which is
 * exactly when it can be laid on its outer face for printing.
 */
function isStraight(
  run: number[],
  frames: ReturnType<typeof miterFrames>,
): { tangent: [number, number]; outward: [number, number] } | false {
  // Interior vertices carry the run's true normal; the mitred ends do not.
  const inner = run.slice(1, -1)
  if (!inner.length) return false
  const first = frames[inner[0]].dir
  for (const j of inner) {
    const d = frames[j].dir
    if (Math.abs(d[0] - first[0]) > 1e-3 || Math.abs(d[1] - first[1]) > 1e-3) return false
  }
  // Wound so that tangent × outward = +Z. The other choice looks equally
  // natural and is left-handed, which turns the print transform into a
  // reflection and exports every rail mirrored.
  return { tangent: [first[1], -first[0]], outward: [first[0], first[1]] }
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
