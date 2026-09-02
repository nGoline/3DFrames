/**
 * Geometry smoke test — `npm run smoke`.
 *
 * Every frame we hand to a slicer has to be a closed, orientable solid, so this
 * checks the two things that actually matter: manifold-3d accepts the mesh
 * without repair, and the volume matches an independent analytic calculation.
 */
import Module from 'manifold-3d'
import { buildOpeningPath, miterFrames, pathLengths } from '../src/core/shapes.ts'
import { buildProfile, normaliseParams } from '../src/core/profiles.ts'
import { buildJoint } from '../src/core/geometry/joints.ts'
import { clipFit, minimumRabbetDepth } from '../src/core/geometry/accessories.ts'
import { STRESS_CEILING } from '../src/core/spring.ts'
import { FACE_PATTERNS, createDisplacer } from '../src/core/geometry/facePattern.ts'
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
// Every edge profile must be a simple polygon inside its own envelope, at any
// proportions. A deep rabbet leaves far less material at the front than the
// thickness suggests, and relief that overruns it folds the outline through
// itself — which sweeps into a solid that looks like a knot.
// ---------------------------------------------------------------------------
{
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const crosses = (p1: number[], p2: number[], p3: number[], p4: number[]) => {
    const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2)
    const d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4)
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  }

  const shapes: [number, number, number, number][] = [
    [18, 12, 6, 5],   // the default
    [6, 4, 2, 2],     // as small as it goes
    [60, 40, 12, 20], // chunky
    [9, 25, 3, 20],   // deep and narrow: very little material at the front
    [80, 45, 20, 30],
    [10, 6, 4, 3],
  ]
  let checked = 0
  const broken: string[] = []
  for (const { id } of PROFILE_PRESETS) {
    for (const [w, d, rw, rd] of shapes) {
      for (const relief of [0, 0.25, 0.5, 0.75, 1]) {
        checked++
        const params = normaliseParams({ width: w, depth: d, rabbetWidth: rw, rabbetDepth: rd, relief })
        const pts = buildProfile(id, params, 2).map((q) => [q.u, q.v])
        const outside = pts.some(
          (q) => q[0] < -1e-6 || q[0] > params.width + 1e-6 || q[1] < -1e-6 || q[1] > params.depth + 1e-6,
        )
        let self = 0
        for (let i = 0; i < pts.length; i++) {
          for (let j = i + 2; j < pts.length; j++) {
            if (i === 0 && j === pts.length - 1) continue
            if (crosses(pts[i], pts[(i + 1) % pts.length], pts[j], pts[(j + 1) % pts.length])) self++
          }
        }
        if (outside || self) {
          broken.push(`${id} ${w}×${d} rabbet ${rw}×${rd} relief ${relief}${self ? ` (self ×${self})` : ''}${outside ? ' (outside)' : ''}`)
        }
      }
    }
  }
  check(`all ${checked} profile × proportion × relief combinations are simple and in bounds`,
    broken.length === 0, broken.slice(0, 5).join('; '))
}

// ---------------------------------------------------------------------------
// Face patterns. A frame closes on itself, so the height field has to meet
// itself exactly where it does — and the angle control has to actually turn
// every pattern, not just the ones that happened to read it.
// ---------------------------------------------------------------------------
{
  for (const perimeter of [400, 914.4, 3048]) {
    const seams: string[] = []
    const ignored: string[] = []
    for (const { id } of FACE_PATTERNS) {
      if (id === 'none') continue
      const flat = createDisplacer({ pattern: id, depth: 0.6, scale: 6, angle: 0 }, perimeter)!
      let worst = 0
      for (let u = 0.5; u < 24; u += 0.25) worst = Math.max(worst, Math.abs(flat(0, u) - flat(perimeter, u)))
      if (worst > 1e-6) seams.push(`${id} ${worst.toFixed(4)}`)

      const turned = createDisplacer({ pattern: id, depth: 0.6, scale: 6, angle: 35 }, perimeter)!
      let moved = 0
      for (let i = 0; i < 300; i++) moved += Math.abs(flat((i / 300) * perimeter, (i % 17) + 1) - turned((i / 300) * perimeter, (i % 17) + 1))
      if (moved / 300 < 1e-4) ignored.push(id)
    }
    check(`patterns meet themselves round a ${perimeter} mm frame`, seams.length === 0, seams.join(', '))
    check(`every pattern responds to the angle at ${perimeter} mm`, ignored.length === 0, ignored.join(', '))
  }
}

