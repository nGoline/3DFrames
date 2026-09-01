import Module from 'manifold-3d'
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import type { Kernel } from './manifold.ts'

let pending: Promise<Kernel> | null = null

/**
 * Load the Manifold WASM kernel in the browser, once per session.
 *
 * Manifold performs every boolean in the pipeline and guarantees the result is
 * a closed, self-intersection-free solid — the difference between an STL a
 * slicer accepts and one it silently mangles.
 */
export function loadManifold(): Promise<Kernel> {
  pending ??= Module({ locateFile: () => wasmUrl }).then((wasm) => {
    wasm.setup()
    return wasm
  })
  return pending
}
