import type { FrameConfig } from './types.ts'
import { MM_PER_INCH } from './units.ts'
import { ARTWORK_CLEARANCE_MM } from './sizing.ts'

export interface PrinterPreset {
  id: string
  /** Manufacturer, used to group the picker. Empty for the custom entry. */
  brand: string
  /** Model name on its own — the brand is shown by the group heading. */
  label: string
  x: number
  y: number
  z: number
}

/**
 * Manufacturers' stated build volumes. These are the numbers on the box, which
 * are what people recognise; slicers model the small exclusion zones around the
 * edges themselves, so trimming here would only make frames split more than
 * they need to.
 */
export const PRINTERS: PrinterPreset[] = [
  { id: 'custom', brand: '', label: 'Custom size', x: 250, y: 250, z: 250 },

  { id: 'anycubic-kobra-s1', brand: 'Anycubic', label: 'Kobra S1', x: 250, y: 250, z: 250 },
  { id: 'anycubic-kobra-s1-max', brand: 'Anycubic', label: 'Kobra S1 Max', x: 350, y: 350, z: 350 },
  { id: 'anycubic-kobra-3', brand: 'Anycubic', label: 'Kobra 3', x: 250, y: 250, z: 260 },
  { id: 'anycubic-kobra-3-max', brand: 'Anycubic', label: 'Kobra 3 Max', x: 420, y: 420, z: 500 },
  { id: 'anycubic-kobra-2-neo', brand: 'Anycubic', label: 'Kobra 2 Neo', x: 220, y: 220, z: 250 },
  { id: 'anycubic-kobra-2-pro', brand: 'Anycubic', label: 'Kobra 2 Pro', x: 220, y: 220, z: 250 },
  { id: 'anycubic-kobra-2-plus', brand: 'Anycubic', label: 'Kobra 2 Plus', x: 320, y: 320, z: 400 },
  { id: 'anycubic-kobra-2-max', brand: 'Anycubic', label: 'Kobra 2 Max', x: 420, y: 420, z: 500 },

  { id: 'bambu-a1-mini', brand: 'Bambu Lab', label: 'A1 mini', x: 180, y: 180, z: 180 },
  { id: 'bambu-a1', brand: 'Bambu Lab', label: 'A1', x: 256, y: 256, z: 256 },
  { id: 'bambu-p1-x1', brand: 'Bambu Lab', label: 'P1 / X1', x: 256, y: 256, z: 256 },
  { id: 'bambu-h2d', brand: 'Bambu Lab', label: 'H2D', x: 325, y: 320, z: 325 },

  { id: 'creality-ender3', brand: 'Creality', label: 'Ender 3', x: 220, y: 220, z: 250 },
  { id: 'creality-ender5-plus', brand: 'Creality', label: 'Ender 5 Plus', x: 350, y: 350, z: 400 },
  { id: 'creality-k1-max', brand: 'Creality', label: 'K1 Max', x: 300, y: 300, z: 300 },

  { id: 'elegoo-nep4', brand: 'Elegoo', label: 'Neptune 4', x: 225, y: 225, z: 265 },

  { id: 'prusa-mini', brand: 'Prusa', label: 'MINI+', x: 180, y: 180, z: 180 },
  { id: 'prusa-mk4', brand: 'Prusa', label: 'MK4 / MK3S', x: 250, y: 210, z: 220 },
  { id: 'prusa-xl', brand: 'Prusa', label: 'XL', x: 360, y: 360, z: 360 },

  { id: 'voron-250', brand: 'Voron', label: '2.4 250', x: 250, y: 250, z: 250 },
  { id: 'voron-350', brand: 'Voron', label: '2.4 350', x: 350, y: 350, z: 350 },
]

/** Full name of a preset, for summaries and labels outside the picker. */
export const printerName = (p: PrinterPreset): string =>
  p.brand ? `${p.brand} ${p.label}` : p.label

