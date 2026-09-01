import { zipSync, strToU8 } from 'fflate'
import type { Part } from '../types.ts'
import { weldVertices } from './weld.ts'
import { orientForPrint } from '../print.ts'

const CORE_NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'

const escapeXml = (value: string) =>
  value.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!))

/**
 * Write a 3MF holding every part as its own coloured object.
 *
 * 3MF carries real units (millimetres, declared once) and per-object colour,
 * so a slicer opens the kit at the right size with the frame, joints and
 * accessories already distinguishable — none of which an STL can express.
 * Objects are written in their print orientation, ready to arrange and slice.
 */
export function encode3mf(parts: Part[], title: string): Uint8Array {
  const materials = parts
    .map((p, i) => `      <base name="${escapeXml(p.name)}" displaycolor="${toDisplayColor(p.color)}"/>${i === parts.length - 1 ? '' : ''}`)
    .join('\n')

  const objects = parts
    .map((part, i) => {
      const { vertices, indices } = weldVertices(orientForPrint(part))
      const verts: string[] = []
      for (let v = 0; v < vertices.length; v += 3) {
        verts.push(
          `        <vertex x="${fmt(vertices[v])}" y="${fmt(vertices[v + 1])}" z="${fmt(vertices[v + 2])}"/>`,
        )
      }
      const tris: string[] = []
      for (let t = 0; t < indices.length; t += 3) {
        tris.push(`        <triangle v1="${indices[t]}" v2="${indices[t + 1]}" v3="${indices[t + 2]}"/>`)
      }
      return [
        `    <object id="${i + 2}" type="model" pid="1" pindex="${i}" name="${escapeXml(part.name)}">`,
        '      <mesh>',
        '        <vertices>',
        verts.join('\n'),
        '        </vertices>',
        '        <triangles>',
        tris.join('\n'),
        '        </triangles>',
        '      </mesh>',
        '    </object>',
      ].join('\n')
    })
    .join('\n')

  const items = parts.map((_, i) => `    <item objectid="${i + 2}"/>`).join('\n')

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="${CORE_NS}">
  <metadata name="Title">${escapeXml(title)}</metadata>
  <metadata name="Application">3DFrames</metadata>
  <metadata name="LicenseTerms">CC0 — generated geometry, use freely</metadata>
  <resources>
    <basematerials id="1">
${materials}
    </basematerials>
${objects}
  </resources>
  <build>
${items}
  </build>
</model>
`

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`

  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rel0" Target="/3D/3dmodel.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`

  return zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(rels),
      '3D/3dmodel.model': strToU8(model),
    },
    { level: 6 },
  )
}

/** 3MF wants #RRGGBBAA. */
function toDisplayColor(hex: string): string {
  const clean = hex.replace('#', '').toUpperCase()
  return `#${clean.length === 6 ? clean : '888888'}FF`
}

const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString()
