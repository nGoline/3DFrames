import { useEffect, useRef, useState } from 'react'
import { useFrameStore } from '../state/store.ts'
import {
  deleteDesign,
  exportAll,
  importAll,
  listDesigns,
  renameDesign,
  saveDesign,
} from '../state/designs.ts'
import { designOf, encodeDesign, suggestName, summarise, type SavedDesign } from '../core/design.ts'
import { download } from '../core/export/download.ts'

/**
 * Saved designs.
 *
 * Three ways out, because they answer different needs: the list keeps what you
 * are working on to hand, a link shares one design with somebody else, and the
 * export is the only one that survives clearing your browser.
 */
export function Designs() {
  const config = useFrameStore((s) => s.config)
  const load = useFrameStore((s) => s.load)
  const [open, setOpen] = useState(false)
  const [designs, setDesigns] = useState<SavedDesign[]>([])
  const [name, setName] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setDesigns(listDesigns())
    setName(suggestName(designOf(config)))
    const away = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open, config])

  const flash = (message: string) => {
    setNote(message)
    setTimeout(() => setNote(null), 2600)
  }

  const copyLink = async (design = designOf(config)) => {
    const url = `${location.origin}${location.pathname}#d=${encodeDesign(design)}`
    try {
      await navigator.clipboard.writeText(url)
      flash('Link copied. It carries the whole design, but not your printer.')
    } catch {
      flash(url)
    }
  }

  return (
    <div className="designs" ref={panel}>
      <button type="button" className="theme-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Designs
      </button>

      {open ? (
        <div className="designs-panel">
          <div className="designs-save">
            <input
              type="text"
              value={name}
              maxLength={60}
              aria-label="Name for this design"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                setDesigns(saveDesign(name, designOf(config)))
                flash('Saved to this browser.')
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setDesigns(saveDesign(name, designOf(config)))
                flash('Saved to this browser.')
              }}
            >
              Save
            </button>
          </div>

          {designs.length ? (
            <ul className="designs-list">
              {designs.map((d) => (
                <li key={d.id}>
                  {renaming === d.id ? (
                    <input
                      className="designs-rename"
                      defaultValue={d.name}
                      autoFocus
                      onBlur={(e) => {
                        setDesigns(renameDesign(d.id, e.target.value))
                        setRenaming(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                    />
                  ) : (
                    <button type="button" className="designs-open" onClick={() => { load(d.design); setOpen(false) }}>
                      <b>{d.name}</b>
                      <small>{summarise(d.design)}</small>
                    </button>
                  )}
                  <span className="designs-actions">
                    <button type="button" title="Rename" onClick={() => setRenaming(d.id)}>Rename</button>
                    <button type="button" title="Copy a link to this design" onClick={() => copyLink(d.design)}>Link</button>
                    <button type="button" title="Delete" onClick={() => setDesigns(deleteDesign(d.id))}>Delete</button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="designs-empty">
              Nothing saved yet. Designs are kept in this browser — export them if you want them to
              outlive it.
            </p>
          )}

          <div className="designs-foot">
            <button type="button" onClick={() => copyLink()}>Copy link to current</button>
            <button
              type="button"
              onClick={() => download(exportAll(), '3dframes-designs.json', 'application/json')}
            >
              Export all
            </button>
            <button type="button" onClick={() => file.current?.click()}>Import</button>
            <input
              ref={file}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={async (e) => {
                const chosen = e.target.files?.[0]
                e.target.value = ''
                if (!chosen) return
                try {
                  const { added, designs: next } = importAll(await chosen.text())
                  setDesigns(next)
                  flash(added ? `Imported ${added} design${added === 1 ? '' : 's'}.` : 'Nothing new in that file.')
                } catch {
                  flash("That file could not be read as a 3DFrames export.")
                }
              }}
            />
          </div>

          {note ? <p className="designs-note">{note}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
