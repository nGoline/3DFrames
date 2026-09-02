import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'
import type { FrameConfig } from './types.ts'
import { DEFAULT_CONFIG } from './presets.ts'
import { formatSize } from './units.ts'

/**
 * Saving a design.
 *
 * A design is everything about the frame and nothing about the machine. The
 * build plate is a property of your printer, not of the thing you drew, so it
 * is deliberately left out: loading somebody else's design should not quietly
 * switch your printer.
 *
 * Stored designs are merged over the current defaults rather than used as-is,
 * so a design saved today still opens after new options are added — it simply
 * takes the defaults for anything it has never heard of.
 */
export type Design = Omit<FrameConfig, 'plate'>

/** Bumped only for changes a merge cannot absorb. */
export const DESIGN_VERSION = 1

export interface SavedDesign {
  id: string
  name: string
  /** ISO timestamp of the last save. */
  saved: string
  design: Design
}

export const designOf = ({ plate: _plate, ...design }: FrameConfig): Design => design

/** A design applied over the current machine settings. */
export const configFrom = (design: Design, plate: FrameConfig['plate']): FrameConfig => ({
  ...design,
  plate,
})

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback

const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)

/**
 * Rebuild a design from whatever was stored, field by field.
 *
 * Deliberately not a generic deep merge: everything is checked for the type it
 * is supposed to be, so a truncated or hand-edited file cannot put a string
 * where the geometry expects a number and fail somewhere far away.
 */
export function reviveDesign(raw: unknown): Design {
  const d = (raw ?? {}) as Record<string, any>
  const base = designOf(DEFAULT_CONFIG)
  const profile = d.profile ?? {}
  const face = d.face ?? {}
  const text = d.text ?? {}
  const acc = d.accessories ?? {}
  const joint = d.joint ?? {}

  return {
    unit: pick(d.unit, ['mm', 'in'] as const, base.unit),
    artwork: { thickness: num(d.artwork?.thickness, base.artwork.thickness) },
    shape: pick(
      d.shape,
      ['rectangle', 'square', 'circle', 'oval', 'arch', 'hexagon', 'octagon'] as const,
      base.shape,
    ),
    interiorWidth: num(d.interiorWidth, base.interiorWidth),
    interiorHeight: num(d.interiorHeight, base.interiorHeight),
    profilePreset: pick(
      d.profilePreset,
      ['flat', 'classic', 'ogee', 'scoop', 'bevel', 'roundover', 'step', 'crown', 'gallery', 'custom'] as const,
      base.profilePreset,
    ),
    profile: {
      width: num(profile.width, base.profile.width),
      depth: num(profile.depth, base.profile.depth),
      rabbetWidth: num(profile.rabbetWidth, base.profile.rabbetWidth),
      rabbetDepth: num(profile.rabbetDepth, base.profile.rabbetDepth),
      relief: num(profile.relief, base.profile.relief),
    },
    face: {
      pattern: pick(
        face.pattern,
        ['none', 'oak', 'walnut', 'linen', 'fluted', 'chevron', 'hammered', 'beadboard', 'knurled'] as const,
        base.face.pattern,
      ),
      depth: num(face.depth, base.face.depth),
      scale: num(face.scale, base.face.scale),
      angle: num(face.angle, base.face.angle),
    },
    text: {
      content: typeof text.content === 'string' ? text.content.slice(0, 64) : base.text.content,
      font: pick(text.font, ['inter', 'playfair', 'bebas', 'caveat'] as const, base.text.font),
      size: num(text.size, base.text.size),
      style: pick(text.style, ['raised', 'engraved'] as const, base.text.style),
      depth: num(text.depth, base.text.depth),
      placement: pick(text.placement, ['bottom', 'top'] as const, base.text.placement),
    },
    accessories: {
      clips: bool(acc.clips, base.accessories.clips),
      easel: bool(acc.easel, base.accessories.easel),
      hanger: bool(acc.hanger, base.accessories.hanger),
      backer: bool(acc.backer, base.accessories.backer),
    },
    joint: {
      style: pick(joint.style, ['snap', 'key'] as const, base.joint.style),
      tolerance: num(joint.tolerance, base.joint.tolerance),
    },
    quality: ([0, 1, 2, 3] as const).find((q) => q === d.quality) ?? base.quality,
  }
}

/* --- Sharing ------------------------------------------------------------- */

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (text: string): Uint8Array => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * A design as a URL-safe string: JSON, deflated, base64url. Compressing first
 * is what keeps a whole frame down to a link you can paste in a message.
 */
export function encodeDesign(design: Design): string {
  return toBase64Url(deflateSync(strToU8(JSON.stringify({ v: DESIGN_VERSION, d: design })), { level: 9 }))
}

export function decodeDesign(text: string): Design | null {
  try {
    const parsed = JSON.parse(strFromU8(inflateSync(fromBase64Url(text.trim()))))
    return reviveDesign(parsed?.d ?? parsed)
  } catch {
    return null
  }
}

/** One line describing a design, for the saved list. */
export function summarise(design: Design): string {
  const size = formatSize(design.interiorWidth, design.interiorHeight, design.unit)
  const pattern = design.face.pattern === 'none' ? '' : ` · ${design.face.pattern}`
  return `${size} · ${design.profilePreset} ${design.profile.width}×${design.profile.depth}${pattern}`
}

/** A name to offer when saving something unnamed. */
export const suggestName = (design: Design): string =>
  `${formatSize(design.interiorWidth, design.interiorHeight, design.unit)} ${design.profilePreset}`