// ---------------------------------------------------------------------------
// Full pipeline: split, joints, text, accessories and the exporters.
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs'
import opentype from 'opentype.js'
import { buildFrame } from '../src/core/frame.ts'
import { DEFAULT_CONFIG, PRINTERS, SIZE_PRESETS } from '../src/core/presets.ts'
import { ARTWORK_CLEARANCE_MM, holdsArtwork, sightOf, sightSize } from '../src/core/sizing.ts'
import { encodeStl, encodeCombinedStl } from '../src/core/export/stl.ts'
import { encode3mf } from '../src/core/export/threemf.ts'
import { unzipSync, strFromU8 } from 'fflate'
import { encodeBundle } from '../src/core/export/bundle.ts'
import { weldVertices } from '../src/core/export/weld.ts'
import { convexHull, fitsOnPlate, minAreaRect } from '../src/core/geometry/packing.ts'
import { layoutOnPlate } from '../src/core/plateLayout.ts'
import { determinant, orientForPrint } from '../src/core/print.ts'
import type { FrameConfig } from '../src/core/types.ts'

const nodeFont = (id: string) => {
  const buf = readFileSync(`src/fonts/${id}.woff`)
  return Promise.resolve(opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)))
}
const deps = { kernel: wasm, loadFont: nodeFont }

