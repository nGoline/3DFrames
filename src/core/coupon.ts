import type { BuildResult, FrameConfig, Part } from './types.ts'
import { buildOpeningPath, densifyPath, miterFrames, pathLengths } from './shapes.ts'
import { buildProfile, normaliseParams } from './profiles.ts'
import { sweep } from './geometry/sweep.ts'
import { buildJoint } from './geometry/joints.ts'
import { buildClip, clipFit, clipSlots } from './geometry/accessories.ts'
import { boundsOf, toTriangleSoup, volumeOf, type RawMesh } from './geometry/mesh.ts'
import { fromManifold, toManifold } from './manifold.ts'
import { UPRIGHT, onOuterFace, seat } from './print.ts'
import type { BuildDeps } from './frame.ts'

/**
 * A test piece.
 *
 * The three things that can only be answered by printing — does the mitre close,
 * does the clip grip its slot, does the leaf press the artwork — all live at one
 * corner of a frame. So the coupon is one corner, at full size, in the moulding
 * you actually configured. Twenty minutes instead of four hours.
 *
 * Both joint styles are included, because which one to trust is exactly the
 * open question, and printing one of each costs almost nothing at this size.
 */

/**
 * Length of each leg past the corner, measured along the sight edge.
 *
 * Long enough to hold the joint the real frame would use — a mitre tenon
 * reaches about 12 mm along the rail — and to get a grip on, and no longer.
 * Taking whole sides of a square instead would mitre both ends of every leg and
 * roughly triple the print for nothing.
 */
const LEG_MM = 20

const COLORS = { snap: '#c08a52', key: '#a8794a', clip: '#8a8f7a', butterfly: '#6b7f8f' }

export async function buildCoupon(config: FrameConfig, deps: BuildDeps): Promise<BuildResult> {
  const { kernel } = deps
  const params = normaliseParams(config.profile)
  const profile = buildProfile(config.profilePreset, params, config.quality)
  const notes: string[] = []
  const warnings: string[] = []
  const parts: Part[] = []

  // A square gives a real 90° mitre with the real mitre scale. Densifying it
  // puts a vertex one leg's length either side of a corner, so the coupon can
  // be a short run off that corner rather than two whole sides.
  const path = densifyPath(
    buildOpeningPath('square', LEG_MM * 4, LEG_MM * 4, config.quality),
    LEG_MM,
  )
  const frames = miterFrames(path.points)
  const { at } = pathLengths(path.points)
  // The second corner, so there is a full leg of path on either side of it.
  const corner = path.sharp.indexOf(true, 1)
  const runs = [
    [corner - 1, corner],
    [corner, corner + 1],
  ]

  const artwork = Math.max(0, config.artwork.thickness)
  const clip = config.accessories.clips ? clipFit(params, artwork, config.joint.tolerance) : null

  for (const [style, offset] of [
    ['snap', 0],
    ['key', params.width * 2 + LEG_MM + 14],
  ] as const) {
    // No reach limit: the coupon has to carry the joint a real frame would use,
    // not a shortened one that would tell you nothing.
    const joint = buildJoint(path.points[corner], frames[corner], profile, { ...config.joint, style })
    if (!joint) {
      warnings.push(`No ${style} joint fits this moulding, so it is left out of the test piece.`)
      continue
    }

    let legs = runs.map((run) =>
      toManifold(
        kernel,
        sweep({
          points: run.map((j) => path.points[j]),
          frames: run.map((j) => frames[j]),
          arc: run.map((j) => at[j]),
          profile,
          faceStart: 3,
          displacer: null,
          closed: false,
        }),
      ),
    )

    if (style === 'key' && joint.recess) {
      const cut = toManifold(kernel, joint.recess)
      legs = legs.map((leg) => leg.subtract(cut))
      parts.push(
        makePart(`${style}-key`, 'Butterfly key', joint.key!, COLORS.butterfly, UPRIGHT, offset),
      )
    } else if (joint.tenon && joint.mortise) {
      // `forward` decides which side the tenon reaches into, as a frame does.
      const dir = frames[corner].dir
      const ahead = path.points[corner + 1]
      const forward =
        (ahead[0] - path.points[corner][0]) * dir[1] - (ahead[1] - path.points[corner][1]) * dir[0]
      const female = forward > 0 ? 1 : 0
      legs = legs.map((leg, i) =>
        i === female
          ? leg.subtract(toManifold(kernel, joint.mortise!))
          : leg.add(toManifold(kernel, joint.tenon!)),
      )
    }

    // One leg carries a clip slot, so the fit can be felt.
    if (clip) {
      const ctx = {
        points: path.points,
        frames,
        profile: params,
        bounds: { minX: -LEG_MM * 2, minY: -LEG_MM * 2, maxX: LEG_MM * 2, maxY: LEG_MM * 2 },
        plate: config.plate,
      }
      const slots = clipSlots(ctx, clip, [runs[0][0]])
      if (slots) legs[0] = legs[0].subtract(toManifold(kernel, slots))
      if (style === 'snap') {
        const made = buildClip(ctx, clip, runs[0][0])
        parts.push(makePart('clip', 'Spring clip', made.mesh, COLORS.clip, made.print, offset))
      }
    }

    legs.forEach((leg, i) => {
      // Take the rail's direction from the leg's straight end, not the mitre.
      const d = frames[i === 0 ? runs[0][0] : runs[1][1]].dir
      const straight = { tangent: [d[1], -d[0]] as [number, number], outward: d }
      parts.push(
        makePart(
          `${style}-leg-${i}`,
          `${style === 'snap' ? 'Snap' : 'Butterfly'} corner ${i + 1}`,
          fromManifold(leg),
          COLORS[style],
          onOuterFace(straight.tangent, straight.outward),
          offset,
        ),
      )
    })
  }

  const volume = parts.reduce((sum, p) => sum + volumeOf(p.positions), 0) / 1000
  notes.push(
    `Test piece: one corner of your ${params.width} × ${params.depth} mm moulding, in both joint styles, at full size.`,
    `About ${volume.toFixed(0)} cm³ — a fraction of an hour rather than most of an evening.`,
    'Push each pair together: the mitre should close, and you should feel it click.',
  )
  if (clip) {
    notes.push(
      `Push the clip into its slot: free at first, then wedging over the last couple of millimetres. Its leaf should stand ${clip.spring.squeeze.toFixed(1)} mm proud of where ${artwork.toFixed(1)} mm of artwork would sit.`,
    )
  }

  const bounds = parts.map((p) => p.bounds)
  return {
    parts,
    notes,
    warnings,
    outerSize: [
      Math.max(...bounds.map((b) => b.max[0])) - Math.min(...bounds.map((b) => b.min[0])),
      Math.max(...bounds.map((b) => b.max[1])) - Math.min(...bounds.map((b) => b.min[1])),
    ],
    volumeCm3: volume,
  }
}

function makePart(
  id: string,
  name: string,
  mesh: RawMesh,
  color: string,
  rotation: number[],
  offsetX: number,
): Part {
  const positions = toTriangleSoup(mesh)
  // Shift the two joint styles apart so the assembled view reads as two corners.
  const shifted = new Float32Array(positions)
  for (let i = 0; i < shifted.length; i += 3) shifted[i] += offsetX
  return {
    id,
    name,
    kind: 'frame',
    positions: shifted,
    print: seat(rotation, shifted),
    needsSupport: false,
    color,
    bounds: boundsOf(shifted),
  }
}
