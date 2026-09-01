import type { FrameConfig } from './types.ts'
import { MM_PER_INCH } from './units.ts'

export interface PrinterPreset {
  id: string
  label: string
  x: number
  y: number
  z: number
}

/** Usable build volumes, trimmed slightly from the headline numbers. */
export const PRINTERS: PrinterPreset[] = [
  { id: 'custom', label: 'Custom size', x: 250, y: 250, z: 250 },
  { id: 'bambu-a1-mini', label: 'Bambu Lab A1 mini', x: 180, y: 180, z: 180 },
  { id: 'bambu-p1-x1', label: 'Bambu Lab P1/X1', x: 256, y: 256, z: 256 },
  { id: 'bambu-a1', label: 'Bambu Lab A1', x: 256, y: 256, z: 256 },
  { id: 'bambu-h2d', label: 'Bambu Lab H2D', x: 325, y: 320, z: 325 },
  { id: 'prusa-mk4', label: 'Prusa MK4 / MK3S', x: 250, y: 210, z: 220 },
  { id: 'prusa-mini', label: 'Prusa MINI+', x: 180, y: 180, z: 180 },
  { id: 'prusa-xl', label: 'Prusa XL', x: 360, y: 360, z: 360 },
  { id: 'ender3', label: 'Creality Ender 3', x: 220, y: 220, z: 250 },
  { id: 'ender5-plus', label: 'Creality Ender 5 Plus', x: 350, y: 350, z: 400 },
  { id: 'k1-max', label: 'Creality K1 Max', x: 300, y: 300, z: 300 },
  { id: 'voron-250', label: 'Voron 2.4 250', x: 250, y: 250, z: 250 },
  { id: 'voron-350', label: 'Voron 2.4 350', x: 350, y: 350, z: 350 },
  { id: 'elegoo-nep4', label: 'Elegoo Neptune 4', x: 225, y: 225, z: 265 },
]

export interface SizePreset {
  id: string
  label: string
  /** Interior width and height in millimetres. */
  w: number
  h: number
  group: 'photo' | 'paper' | 'poster'
}

const inches = (n: number) => Math.round(n * MM_PER_INCH * 10) / 10

/** Interior (sight) sizes. A print is trapped ~4 mm under the rabbet all round. */
export const SIZE_PRESETS: SizePreset[] = [
  { id: '4x6', label: '4 × 6 in', w: inches(4), h: inches(6), group: 'photo' },
  { id: '5x7', label: '5 × 7 in', w: inches(5), h: inches(7), group: 'photo' },
  { id: '6x8', label: '6 × 8 in', w: inches(6), h: inches(8), group: 'photo' },
  { id: '8x10', label: '8 × 10 in', w: inches(8), h: inches(10), group: 'photo' },
  { id: '11x14', label: '11 × 14 in', w: inches(11), h: inches(14), group: 'photo' },
  { id: '16x20', label: '16 × 20 in', w: inches(16), h: inches(20), group: 'photo' },
  { id: 'a6', label: 'A6', w: 105, h: 148, group: 'paper' },
  { id: 'a5', label: 'A5', w: 148, h: 210, group: 'paper' },
  { id: 'a4', label: 'A4', w: 210, h: 297, group: 'paper' },
  { id: 'a3', label: 'A3', w: 297, h: 420, group: 'paper' },
  { id: 'letter', label: 'US Letter', w: inches(8.5), h: inches(11), group: 'paper' },
  { id: '12x16', label: '12 × 16 in', w: inches(12), h: inches(16), group: 'poster' },
  { id: '18x24', label: '18 × 24 in', w: inches(18), h: inches(24), group: 'poster' },
  { id: '24x36', label: '24 × 36 in', w: inches(24), h: inches(36), group: 'poster' },
  { id: '50x70', label: '50 × 70 cm', w: 500, h: 700, group: 'poster' },
]

export const DEFAULT_CONFIG: FrameConfig = {
  unit: 'in',
  plate: { x: 256, y: 256, z: 256, smartOrientation: true },
  shape: 'rectangle',
  interiorWidth: inches(8),
  interiorHeight: inches(10),
  profilePreset: 'classic',
  profile: { width: 18, depth: 12, rabbetWidth: 6, rabbetDepth: 5, relief: 0.75 },
  face: { pattern: 'oak', depth: 0.5, scale: 6, angle: 0 },
  text: { content: '', font: 'inter', size: 8, style: 'raised', depth: 0.8, placement: 'bottom' },
  accessories: { easel: false, hanger: false, clips: false, backer: false },
  joint: { style: 'dovetail', tolerance: 0.18 },
  quality: 1,
}
