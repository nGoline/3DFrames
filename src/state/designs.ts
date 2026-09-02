import type { Design, SavedDesign } from '../core/design.ts'
import { reviveDesign } from '../core/design.ts'

/**
 * Saved designs live in this browser and nowhere else, which is the whole point
 * of an app with no server — but it also means they are exactly as durable as
 * the browser's site data. Hence the export: a design worth keeping should not
 * depend on nobody ever clearing their history.
 */
const KEY = '3dframes:designs'
const MAX = 60

const read = (): SavedDesign[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw
      .filter((d) => d && typeof d.id === 'string')
      .map((d) => ({
        id: String(d.id),
        name: typeof d.name === 'string' ? d.name.slice(0, 60) : 'Untitled',
        saved: typeof d.saved === 'string' ? d.saved : new Date().toISOString(),
        design: reviveDesign(d.design),
      }))
  } catch {
    return []
  }
}

const write = (designs: SavedDesign[]): SavedDesign[] => {
  try {
    localStorage.setItem(KEY, JSON.stringify(designs.slice(0, MAX)))
  } catch {
    // Storage full or blocked; the list stays in memory for this session.
  }
  return designs
}

export const listDesigns = read

export function saveDesign(name: string, design: Design, id?: string): SavedDesign[] {
  const now = new Date().toISOString()
  const designs = read()
  const existing = id ? designs.findIndex((d) => d.id === id) : -1
  const entry: SavedDesign = {
    id: id ?? `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim().slice(0, 60) || 'Untitled',
    saved: now,
    design,
  }
  if (existing >= 0) designs[existing] = entry
  else designs.unshift(entry)
  return write(designs)
}

export const renameDesign = (id: string, name: string): SavedDesign[] =>
  write(read().map((d) => (d.id === id ? { ...d, name: name.trim().slice(0, 60) || d.name } : d)))

export const deleteDesign = (id: string): SavedDesign[] => write(read().filter((d) => d.id !== id))

/** Everything, as a file you can keep somewhere that is not a browser. */
export const exportAll = (): string =>
  JSON.stringify({ app: '3DFrames', exported: new Date().toISOString(), designs: read() }, null, 2)

/** Merge an exported file back in, keeping anything already here. */
export function importAll(text: string): { added: number; designs: SavedDesign[] } {
  const parsed = JSON.parse(text)
  const incoming: unknown[] = Array.isArray(parsed) ? parsed : (parsed?.designs ?? [])
  const existing = read()
  const known = new Set(existing.map((d) => d.id))
  let added = 0
  for (const raw of incoming) {
    const d = raw as Record<string, any>
    if (!d || typeof d !== 'object') continue
    const id = typeof d.id === 'string' && !known.has(d.id) ? d.id : `d${Math.random().toString(36).slice(2, 10)}`
    if (known.has(id)) continue
    known.add(id)
    existing.push({
      id,
      name: typeof d.name === 'string' ? d.name.slice(0, 60) : 'Imported',
      saved: typeof d.saved === 'string' ? d.saved : new Date().toISOString(),
      design: reviveDesign(d.design ?? d),
    })
    added++
  }
  existing.sort((a, b) => b.saved.localeCompare(a.saved))
  return { added, designs: write(existing) }
}