function partsAreSolid(label: string, result: Awaited<ReturnType<typeof buildFrame>>) {
  let bad: string[] = []
  const mirrored: string[] = []
  const inverted: string[] = []
  for (const part of result.parts) {
    // The exporters ship print orientation, so that is what has to be valid.
    // A reflected transform mirrors the part and turns every face inward.
    const rotation = [
      part.print[0], part.print[1], part.print[2],
      part.print[4], part.print[5], part.print[6],
      part.print[8], part.print[9], part.print[10],
    ]
    if (determinant(rotation) <= 0) mirrored.push(part.name)
    const printed = weldVertices(orientForPrint(part))
    try {
      const m = Manifold.ofMesh(new Mesh({ numProp: 3, vertProperties: printed.vertices, triVerts: printed.indices }))
      if (m.status() !== 'NoError' || m.volume() <= 0) inverted.push(`${part.name}: ${m.status()} vol=${m.volume().toFixed(1)}`)
    } catch (e) {
      inverted.push(`${part.name}: ${(e as Error).message}`)
    }

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
  check(`${label}: no part is exported mirrored`, mirrored.length === 0, mirrored.join(', '))
  check(`${label}: every part is solid as exported`, inverted.length === 0, inverted.join('; '))
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
  check('poster frame is split into many segments', segs > 8, `${segs} segments`)
  check('snap joints leave no loose parts', r.parts.every((q) => q.kind !== 'snapkit'))
  // The whole promise of the app: every printable part must actually fit, in
  // the orientation it is exported in.
  const oversize = r.parts.filter((part) => {
    const pos = orientForPrint(part)
    const hull: [number, number][] = []
    let tall = 0
    for (let i = 0; i < pos.length; i += 3) {
      hull.push([pos[i], pos[i + 1]])
      if (pos[i + 2] > tall) tall = pos[i + 2]
    }
    const rect = minAreaRect(hull)
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
    accessories: { clips: true, easel: true, hanger: true, backer: true },
    joint: { style: 'key', tolerance: 0.18 },
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

  const mf = encode3mf(r.parts, 'Test', cfg.plate)
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

    const escaped = layout.placements.filter((q) => {
      const cos = Math.cos(q.angle)
      const sin = Math.sin(q.angle)
      for (let i = 0; i < q.positions.length; i += 3) {
        const x = q.positions[i] * cos - q.positions[i + 1] * sin + q.offset[0]
        const y = q.positions[i] * sin + q.positions[i + 1] * cos + q.offset[1]
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


// ---------------------------------------------------------------------------
// Joints must stay inside the moulding.
//
// A key set perpendicular to a mitre travels diagonally across the rail, so it
// drifts toward the outer edge as it reaches into each segment. Get that wrong
// and the keys stand proud of the frame while their pockets open holes in its
// sides. Assembling the kit and subtracting the frame it was cut from catches
// both at once: the remainder must be nothing.
// ---------------------------------------------------------------------------
{
  const nominal = (cfg: FrameConfig) => {
    const params = normaliseParams(cfg.profile)
    const profile = buildProfile(cfg.profilePreset, params, cfg.quality)
    // The swept opening is the sight, which the interior and rabbet determine.
    const path = buildOpeningPath(cfg.shape, ...sightOf(cfg), cfg.quality)
    const frames = miterFrames(path.points)
    const { at } = pathLengths(path.points)
    const raw = sweep({ points: path.points, frames, arc: at, profile, faceStart: 3, displacer: null, closed: true })
    return Manifold.ofMesh(new Mesh({ numProp: 3, vertProperties: raw.vertProperties, triVerts: raw.triVerts }))
  }

  const cases: [string, Partial<FrameConfig>][] = [
    ['rectangle, classic', {}],
    ['rectangle, gallery', { profilePreset: 'gallery' }],
    ['rectangle, narrow moulding', { profile: { width: 9, depth: 8, rabbetWidth: 3, rabbetDepth: 3, relief: 0.75 } }],
    ['hexagon', { shape: 'hexagon' }],
    ['octagon, scoop', { shape: 'octagon', profilePreset: 'scoop' }],
    ['circle', { shape: 'circle', interiorHeight: 203.2 }],
    ['with spring clip slots', { accessories: { clips: true, easel: false, hanger: false, backer: false } }],
    ['poster, split many ways', {
      interiorWidth: 610, interiorHeight: 914,
      plate: { printer: 'bambu-a1-mini', x: 180, y: 180, z: 180, smartOrientation: true },
    }],
  ]

  for (const [label, patch] of cases) {
    // No surface relief: it resamples with the path, so the nominal solid would
    // not be bit-for-bit comparable.
    const cfg: FrameConfig = { ...DEFAULT_CONFIG, face: { ...DEFAULT_CONFIG.face, pattern: 'none' }, ...patch }
    const r = await buildFrame(cfg, deps)
    const kit = r.parts.filter((p) => p.kind === 'frame' || p.kind === 'snapkit')
    const assembled = kit
      .map((part) => {
        const { vertices, indices } = weldVertices(part.positions)
        return Manifold.ofMesh(new Mesh({ numProp: 3, vertProperties: vertices, triVerts: indices }))
      })
      .reduce((a, b) => a.add(b))

    const frame = nominal(cfg)
    const outside = assembled.subtract(frame).volume()
    const ratio = outside / frame.volume()
    check(`${label}: nothing sits outside the moulding`, ratio < 1e-4,
      `${outside.toFixed(1)} mm³ outside (${(ratio * 100).toFixed(2)}%)`)

    // And the joints must not have eaten more than their clearances. The lower
    // bound matters as much as the upper one: a kit *larger* than the frame it
    // came from means something is inside out.
    const missing = (frame.volume() - assembled.volume()) / frame.volume()
    // What is missing should be nothing but joint clearances and clip slots.
    check(`${label}: the kit still reassembles into the frame`, missing >= -1e-4 && missing < 0.035,
      `${(missing * 100).toFixed(2)}% of the frame is missing`)
  }
}


// ---------------------------------------------------------------------------
// Fittings have to sit where they claim to. The backing panel and hanger must
// occupy voids in the frame rather than clash with it, the retainer bars must
// actually span the rabbet, and nothing but the stand's slot lip may come round
// to the front of the picture.
// ---------------------------------------------------------------------------
{
  const cfg: FrameConfig = {
    ...DEFAULT_CONFIG,
    face: { ...DEFAULT_CONFIG.face, pattern: 'none' },
    accessories: { clips: true, easel: true, hanger: true, backer: true },
  }
  const r = await buildFrame(cfg, deps)
  const p = cfg.profile
  const solid = (part: (typeof r.parts)[number]) => {
    const { vertices, indices } = weldVertices(part.positions)
    return Manifold.ofMesh(new Mesh({ numProp: 3, vertProperties: vertices, triVerts: indices }))
  }
  const frame = r.parts
    .filter((q) => q.kind === 'frame')
    .map(solid)
    .reduce((a, b) => a.add(b))
  const named = (needle: string) => r.parts.filter((q) => q.name.includes(needle))

  for (const kind of ['Backing panel', 'Keyhole hanger', 'Desk stand']) {
    const clash = named(kind).map((q) => solid(q).intersect(frame).volume())
    check(`${kind} does not clash with the frame`, clash.every((v) => v < 1),
      clash.map((v) => v.toFixed(1) + ' mm³').join(', '))
  }

  for (const part of named('Backing panel').concat(named('Retainer bar'))) {
    check(`${part.name} stays inside the rabbet`,
      part.bounds.min[2] >= -0.01 && part.bounds.max[2] <= p.rabbetDepth + 0.01,
      `z ${part.bounds.min[2].toFixed(1)}..${part.bounds.max[2].toFixed(1)}, rabbet is ${p.rabbetDepth}`)
  }

  // The bars only work if they are longer than the gap they wedge into.
  const rabbetSpan = cfg.interiorWidth + 2 * p.rabbetWidth
  for (const bar of named('Retainer bar')) {
    const over = bar.bounds.max[0] - bar.bounds.min[0] - rabbetSpan
    check(`${bar.name} spans the rabbet with interference`, over > 0.1 && over < 2,
      `${over.toFixed(2)} mm over a ${rabbetSpan.toFixed(1)} mm span`)
  }

  // Nothing may stand proud of the picture except the stand's slot lip.
  for (const part of r.parts) {
    const limit = part.name.startsWith('Desk stand') ? p.depth + 6 : p.depth + 0.01
    check(`${part.name} does not block the front of the picture`, part.bounds.max[2] <= limit,
      `reaches z ${part.bounds.max[2].toFixed(1)}, limit ${limit.toFixed(1)}`)
  }

  // A stand that sits in front of the frame would tip it over.
  for (const stand of named('Desk stand')) {
    const front = stand.bounds.max[2] - p.depth
    const back = -stand.bounds.min[2]
    check(`${stand.name} sits behind the frame`, back > front * 3,
      `${back.toFixed(1)} mm behind vs ${front.toFixed(1)} mm in front`)
    check(`${stand.name} grips the bottom rail`,
      stand.bounds.max[1] > -sightOf(cfg)[1] / 2 - p.width + 4 &&
        stand.bounds.max[1] < -sightOf(cfg)[1] / 2,
      `top at y ${stand.bounds.max[1].toFixed(1)}`)
  }

  // A spring clip is only useful if it plugs into its slot and reaches past the
  // rabbet onto the artwork.
  const fit = clipFit(p, cfg.artwork.thickness)!
  check('spring clip slots are proportioned for this moulding', !!fit)
  check('slot leaves a floor above the back face', fit.z0 - fit.depth * fit.tilt >= 0.5,
    `${(fit.z0 - fit.depth * fit.tilt).toFixed(2)} mm`)
  // The tang must sit clear behind the artwork, not inside it.
  check('slot clears the back of the artwork',
    fit.z0 + fit.height <= p.rabbetDepth - cfg.artwork.thickness,
    `slot tops out at ${(fit.z0 + fit.height).toFixed(2)}, artwork backs onto ${(p.rabbetDepth - cfg.artwork.thickness).toFixed(2)}`)
  // And the leaf must rest proud of the artwork, or it presses on nothing.
  const rest = fit.z0 + fit.thickness + fit.span * fit.tilt
  check('leaf rests one squeeze proud of the artwork',
    Math.abs(rest - (p.rabbetDepth - cfg.artwork.thickness) - fit.spring.squeeze) < 0.05,
    `rests at ${rest.toFixed(2)}, artwork backs onto ${(p.rabbetDepth - cfg.artwork.thickness).toFixed(2)}, squeeze ${fit.spring.squeeze.toFixed(2)}`)
  check('leaf stays under the working stress limit', fit.spring.stress <= STRESS_CEILING + 0.01,
    `${fit.spring.stress.toFixed(1)} MPa`)
  check('slot does not reach the outside of the moulding',
    p.rabbetWidth + fit.depth <= p.width - 1.4,
    `${(p.width - p.rabbetWidth - fit.depth).toFixed(1)} mm of wall left`)

  // Measured lying flat, since installed the clip is rotated into its slot and
  // its world-axis extents no longer mean length or thickness.
  for (const c of named('Spring clip')) {
    const pos = orientForPrint(c)
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (pos[i + k] < lo[k]) lo[k] = pos[i + k]
        if (pos[i + k] > hi[k]) hi[k] = pos[i + k]
      }
    }
    const size = hi.map((v, k) => v - lo[k])
    check(`${c.name} is thinner than its slot`, size[2] < fit.height,
      `${size[2].toFixed(2)} mm in a ${fit.height.toFixed(2)} mm slot`)
    check(`${c.name} reaches past the rabbet onto the artwork`, size[0] > p.rabbetWidth + fit.depth,
      `${size[0].toFixed(1)} mm long, rabbet + tang is ${(p.rabbetWidth + fit.depth).toFixed(1)} mm`)
  }
  check('there is a clip for every slot', named('Spring clip').length >= 4,
    `${named('Spring clip').length} clips`)

  // Each clip must sit in its own slot, not pile up at the origin, and must lie
  // flat again for printing.
  const clips = named('Spring clip')
  const stacked = clips.filter((a, i) =>
    clips.some((b, j) => j > i &&
      Math.abs(a.bounds.min[0] - b.bounds.min[0]) < 0.01 &&
      Math.abs(a.bounds.min[1] - b.bounds.min[1]) < 0.01),
  )
  check('clips are placed in their slots, not stacked', stacked.length === 0,
    `${stacked.length} share a position`)
  for (const c of clips) {
    const pos = orientForPrint(c)
    let lo = Infinity, hi = -Infinity
    for (let i = 2; i < pos.length; i += 3) {
      if (pos[i] < lo) lo = pos[i]
      if (pos[i] > hi) hi = pos[i]
    }
    check(`${c.name} lies flat to print`, Math.abs(hi - lo - fit.thickness) < 0.05,
      `stands ${(hi - lo).toFixed(2)} mm, leaf is ${fit.thickness.toFixed(2)} mm thick`)
  }

  const hanger = named('Keyhole hanger')[0]
  if (hanger) {
    const railLo = sightOf(cfg)[1] / 2
    check('Keyhole hanger fits within the top rail',
      hanger.bounds.min[1] >= railLo - 0.01 && hanger.bounds.max[1] <= railLo + p.width + 0.01,
      `y ${hanger.bounds.min[1].toFixed(1)}..${hanger.bounds.max[1].toFixed(1)}`)
  }
}


// ---------------------------------------------------------------------------
// Print orientation and joint assembly.
//
// A frame lying face up puts the rabbet ceiling out over thin air, so straight
// rails are turned onto their outer face. And a joint is only useful if it can
// actually be put together: nothing may have a cavity wider than its mouth
// unless something is able to flex.
// ---------------------------------------------------------------------------
{
  const rect: FrameConfig = { ...DEFAULT_CONFIG, face: { ...DEFAULT_CONFIG.face, pattern: 'none' } }
  const r = await buildFrame(rect, deps)

  check('no part of a straight frame needs support', r.parts.every((p) => !p.needsSupport))
  for (const part of r.parts.filter((p) => p.kind === 'frame')) {
    const pos = orientForPrint(part)
    let minZ = Infinity, maxZ = -Infinity, maxY = -Infinity
    for (let i = 2; i < pos.length; i += 3) {
      if (pos[i] < minZ) minZ = pos[i]
      if (pos[i] > maxZ) maxZ = pos[i]
    }
    for (let i = 1; i < pos.length; i += 3) if (pos[i] > maxY) maxY = pos[i]
    check(`${part.name} is seated on the bed`, Math.abs(minZ) < 1e-4, `min z ${minZ.toFixed(3)}`)
    // On its outer face the rail stands as tall as the moulding is wide, and is
    // only as deep as the moulding is thick — the giveaway that it was turned.
    check(`${part.name} prints on its outer face`,
      Math.abs(maxZ - rect.profile.width) < 0.6, `stands ${maxZ.toFixed(1)} mm, moulding is ${rect.profile.width} mm wide`)
  }

  // A curved frame cannot lie on its outer face, and should say so rather than
  // quietly producing a part that needs support nobody was told about.
  const round = await buildFrame(
    { ...rect, shape: 'circle', interiorWidth: 400, interiorHeight: 400 },
    deps,
  )
  check('curved runs are flagged as needing support',
    round.parts.some((p) => p.kind === 'frame' && p.needsSupport))
  check('and the notes say so', round.notes.some((n) => /support/i.test(n)))

  // The loose butterfly is only assemblable because its recess opens onto the
  // back face — pushed in edgewise it would jam, since the cavity is wider than
  // the mouth. Guard the property that makes it work.
  const keyed = await buildFrame({ ...rect, joint: { style: 'key', tolerance: 0.18 } }, deps)
  const butterflies = keyed.parts.filter((p) => p.kind === 'snapkit')
  check('butterfly keys exist for the key style', butterflies.length > 0)
  for (const key of butterflies) {
    check(`${key.name} drops in from the back face`, Math.abs(key.bounds.min[2]) < 0.01,
      `starts at z ${key.bounds.min[2].toFixed(2)}`)
  }
  check('snap joints leave nothing loose', r.parts.every((p) => p.kind !== 'snapkit'))

  // The face it lies on is the first layer, so it has to stay flat and full
  // width whatever relief is applied to the decorative face.
  for (const pattern of FACE_PATTERNS.map((f) => f.id)) {
    const textured = await buildFrame(
      { ...rect, face: { pattern, depth: 1.2, scale: 6, angle: 20 } },
      deps,
    )
    const rail = textured.parts.find((q) => q.kind === 'frame')!
    const pos = orientForPrint(rail)
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i + 2] < 1e-4) {
        if (pos[i + 1] < lo) lo = pos[i + 1]
        if (pos[i + 1] > hi) hi = pos[i + 1]
      }
    }
    check(`${pattern}: the rail sits on its full outer face`,
      Math.abs(hi - lo - rect.profile.depth) < 0.05,
      `contact patch ${(hi - lo).toFixed(2)} of ${rect.profile.depth} mm`)
  }

  // A snap is only a snap if the barb genuinely interferes with the socket
  // throat — and only assemblable if that interference is small enough for the
  // arms to absorb. Both halves are checked directly.
  const profile = buildProfile(rect.profilePreset, normaliseParams(rect.profile), rect.quality)
  for (const [what, scale] of [['mitre', Math.SQRT2], ['mid-rail', 1]] as [string, number][]) {
    const j = buildJoint([0, 0], { dir: [1, 0], scale }, profile, rect.joint)
    if (!j?.tenon || !j.mortise) {
      check(`${what} joint is built`, false)
      continue
    }
    check(`${what} joint has flexing arms`, j.snaps)
    const solidOf = (mesh: { vertProperties: Float32Array; triVerts: Uint32Array }) =>
      Manifold.ofMesh(new Mesh({ numProp: 3, vertProperties: mesh.vertProperties, triVerts: mesh.triVerts }))
    const tenon = solidOf(j.tenon)
    const socket = solidOf(j.mortise)
    check(`${what} tenon is not inside out`, tenon.volume() > 0, `${tenon.volume().toFixed(1)} mm³`)
    check(`${what} socket is not inside out`, socket.volume() > 0, `${socket.volume().toFixed(1)} mm³`)
    // Seated, the barb sits in its relief and the joint is free — that is what
    // lets the seam close fully rather than standing off on the barb.
    const seated = tenon.subtract(socket).volume() / tenon.volume()
    check(`${what} joint is free once seated`, seated < 0.001,
      `${(seated * 100).toFixed(2)}% of the tenon still fouls`)

    // Part way in, the barb has to be forced through the socket throat. Only
    // the material still inside the socket's own envelope counts — the rest of
    // the tenon is simply not in the hole yet.
    // n = (dir.y, −dir.x) = (0, −1) here, so backing out is +Y.
    const bb = socket.boundingBox()
    const envelope = Manifold.cube(
      [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]],
    ).translate(bb.min)
    const entering = tenon.translate(0, j.size.length * 0.35, 0).intersect(envelope)
    const foul = entering.subtract(socket).volume() / entering.volume()
    check(`${what} barb has to be forced through the throat`, foul > 0.005,
      `${(foul * 100).toFixed(2)}% of the entering section`)
    check(`${what} that interference is small enough to flex past`, foul < 0.25,
      `${(foul * 100).toFixed(2)}% of the entering section`)
  }
}


// ---------------------------------------------------------------------------
// The 3MF has to open as an arrangement, not a heap. Every object's geometry is
// centred on its own origin, so without a per-item transform they all land on
// top of each other at the bed origin.
// ---------------------------------------------------------------------------
{
  const cfg: FrameConfig = {
    ...DEFAULT_CONFIG,
    interiorWidth: 610, interiorHeight: 914,
    plate: { printer: 'custom', x: 200, y: 250, z: 250, smartOrientation: true },
    accessories: { easel: true, hanger: true, backer: true },
  }
  const r = await buildFrame(cfg, deps)
  const files = unzipSync(encode3mf(r.parts, 'Layout test', cfg.plate))
  const model = strFromU8(files['3D/3dmodel.model'])

  const items = [...model.matchAll(/<item objectid="(\d+)"(?: transform="([^"]*)")?\/>/g)]
  check('3MF has one build item per part', items.length === r.parts.length,
    `${items.length} items for ${r.parts.length} parts`)
  check('every build item is positioned', items.every((m) => m[2]),
    `${items.filter((m) => !m[2]).length} items have no transform`)

  // Place each part's bounding box by its item transform and check nothing
  // shares space with anything else.
  const boxes = items.map((m, i) => {
    const t = m[2].split(/\s+/).map(Number)
    const pos = orientForPrint(r.parts[i])
    const pts: [number, number][] = []
    let lo: [number, number] = [Infinity, Infinity]
    for (let k = 0; k < pos.length; k += 3) {
      // Row-vector convention: v' = v · M, translation in the last row.
      const x = pos[k] * t[0] + pos[k + 1] * t[3] + pos[k + 2] * t[6] + t[9]
      const y = pos[k] * t[1] + pos[k + 1] * t[4] + pos[k + 2] * t[7] + t[10]
      pts.push([x, y])
      lo = [Math.min(lo[0], x), Math.min(lo[1], y)]
    }
    return { name: r.parts[i].name, lo, hull: convexHull(pts) }
  })

  // Axis-aligned boxes are useless here — parallel diagonal bars have heavily
  // overlapping AABBs while sitting comfortably side by side. Test the convex
  // hulls with the separating axis theorem instead.
  const separated = (a: [number, number][], b: [number, number][]) => {
    for (const poly of [a, b]) {
      for (let i = 0; i < poly.length; i++) {
        const p1 = poly[i]
        const p2 = poly[(i + 1) % poly.length]
        const nx = -(p2[1] - p1[1])
        const ny = p2[0] - p1[0]
        const span = (pts: [number, number][]) => {
          let lo = Infinity, hi = -Infinity
          for (const q of pts) {
            const d = q[0] * nx + q[1] * ny
            if (d < lo) lo = d
            if (d > hi) hi = d
          }
          return [lo, hi]
        }
        const [aLo, aHi] = span(a)
        const [bLo, bHi] = span(b)
        if (aHi <= bLo + 1e-6 || bHi <= aLo + 1e-6) return true
      }
    }
    return false
  }

  const clashes: string[] = []
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (!separated(boxes[i].hull, boxes[j].hull)) clashes.push(`${boxes[i].name} / ${boxes[j].name}`)
    }
  }
  check('no two 3MF objects overlap', clashes.length === 0, clashes.slice(0, 4).join(', '))
  check('3MF objects sit in the positive quadrant',
    boxes.every((b) => b.lo[0] > -1 && b.lo[1] > -1),
    boxes.filter((b) => b.lo[0] <= -1 || b.lo[1] <= -1).map((b) => b.name).join(', '))
}


