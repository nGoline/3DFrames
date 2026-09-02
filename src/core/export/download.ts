/** Hand a generated file to the browser's download machinery. */
export function download(data: ArrayBuffer | Uint8Array | string, filename: string, mime: string): void {
  // Copy into a plain ArrayBuffer: fflate hands back views whose backing buffer
  // TypeScript can no longer prove is not shared, and Blob only takes the former.
  const bytes =
    typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data instanceof Uint8Array
        ? data
        : new Uint8Array(data)
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)

  const url = URL.createObjectURL(new Blob([buffer], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Give the browser a moment to start the transfer before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
