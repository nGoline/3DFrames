/**
 * Write a test piece to the project folder — `npm run coupon`.
 *
 * Defaults to the case that failed on a real print: an 18 x 14 mm classic
 * moulding holding 4.5 mm of artwork (a photo on a wooden back), with spring
 * clips. Override any of it from the command line, e.g.
 *
 *   npm run coupon -- --artwork 2 --width 24 --preset ogee
 */
import Module from 'manifold-3d'
import opentype from 'opentype.js'
import { readFileSync, writeFileSync } from 'node:fs'
import { buildCoupon } from '../src/core/coupon.ts'
import { DEFAULT_CONFIG } from '../src/core/presets.ts'
import { minimumRabbetDepth } from '../src/core/geometry/accessories.ts'
import { normaliseParams } from '../src/core/profiles.ts'
import { encode3mf } from '../src/core/export/threemf.ts'
import { encodeStl } from '../src/core/export/stl.ts'
import { orientForPrint } from '../src/core/print.ts'
import type { FrameConfig, ProfilePreset } from '../src/core/types.ts'

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const wasm = await Module()
wasm.setup()

const artwork = Number(arg('artwork', '4.5'))
const width = Number(arg('width', '18'))
const preset = arg('preset', 'classic') as ProfilePreset

// Deepen the rabbet to suit the artwork, exactly as the app does.
const probe = normaliseParams({ ...DEFAULT_CONFIG.profile, width })
const rabbetDepth = Math.ceil(minimumRabbetDepth(probe, artwork, DEFAULT_CONFIG.joint.tolerance) * 2) / 2
const config: FrameConfig = {
  ...DEFAULT_CONFIG,
  profilePreset: preset,
  artwork: { thickness: artwork },
  profile: {
    ...DEFAULT_CONFIG.profile,
    width,
    rabbetDepth,
    depth: Math.max(DEFAULT_CONFIG.profile.depth, Math.ceil((rabbetDepth + 1.5) * 2) / 2),
  },
  accessories: { ...DEFAULT_CONFIG.accessories, clips: true },
}

const loadFont = (id: string) => {
  const buf = readFileSync(`src/fonts/${id}.woff`)
  return Promise.resolve(opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)))
}

const result = await buildCoupon(config, { kernel: wasm, loadFont })

writeFileSync('test-piece.3mf', encode3mf(result.parts, '3DFrames test piece', config.plate))
for (const part of result.parts) {
  const name = part.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  writeFileSync(`test-piece-${name}.stl`, Buffer.from(encodeStl(orientForPrint(part), part.name)))
}

const p = config.profile
console.log(`Moulding      ${p.width} × ${p.depth} mm, ${preset}`)
console.log(`Rabbet        ${p.rabbetWidth} × ${p.rabbetDepth} mm, sized for ${artwork} mm of artwork`)
console.log(`Parts         ${result.parts.map((q) => q.name).join(', ')}`)
console.log(`Material      ${result.volumeCm3.toFixed(1)} cm³`)
console.log('')
for (const note of result.notes) console.log(`  ${note}`)
for (const warning of result.warnings) console.log(`  ! ${warning}`)
console.log('')
console.log('Wrote test-piece.3mf (everything, arranged) and one STL per part.')