// ---------------------------------------------------------------------------
// The artwork thickness has to be honoured, not merely accepted. Whatever goes
// in the frame, the clip must end up behind it, resting a full squeeze proud so
// that fitting the artwork loads the spring — the failure being guarded against
// is a clip positioned where the backing already is.
// ---------------------------------------------------------------------------
{
  for (const thickness of [0.3, 1, 2, 3, 4.5, 6, 10]) {
    const probe = normaliseParams({ ...DEFAULT_CONFIG.profile, rabbetDepth: 6 })
    const needed = minimumRabbetDepth(probe, thickness)
    const rabbetDepth = Math.ceil(needed * 2) / 2
    const params = normaliseParams({
      ...DEFAULT_CONFIG.profile,
      depth: rabbetDepth + 2,
      rabbetDepth,
    })
    const fit = clipFit(params, thickness)
    if (!fit) {
      check(`${thickness} mm artwork: a clip fits`, false, `no fit at ${rabbetDepth} mm rabbet`)
      continue
    }
    const back = params.rabbetDepth - thickness
    const rest = fit.z0 + fit.thickness + fit.span * fit.tilt
    check(`${thickness} mm artwork: clip sits behind it`,
      fit.z0 + fit.height <= back + 1e-6,
      `slot tops out at ${(fit.z0 + fit.height).toFixed(2)}, artwork backs onto ${back.toFixed(2)}`)
    check(`${thickness} mm artwork: leaf presses on it`,
      Math.abs(rest - back - fit.spring.squeeze) < 0.05,
      `rests at ${rest.toFixed(2)}, wanted ${(back + fit.spring.squeeze).toFixed(2)}`)
    check(`${thickness} mm artwork: spring within its stress limit`,
      fit.spring.stress <= STRESS_CEILING + 0.01, `${fit.spring.stress.toFixed(1)} MPa`)
  }

  // And the stated minimum has to be honest: one notch under it must not fit.
  const params = normaliseParams({ ...DEFAULT_CONFIG.profile, depth: 30, rabbetDepth: 6 })
  const needed = minimumRabbetDepth(params, 4.5)
  const tooShallow = normaliseParams({ ...DEFAULT_CONFIG.profile, depth: 30, rabbetDepth: needed - 0.4 })
  check('the stated minimum rabbet is the real minimum', clipFit(tooShallow, 4.5) === null,
    `a ${(needed - 0.4).toFixed(1)} mm rabbet was accepted when ${needed.toFixed(1)} mm was claimed`)
}


