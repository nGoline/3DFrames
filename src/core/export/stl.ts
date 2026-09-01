import type { Part } from '../types.ts'

/**
 * Binary STL: an 80-byte header, a triangle count, then 50 bytes per facet.
 *
 * Normals are written out properly rather than zeroed — some older slicers and
 * most mesh repair tools still use them to infer facet orientation.
 */
export function encodeStl(positions: Float32Array, header = '3DFrames'): ArrayBuffer {
  const triangles = positions.length / 9
  const buffer = new ArrayBuffer(84 + triangles * 50)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  const label = `${header} — github.com/nGoline/3DFrames`.slice(0, 79)
  for (let i = 0; i < label.length; i++) bytes[i] = label.charCodeAt(i) & 0x7f
  view.setUint32(80, triangles, true)

  let offset = 84
  for (let t = 0; t < triangles; t++) {
    const i = t * 9
    const ax = positions[i], ay = positions[i + 1], az = positions[i + 2]
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5]
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8]

    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len; ny /= len; nz /= len

    view.setFloat32(offset, nx, true)
    view.setFloat32(offset + 4, ny, true)
    view.setFloat32(offset + 8, nz, true)
    for (let k = 0; k < 9; k++) view.setFloat32(offset + 12 + k * 4, positions[i + k], true)
    view.setUint16(offset + 48, 0, true)
    offset += 50
  }
  return buffer
}

/** One STL holding every part, in assembled position. */
export function encodeCombinedStl(parts: Part[]): ArrayBuffer {
  const total = parts.reduce((sum, p) => sum + p.positions.length, 0)
  const merged = new Float32Array(total)
  let at = 0
  for (const part of parts) {
    merged.set(part.positions, at)
    at += part.positions.length
  }
  return encodeStl(merged, '3DFrames assembly')
}
