import type { Vec2 } from './types.ts'
import type { Material } from './materials.ts'

/**
 * The retaining clip, as a spring rather than a shape.
 *
 * A clip that merely fits is useless — it has to press the artwork forward hard
 * enough to hold it and survive being deflected without taking a set. Both
 * follow from ordinary cantilever beam theory, so the geometry is derived from
 * the force we want rather than the force being whatever the geometry happens
 * to give.
 *
 *   force       F = 3·E·I·δ / L³        I = w·t³ / 12
 *   peak stress σ = 3·E·δ·t / (2·L²)
 *
 * The deflection δ is the "squeeze": how far the leaf is pushed back from where
 * it would rest, which is also how much room the rabbet has to leave behind the
 * artwork. Everything else is a consequence.
 */

/**
 * Force each clip should press with, in newtons. Set above what the leaf can
 * reach, so the geometry runs against the stress limit rather than against this
 * — a clip that presses too gently is the failure that gets reported.
 */
const TARGET_FORCE = 4
/**
 * The leaf is straight, and that is a correction rather than a simplification.
 *
 * It used to be S-curved, on the reasoning that the extra path length bought
 * compliance — bending goes as the cube of length, so an S was supposedly worth
 * 1.7x. Working it out properly says otherwise. For an out-of-plane tip load on
 * a planar curved beam, Castigliano gives
 *
 *     δ/P = ∫ [ (r·t)²/EI + (r×t)²/GJ ] ds
 *
 * where r is the in-plane vector from each point to the tip. Wandering sideways
 * lengthens ds but shortens r, and the two very nearly cancel: a 2.6 mm S over
 * a 20 mm span is worth 1.068x, not 4.9x. It was buying 7% of compliance while
 * the model claimed 390%, so every leaf sized against it was carrying about
 * three times the stress it was supposed to.
 *
 * A straight leaf gets its compliance from length, where the cube law actually
 * applies, and its behaviour is exactly the textbook cantilever.
 */

export interface Leaf {
  /** What it will be printed in. Stiffness and working stress come from this. */
  material: Material
  /** Leaf thickness, in mm. */
  thickness: number
  /** Leaf width, in mm. */
  width: number
  /** Straight span from the tang to the tip, in mm. */
  span: number
}

export interface SpringSpec extends Leaf {
  /** Beam length, in mm. The leaf is straight, so this is its span. */
  length: number
  /** Deflection the clip is built to work at, in mm. */
  squeeze: number
  /** Force it presses with at that deflection, in newtons. */
  force: number
  /** Peak bending stress at that deflection, in MPa. */
  stress: number
}

const secondMoment = (leaf: Leaf) => (leaf.width * leaf.thickness ** 3) / 12

/** Deflection that produces a given force. */
const deflectionFor = (leaf: Leaf, length: number, force: number) =>
  (force * length ** 3) / (3 * leaf.material.stiffness * secondMoment(leaf))

/** Peak bending stress at a given deflection. */
const stressAt = (leaf: Leaf, length: number, deflection: number) =>
  (3 * leaf.material.stiffness * deflection * leaf.thickness) / (2 * length ** 2)

/**
 * Work out how far a leaf has to be squeezed to press with the target force,
 * and back the deflection off if that would over-stress it. A clip that presses
 * a little too gently is a nuisance; one that snaps or takes a permanent set is
 * a wasted print.
 */
export function springFor(leaf: Leaf): SpringSpec {
  const length = leaf.span
  let squeeze = deflectionFor(leaf, length, TARGET_FORCE)

  const limit = (leaf.material.working * 2 * length ** 2) / (3 * leaf.material.stiffness * leaf.thickness)
  if (squeeze > limit) squeeze = limit

  const force = (3 * leaf.material.stiffness * secondMoment(leaf) * squeeze) / length ** 3
  return {
    ...leaf,
    length,
    squeeze,
    force,
    stress: stressAt(leaf, length, squeeze),
  }
}

/** Deflection at which the leaf would reach the working stress limit. */
export const squeezeLimit = (leaf: Leaf): number =>
  (leaf.material.working * 2 * leaf.span ** 2) / (3 * leaf.material.stiffness * leaf.thickness)

/**
 * The span a leaf needs to reach a given travel without exceeding the working
 * stress. Travel is what tolerates a mis-measured stack, so it is the thing
 * worth solving for; the force that comes with it is 3·w·t²/span.
 */
export const spanForTravel = (material: Material, thickness: number, travel: number): number =>
  Math.sqrt((3 * material.stiffness * thickness * travel) / (2 * material.working))

/* --- Springs of any shape ------------------------------------------------ */

/**
 * Analyse a leaf from its centre line rather than from a formula.
 *
 * Closed forms have been wrong twice here — once for an S-curve, once for a
 * folded leaf whose load I put in the wrong place — so the shape is integrated
 * directly. For an out-of-plane tip load on a planar beam, Castigliano gives
 *
 *     δ/P = (1/EI) ∫ [ (r·t)² + (r×t)²·EI/GJ ] ds
 *
 * with r the in-plane vector from each point to the loaded point and t the unit
 * tangent: r·t bends the strip, r×t twists it. Peak bending moment is P·max|r·t|.
 *
 * For a straight cantilever this reduces to the textbook PL³/3EI and 6PL/wt²,
 * which is asserted in the tests rather than assumed here.
 */
export interface Shape {
  /** Centre line, in mm. The last point is where the load is applied. */
  points: Vec2[]
}

/** Thin strip: GJ/EI = (E/2.6)(wt³/3) / (E wt³/12) = 1.538. */
const TORSION_SHARE = 1 / 1.538

export interface ShapeSpec {
  /** ∫[(r·t)² + (r×t)²·EI/GJ] ds, in mm³. Deflection is P·this/EI. */
  compliance: number
  /** Largest bending lever arm along the beam, in mm. */
  arm: number
}

export function analyse(shape: Shape): ShapeSpec {
  const pts = shape.points
  const tip = pts[pts.length - 1]
  let compliance = 0
  let arm = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const ds = Math.hypot(dx, dy)
    if (ds < 1e-9) continue
    const tx = dx / ds
    const ty = dy / ds
    // Take the arm at the segment's midpoint.
    const rx = tip[0] - (a[0] + b[0]) / 2
    const ry = tip[1] - (a[1] + b[1]) / 2
    const bend = rx * tx + ry * ty
    const twist = ry * tx - rx * ty
    compliance += (bend * bend + TORSION_SHARE * twist * twist) * ds
    arm = Math.max(arm, Math.abs(bend))
  }
  return { compliance, arm }
}

/** What a leaf of this shape does, worked to the material's limit. */
export function springForShape(leaf: Leaf, shape: Shape): SpringSpec {
  const { compliance, arm } = analyse(shape)
  const I = secondMoment(leaf)
  const E = leaf.material.stiffness
  // σ = M·c/I = 6·P·arm/(w·t²), and δ = P·compliance/(EI). Eliminating P:
  const squeeze = (2 * compliance * leaf.material.working) / (E * leaf.thickness * arm)
  const force = (squeeze * E * I) / compliance
  return {
    ...leaf,
    length: compliance,
    squeeze,
    force,
    stress: (6 * force * arm) / (leaf.width * leaf.thickness ** 2),
  }
}


