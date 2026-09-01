/**
 * Collapse a triangle soup back into an indexed mesh.
 *
 * The generator works in soup form because that is what the renderer wants, but
 * writing soup into a 3MF triples the file size and leaves the mesh formally
 * non-manifold. Welding on a 1 µm lattice restores shared vertices exactly, as
 * the geometry was built from shared vertices to begin with.
 */
export function weldVertices(positions: Float32Array): {
  vertices: Float32Array
  indices: Uint32Array
} {
  const map = new Map<string, number>()
  const vertices: number[] = []
  const indices = new Uint32Array(positions.length / 3)

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]
    const y = positions[i + 1]
    const z = positions[i + 2]
    const key = `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`
    let index = map.get(key)
    if (index === undefined) {
      index = vertices.length / 3
      vertices.push(x, y, z)
      map.set(key, index)
    }
    indices[i / 3] = index
  }
  return { vertices: new Float32Array(vertices), indices }
}
