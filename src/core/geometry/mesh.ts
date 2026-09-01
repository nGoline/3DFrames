/**
 * A minimal indexed triangle mesh, in exactly the layout manifold-3d wants for
 * `Manifold.ofMesh` — three floats per vertex, three indices per triangle.
 */
export interface RawMesh {
  vertProperties: Float32Array
  triVerts: Uint32Array
}

/** Incrementally accumulate vertices and triangles without pre-sizing arrays. */
export class MeshBuilder {
  private verts: number[] = []
  private tris: number[] = []

  addVertex(x: number, y: number, z: number): number {
    const index = this.verts.length / 3
    this.verts.push(x, y, z)
    return index
  }

  addTriangle(a: number, b: number, c: number): void {
    if (a === b || b === c || a === c) return
    this.tris.push(a, b, c)
  }

  /** Two triangles for a quad wound a → b → c → d. */
  addQuad(a: number, b: number, c: number, d: number): void {
    this.addTriangle(a, b, c)
    this.addTriangle(a, c, d)
  }

  get vertexCount(): number {
    return this.verts.length / 3
  }

  get triangleCount(): number {
    return this.tris.length / 3
  }

  build(): RawMesh {
    return {
      vertProperties: new Float32Array(this.verts),
      triVerts: new Uint32Array(this.tris),
    }
  }
}

/** Expand an indexed mesh into the flat triangle soup three.js renders from. */
export function toTriangleSoup(mesh: RawMesh): Float32Array {
  const out = new Float32Array(mesh.triVerts.length * 3)
  for (let i = 0; i < mesh.triVerts.length; i++) {
    const v = mesh.triVerts[i] * 3
    out[i * 3] = mesh.vertProperties[v]
    out[i * 3 + 1] = mesh.vertProperties[v + 1]
    out[i * 3 + 2] = mesh.vertProperties[v + 2]
  }
  return out
}

export function boundsOf(positions: Float32Array) {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const value = positions[i + k]
      if (value < min[k]) min[k] = value
      if (value > max[k]) max[k] = value
    }
  }
  if (!positions.length) return { min: [0, 0, 0] as [number, number, number], max: [0, 0, 0] as [number, number, number] }
  return { min, max }
}

/** Signed volume in mm³ of a closed triangle soup, via the divergence theorem. */
export function volumeOf(positions: Float32Array): number {
  let total = 0
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i], ay = positions[i + 1], az = positions[i + 2]
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5]
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8]
    total +=
      (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
  }
  return Math.abs(total)
}
