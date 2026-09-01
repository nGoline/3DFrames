/**
 * Geometry smoke test — `npm run smoke`.
 *
 * Every frame we hand to a slicer has to be a closed, orientable solid, so this
 * checks the two things that actually matter: manifold-3d accepts the mesh
 * without repair, and the volume matches an independent analytic calculation.
 */
import Module from 'manifold-3d'
import { buildOpeningPath, miterFrames, pathLengths } from '../src/core/shapes.ts'
import { buildProfile } from '../src/core/profiles.ts'
import { sweep } from '../src/core/geometry/sweep.ts'
import { toTriangleSoup, volumeOf } from '../src/core/geometry/mesh.ts'
import { PROFILE_PRESETS } from '../src/core/profiles.ts'
import { FRAME_SHAPES } from '../src/core/shapes.ts'
import type { ProfileParams } from '../src/core/types.ts'

const wasm = await Module()
wasm.setup()
const { Manifold, Mesh } = wasm

const params: ProfileParams = { width: 15, depth: 12, rabbetWidth: 5, rabbetDepth: 4, relief: 0.8 }
let failures = 0

function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
}

function sweepFrame(shape: any, preset: any, w = 100, h = 150) {
  const profile = buildProfile(preset, params, 1)
  const path = buildOpeningPath(shape, w, h, 1)
  const frames = miterFrames(path.points)
  const { at } = pathLengths(path.points)
  return sweep({ points: path.points, frames, arc: at, profile, faceStart: 3, displacer: null, closed: true })
}

// A flat rectangular moulding has a volume we can work out by hand:
//   ∫∫ (perimeter at offset u) du dv  =  (2W+2H)·A + 8·A·ū
{
  const raw = sweepFrame('rectangle', 'flat')
  const A = 15 * 12 - 5 * 4
  const uBar = (180 * 7.5 - 20 * 2.5) / A
  const expected = (2 * 100 + 2 * 150) * A + 8 * A * uBar
  const m = Manifold.ofMesh(new Mesh({ numProp: 3, vertProperties: raw.vertProperties, triVerts: raw.triVerts }))
  check('rectangle/flat is a valid manifold', m.status() === 'NoError', `status=${m.status()}`)
  check('rectangle/flat is a torus (genus 1)', m.genus() === 1, `genus=${m.genus()}`)
  const err = Math.abs(m.volume() - expected) / expected
  check('rectangle/flat volume matches analytic', err < 1e-4, `${m.volume().toFixed(1)} vs ${expected.toFixed(1)}`)
  const soupErr = Math.abs(volumeOf(toTriangleSoup(raw)) - expected) / expected
  check('triangle soup volume agrees', soupErr < 1e-4)
  const bb = m.boundingBox()
  const okBox =
    Math.abs(bb.min[0] + 65) < 1e-3 && Math.abs(bb.max[1] - 90) < 1e-3 &&
    Math.abs(bb.min[2]) < 1e-6 && Math.abs(bb.max[2] - 12) < 1e-3
  check('rectangle/flat bounding box', okBox, `${bb.min.map((n) => n.toFixed(2))} → ${bb.max.map((n) => n.toFixed(2))}`)
}

// Every shape × profile combination must still come out as a clean solid.
for (const { id: shape } of FRAME_SHAPES) {
  for (const { id: preset } of PROFILE_PRESETS) {
    const raw = sweepFrame(shape, preset)
    const m = Manifold.ofMesh(new Mesh({ numProp: 3, vertProperties: raw.vertProperties, triVerts: raw.triVerts }))
    check(`${shape} / ${preset}`, m.status() === 'NoError' && m.volume() > 0, `status=${m.status()} vol=${m.volume().toFixed(0)}`)
  }
}


// ---------------------------------------------------------------------------
// Full pipeline: split, joints, text, accessories and the exporters.
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs'
import opentype from 'opentype.js'
import { buildFrame } from '../src/core/frame.ts'
import { DEFAULT_CONFIG, PRINTERS } from '../src/core/presets.ts'
import { encodeStl, encodeCombinedStl } from '../src/core/export/stl.ts'
import { encode3mf } from '../src/core/export/threemf.ts'
import { encodeBundle } from '../src/core/export/bundle.ts'
import { weldVertices } from '../src/core/export/weld.ts'
import { fitsOnPlate, minAreaRect } from '../src/core/geometry/packing.ts'
import { layoutOnPlate } from '../src/ui/plateLayout.ts'
import type { FrameConfig } from '../src/core/types.ts'

