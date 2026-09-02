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
  const length = leaf.span
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
export const squeezeLimit = (leaf: Leaf): number =>
  (STRESS_LIMIT * 2 * leaf.span ** 2) / (3 * E_PLA * leaf.thickness)

/**
 * The span a leaf needs to reach a given travel without exceeding the working
 * stress. Travel is what tolerates a mis-measured stack, so it is the thing
 * worth solving for; the force that comes with it is 3·w·t²/span.
 */
export const spanForTravel = (thickness: number, travel: number): number =>
  Math.sqrt((3 * E_PLA * thickness * travel) / (2 * STRESS_LIMIT))

export const STRESS_CEILING = STRESS_LIMIT
