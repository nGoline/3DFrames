import opentype from 'opentype.js'
import interUrl from './fonts/inter.woff?url'
import playfairUrl from './fonts/playfair.woff?url'
import bebasUrl from './fonts/bebas.woff?url'
import caveatUrl from './fonts/caveat.woff?url'
import { FONTS } from './core/geometry/text.ts'

/** Bundled font files, hashed and base-path corrected by the bundler. */
export const FONT_URLS: Record<string, string> = {
  inter: interUrl,
  playfair: playfairUrl,
  bebas: bebasUrl,
  caveat: caveatUrl,
}

const cache = new Map<string, Promise<opentype.Font>>()

/** Fetch and parse a bundled font, once per session. */
export function loadFont(id: string): Promise<opentype.Font> {
  const option = FONTS.find((f) => f.id === id) ?? FONTS[0]
  let pending = cache.get(option.id)
  if (!pending) {
    pending = fetch(FONT_URLS[option.id])
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load the ${option.label} font (${r.status})`)
        return r.arrayBuffer()
      })
      .then((buf) => opentype.parse(buf))
    cache.set(option.id, pending)
  }
  return pending
}