const nodeFont = (id: string) => {
  const buf = readFileSync(`src/fonts/${id}.woff`)
  return Promise.resolve(opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)))
}
const deps = { kernel: wasm, loadFont: nodeFont }

function partsAreSolid(label: string, result: Awaited<ReturnType<typeof buildFrame>>) {
  let bad: string[] = []
  for (const part of result.parts) {
    const soup = part.positions
    if (soup.length === 0) { bad.push(`${part.name}: empty`); continue }
    // Re-import each part exactly as the exporters see it: welded back into an
    // indexed mesh. If Manifold accepts that, a slicer will too.
    const { vertices, indices } = weldVertices(soup)
    try {
      const m = Manifold.ofMesh(new Mesh({ numProp: 3, vertProperties: vertices, triVerts: indices }))
      if (m.status() !== 'NoError') bad.push(`${part.name}: ${m.status()}`)
      else if (m.volume() <= 0) bad.push(`${part.name}: volume ${m.volume().toFixed(2)}`)
    } catch (e) {
      bad.push(`${part.name}: ${(e as Error).message}`)
    }
  }
  check(`${label}: ${result.parts.length} parts all solid`, bad.length === 0, bad.join('; '))
  return result
}

console.log('')

{
  // Small frame on a big bed — should stay in one piece.
  const cfg: FrameConfig = { ...DEFAULT_CONFIG, interiorWidth: 100, interiorHeight: 150 }
  const r = await buildFrame(cfg, deps)
  partsAreSolid('single-piece', r)
  check('single-piece produces exactly one frame part', r.parts.filter((p) => p.kind === 'frame').length === 1)
  check('no snap keys when unsplit', r.parts.filter((p) => p.kind === 'snapkit').length === 0)
}

{
  // A 24x36 poster frame on a 180 mm bed — the headline case.
  const cfg: FrameConfig = {
    ...DEFAULT_CONFIG,
    interiorWidth: 610, interiorHeight: 914,
    plate: { x: 180, y: 180, z: 180, smartOrientation: true },
  }
  const r = await buildFrame(cfg, deps)
  partsAreSolid('24x36 on A1 mini', r)
  const segs = r.parts.filter((p) => p.kind === 'frame').length
  const keys = r.parts.filter((p) => p.kind === 'snapkit').length
  check('poster frame is split into many segments', segs > 8, `${segs} segments`)
  check('one snap key per seam', keys === segs, `${keys} keys / ${segs} segments`)
  // The whole promise of the app: every printable part must actually fit.
  const oversize = r.parts.filter((p) => {
    const hull: [number, number][] = []
    for (let i = 0; i < p.positions.length; i += 3) hull.push([p.positions[i], p.positions[i + 1]])
    const rect = minAreaRect(hull)
    const tall = p.bounds.max[2] - p.bounds.min[2]
    return !fitsOnPlate(rect.width, rect.height, 180, 180, true) || tall > 180
  })
  check('every part fits the 180 mm bed', oversize.length === 0, oversize.map((p) => p.name).join(', '))
}

{
  // Everything switched on at once.
  const cfg: FrameConfig = {
    ...DEFAULT_CONFIG,
    interiorWidth: 210, interiorHeight: 297,
    plate: { x: 220, y: 220, z: 250, smartOrientation: true },
    face: { pattern: 'fluted', depth: 0.6, scale: 5, angle: 0 },
    text: { content: 'Hello World', font: 'playfair', size: 9, style: 'raised', depth: 0.8, placement: 'bottom' },
    accessories: { easel: true, hanger: true, clips: true, backer: true },
  }
  const r = await buildFrame(cfg, deps)
  partsAreSolid('everything enabled', r)
  for (const kind of ['frame', 'snapkit', 'accessory', 'backer'] as const) {
    check(`kit includes ${kind} parts`, r.parts.some((p) => p.kind === kind))
  }

  const stl = encodeStl(r.parts[0].positions)
  check('STL header and triangle count', new DataView(stl).getUint32(80, true) === r.parts[0].positions.length / 9)
  check('STL length matches the count', stl.byteLength === 84 + (r.parts[0].positions.length / 9) * 50)
  check('combined STL covers every part', new DataView(encodeCombinedStl(r.parts)).getUint32(80, true) ===
    r.parts.reduce((n, p) => n + p.positions.length / 9, 0))

  const mf = encode3mf(r.parts, 'Test')
  check('3MF is a zip', mf[0] === 0x50 && mf[1] === 0x4b, `${mf[0]},${mf[1]}`)
  const bundle = encodeBundle(r, cfg, 'Test frame')
  check('bundle is a zip and non-trivial', bundle[0] === 0x50 && bundle.length > 5000, `${bundle.length} bytes`)
}

