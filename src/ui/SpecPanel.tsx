import { useEffect, useState, type ReactNode } from 'react'
import { useFrameStore } from '../state/store.ts'
import { PRINTERS, SIZE_PRESETS, printerName, printersByBrand } from '../core/presets.ts'
import { PROFILE_PRESETS, buildProfile, normaliseParams } from '../core/profiles.ts'
import { clipFit, minimumRabbetDepth } from '../core/geometry/accessories.ts'
import { ARTWORK_CLEARANCE_MM, sightOf } from '../core/sizing.ts'
import { FRAME_SHAPES } from '../core/shapes.ts'
import { FACE_PATTERNS } from '../core/geometry/facePattern.ts'
import { FONTS } from '../core/geometry/text.ts'
import { formatSize, fromMm, toMm } from '../core/units.ts'
import { SectionDrawing } from './SectionDrawing.tsx'
import { Chips, Field, Slider, Switch } from './controls.tsx'
import type { FaceDesign, FrameShape, ProfilePreset, Unit } from '../core/types.ts'

/**
 * The configuration reads as a specification sheet rather than a wizard: each
 * row names one property of the moulding and shows its current value, so the
 * whole frame can be taken in at a glance and any row opened in any order.
 */
export function SpecPanel() {
  const config = useFrameStore((s) => s.config)
  const store = useFrameStore()
  const [open, setOpen] = useState<string | null>('size')
  const [pinned, setPinned] = usePinned()

  const params = normaliseParams(config.profile)
  const profile = buildProfile(config.profilePreset, params, config.quality)
  const presetLabel = PROFILE_PRESETS.find((p) => p.id === config.profilePreset)?.label ?? 'Custom'
  const printer = PRINTERS.find((p) => p.id === config.plate.printer)
  const artwork = Math.max(0, config.artwork.thickness)
  const clip = config.accessories.clips ? clipFit(params, artwork) : null
  const minRabbet = minimumRabbetDepth(params, artwork)
  const sight = sightOf({ ...config, profile: params })

  const toggle = (id: string) => setOpen((current) => (current === id ? null : id))
  const round = (mm: number) => Math.round(fromMm(mm, config.unit) * 100) / 100

  return (
    <aside className="spec">
      <div className="spec-head">
        <p className="eyebrow">Specification</p>
      </div>

      <SectionDrawing
        profile={profile}
        params={params}
        presetLabel={presetLabel}
        artwork={artwork}
        clip={clip}
        minRabbet={minRabbet}
        clipsWanted={config.accessories.clips}
        pinned={pinned}
        onPin={setPinned}
      />

      <Row id="printer" open={open} onToggle={toggle} label="Printer"
        value={`${printer && printer.id !== 'custom' ? printerName(printer) : 'Custom'} · ${config.plate.x} × ${config.plate.y} mm`}>
        <Field label="Build plate">
          <select
            value={config.plate.printer}
            onChange={(e) => {
              const preset = PRINTERS.find((p) => p.id === e.target.value)
              if (preset) store.setPlate({ printer: preset.id, x: preset.x, y: preset.y, z: preset.z })
            }}
          >
            <option value="custom">Custom size</option>
            {printersByBrand().map((group) => (
              <optgroup key={group.brand} label={group.brand}>
                {group.printers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} — {p.x} × {p.y} mm
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <div className="pair">
          <Field label="Width mm">
            <input type="number" min={80} max={800} value={config.plate.x}
              onChange={(e) => store.setPlate({ printer: 'custom', x: Number(e.target.value) || 180 })} />
          </Field>
          <span className="times">×</span>
          <Field label="Depth mm">
            <input type="number" min={80} max={800} value={config.plate.y}
              onChange={(e) => store.setPlate({ printer: 'custom', y: Number(e.target.value) || 180 })} />
          </Field>
        </div>
        <Switch
          checked={config.plate.smartOrientation}
          onChange={(v) => store.setPlate({ smartOrientation: v })}
          title="Smart orientation"
          note="Lets long segments sit diagonally on the bed, which usually means fewer pieces and fewer seams."
        />
      </Row>

      <Row id="shape" open={open} onToggle={toggle} label="Shape"
        value={FRAME_SHAPES.find((s) => s.id === config.shape)?.label ?? ''}>
        <Chips<FrameShape>
          label="Aperture shape"
          value={config.shape}
          options={FRAME_SHAPES.map((s) => ({ id: s.id, label: s.label }))}
          onChange={(shape) => {
            const locked = FRAME_SHAPES.find((s) => s.id === shape)?.locksAspect
            store.set(locked ? { shape, interiorHeight: config.interiorWidth } : { shape })
          }}
        />
      </Row>

      <Row id="size" open={open} onToggle={toggle} label="Interior size"
        value={formatSize(config.interiorWidth, config.interiorHeight, config.unit)}>
        <Field label="Units">
          <div className="chips">
            {(['in', 'mm'] as Unit[]).map((u) => (
              <button key={u} type="button" className="chip" aria-pressed={config.unit === u}
                onClick={() => store.set({ unit: u })}>
                {u === 'in' ? 'Inches' : 'Millimetres'}
              </button>
            ))}
          </div>
        </Field>
        <div className="pair">
          <Field label={`Width ${config.unit}`}>
            <input type="number" step={config.unit === 'in' ? 0.25 : 1} min={1}
              value={round(config.interiorWidth)}
              onChange={(e) => store.set({ interiorWidth: toMm(Number(e.target.value) || 1, config.unit) })} />
          </Field>
          <span className="times">×</span>
          <Field label={`Height ${config.unit}`}>
            <input type="number" step={config.unit === 'in' ? 0.25 : 1} min={1}
              value={round(config.interiorHeight)}
              onChange={(e) => store.set({ interiorHeight: toMm(Number(e.target.value) || 1, config.unit) })} />
          </Field>
        </div>
        <p className="hint">
          The pocket your artwork drops into — measure the artwork and add about{' '}
          {ARTWORK_CLEARANCE_MM} mm. The frame then covers{' '}
          {Math.round(params.rabbetWidth * 10) / 10} mm of each edge, leaving{' '}
          <b>{formatSize(sight[0], sight[1], config.unit)}</b> on show.
        </p>
        <Field label="Common artwork sizes">
          <div className="chips">
            {SIZE_PRESETS.map((p) => (
              <button key={p.id} type="button" className="chip"
                aria-pressed={Math.abs(p.w - config.interiorWidth) < 0.6 && Math.abs(p.h - config.interiorHeight) < 0.6}
                onClick={() => store.set({ interiorWidth: p.w, interiorHeight: p.h })}>
                {p.label}
              </button>
            ))}
          </div>
        </Field>
      </Row>

      <Row id="artwork" open={open} onToggle={toggle} label="Artwork"
        value={`${Math.round(artwork * 10) / 10} mm thick`}>
        <Slider label="Total thickness" value={config.artwork.thickness} min={0.2} max={25} step={0.1}
          onChange={(thickness) => store.setArtwork(thickness)}
          hint="Everything that goes in the rabbet, added up: the print, any mount board, glazing and the backing. The rabbet and the clips are sized around this, so it is worth measuring." />
        <div className="chips">
          {[
            ['Photo print', 0.3],
            ['Print + card', 2],
            ['+ mount board', 3.5],
            ['+ 2 mm acrylic', 5.5],
            ['Wooden back', 4.5],
          ].map(([label, mm]) => (
            <button key={label as string} type="button" className="chip"
              aria-pressed={Math.abs(config.artwork.thickness - (mm as number)) < 0.05}
              onClick={() => store.setArtwork(mm as number)}>
              {label}
            </button>
          ))}
        </div>
        <p className="hint">
          The rabbet has to be at least <b>{Math.round(minRabbet * 10) / 10} mm</b> deep to hold this
          and still leave the clip somewhere to sit behind it.
        </p>
      </Row>

      <Row id="profile" open={open} onToggle={toggle} label="Moulding"
        value={`${presetLabel} · ${params.width.toFixed(0)} × ${params.depth.toFixed(0)} mm`}>
        <Chips<ProfilePreset>
          label="Edge profile"
          value={config.profilePreset}
          options={PROFILE_PRESETS}
          onChange={(profilePreset) => store.set({ profilePreset })}
        />
        <Slider label="Face width" value={config.profile.width} min={6} max={80} step={0.5}
          onChange={(width) => store.setProfile({ width })}
          hint="How broad the frame looks from the front." />
        <Slider label="Thickness" value={config.profile.depth} min={4} max={45} step={0.5}
          onChange={(depth) => store.setProfile({ depth })} />
        <Slider label="Rabbet width" value={config.profile.rabbetWidth} min={1}
          max={Math.max(2, Math.min(params.width - 2, config.interiorWidth / 2 - 2))} step={0.5}
          onChange={(rabbetWidth) => store.setProfile({ rabbetWidth })}
          hint={`How much of the artwork the frame covers on each edge. More is more secure and shows less: at ${Math.round(params.rabbetWidth * 10) / 10} mm you see ${formatSize(sight[0], sight[1], config.unit)} of it.`} />
        <Slider label="Rabbet depth" value={config.profile.rabbetDepth}
          min={Math.round(minRabbet * 10) / 10}
          max={Math.max(minRabbet + 1, params.depth - 1.5)} step={0.5}
          onChange={(rabbetDepth) => store.setProfile({ rabbetDepth })}
          hint={`Room for the artwork and the clip behind it. Its minimum follows the ${Math.round(artwork * 10) / 10} mm of artwork above; raise the thickness there and this moves with it.`} />
        {config.profilePreset !== 'flat' && config.profilePreset !== 'custom' ? (
          <Slider label="Relief" value={config.profile.relief} min={0} max={1} step={0.05} suffix=""
            onChange={(relief) => store.setProfile({ relief })}
            hint="How pronounced the profile's shaping is." />
        ) : null}
      </Row>

      <Row id="face" open={open} onToggle={toggle} label="Face"
        value={FACE_PATTERNS.find((p) => p.id === config.face.pattern)?.label ?? 'Smooth'}>
        <Chips<FaceDesign['pattern']>
          label="Surface"
          value={config.face.pattern}
          options={FACE_PATTERNS}
          onChange={(pattern) => store.setFace({ pattern })}
        />
        {config.face.pattern !== 'none' ? (
          <>
            <p className="hint">
              The pattern is cut into the front of the moulding as real relief, so it survives
              into the print. It stops short of the outer edge, which is the face the rail is
              printed on.
            </p>
            <Slider label="How deep it is cut" value={config.face.depth} min={0.1} max={2} step={0.05}
              onChange={(depth) => store.setFace({ depth })}
              hint="Distance from the high points to the low ones. Cut inward, so the frame keeps its stated size. 0.4–0.8 mm reads clearly at a 0.2 mm layer height." />
            <Slider label="Spacing between features" value={config.face.scale} min={1} max={30} step={0.5}
              onChange={(scale) => store.setFace({ scale })}
              hint="How far apart the grain lines, flutes or weave sit. Smaller is finer and takes a lower layer height to print well." />
            <Slider label="Pattern angle" value={config.face.angle} min={0} max={90} step={1} suffix="°"
              onChange={(angle) => store.setFace({ angle })}
              hint="Turns the pattern across the face. 0° runs it along the moulding." />
          </>
        ) : null}
      </Row>

      <Row id="text" open={open} onToggle={toggle} label="Caption"
        value={config.text.content.trim() || 'None'}>
        <Field label="Text" hint="Left empty, no caption is cut.">
          <input type="text" value={config.text.content} maxLength={64} placeholder="e.g. Lisbon, 2025"
            onChange={(e) => store.setText({ content: e.target.value })} />
        </Field>
        {config.text.content.trim() ? (
          <>
            <Chips
              label="Face"
              value={config.text.font}
              options={FONTS.map((f) => ({ id: f.id, label: f.label, blurb: f.blurb }))}
              onChange={(font) => store.setText({ font })}
            />
            <Chips
              label="Cut"
              value={config.text.style}
              options={[
                { id: 'raised' as const, label: 'Raised', blurb: 'Stands proud of the face. Prints without support.' },
                { id: 'engraved' as const, label: 'Engraved', blurb: 'Cut into the face. Reads best in a contrasting filament change.' },
              ]}
              onChange={(style) => store.setText({ style })}
            />
            <Chips
              label="Placement"
              value={config.text.placement}
              options={[{ id: 'bottom' as const, label: 'Bottom rail' }, { id: 'top' as const, label: 'Top rail' }]}
              onChange={(placement) => store.setText({ placement })}
            />
            <Slider label="Cap height" value={config.text.size} min={3} max={Math.max(4, params.width * 0.8)} step={0.5}
              onChange={(size) => store.setText({ size })} />
            <Slider label={config.text.style === 'raised' ? 'Emboss height' : 'Engrave depth'}
              value={config.text.depth} min={0.2} max={3} step={0.1}
              onChange={(depth) => store.setText({ depth })} />
          </>
        ) : null}
      </Row>

      <Row id="fittings" open={open} onToggle={toggle} label="Fittings" value={fittingsSummary(config.accessories)}>
        <Switch checked={config.accessories.clips} onChange={(v) => store.setAccessory('clips', v)}
          title="Spring clips" note="Sprung strips that push into slots in the rabbet and press the artwork forward. Works with any backing — printed, card or foamboard — and at any frame size. Adds the slots to the frame." />
        <Switch checked={config.accessories.backer} onChange={(v) => store.setAccessory('backer', v)}
          title="Snap-in back" note="A panel that presses in from behind and clicks into a groove round the rabbet, holding the artwork forward. Adds the groove to the frame." />
        <Switch checked={config.accessories.hanger} onChange={(v) => store.setAccessory('hanger', v)}
          title="Keyhole hanger" note="A plate for the back of the top rail, to hang on a single screw." />
        <Switch checked={config.accessories.easel} onChange={(v) => store.setAccessory('easel', v)}
          title="Desk stands" note="A pair of slotted feet the bottom rail drops into." />

        <hr style={{ border: 0, borderTop: '1px solid var(--rule)', margin: '4px 0' }} />

        <Chips
          label="Seam joint"
          value={config.joint.style}
          options={[
            { id: 'snap' as const, label: 'Snap fit', blurb: 'A barbed tenon moulded onto one segment clicks into a socket in the next. No loose parts and no glue.' },
            { id: 'key' as const, label: 'Butterfly key', blurb: 'A separate key dropped into a recess across the seam from the back. Traditional and very strong, but a part you can lose.' },
          ]}
          onChange={(style) => store.set({ joint: { ...config.joint, style } })}
        />
        <Slider label="Joint clearance" value={config.joint.tolerance} min={0} max={0.5} step={0.02}
          onChange={(tolerance) => store.set({ joint: { ...config.joint, tolerance } })}
          hint="Per side. 0.15–0.2 mm suits most printers. Raise it if the seams will not close; lower it if they feel loose." />
        <Chips
          label="Curve quality"
          value={String(config.quality)}
          options={[
            { id: '0', label: 'Draft' },
            { id: '1', label: 'Standard' },
            { id: '2', label: 'Fine' },
            { id: '3', label: 'Extra fine' },
          ]}
          onChange={(q) => store.set({ quality: Number(q) as 0 | 1 | 2 | 3 })}
        />
      </Row>

      <footer className="colophon">
        <p>
          Made with <span aria-label="love">❤️</span> by{' '}
          <a href="https://github.com/nGoline" target="_blank" rel="noreferrer">nGoline</a> and{' '}
          <span aria-label="robot">🤖</span> Claude.
        </p>
        <p className="colophon-version">
          <a href="https://github.com/nGoline/3DFrames" target="_blank" rel="noreferrer">
            v{__APP_VERSION__}
            {__APP_COMMIT__ === 'dev' ? ' · dev' : ` · ${__APP_COMMIT__}`}
          </a>
          {' · '}MIT
        </p>
      </footer>
    </aside>
  )
}

/** Remembers whether the drawing is pinned, so it survives a reload. */
function usePinned(): [boolean, (v: boolean) => void] {
  const [pinned, setPinned] = useState(() => {
    try {
      return localStorage.getItem('3dframes:pin-section') === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('3dframes:pin-section', pinned ? '1' : '0')
    } catch {
      // Private browsing; the choice just will not persist.
    }
  }, [pinned])
  return [pinned, setPinned]
}

function Row({
  id, open, onToggle, label, value, children,
}: {
  id: string
  open: string | null
  onToggle: (id: string) => void
  label: string
  value: string
  children: ReactNode
}) {
  const isOpen = open === id
  return (
    <section className="row" data-open={isOpen}>
      <button type="button" className="row-head" onClick={() => onToggle(id)} aria-expanded={isOpen}>
        <span className="row-label">{label}</span>
        <span className="row-value">{value}</span>
        <span className="row-caret" aria-hidden="true">▶</span>
      </button>
      {isOpen ? <div className="row-body">{children}</div> : null}
    </section>
  )
}

function fittingsSummary(a: { clips: boolean; easel: boolean; hanger: boolean; backer: boolean }): string {
  const on = [
    a.clips && 'spring clips',
    a.backer && 'snap-in back',
    a.hanger && 'hanger',
    a.easel && 'desk stands',
  ].filter(Boolean) as string[]
  if (!on.length) return 'None'
  return on[0][0].toUpperCase() + on[0].slice(1) + (on.length > 1 ? ` +${on.length - 1}` : '')
}
