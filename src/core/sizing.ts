import type { FrameConfig } from './types.ts'

/**
 * How the three sizes relate.
 *
 *   interior — the pocket the artwork drops into. This is what you enter,
 *              because it is the one you can hold a print up against.
 *   sight    — what you actually see once it is in: the interior less what the
 *              frame covers on each side.
 *   outer    — the whole frame, interior plus the moulding all round.
 *
 * Asking for the sight size instead looks reasonable and is a trap: a 200 × 250
 * print entered as a 200 × 250 sight leaves a 212 × 262 pocket, and the print
 * falls straight through the back.
 */

/** Clearance recommended between the artwork and the pocket it sits in. */
export const ARTWORK_CLEARANCE_MM = 0.2

/** The visible opening, given the interior and how far the rabbet reaches in. */
export const sightSize = (interior: number, rabbetWidth: number): number =>
  Math.max(4, interior - 2 * rabbetWidth)

/** The sight opening a configuration will end up with. */
export const sightOf = (config: FrameConfig): [number, number] => [
  sightSize(config.interiorWidth, config.profile.rabbetWidth),
  sightSize(config.interiorHeight, config.profile.rabbetWidth),
]

/**
 * Whether an artwork of this size is actually held: it has to be smaller than
 * the pocket so it goes in, and larger than the sight so its edges are covered.
 */
export const holdsArtwork = (interior: number, rabbetWidth: number, artwork: number): boolean =>
  artwork <= interior && artwork > sightSize(interior, rabbetWidth)