/** Presets grouped by manufacturer, preserving the order above. */
export function printersByBrand(): { brand: string; printers: PrinterPreset[] }[] {
  const groups: { brand: string; printers: PrinterPreset[] }[] = []
  for (const printer of PRINTERS) {
    if (!printer.brand) continue
    const last = groups[groups.length - 1]
    if (last?.brand === printer.brand) last.printers.push(printer)
    else groups.push({ brand: printer.brand, printers: [printer] })
  }
  return groups
}

export interface SizePreset {
  id: string
  /** The artwork this suits. */
  label: string
  /** Interior size in mm: the artwork plus its clearance. */
  w: number
  h: number
  group: 'photo' | 'paper' | 'poster'
}

const inches = (n: number) => Math.round(n * MM_PER_INCH * 10) / 10
/** Interior = artwork + clearance, so a print of the named size drops straight in. */
const fits = (n: number) => Math.round((n + ARTWORK_CLEARANCE_MM) * 10) / 10

/** Named by the artwork they take, sized as the pocket that takes it. */
export const SIZE_PRESETS: SizePreset[] = [
  { id: '4x6', label: '4 × 6 in', w: fits(inches(4)), h: fits(inches(6)), group: 'photo' },
  { id: '5x7', label: '5 × 7 in', w: fits(inches(5)), h: fits(inches(7)), group: 'photo' },
  { id: '6x8', label: '6 × 8 in', w: fits(inches(6)), h: fits(inches(8)), group: 'photo' },
  { id: '8x10', label: '8 × 10 in', w: fits(inches(8)), h: fits(inches(10)), group: 'photo' },
  { id: '11x14', label: '11 × 14 in', w: fits(inches(11)), h: fits(inches(14)), group: 'photo' },
  { id: '16x20', label: '16 × 20 in', w: fits(inches(16)), h: fits(inches(20)), group: 'photo' },
  { id: 'a6', label: 'A6', w: fits(105), h: fits(148), group: 'paper' },
  { id: 'a5', label: 'A5', w: fits(148), h: fits(210), group: 'paper' },
  { id: 'a4', label: 'A4', w: fits(210), h: fits(297), group: 'paper' },
  { id: 'a3', label: 'A3', w: fits(297), h: fits(420), group: 'paper' },
  { id: 'letter', label: 'US Letter', w: fits(inches(8.5)), h: fits(inches(11)), group: 'paper' },
  { id: '12x16', label: '12 × 16 in', w: fits(inches(12)), h: fits(inches(16)), group: 'poster' },
  { id: '18x24', label: '18 × 24 in', w: fits(inches(18)), h: fits(inches(24)), group: 'poster' },
  { id: '24x36', label: '24 × 36 in', w: fits(inches(24)), h: fits(inches(36)), group: 'poster' },
  { id: '50x70', label: '50 × 70 cm', w: fits(500), h: fits(700), group: 'poster' },
]

export const DEFAULT_CONFIG: FrameConfig = {
  unit: 'in',
  material: 'pla',
  // A print with a card backing. A wooden back is more like 4.5 mm.
  artwork: { thickness: 2 },
  plate: { printer: 'bambu-p1-x1', x: 256, y: 256, z: 256, smartOrientation: true },
  shape: 'rectangle',
  interiorWidth: fits(inches(8)),
  interiorHeight: fits(inches(10)),
  profilePreset: 'classic',
  profile: { width: 18, depth: 14, rabbetWidth: 6, rabbetDepth: 6.5, relief: 0.75 },
  face: { pattern: 'oak', depth: 0.5, scale: 6, angle: 0 },
  text: { content: '', font: 'inter', size: 8, style: 'raised', depth: 0.8, placement: 'bottom' },
  accessories: { clips: true, easel: false, hanger: false, backer: false },
  joint: { style: 'snap', tolerance: 0.18 },
  quality: 1,
}
