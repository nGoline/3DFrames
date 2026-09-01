import { create } from 'zustand'
import type { BuildResult, FrameConfig } from '../core/types.ts'
import { DEFAULT_CONFIG } from '../core/presets.ts'
import { buildFrame } from '../core/frame.ts'
import { loadManifold } from '../core/manifoldLoader.ts'
import { loadFont } from '../fontLoader.ts'
import { buildOpeningPath, miterFrames, pathLengths } from '../core/shapes.ts'
import { buildProfile, normaliseParams } from '../core/profiles.ts'
import { createDisplacer } from '../core/geometry/facePattern.ts'
import { sweep } from '../core/geometry/sweep.ts'
import { toTriangleSoup } from '../core/geometry/mesh.ts'

type Status = 'idle' | 'working' | 'ready' | 'error'

interface FrameStore {
  config: FrameConfig
  /** Instant single-piece preview, recomputed on every edit without the kernel. */
  preview: Float32Array | null
  /** The full kit, produced only when the user asks for it. */
  result: BuildResult | null
  /** True when the config has moved on since the last generate. */
  stale: boolean
  status: Status
  error: string | null
  /** Which part kinds are visible in the viewport. */
  visible: Record<string, boolean>

  set: (patch: Partial<FrameConfig>) => void
  setProfile: (patch: Partial<FrameConfig['profile']>) => void
  setFace: (patch: Partial<FrameConfig['face']>) => void
  setText: (patch: Partial<FrameConfig['text']>) => void
  setPlate: (patch: Partial<FrameConfig['plate']>) => void
  setAccessory: (key: keyof FrameConfig['accessories'], value: boolean) => void
  toggleVisible: (kind: string) => void
  generate: () => Promise<void>
}

/**
 * The preview path deliberately skips the WASM kernel: it sweeps the moulding
 * as one closed loop and nothing else. That is fast enough to run on every
 * slider frame, so the shape responds immediately while the expensive work —
 * splitting, pockets, booleans — waits for an explicit Generate.
 */
function computePreview(config: FrameConfig): Float32Array {
  const params = normaliseParams(config.profile)
  const profile = buildProfile(config.profilePreset, params, config.quality)
  const path = buildOpeningPath(config.shape, config.interiorWidth, config.interiorHeight, config.quality)
  const frames = miterFrames(path.points)
  const { at, total } = pathLengths(path.points)
  return toTriangleSoup(
    sweep({
      points: path.points,
      frames,
      arc: at,
      profile,
      faceStart: 3,
      displacer: createDisplacer(config.face, total),
      closed: true,
    }),
  )
}

const withPreview = (config: FrameConfig) => ({
  config,
  preview: computePreview(config),
  stale: true,
})

export const useFrameStore = create<FrameStore>((set, get) => ({
  config: DEFAULT_CONFIG,
  preview: computePreview(DEFAULT_CONFIG),
  result: null,
  stale: true,
  status: 'idle',
  error: null,
  visible: { frame: true, snapkit: true, accessory: true, backer: true },

  set: (patch) => set(withPreview({ ...get().config, ...patch })),
  setProfile: (patch) =>
    set(withPreview({ ...get().config, profile: { ...get().config.profile, ...patch } })),
  setFace: (patch) => set(withPreview({ ...get().config, face: { ...get().config.face, ...patch } })),
  setText: (patch) => set(withPreview({ ...get().config, text: { ...get().config.text, ...patch } })),
  setPlate: (patch) => set(withPreview({ ...get().config, plate: { ...get().config.plate, ...patch } })),
  setAccessory: (key, value) =>
    set(withPreview({ ...get().config, accessories: { ...get().config.accessories, [key]: value } })),

  toggleVisible: (kind) => set({ visible: { ...get().visible, [kind]: !get().visible[kind] } }),

  generate: async () => {
    set({ status: 'working', error: null })
    try {
      const kernel = await loadManifold()
      const result = await buildFrame(get().config, {
        kernel,
        loadFont,
      })
      set({ result, status: 'ready', stale: false })
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Something went wrong while generating.',
      })
    }
  },
}))
