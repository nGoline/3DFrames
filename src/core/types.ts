/**
 * Shared vocabulary for the frame generator.
 *
 * Conventions used everywhere below this module:
 *   - All internal geometry is in millimetres. The UI converts at the edges.
 *   - The frame lies in the XY plane, centred on the origin, with the back face
 *     on Z = 0 and the decorative front face toward +Z.
 *   - "Interior" is the pocket the artwork sits in. "Sight" is what you see of
 *     it once the frame covers its edges. The artwork is between the two: it
 *     must fit the interior, and overlap the sight.
 */

export type Unit = 'mm' | 'in'

export type Vec2 = [number, number]

/** A closed 2D contour, counter-clockwise for outer boundaries. */
export type Contour = Vec2[]

/**
 * A cross-section point in profile space.
 *
 *   u — distance outward from the sight edge (u = 0 at the aperture).
 *   v — height above the build plate (v = 0 at the back face).
 *
 * The profile is a closed polygon swept around the frame's opening path.
 */
export interface ProfilePoint {
  u: number
  v: number
}

export type FrameShape =
  | 'rectangle'
  | 'square'
  | 'circle'
  | 'oval'
  | 'arch'
  | 'hexagon'
  | 'octagon'

export type ProfilePreset =
  | 'flat'
  | 'classic'
  | 'ogee'
  | 'scoop'
  | 'bevel'
  | 'roundover'
  | 'step'
  | 'crown'
  | 'gallery'
  | 'custom'

export type FacePattern =
  | 'none'
  | 'oak'
  | 'walnut'
  | 'linen'
  | 'fluted'
  | 'chevron'
  | 'hammered'
  | 'beadboard'
  | 'knurled'

export type TextStyle = 'raised' | 'engraved'
export type TextPlacement = 'bottom' | 'top'

export type JointStyle = 'snap' | 'key'

/**
 * How the retaining clip reaches the artwork.
 *
 * 'folded' doubles back so its foot lands over the rabbet lip, where there is
 * something behind the artwork to press against. 'straight' reaches further in
 * and presses in mid-air, which only works if a rigid backing spans the gap.
 */
export type ClipStyle = 'folded' | 'straight'

export interface BuildPlate {
  /**
   * Id of the chosen printer preset, or 'custom'. Stored rather than inferred,
   * because plenty of printers share a bed size — a Kobra S1 and a Voron 2.4
   * 250 are both 250 × 250.
   */
  printer: string
  /** Usable build plate width in mm. */
  x: number
  /** Usable build plate depth in mm. */
  y: number
  /** Usable Z height in mm — limits how tall a part may stand. */
  z: number
  /**
   * When true, parts are allowed to be rotated in plan to make better use of a
   * rectangular or diagonal plate footprint before being split further.
   */
  smartOrientation: boolean
}

export interface ProfileParams {
  /** Face width of the moulding, from sight edge to outer edge (mm). */
  width: number
  /** Overall thickness front-to-back (mm). */
  depth: number
  /** How far the rabbet reaches in from the sight edge (mm). */
  rabbetWidth: number
  /** How deep the rabbet pocket is, measured from the back face (mm). */
  rabbetDepth: number
  /** Strength of the preset's decorative relief, 0..1. */
  relief: number
}

export interface FaceDesign {
  pattern: FacePattern
  /** Peak-to-trough depth of the surface relief (mm). */
  depth: number
  /** Feature size of the pattern (mm). */
  scale: number
  /** Rotation of the pattern across the face, in degrees. */
  angle: number
}

export interface TextConfig {
  content: string
  font: string
  /** Cap height in mm. */
  size: number
  style: TextStyle
  /** Emboss height or engrave depth (mm). */
  depth: number
  placement: TextPlacement
}

export interface Accessories {
  /**
   * Sprung clips that plug into slots in the rabbet wall and press the artwork
   * forward. Adds the slots to the frame. Works with any backing — printed,
   * card or foamboard — and at any frame size.
   */
  clips: boolean
  /** A printed easel leg that clips into the back for desk display. */
  easel: boolean
  /** A keyhole hanger plate for the wall. */
  hanger: boolean
  /**
   * A backing panel that snaps into a groove around the rabbet, holding the
   * artwork forward. Adds the matching groove to the frame.
   */
  backer: boolean
}

export interface JointConfig {
  style: JointStyle
  /** Nominal clearance between the male and female halves, per side (mm). */
  tolerance: number
}

export interface Artwork {
  /**
   * Everything that goes in the rabbet, front to back, added up: the print,
   * any mount board, glazing, and the backing. This is the number the rabbet
   * and the retaining clips are sized around.
   */
  thickness: number
}

export interface FrameConfig {
  unit: Unit
  /** Filament id — see `materials.ts`. Sets how the spring clips are sized. */
  material: string
  clipStyle: ClipStyle
  artwork: Artwork
  plate: BuildPlate
  shape: FrameShape
  /**
   * Width of the pocket the artwork drops into, in mm — not the visible
   * opening. See `sizing.ts`; the visible opening is this less the rabbet on
   * each side.
   */
  interiorWidth: number
  /** Height of the pocket the artwork drops into, in mm. */
  interiorHeight: number
  profilePreset: ProfilePreset
  profile: ProfileParams
  face: FaceDesign
  text: TextConfig
  accessories: Accessories
  joint: JointConfig
  /** Curve resolution for round shapes and reliefs. Higher is smoother. */
  quality: 0 | 1 | 2 | 3
}

/** One printable object in the generated kit. */
export interface Part {
  id: string
  name: string
  /** Which group it belongs to, for the parts filter in the UI. */
  kind: 'frame' | 'snapkit' | 'accessory' | 'backer'
  /** Triangle soup, already in millimetres and laid out in assembled position. */
  positions: Float32Array
  /**
   * Transform from assembled position into the orientation the part should be
   * printed in, sitting on Z = 0. Straight rails are turned onto their outer
   * face so the rabbet is not a cantilevered overhang.
   */
  print: number[]
  /** True when this part still needs support in its print orientation. */
  needsSupport: boolean
  /** Optional per-part display colour. */
  color: string
  /** Bounding box in assembled position. */
  bounds: { min: [number, number, number]; max: [number, number, number] }
}

export interface BuildResult {
  parts: Part[]
  /** Human-readable notes surfaced in the UI (splitting decisions, warnings). */
  notes: string[]
  warnings: string[]
  /** Outer envelope of the assembled frame in mm. */
  outerSize: [number, number]
  /** Total material volume in cm³, for a filament estimate. */
  volumeCm3: number
}
