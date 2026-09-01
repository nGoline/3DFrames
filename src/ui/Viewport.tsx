import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { BuildPlate, Part } from '../core/types.ts'
import type { PlateLayout } from './plateLayout.ts'

export type ViewMode = 'assembled' | 'plate'

/** Gap between plates when a kit needs more than one. */
export const PLATE_GAP = 40

interface Props {
  parts: Part[] | null
  preview: Float32Array | null
  plate: BuildPlate
  mode: ViewMode
  /** Precomputed bed arrangement; null in assembled view. */
  layout: PlateLayout | null
  /** Bumped by the caller to request a camera reframe. */
  fitToken: number
}

const PREVIEW_COLOR = '#c08a52'

export function Viewport({ parts, preview, plate, mode, layout, fitToken }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<THREE.Scene>()
  const camera = useRef<THREE.PerspectiveCamera>()
  const controls = useRef<OrbitControls>()
  const content = useRef<THREE.Group>()
  const plateGroup = useRef<THREE.Group>()

  // --- one-time scene setup ------------------------------------------------
  useEffect(() => {
    const el = host.current
    if (!el) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setSize(el.clientWidth, el.clientHeight)
    el.appendChild(renderer.domElement)

    const s = new THREE.Scene()
    s.background = new THREE.Color('#191c1f')
    scene.current = s

    const cam = new THREE.PerspectiveCamera(38, el.clientWidth / el.clientHeight, 1, 8000)
    cam.up.set(0, 0, 1)
    cam.position.set(320, -420, 380)
    camera.current = cam

    const orbit = new OrbitControls(cam, renderer.domElement)
    orbit.enableDamping = true
    orbit.dampingFactor = 0.08
    orbit.screenSpacePanning = true
    controls.current = orbit

    // A key light raking across the face, so surface relief actually reads.
    s.add(new THREE.HemisphereLight(0xdfe9ee, 0x20242a, 1.5))
    const key = new THREE.DirectionalLight(0xffffff, 2.1)
    key.position.set(-0.5, -1, 1.4)
    s.add(key)
    const fill = new THREE.DirectionalLight(0xbcd4e0, 0.7)
    fill.position.set(1, 0.7, 0.4)
    s.add(fill)

    const group = new THREE.Group()
    s.add(group)
    content.current = group

    const bed = new THREE.Group()
    s.add(bed)
    plateGroup.current = bed

    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      orbit.update()
      renderer.render(s, cam)
    }
    tick()

    const observer = new ResizeObserver(() => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (!w || !h) return
      cam.aspect = w / h
      cam.updateProjectionMatrix()
      renderer.setSize(w, h)
    })
    observer.observe(el)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      orbit.dispose()
      renderer.dispose()
      el.removeChild(renderer.domElement)
    }
  }, [])

  // --- build plates --------------------------------------------------------
  useEffect(() => {
    const bed = plateGroup.current
    if (!bed) return
    dispose(bed)
    const count = mode === 'plate' ? (layout?.plates ?? 1) : 1

    for (let i = 0; i < count; i++) {
      const shift = i * (plate.x + PLATE_GAP)

      // A grid at a 10 mm pitch, drawn to the real bed rectangle, so a part's
      // size can be read straight off the plate.
      const points: number[] = []
      const hx = plate.x / 2
      const hy = plate.y / 2
      for (let x = -hx; x <= hx + 0.001; x += 10) points.push(x, -hy, 0, x, hy, 0)
      for (let y = -hy; y <= hy + 0.001; y += 10) points.push(-hx, y, 0, hx, y, 0)
      const grid = new THREE.LineSegments(
        new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3)),
        new THREE.LineBasicMaterial({ color: 0x333a40 }),
      )
      grid.position.set(shift, 0, -0.2)
      grid.visible = mode === 'plate'
      bed.add(grid)

      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(plate.x, plate.y)),
        new THREE.LineBasicMaterial({ color: 0x4e7f96 }),
      )
      outline.position.set(shift, 0, -0.1)
      bed.add(outline)
    }
  }, [plate.x, plate.y, mode, layout])

  // --- geometry ------------------------------------------------------------
  useEffect(() => {
    const group = content.current
    if (!group) return
    dispose(group)

    if (parts?.length) {
      const placements = mode === 'plate' ? layout?.placements : null
      parts.forEach((part) => {
        const spot = placements?.find((q) => q.part === part)
        const mesh = meshFor(spot ? spot.positions : part.positions, part.color)
        mesh.name = part.name
        if (spot) {
          mesh.rotation.z = spot.angle
          mesh.position.set(
            spot.offset[0] + spot.plate * (plate.x + PLATE_GAP),
            spot.offset[1],
            spot.offset[2],
          )
          if (spot.overflow) (mesh.material as THREE.MeshStandardMaterial).color.set('#b8402b')
        }
        group.add(mesh)
      })
    } else if (preview?.length) {
      group.add(meshFor(preview, PREVIEW_COLOR))
    }
  }, [parts, preview, mode, plate, layout])

  // --- framing -------------------------------------------------------------
  useEffect(() => {
    const cam = camera.current
    const orbit = controls.current
    const group = content.current
    if (!cam || !orbit || !group) return

    const box = new THREE.Box3().setFromObject(group)
    if (box.isEmpty()) return
    const size = box.getSize(new THREE.Vector3())
    const centre = box.getCenter(new THREE.Vector3())
    const radius = Math.max(size.x, size.y, size.z) * 0.72
    const distance = radius / Math.tan((cam.fov * Math.PI) / 360) + radius

    orbit.target.copy(centre)
    cam.position.set(centre.x + distance * 0.45, centre.y - distance * 0.78, centre.z + distance * 0.62)
    cam.near = Math.max(1, distance / 200)
    cam.far = distance * 12
    cam.updateProjectionMatrix()
    orbit.update()
  }, [fitToken])

  return <div ref={host} style={{ position: 'absolute', inset: 0 }} />
}

function meshFor(positions: Float32Array, color: string): THREE.Mesh {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.04, flatShading: true }),
  )
}

function dispose(group: THREE.Group) {
  for (const child of [...group.children]) {
    group.remove(child)
    child.traverse((node) => {
      const mesh = node as THREE.Mesh
      mesh.geometry?.dispose()
      const material = mesh.material
      if (Array.isArray(material)) material.forEach((m) => m.dispose())
      else material?.dispose()
    })
  }
}