{
  // Engraved text on a round frame, to exercise the other boolean path.
  const cfg: FrameConfig = {
    ...DEFAULT_CONFIG,
    shape: 'circle', interiorWidth: 200, interiorHeight: 200,
    profilePreset: 'scoop',
    text: { content: 'MMXXVI', font: 'bebas', size: 7, style: 'engraved', depth: 0.6, placement: 'bottom' },
  }
  partsAreSolid('engraved circle', await buildFrame(cfg, deps))
}


// ---------------------------------------------------------------------------
// Bed arrangement: nothing may be reported as overflowing that actually fits,
// and every placed part must sit inside its own plate.
// ---------------------------------------------------------------------------
{
  for (const [label, cfg] of [
    ['8x10 on a 256 bed', { ...DEFAULT_CONFIG }],
    ['24x36 on a 180 bed', {
      ...DEFAULT_CONFIG,
      interiorWidth: 610, interiorHeight: 914,
      plate: { x: 180, y: 180, z: 180, smartOrientation: true },
    }],
  ] as [string, FrameConfig][]) {
    const r = await buildFrame(cfg, deps)
    const layout = layoutOnPlate(r.parts, cfg.plate)
    check(`${label}: nothing marked as overflowing`,
      layout.placements.every((p) => !p.overflow),
      layout.placements.filter((p) => p.overflow).map((p) => p.part.name).join(', '))

    const escaped = layout.placements.filter((p) => {
      const cos = Math.cos(p.angle)
      const sin = Math.sin(p.angle)
      for (let i = 0; i < p.part.positions.length; i += 3) {
        const x = p.part.positions[i] * cos - p.part.positions[i + 1] * sin + p.offset[0]
        const y = p.part.positions[i] * sin + p.part.positions[i + 1] * cos + p.offset[1]
        if (Math.abs(x) > cfg.plate.x / 2 + 0.01 || Math.abs(y) > cfg.plate.y / 2 + 0.01) return true
      }
      return false
    })
    check(`${label}: every part lands inside its plate`, escaped.length === 0,
      escaped.map((p) => p.part.name).join(', '))
    console.log(`         ${label}: ${r.parts.length} parts over ${layout.plates} plate(s)${layout.diagonal ? ', diagonal' : ''}`)
  }
}


// ---------------------------------------------------------------------------
// Printer presets. A typo here silently gives someone the wrong bed size, so
// check the list holds together and that a real frame builds on each one.
// ---------------------------------------------------------------------------
{
  const ids = PRINTERS.map((p) => p.id)
  check('printer ids are unique', new Set(ids).size === ids.length,
    ids.filter((id, i) => ids.indexOf(id) !== i).join(', '))
  const odd = PRINTERS.filter((p) => p.x < 100 || p.y < 100 || p.z < 100 || p.x > 800 || p.y > 800 || p.z > 800)
  check('every bed size is plausible', odd.length === 0, odd.map((p) => p.id).join(', '))
  check('every preset but custom names a brand',
    PRINTERS.every((p) => p.id === 'custom' || p.brand.length > 0))
  check('the default config points at a real preset',
    PRINTERS.some((p) => p.id === DEFAULT_CONFIG.plate.printer))

  // The smallest and largest beds are where splitting is most likely to break.
  const beds = [...PRINTERS].filter((p) => p.id !== 'custom').sort((a, b) => a.x * a.y - b.x * b.y)
  for (const bed of [beds[0], beds[beds.length - 1], PRINTERS.find((p) => p.id === 'anycubic-kobra-s1')!]) {
    const cfg: FrameConfig = {
      ...DEFAULT_CONFIG,
      interiorWidth: 610, interiorHeight: 914,
      plate: { printer: bed.id, x: bed.x, y: bed.y, z: bed.z, smartOrientation: true },
    }
    const r = await buildFrame(cfg, deps)
    const layout = layoutOnPlate(r.parts, cfg.plate)
    const bad = layout.placements.filter((p) => p.overflow)
    check(`24x36 poster on ${bed.brand} ${bed.label} (${bed.x}×${bed.y})`,
      r.warnings.length === 0 && bad.length === 0,
      [...r.warnings, ...bad.map((p) => p.part.name)].join('; '))
    console.log(`         ${bed.label}: ${r.parts.length} parts over ${layout.plates} plate(s)`)
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
