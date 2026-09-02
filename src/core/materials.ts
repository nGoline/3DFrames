/**
 * Filament, as far as a spring is concerned.
 *
 * Two numbers matter. Stiffness sets how hard a given deflection pushes, and
 * the working stress sets how far it may be deflected before it stops springing
 * back. The second is the harder one: a retaining clip is loaded *permanently*,
 * so the limit is creep, not the tensile figure on the spool.
 *
 * These are deliberately conservative working values for printed parts under
 * sustained load, not datasheet numbers for injection-moulded test bars.
 * Printed parts are weaker than bulk material, layer adhesion is weaker still,
 * and a clip that relaxes over a month has failed just as surely as one that
 * snapped.
 */

export interface Material {
  id: string
  label: string
  /** Young's modulus, MPa. */
  stiffness: number
  /** Working stress under permanent load, MPa. */
  working: number
  /** Roughly where the material gives up, MPa — for context, not for design. */
  yieldStress: number
  blurb: string
}

export const MATERIALS: Material[] = [
  {
    id: 'pla',
    label: 'PLA',
    stiffness: 3000,
    working: 18,
    yieldStress: 55,
    blurb: 'Stiff, so it presses hard for its size. Creeps under sustained load, so it is held well below yield.',
  },
  {
    id: 'petg',
    label: 'PETG',
    stiffness: 2100,
    working: 20,
    yieldStress: 50,
    blurb: 'More compliant than PLA and far more forgiving. Springs get shorter and hold their set better.',
  },
  {
    id: 'abs',
    label: 'ABS / ASA',
    stiffness: 2000,
    working: 15,
    yieldStress: 40,
    blurb: 'Tough and warm-resistant, but weaker. Springs run longer and press more gently.',
  },
  {
    id: 'pa',
    label: 'Nylon',
    stiffness: 1400,
    working: 12,
    yieldStress: 45,
    blurb: 'Very tough and hard to break, but it creeps and it takes up moisture. The most cautious of the four.',
  },
]

export const materialById = (id: string): Material =>
  MATERIALS.find((m) => m.id === id) ?? MATERIALS[0]
