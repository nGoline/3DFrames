import type { Unit } from './types.ts'

export const MM_PER_INCH = 25.4

export const toMm = (value: number, unit: Unit): number =>
  unit === 'in' ? value * MM_PER_INCH : value

export const fromMm = (mm: number, unit: Unit): number =>
  unit === 'in' ? mm / MM_PER_INCH : mm

/** Format a millimetre value for display in the active unit. */
export function formatLength(mm: number, unit: Unit): string {
  const v = fromMm(mm, unit)
  return unit === 'in' ? `${v.toFixed(2)} in` : `${Math.round(v * 10) / 10} mm`
}

export function formatSize(wMm: number, hMm: number, unit: Unit): string {
  const w = fromMm(wMm, unit)
  const h = fromMm(hMm, unit)
  const fmt = (n: number) => (unit === 'in' ? n.toFixed(2) : String(Math.round(n * 10) / 10))
  return `${fmt(w)} × ${fmt(h)} ${unit}`
}

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v))
