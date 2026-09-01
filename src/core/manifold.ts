import type { ManifoldToplevel } from 'manifold-3d'
import type { RawMesh } from './geometry/mesh.ts'

/**
 * The Manifold WASM kernel, passed into the geometry pipeline rather than
 * imported by it. Loading is the host's job (see `manifoldLoader.ts` for the
 * browser), which keeps this module — and everything downstream of it —
 * runnable under plain Node for the smoke tests.
 */
export type Kernel = ManifoldToplevel

export const toManifold = (k: Kernel, raw: RawMesh) =>
  k.Manifold.ofMesh(new k.Mesh({ numProp: 3, vertProperties: raw.vertProperties, triVerts: raw.triVerts }))

export function fromManifold(m: {
  getMesh(): { vertProperties: Float32Array; triVerts: Uint32Array }
}): RawMesh {
  const mesh = m.getMesh()
  return { vertProperties: mesh.vertProperties, triVerts: mesh.triVerts }
}
