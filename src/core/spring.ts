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

/** Young's modulus of PLA, in MPa. Conservative — it varies with print settings. */
const E_PLA = 3000
/**
 * Working stress limit, in MPa. PLA yields around 55; a third of that leaves
 * room for layer adhesion being weaker than bulk material, and for the leaf
 * being deflected repeatedly rather than once.
 */
const STRESS_LIMIT = 18
/** Force each clip should press with, in newtons. */
const TARGET_FORCE = 1.2
/**
 * How much longer the S-curve makes the leaf than its straight span. Bending
 * goes as the cube of length, so the S is what makes a clip this short flexible
 * enough to be worth calling a spring.
 */
export const S_CURVE_FACTOR = 1.7

export interface Leaf {
  /** Leaf thickness, in mm. */
  thickness: number
  /** Leaf width, in mm. */
  width: number
  /** Straight span from the tang to the tip, in mm. */
  span: number
}

export interface SpringSpec extends Leaf {
  /** Effective beam length once the S-curve is accounted for, in mm. */
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
  (force * length ** 3) / (3 * E_PLA * secondMoment(leaf))

/** Peak bending stress at a given deflection. */
const stressAt = (leaf: Leaf, length: number, deflection: number) =>
  (3 * E_PLA * deflection * leaf.thickness) / (2 * length ** 2)

/**
 * Work out how far a leaf has to be squeezed to press with the target force,
 * and back the deflection off if that would over-stress it. A clip that presses
 * a little too gently is a nuisance; one that snaps or takes a permanent set is
 * a wasted print.
 */
export function springFor(leaf: Leaf): SpringSpec {
  const length = leaf.span * S_CURVE_FACTOR
  let squeeze = deflectionFor(leaf, length, TARGET_FORCE)

  const limit = (STRESS_LIMIT * 2 * length ** 2) / (3 * E_PLA * leaf.thickness)
  if (squeeze > limit) squeeze = limit

  const force = (3 * E_PLA * secondMoment(leaf) * squeeze) / length ** 3
  return {
    ...leaf,
    length,
    squeeze,
    force,
    stress: stressAt(leaf, length, squeeze),
  }
}

/** Deflection at which the leaf would reach the working stress limit. */
export const squeezeLimit = (leaf: Leaf): number => {
  const length = leaf.span * S_CURVE_FACTOR
  return (STRESS_LIMIT * 2 * length ** 2) / (3 * E_PLA * leaf.thickness)
}

export const STRESS_CEILING = STRESS_LIMIT
