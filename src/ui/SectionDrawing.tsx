import { useMemo } from 'react'
import type { ProfilePoint, ProfileParams, Unit } from '../core/types.ts'
import { fromMm } from '../core/units.ts'

interface Props {
  profile: ProfilePoint[]
  params: ProfileParams
  unit: Unit
  presetLabel: string
}

const PAD = { l: 17, r: 13, t: 13, b: 19 }
const VIEW_W = 168
const MAX_DRAW_H = 74

/**
 * The moulding drawn as a proper section, the way a framing supplier prints it
 * in a catalogue: cut material hatched at 45°, redline dimensions with
 * architect's ticks, and a dashed ghost showing where the artwork actually
 * lands under the rabbet.
 *
 * This is the one drawing that answers the question people really have — will
 * my print fit, and how much of it will the frame cover — so it sits at the top
 * of the panel and redraws on every edit.
 */
export function SectionDrawing({ profile, params, unit, presetLabel }: Props) {
  const draw = useMemo(() => {
    const { width, depth, rabbetWidth, rabbetDepth } = params
    const scale = Math.min((VIEW_W - PAD.l - PAD.r) / width, MAX_DRAW_H / depth)
    const h = depth * scale + PAD.t + PAD.b
    const x = (u: number) => PAD.l + u * scale
    const y = (v: number) => PAD.t + (depth - v) * scale
    return { scale, h, x, y, width, depth, rabbetWidth, rabbetDepth }
  }, [params])

  const { x, y, scale, h, width, depth, rabbetWidth, rabbetDepth } = draw
  const outline = profile.map((p) => `${x(p.u).toFixed(2)},${y(p.v).toFixed(2)}`).join(' ')

  const dim = (value: number) => {
    const v = fromMm(value, unit)
    return unit === 'in' ? `${v.toFixed(2)}"` : `${Math.round(v * 10) / 10}`
  }

  const baseY = y(0)
  const widthDimY = baseY + 11
  const depthDimX = PAD.l - 9

  return (
    <figure className="section-plate">
      <figcaption>
        <span>Section through the moulding</span>
        <b>{presetLabel}</b>
      </figcaption>
      <svg
        className="section-svg"
        viewBox={`0 0 ${VIEW_W} ${h}`}
        role="img"
        aria-label={`Cross-section of the moulding: ${dim(width)} wide by ${dim(depth)} thick, with a ${dim(rabbetWidth)} by ${dim(rabbetDepth)} rabbet.`}
      >
        <defs>
          <pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4" height="4" fill="var(--film-3)" />
            <line className="hatch" x1="0" y1="0" x2="0" y2="4" />
          </pattern>
        </defs>

        {/* Cut material. */}
        <polygon className="material" points={outline} fill="url(#hatch)" />

        {/* The rabbet void: where the artwork, glazing and backing stack up. */}
        <rect
          className="ghost"
          x={x(0)}
          y={y(rabbetDepth)}
          width={rabbetWidth * scale}
          height={rabbetDepth * scale}
        />
        <line className="ghost" x1={x(rabbetWidth)} y1={y(rabbetDepth)} x2={x(rabbetWidth) + 8} y2={y(rabbetDepth) - 5} />
        <text className="note" x={x(rabbetWidth) + 9.5} y={y(rabbetDepth) - 4}>
          artwork sits here
        </text>

        {/* Overall width. */}
        <Dimension x1={x(0)} x2={x(width)} y={widthDimY} label={dim(width)} />
        <line className="dim" x1={x(0)} y1={baseY + 2} x2={x(0)} y2={widthDimY + 3} />
        <line className="dim" x1={x(width)} y1={baseY + 2} x2={x(width)} y2={widthDimY + 3} />

        {/* Overall depth. */}
        <Dimension vertical x1={y(0)} x2={y(depth)} y={depthDimX} label={dim(depth)} />

        <text className="note" x={x(0) - 1} y={y(depth) - 4} textAnchor="middle">
          sight
        </text>
        <text className="note" x={x(width)} y={y(depth) - 4} textAnchor="middle">
          outer
        </text>
      </svg>
      <p className="section-spec">
        <span>
          Moulding <b>{dim(width)} × {dim(depth)}</b>
        </span>
        <span>
          Rabbet <b>{dim(rabbetWidth)} × {dim(rabbetDepth)}</b>
        </span>
      </p>
    </figure>
  )
}

/** A dimension line with architect's ticks rather than arrowheads. */
function Dimension({
  x1,
  x2,
  y,
  label,
  vertical = false,
}: {
  x1: number
  x2: number
  y: number
  label: string
  vertical?: boolean
}) {
  const mid = (x1 + x2) / 2
  const tick = 2.4
  if (vertical) {
    return (
      <g>
        <line className="dim" x1={y} y1={x1} x2={y} y2={x2} />
        <line className="dim" x1={y - tick} y1={x1 + tick} x2={y + tick} y2={x1 - tick} />
        <line className="dim" x1={y - tick} y1={x2 + tick} x2={y + tick} y2={x2 - tick} />
        <text className="dim-text" x={y - 3} y={mid} textAnchor="middle" transform={`rotate(-90 ${y - 3} ${mid})`}>
          {label}
        </text>
      </g>
    )
  }
  return (
    <g>
      <line className="dim" x1={x1} y1={y} x2={x2} y2={y} />
      <line className="dim" x1={x1 - tick} y1={y + tick} x2={x1 + tick} y2={y - tick} />
      <line className="dim" x1={x2 - tick} y1={y + tick} x2={x2 + tick} y2={y - tick} />
      <text className="dim-text" x={mid} y={y - 2.6} textAnchor="middle">
        {label}
      </text>
    </g>
  )
}
