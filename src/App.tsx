import { useEffect, useMemo, useState } from 'react'
import { useFrameStore } from './state/store.ts'
import { SpecPanel } from './ui/SpecPanel.tsx'
import { Designs } from './ui/Designs.tsx'
import { decodeDesign } from './core/design.ts'
import { Viewport, type ViewMode } from './ui/Viewport.tsx'
import { layoutOnPlate } from './core/plateLayout.ts'
import { formatSize } from './core/units.ts'
import { encodeBundle } from './core/export/bundle.ts'
import { encodeCombinedStl, encodeStl } from './core/export/stl.ts'
import { encode3mf } from './core/export/threemf.ts'
import { download } from './core/export/download.ts'
import type { Part } from './core/types.ts'

const KINDS: { id: Part['kind']; label: string; color: string }[] = [
  { id: 'frame', label: 'Frame', color: '#c08a52' },
  { id: 'snapkit', label: 'Snap kit', color: '#6b7f8f' },
  { id: 'accessory', label: 'Fittings', color: '#8a8f7a' },
  { id: 'backer', label: 'Backing', color: '#9aa0a6' },
]

export default function App() {
  const { config, preview, result, stale, status, error, visible, toggleVisible, generate } = useFrameStore()
  const [mode, setMode] = useState<ViewMode>('assembled')
  const [fitToken, setFit] = useState(0)
  const [showDownloads, setShowDownloads] = useState(false)
  const [theme, setTheme] = useTheme()
  useSharedDesign()

  const shown = useMemo(
    () => result?.parts.filter((p) => visible[p.kind]) ?? null,
    [result, visible],
  )
  const layout = useMemo(
    () => (mode === 'plate' && shown?.length ? layoutOnPlate(shown, config.plate) : null),
    [mode, shown, config.plate],
  )
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const part of result?.parts ?? []) map.set(part.kind, (map.get(part.kind) ?? 0) + 1)
    return map
  }, [result])

  const slug = `frame-${Math.round(config.interiorWidth)}x${Math.round(config.interiorHeight)}mm`
  const title = `3DFrames — ${formatSize(config.interiorWidth, config.interiorHeight, config.unit)} ${config.shape} frame`

  return (
    <div className="app">
      <header className="masthead">
        <h1 className="wordmark">3D<span>FRAMES</span></h1>
        <p className="tagline">
          A picture frame for any artwork, printable on <b>any bed</b>. Free, open source, and entirely in your browser.
        </p>
        <Designs />
        <button
          type="button"
          className="theme-toggle"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
        <a href="https://github.com/nGoline/3DFrames" target="_blank" rel="noreferrer">Source</a>
      </header>

      <SpecPanel />

      <main className="stage">
        <Viewport
          parts={shown}
          preview={preview}
          plate={config.plate}
          mode={mode}
          layout={layout}
          fitToken={fitToken}
        />

        {result ? (
          <div className="legend-box">
            {KINDS.filter((k) => counts.get(k.id)).map((kind) => (
              <button
                key={kind.id}
                type="button"
                className="legend-item"
                aria-pressed={visible[kind.id]}
                onClick={() => toggleVisible(kind.id)}
              >
                <span className="legend-swatch" style={{ background: kind.color }} />
                {kind.label} <b>{counts.get(kind.id)}</b>
              </button>
            ))}
          </div>
        ) : null}

        <div className="stage-tools">
          <button type="button" className="tool" aria-pressed={mode === 'assembled'} onClick={() => { setMode('assembled'); setFit((n) => n + 1) }}>
            Assembled
          </button>
          <button type="button" className="tool" aria-pressed={mode === 'plate'} onClick={() => { setMode('plate'); setFit((n) => n + 1) }} disabled={!result}>
            On the plate
          </button>
          <button type="button" className="tool" onClick={() => setFit((n) => n + 1)}>Reframe</button>
        </div>

        {result && (result.notes.length || result.warnings.length) ? (
          <div className="messages">
            {result.warnings.map((w, i) => (
              <p key={`w${i}`} className="message" data-kind="warning">{w}</p>
            ))}
            {result.notes.slice(0, 2).map((n, i) => (
              <p key={`n${i}`} className="message">{n}</p>
            ))}
          </div>
        ) : null}

        {error ? <div className="messages"><p className="message" data-kind="warning">{error}</p></div> : null}

        {showDownloads && result ? (
          <div className="downloads">
            <p className="downloads-title">Download</p>
            <button type="button" onClick={() => {
              download(encodeBundle(result, config, title), `${slug}-kit.zip`, 'application/zip')
              setShowDownloads(false)
            }}>
              Complete kit <small>ZIP · one STL per part + guide</small>
            </button>
            <button type="button" onClick={() => {
              download(encode3mf(result.parts, title, config.plate), `${slug}.3mf`, 'model/3mf')
              setShowDownloads(false)
            }}>
              Coloured 3MF <small>every part, correct scale</small>
            </button>
            <button type="button" onClick={() => {
              download(encodeCombinedStl(result.parts), `${slug}-assembled.stl`, 'model/stl')
              setShowDownloads(false)
            }}>
              Assembled STL <small>one solid, for a render</small>
            </button>
            {result.parts.length === 1 ? (
              <button type="button" onClick={() => {
                download(encodeStl(result.parts[0].positions), `${slug}.stl`, 'model/stl')
                setShowDownloads(false)
              }}>
                Frame STL <small>single piece</small>
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="rail">
          <Stat label="Outer size" value={result ? formatSize(result.outerSize[0], result.outerSize[1], config.unit) : '—'} />
          <Stat label="Parts" value={result ? String(result.parts.length) : '—'} />
          <Stat label="Material" value={result ? `${result.volumeCm3.toFixed(0)}` : '—'} unit="cm³" />
          {layout ? (
            <Stat
              label="Print jobs"
              value={String(layout.plates)}
              unit={layout.diagonal ? 'diagonal' : 'plates'}
            />
          ) : null}
          <div className="rail-spacer" />
          {stale && result ? <span className="stale-dot" title="The configuration has changed since this was generated" /> : null}
          <button type="button" className="btn btn-primary" onClick={generate} disabled={status === 'working'}>
            {status === 'working' ? 'Generating' : result && stale ? 'Regenerate' : 'Generate'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!result}
            onClick={() => setShowDownloads((v) => !v)}
          >
            Download
          </button>
        </div>

        {status === 'working' ? <div className="veil">Cutting the moulding…</div> : null}
      </main>
    </div>
  )
}

/**
 * Open a shared design if the URL carries one, then drop it from the address
 * bar — once you start editing, a link describing the design you arrived with
 * would be describing something that is no longer on screen.
 */
function useSharedDesign() {
  const load = useFrameStore((s) => s.load)
  useEffect(() => {
    const match = /[#&]d=([^&]+)/.exec(location.hash)
    if (!match) return
    const design = decodeDesign(match[1])
    if (design) load(design)
    history.replaceState(null, '', location.pathname + location.search)
  }, [load])
}

/** Remembers the reader's choice; falls back to the system preference. */
function useTheme(): ['light' | 'dark', (t: 'light' | 'dark') => void] {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('3dframes:theme')
    if (saved === 'light' || saved === 'dark') return saved
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('3dframes:theme', theme)
    } catch {
      // Private browsing; the choice just will not persist.
    }
  }, [theme])
  return [theme, setTheme]
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <dl className="stat">
      <dt>{label}</dt>
      <dd>
        {value}
        {unit ? <small> {unit}</small> : null}
      </dd>
    </dl>
  )
}
