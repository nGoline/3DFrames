import { zipSync, strToU8 } from 'fflate'
import type { BuildResult, FrameConfig, Part } from '../types.ts'
import { encode3mf } from './threemf.ts'
import { encodeCombinedStl, encodeStl } from './stl.ts'
import { formatSize } from '../units.ts'
import { orientForPrint } from '../print.ts'

const safe = (name: string) => name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()

/** A ZIP with one STL per part, a combined STL, a 3MF, and a printing guide. */
export function encodeBundle(result: BuildResult, config: FrameConfig, title: string): Uint8Array {
  const files: Record<string, Uint8Array> = {}

  const counts = new Map<string, number>()
  for (const part of result.parts) {
    const base = safe(part.name)
    const seen = counts.get(base) ?? 0
    counts.set(base, seen + 1)
    const name = seen ? `${base}-${seen + 1}` : base
    files[`stl/${name}.stl`] = new Uint8Array(encodeStl(orientForPrint(part), part.name))
  }

  // The assembled STL stays in assembled position — it is for looking at, not
  // for slicing.
  files['assembled.stl'] = new Uint8Array(encodeCombinedStl(result.parts))
  files['frame.3mf'] = encode3mf(result.parts, title)
  files['README.txt'] = strToU8(printingGuide(result, config, title))

  return zipSync(files, { level: 6 })
}

/** Whether anything in this kit actually needs support, and where. */
function supportLine(result: BuildResult): string {
  const needy = result.parts.filter((p) => p.needsSupport)
  if (!needy.length) return '  Supports    : none. Nothing here overhangs in its print orientation.'
  return `  Supports    : needed under the rabbet on ${needy.length} curved ${needy.length === 1 ? 'run' : 'runs'} only (${needy
    .map((p) => p.name)
    .join(', ')}). Everything else is support free.`
}

function printingGuide(result: BuildResult, config: FrameConfig, title: string): string {
  const byKind = (kind: Part['kind']) => result.parts.filter((p) => p.kind === kind)
  const lines = [
    title,
    '='.repeat(title.length),
    '',
    `Interior (sight) size : ${formatSize(config.interiorWidth, config.interiorHeight, config.unit)}`,
    `Outer size            : ${formatSize(result.outerSize[0], result.outerSize[1], config.unit)}`,
    `Moulding              : ${config.profilePreset}, ${config.profile.width.toFixed(1)} mm wide × ${config.profile.depth.toFixed(1)} mm thick`,
    `Rabbet                : ${config.profile.rabbetWidth.toFixed(1)} mm × ${config.profile.rabbetDepth.toFixed(1)} mm deep`,
    `Build plate           : ${config.plate.x} × ${config.plate.y} × ${config.plate.z} mm`,
    `Material              : ~${result.volumeCm3.toFixed(1)} cm³ (${(result.volumeCm3 * 1.24).toFixed(0)} g in PLA at 100% infill)`,
    '',
    'PARTS',
    '-----',
    ...result.parts.map((p) => {
      const size = p.bounds.max.map((v, i) => (v - p.bounds.min[i]).toFixed(1)).join(' × ')
      return `  ${p.name.padEnd(22)} ${size} mm`
    }),
    '',
    'PRINTING',
    '--------',
    '  Orientation : print each STL exactly as exported. Straight rails are',
    '                already turned onto their outer face, which is what keeps',
    '                the rabbet from becoming an overhang. Do not lay them',
    '                face up.',
    supportLine(result),
    '  Layer height: 0.2 mm is plenty for the frame; drop to 0.12 mm if you',
    '                chose a face texture and want the grain to read clearly.',
    '  Walls/infill: 3 perimeters and 15% infill is strong enough. Give the',
    '                joints 4 perimeters or more — they carry the whole seam.',
    '  Fit         : ' + config.joint.tolerance.toFixed(2) + ' mm clearance per side. If the seams will not',
    '                close, raise it and regenerate; if they feel loose, lower it.',
    '',
    'ASSEMBLY',
    '--------',
  ]

  if (result.parts.filter((p) => p.kind === 'frame').length < 2) {
    lines.push('  The frame prints in one piece — nothing to assemble.')
  } else if (byKind('snapkit').length) {
    lines.push(
      '  1. Lay the frame segments face down on a flat surface.',
      '  2. Push each pair of segments together until the mitre closes.',
      '  3. Drop a butterfly key into the recess that now spans each seam,',
      '     from the back. It should need a firm push. A drop of CA glue makes',
      '     it permanent; leave it dry if you may want to reprint a segment.',
    )
  } else {
    lines.push(
      '  1. Lay the frame segments face down on a flat surface.',
      '  2. Push each pair of segments together. The tenon squeezes through',
      '     the socket throat and clicks when it is home — you will feel it.',
      '  3. Work around the frame, checking it stays flat as you go. To take a',
      '     seam apart again, squeeze the tenon arms through the socket mouth.',
    )
  }

  if (config.accessories.backer) {
    lines.push(
      '  Drop the artwork in face down, then press the backing panel in from',
      '  the back until its rib clicks into the groove round the rabbet.',
    )
  }
  if (config.accessories.hanger) lines.push('  Glue the keyhole hanger centred on the back of the top rail.')
  if (config.accessories.easel) lines.push('  Slide the two desk stands onto the bottom rail.')

  if (result.warnings.length) {
    lines.push('', 'WARNINGS', '--------', ...result.warnings.map((w) => `  ! ${w}`))
  }

  lines.push(
    '',
    'Generated by 3DFrames — https://github.com/nGoline/3DFrames',
    'The generator is MIT licensed. Frames you make with it are yours.',
  )
  return lines.join('\n')
}
