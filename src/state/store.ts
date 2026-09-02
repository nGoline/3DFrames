import { create } from 'zustand'
import type { BuildResult, FrameConfig } from '../core/types.ts'
import { DEFAULT_CONFIG } from '../core/presets.ts'
import { configFrom, type Design } from '../core/design.ts'
import { buildFrame } from '../core/frame.ts'
import { buildCoupon } from '../core/coupon.ts'
import { encode3mf } from '../core/export/threemf.ts'
import { download } from '../core/export/download.ts'
import { loadManifold } from '../core/manifoldLoader.ts'
import { loadFont } from '../fontLoader.ts'
import { buildOpeningPath, miterFrames, pathLengths } from '../core/shapes.ts'
import { buildProfile, normaliseParams } from '../core/profiles.ts'
import { sightSize } from '../core/sizing.ts'
import { minimumRabbetDepth } from '../core/geometry/accessories.ts'
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
  setArtwork: (thickness: number) => void
  setFace: (patch: Partial<FrameConfig['face']>) => void
  setText: (patch: Partial<FrameConfig['text']>) => void
  setPlate: (patch: Partial<FrameConfig['plate']>) => void
  setAccessory: (key: keyof FrameConfig['accessories'], value: boolean) => void
  toggleVisible: (kind: string) => void
  /** Apply a saved design, keeping the printer already selected. */
  load: (design: Design) => void
  generate: () => Promise<void>
  /** Build and download the test piece for the current design. */
  testPiece: () => Promise<void>
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
  const path = buildOpeningPath(
      config.shape,
      sightSize(config.interiorWidth, params.rabbetWidth),
      sightSize(config.interiorHeight, params.rabbetWidth),
      config.quality,
    )
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

  /**
   * Changing what goes in the frame carries the rabbet with it. Leaving the
   * rabbet where it was would silently invalidate the number just typed — the
   * clip would have nowhere to sit, which is the failure this exists to stop.
   */
  setArtwork: (thickness) => {
    const config = get().config
    const profile = { ...config.profile, rabbetDepth: config.profile.rabbetDepth }
    const needed = minimumRabbetDepth(normaliseParams(profile), thickness, config.joint.tolerance)
    const rabbetDepth = Math.max(profile.rabbetDepth, Math.ceil(needed * 2) / 2)
    // The moulding has to stay thick enough to have that rabbet cut into it.
    const depth = Math.max(profile.depth, Math.ceil((rabbetDepth + 1.5) * 2) / 2)
    set(withPreview({ ...config, artwork: { thickness }, profile: { ...profile, rabbetDepth, depth } }))
  },
  setFace: (patch) => set(withPreview({ ...get().config, face: { ...get().config.face, ...patch } })),
  setText: (patch) => set(withPreview({ ...get().config, text: { ...get().config.text, ...patch } })),
  setPlate: (patch) => set(withPreview({ ...get().config, plate: { ...get().config.plate, ...patch } })),
  setAccessory: (key, value) =>
    set(withPreview({ ...get().config, accessories: { ...get().config.accessories, [key]: value } })),

  toggleVisible: (kind) => set({ visible: { ...get().visible, [kind]: !get().visible[kind] } }),

  // The build plate belongs to the machine, not the design, so it survives.
  load: (design) => set({ ...withPreview(configFrom(design, get().config.plate)), result: null }),

  /**
   * A corner of the current design, downloadable without generating the whole
   * frame first — which is the point of it. Checking the fit should not require
   * committing to the print you are checking.
   */
  testPiece: async () => {
    set({ status: 'working', error: null })
    try {
      const kernel = await loadManifold()
      const config = get().config
      const coupon = await buildCoupon(config, { kernel, loadFont })
      download(
        encode3mf(coupon.parts, '3DFrames test piece', config.plate),
        'test-piece.3mf',
        'model/3mf',
      )
      set({ status: get().result ? 'ready' : 'idle' })
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'The test piece could not be built.',
      })
    }
  },

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
