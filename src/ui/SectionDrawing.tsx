import { useMemo } from 'react'
import type { ProfilePoint, ProfileParams } from '../core/types.ts'
import type { ClipFit } from '../core/geometry/accessories.ts'
import type { Material } from '../core/materials.ts'

interface Props {
  profile: ProfilePoint[]
  params: ProfileParams
  presetLabel: string
  /** Total thickness of everything going in the rabbet. */
  artwork: number
  /** The clip, if one will be fitted and there is room for it. */
  clip: ClipFit | null
  /** Shallowest rabbet that would hold this artwork with a clip behind it. */
  minRabbet: number
  clipsWanted: boolean
  material: Material
  /** Keep the drawing in view while the rest of the panel scrolls under it. */
  pinned: boolean
  onPin: (pinned: boolean) => void
}

const PAD = { l: 17, r: 13, t: 13, b: 19 }
const VIEW_W = 168
const MAX_DRAW_H = 84

/**
 * The moulding drawn as a live section — the frame's edge, at the size it will
 * print, with what actually goes into it drawn in place.
 *
 * A cross-section on its own only answers "what shape is it". The questions
 * people really have are whether their artwork fits and whether the clip has
 * anywhere to go, so the artwork stack and the clip are drawn in too, and the
 * drawing says plainly whether it all works.
 */