// ---------------------------------------------------------------------------
// A frame has to hold the artwork it was built for.
//
// The interior is the pocket the artwork drops into, so the artwork must be
// smaller than it — and larger than the sight opening, or nothing covers its
// edges and it drops straight out of the back. Asking for the sight size
// instead is the trap this guards: a 200 x 250 print entered as a 200 x 250
// sight leaves a 212 x 262 pocket and falls through.
// ---------------------------------------------------------------------------
{
  for (const preset of SIZE_PRESETS) {
    const artwork: [number, number] = [preset.w - ARTWORK_CLEARANCE_MM, preset.h - ARTWORK_CLEARANCE_MM]
    for (const rabbetWidth of [3, 6, 12]) {
      const held =
        holdsArtwork(preset.w, rabbetWidth, artwork[0]) &&
        holdsArtwork(preset.h, rabbetWidth, artwork[1])
      check(`${preset.label} artwork is held at a ${rabbetWidth} mm rabbet`, held,
        `sight ${sightSize(preset.w, rabbetWidth).toFixed(1)} × ${sightSize(preset.h, rabbetWidth).toFixed(1)}, artwork ${artwork.map((v) => v.toFixed(1)).join(' × ')}`)
    }
  }

  // The sight the geometry actually produces must match what the panel promises.
  const cfg: FrameConfig = { ...DEFAULT_CONFIG, interiorWidth: 200.2, interiorHeight: 250.2 }
  const r = await buildFrame(cfg, deps)
  const [sw, sh] = sightOf(cfg)
  const expected: [number, number] = [sw + 2 * cfg.profile.width, sh + 2 * cfg.profile.width]
  check('the built frame matches the promised sight opening',
    Math.abs(r.outerSize[0] - expected[0]) < 0.05 && Math.abs(r.outerSize[1] - expected[1]) < 0.05,
    `outer ${r.outerSize.map((v) => v.toFixed(1)).join(' × ')}, expected ${expected.map((v) => v.toFixed(1)).join(' × ')}`)
  check('a 200 × 250 print is held by a 200.2 × 250.2 interior',
    holdsArtwork(200.2, cfg.profile.rabbetWidth, 200) && holdsArtwork(250.2, cfg.profile.rabbetWidth, 250))
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
