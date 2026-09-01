import type { ReactNode } from 'react'
import { useId } from 'react'

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  )
}

/** A row of mutually exclusive choices. */
export function Chips<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { id: T; label: string; blurb?: string }[]
  onChange: (value: T) => void
  label: string
}) {
  const active = options.find((o) => o.id === value)
  return (
    <div className="field">
      <span className="legend">{label}</span>
      <div className="chips" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className="chip"
            aria-pressed={option.id === value}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {active?.blurb ? <p className="hint">{active.blurb}</p> : null}
    </div>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.1,
  suffix = 'mm',
  onChange,
  hint,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange: (value: number) => void
  hint?: string
}) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} <span style={{ color: 'var(--lead-1)' }}>{suffix}</span>
      </label>
      <div className="slider">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={Math.round(value * 100) / 100}
          onChange={(e) => onChange(clamp(Number(e.target.value), min, max))}
          aria-label={`${label} in ${suffix}`}
        />
      </div>
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  title,
  note,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  title: string
  note: string
}) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <b>{title}</b>
        {note}
      </span>
    </label>
  )
}

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo)
