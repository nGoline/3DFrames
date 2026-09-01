import { useState, type ReactNode } from 'react'
import { useFrameStore } from '../state/store.ts'
import { PRINTERS, SIZE_PRESETS, printerName, printersByBrand } from '../core/presets.ts'
import { PROFILE_PRESETS, buildProfile, normaliseParams } from '../core/profiles.ts'
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

  const params = normaliseParams(config.profile)
  const profile = buildProfile(config.profilePreset, params, config.quality)
  const presetLabel = PROFILE_PRESETS.find((p) => p.id === config.profilePreset)?.label ?? 'Custom'
  const printer = PRINTERS.find((p) => p.id === config.plate.printer)

  const toggle = (id: string) => setOpen((current) => (current === id ? null : id))
  const round = (mm: number) => Math.round(fromMm(mm, config.unit) * 100) / 100

  return (
    <aside className="spec">
      <div className="spec-head">
        <p className="eyebrow">Specification</p>
      </div>

      <SectionDrawing profile={profile} params={params} unit={config.unit} presetLabel={presetLabel} />

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

      <Row id="size" open={open} onToggle={toggle} label="Sight size"
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
          This is what you will see of the artwork. The print itself needs to be about{' '}
          {formatSize(config.interiorWidth + params.rabbetWidth * 2, config.interiorHeight + params.rabbetWidth * 2, config.unit)}{' '}
          so its edges stay trapped under the rabbet.
        </p>
        <Field label="Common sizes">
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
        <Slider label="Rabbet width" value={config.profile.rabbetWidth} min={1} max={Math.max(2, params.width - 2)} step={0.5}
          onChange={(rabbetWidth) => store.setProfile({ rabbetWidth })}
          hint="How far the frame overlaps the artwork on every side." />
        <Slider label="Rabbet depth" value={config.profile.rabbetDepth} min={1} max={Math.max(2, params.depth - 1.5)} step={0.5}
          onChange={(rabbetDepth) => store.setProfile({ rabbetDepth })}
          hint="Room for the artwork, glazing and backing together." />
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
            <Slider label="Relief depth" value={config.face.depth} min={0.1} max={2} step={0.05}
              onChange={(depth) => store.setFace({ depth })}
              hint="Cut into the face, so the frame keeps its nominal size. 0.4–0.8 mm reads well at a 0.2 mm layer height." />
            <Slider label="Feature size" value={config.face.scale} min={1} max={30} step={0.5}
              onChange={(scale) => store.setFace({ scale })} />
            <Slider label="Angle" value={config.face.angle} min={0} max={90} step={1} suffix="°"
              onChange={(angle) => store.setFace({ angle })} />
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
        <Switch checked={config.accessories.backer} onChange={(v) => store.setAccessory('backer', v)}
          title="Backing panel" note="A flat panel cut to the rabbet, to press the artwork forward." />
        <Switch checked={config.accessories.clips} onChange={(v) => store.setAccessory('clips', v)}
          title="Retainer bars" note="Printed slightly over-length so they spring into the rabbet and hold the stack." />
        <Switch checked={config.accessories.hanger} onChange={(v) => store.setAccessory('hanger', v)}
          title="Keyhole hanger" note="A plate for the back of the top rail, to hang on a single screw." />
        <Switch checked={config.accessories.easel} onChange={(v) => store.setAccessory('easel', v)}
          title="Desk stands" note="A pair of slotted feet the bottom rail drops into." />

        <hr style={{ border: 0, borderTop: '1px solid var(--rule)', margin: '4px 0' }} />

        <Chips
          label="Seam joint"
          value={config.joint.style}
          options={[
            { id: 'dovetail' as const, label: 'Dovetail key', blurb: 'A butterfly key that pulls the seam closed. The strongest option.' },
            { id: 'tab' as const, label: 'Straight tab', blurb: 'Easier to assemble; wants a drop of glue.' },
            { id: 'dowel' as const, label: 'Twin dowels', blurb: 'Two pins. Best on very slender mouldings.' },
          ]}
          onChange={(style) => store.set({ joint: { ...config.joint, style } })}
        />
        <Slider label="Joint clearance" value={config.joint.tolerance} min={0} max={0.5} step={0.02}
          onChange={(tolerance) => store.set({ joint: { ...config.joint, tolerance } })}
          hint="Per side. 0.15–0.2 mm suits most printers; raise it if the keys will not go in." />
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
    </aside>
  )
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

function fittingsSummary(a: { easel: boolean; hanger: boolean; clips: boolean; backer: boolean }): string {
  const on = [
    a.backer && 'backing panel',
    a.clips && 'retainer bars',
    a.hanger && 'hanger',
    a.easel && 'desk stands',
  ].filter(Boolean) as string[]
  if (!on.length) return 'None'
  return on[0][0].toUpperCase() + on[0].slice(1) + (on.length > 1 ? ` +${on.length - 1}` : '')
}