export function SectionDrawing({
  profile,
  params,
  presetLabel,
  artwork,
  clip,
  minRabbet,
  clipsWanted,
  material,
  pinned,
  onPin,
}: Props) {
  // How far the leaf reaches inward past the sight edge.
  const reach = clip ? Math.max(0, clip.span - params.rabbetWidth) + 2 : 0

  const draw = useMemo(() => {
    const { width, depth } = params
    // Room to the left of the sight edge for the artwork to run off. It has to
    // reach at least as far as the clip does, or the leaf appears to press on
    // thin air.
    const overhang = Math.max(Math.min(width * 0.5, 10), reach)
    const scale = Math.min((VIEW_W - PAD.l - PAD.r) / (width + overhang), MAX_DRAW_H / depth)
    return {
      scale,
      overhang,
      h: depth * scale + PAD.t + PAD.b,
      x: (u: number) => PAD.l + (u + overhang) * scale,
      y: (v: number) => PAD.t + (depth - v) * scale,
    }
  }, [params, reach])

  const { x, y, scale, h, overhang } = draw
  const { width, depth, rabbetWidth, rabbetDepth } = params
  const outline = profile.map((p) => `${x(p.u).toFixed(2)},${y(p.v).toFixed(2)}`).join(' ')

  /**
   * Always millimetres here, whatever unit the artwork is measured in. Every
   * dimension on this drawing is a printer-scale one — a rabbet, a leaf, a
   * clearance — and 0.11" says nothing useful about any of them.
   */
  const dim = (value: number) => `${Math.round(value * 10) / 10}`

  const stackBack = rabbetDepth - artwork
  const fits = artwork > 0 && artwork < rabbetDepth && (!clipsWanted || clip !== null)
  // A clip can fail to fit for two quite different reasons, and saying the
  // wrong one sends you to adjust the wrong control.
  const wallLeft = width - rabbetWidth - 1.5
  const verdict = !clipsWanted
    ? artwork >= rabbetDepth
      ? `The rabbet is only ${dim(rabbetDepth)} mm deep — too shallow for ${dim(artwork)} mm of artwork.`
      : 'Everything fits.'
    : clip
      ? 'Everything fits.'
      : wallLeft < 3
        ? `Too narrow for a clip: the slot needs 3 mm of wall outside the rabbet and there is ${dim(Math.max(0, wallLeft))} mm. Widen the face or narrow the rabbet.`
        : `Rabbet needs ${dim(minRabbet)} mm to hold ${dim(artwork)} mm of artwork and a clip behind it.`

  return (
    <figure className={`section-plate${pinned ? ' pinned' : ''}`}>
      <figcaption>
        <span>The frame edge, full size</span>
        <b>{presetLabel}</b>
        <button
          type="button"
          className="pin"
          aria-pressed={pinned}
          title={pinned ? 'Let the drawing scroll away' : 'Keep the drawing in view while you work'}
          onClick={() => onPin(!pinned)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 1.5h4l-.6 4.2 2.6 2.3H9.2L8 14.5 6.8 8H3l2.6-2.3z" />
          </svg>
          <span className="visually-hidden">{pinned ? 'Unpin the frame edge' : 'Pin the frame edge'}</span>
        </button>
      </figcaption>
      <svg
        className="section-svg"
        viewBox={`0 0 ${VIEW_W} ${h}`}
        role="img"
        aria-label={`Section through the moulding: ${dim(width)} by ${dim(depth)} mm, with a ${dim(rabbetWidth)} by ${dim(rabbetDepth)} mm rabbet holding ${dim(artwork)} mm of artwork.`}
      >
        <defs>
          <pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4" height="4" fill="var(--film-3)" />
            <line className="hatch" x1="0" y1="0" x2="0" y2="4" />
          </pattern>
        </defs>

        <polygon className="material" points={outline} fill="url(#hatch)" />

        {/* What goes in: drawn at its real thickness, running off to the left. */}
        {artwork > 0 && artwork < rabbetDepth ? (
          <g>
            <rect
              className="artwork"
              x={x(-overhang)}
              y={y(rabbetDepth)}
              width={(rabbetWidth + overhang) * scale}
              height={artwork * scale}
            />
            <text className="note artwork-label" x={x(-overhang) + 1.5} y={y(rabbetDepth) + artwork * scale / 2 + 2.2}>
              artwork {dim(artwork)} mm
            </text>
          </g>
        ) : (
          <rect
            className="artwork over"
            x={x(-overhang)}
            y={y(rabbetDepth)}
            width={(rabbetWidth + overhang) * scale}
            height={Math.min(artwork, depth) * scale}
          />
        )}

        {/* The clip, pressed against the back of the artwork. */}
        {clip ? <ClipOutline clip={clip} params={params} stackBack={stackBack} x={x} y={y} scale={scale} /> : null}

        <Dimension x1={x(0)} x2={x(width)} y={y(0) + 11} label={dim(width)} />
        <line className="dim" x1={x(0)} y1={y(0) + 2} x2={x(0)} y2={y(0) + 14} />
        <line className="dim" x1={x(width)} y1={y(0) + 2} x2={x(width)} y2={y(0) + 14} />
        <Dimension vertical x1={y(0)} x2={y(depth)} y={PAD.l - 9} label={dim(depth)} />

        <text className="note" x={x(0)} y={y(depth) - 4} textAnchor="middle">sight</text>
        <text className="note" x={x(width)} y={y(depth) - 4} textAnchor="middle">outer</text>
      </svg>

      <p className="section-spec">
        <span>Moulding <b>{dim(width)} × {dim(depth)} mm</b></span>
        <span>Rabbet <b>{dim(rabbetWidth)} × {dim(rabbetDepth)} mm</b></span>
      </p>
      <p className={`section-verdict${fits ? '' : ' bad'}`}>
        {fits ? '✓ ' : '! '}
        {verdict}
        {fits && clip ? (
          <span className="section-verdict-detail">
            {' '}Clip presses {dim(clip.spring.squeeze)} mm, about {clip.spring.force.toFixed(1)} N in{' '}
            {material.label}.
          </span>
        ) : null}
      </p>
    </figure>
  )
}

/**
 * The clip in its working position: tang down the tilted slot, leaf sprung up
 * against the back of the artwork.
 */
function ClipOutline({
  clip,
  params,
  stackBack,
  x,
  y,
  scale,
}: {
  clip: ClipFit
  params: ProfileParams
  stackBack: number
  x: (u: number) => number
  y: (v: number) => number
  scale: number
}) {
  const wall = params.rabbetWidth
  // Pressed flat against the artwork rather than at its free height.
  const pressed = Math.max(0, (stackBack - clip.z0 - clip.thickness) / clip.span)
  const points = [
    [wall + clip.depth, clip.z0 - clip.depth * clip.tilt + clip.thickness / 2],
    [wall, clip.z0 + clip.thickness / 2],
    [wall - clip.span, clip.z0 + clip.thickness / 2 + clip.span * pressed],
  ]
  return (
    <polyline
      className="clip"
      strokeWidth={clip.thickness * scale}
      points={points.map(([u, v]) => `${x(u).toFixed(2)},${y(v).toFixed(2)}`).join(' ')}
    />
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
      <text className="dim-text" x={mid} y={y - 2.6} textAnchor="middle">{label}</text>
    </g>
  )
}
