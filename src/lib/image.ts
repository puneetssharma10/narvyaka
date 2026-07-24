/**
 * Image helpers shared by the Studio (logo + photo replacement) and the
 * intake form's photograph step. Pure functions, no framework.
 *
 * Everything happens in the browser: files are decoded, cropped and
 * re-encoded locally, and only the finished result is ever uploaded. A
 * contributor who abandons the form has sent us nothing.
 */

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']
export const ACCEPTED_LOGO_TYPES = [...ACCEPTED_IMAGE_TYPES, 'image/svg+xml']
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB

export interface LoadedImage {
  el: HTMLImageElement
  width: number
  height: number
  /** Object URL — call revoke() when finished with it. */
  url: string
  revoke: () => void
}

export function fileIsImage(file: File, allowSvg = false): boolean {
  const list = allowSvg ? ACCEPTED_LOGO_TYPES : ACCEPTED_IMAGE_TYPES
  return list.includes(file.type)
}

export async function loadImageFromFile(file: File): Promise<LoadedImage> {
  const url = URL.createObjectURL(file)
  try {
    const el = await loadImageElement(url)
    return { el, width: el.naturalWidth, height: el.naturalHeight, url, revoke: () => URL.revokeObjectURL(url) }
  } catch (err) {
    URL.revokeObjectURL(url)
    throw err
  }
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('That file could not be read as an image.'))
    img.src = src
  })
}

export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('That file could not be read.'))
    reader.readAsDataURL(file)
  })
}

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export interface RenderOptions {
  /** Longest edge of the output, in px. Larger images are scaled down. */
  maxEdge?: number
  mimeType?: 'image/jpeg' | 'image/webp' | 'image/png'
  quality?: number
  /** Fill behind transparent pixels when encoding to JPEG. */
  background?: string
}

/**
 * Crops `source` to `rect` (in source pixels) and re-encodes it.
 * Returns a Blob — upload it, or turn it into a data URI for local preview.
 */
export async function renderCrop(
  source: HTMLImageElement | HTMLCanvasElement,
  rect: CropRect,
  opts: RenderOptions = {},
): Promise<Blob> {
  const { maxEdge = 2000, mimeType = 'image/jpeg', quality = 0.86, background = '#FFFFFF' } = opts

  const scale = Math.min(1, maxEdge / Math.max(rect.width, rect.height))
  const outW = Math.max(1, Math.round(rect.width * scale))
  const outH = Math.max(1, Math.round(rect.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot process images.')

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  if (mimeType === 'image/jpeg') {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, outW, outH)
  }

  ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, outW, outH)

  return canvasToBlob(canvas, mimeType, quality)
}

/** Downscale without cropping — used for the logo, where the whole mark matters. */
export async function downscale(source: HTMLImageElement, opts: RenderOptions = {}): Promise<Blob> {
  return renderCrop(
    source,
    { x: 0, y: 0, width: source.naturalWidth, height: source.naturalHeight },
    { mimeType: 'image/png', quality: 1, ...opts },
  )
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The image could not be encoded.'))),
      type,
      quality,
    )
  })
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('The image could not be encoded.'))
    reader.readAsDataURL(blob)
  })
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Centred crop of the largest rect with `aspect` that fits inside w×h. */
export function centredCrop(w: number, h: number, aspect: number | null): CropRect {
  if (!aspect) return { x: 0, y: 0, width: w, height: h }
  let cw = w
  let ch = w / aspect
  if (ch > h) {
    ch = h
    cw = h * aspect
  }
  return { x: (w - cw) / 2, y: (h - ch) / 2, width: cw, height: ch }
}
