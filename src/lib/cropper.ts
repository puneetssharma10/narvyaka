/**
 * A small pan-and-zoom cropper that mounts into any element.
 *
 * Framework-agnostic on purpose: the Studio (vanilla) and the intake form
 * (React) both use it, so it owns its own DOM and exposes plain methods.
 *
 * Interaction: drag to move, wheel or slider to zoom, arrow keys to nudge,
 * a button to rotate. The crop window is fixed; the picture moves behind it.
 */

import { canvasToBlob, loadImageElement, type CropRect, type RenderOptions } from './image'

export interface CropperOptions {
  /** width / height. null = free (the whole image, no fixed shape). */
  aspect?: number | null
  /** Longest edge of the exported image. */
  maxEdge?: number
  mimeType?: 'image/jpeg' | 'image/webp' | 'image/png'
  quality?: number
  /** Shown under the crop window. */
  hint?: string
}

export class Cropper {
  private root: HTMLElement
  private stage!: HTMLElement
  private img!: HTMLImageElement
  private zoomInput!: HTMLInputElement
  private opts: Required<Omit<CropperOptions, 'hint'>> & { hint: string }

  private naturalW = 0
  private naturalH = 0
  private rotation: 0 | 90 | 180 | 270 = 0
  private zoom = 1
  private tx = 0
  private ty = 0
  private baseScale = 1
  private dragging = false
  private lastX = 0
  private lastY = 0
  private resizeObserver?: ResizeObserver
  private destroyed = false

  constructor(root: HTMLElement, opts: CropperOptions = {}) {
    this.root = root
    this.opts = {
      aspect: opts.aspect ?? 1,
      maxEdge: opts.maxEdge ?? 1600,
      mimeType: opts.mimeType ?? 'image/jpeg',
      quality: opts.quality ?? 0.86,
      hint: opts.hint ?? 'Drag to move · scroll or use the slider to zoom',
    }
    this.build()
  }

  /* ── DOM ──────────────────────────────────────────────────────────────── */

  private build() {
    this.root.innerHTML = ''
    this.root.classList.add('nv-cropper')

    const stage = document.createElement('div')
    stage.className = 'nv-cropper__stage'
    stage.setAttribute('role', 'application')
    stage.setAttribute('aria-label', 'Crop area. Drag to move the picture, use the zoom slider to resize.')
    stage.tabIndex = 0

    const img = document.createElement('img')
    img.className = 'nv-cropper__img'
    img.alt = ''
    img.draggable = false
    stage.appendChild(img)

    const grid = document.createElement('div')
    grid.className = 'nv-cropper__grid'
    grid.setAttribute('aria-hidden', 'true')
    stage.appendChild(grid)

    const controls = document.createElement('div')
    controls.className = 'nv-cropper__controls'

    const zoomWrap = document.createElement('label')
    zoomWrap.className = 'nv-cropper__zoom'
    const zoomLabel = document.createElement('span')
    zoomLabel.className = 'visually-hidden'
    zoomLabel.textContent = 'Zoom'
    const zoomInput = document.createElement('input')
    zoomInput.type = 'range'
    zoomInput.min = '1'
    zoomInput.max = '4'
    zoomInput.step = '0.01'
    zoomInput.value = '1'
    zoomWrap.append(zoomLabel, zoomInput)

    const rotate = document.createElement('button')
    rotate.type = 'button'
    rotate.className = 'btn btn-secondary nv-cropper__rotate'
    rotate.textContent = 'Rotate'
    rotate.addEventListener('click', () => this.rotate())

    const reset = document.createElement('button')
    reset.type = 'button'
    reset.className = 'btn btn-quiet'
    reset.textContent = 'Reset'
    reset.addEventListener('click', () => this.reset())

    controls.append(zoomWrap, rotate, reset)

    const hint = document.createElement('p')
    hint.className = 'nv-cropper__hint hint'
    hint.textContent = this.opts.hint

    this.root.append(stage, controls, hint)

    this.stage = stage
    this.img = img
    this.zoomInput = zoomInput

    this.bindEvents()
    this.applyAspect()
  }

  private bindEvents() {
    this.zoomInput.addEventListener('input', () => {
      this.setZoom(Number(this.zoomInput.value))
    })

    this.stage.addEventListener('pointerdown', (e) => {
      this.dragging = true
      this.lastX = e.clientX
      this.lastY = e.clientY
      this.stage.setPointerCapture(e.pointerId)
      this.stage.classList.add('is-dragging')
    })

    this.stage.addEventListener('pointermove', (e) => {
      if (!this.dragging) return
      this.pan(e.clientX - this.lastX, e.clientY - this.lastY)
      this.lastX = e.clientX
      this.lastY = e.clientY
    })

    const endDrag = (e: PointerEvent) => {
      if (!this.dragging) return
      this.dragging = false
      try {
        this.stage.releasePointerCapture(e.pointerId)
      } catch {
        /* pointer already released */
      }
      this.stage.classList.remove('is-dragging')
    }
    this.stage.addEventListener('pointerup', endDrag)
    this.stage.addEventListener('pointercancel', endDrag)

    this.stage.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        this.setZoom(this.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))
      },
      { passive: false },
    )

    this.stage.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 20 : 6
      switch (e.key) {
        case 'ArrowLeft':
          this.pan(step, 0)
          break
        case 'ArrowRight':
          this.pan(-step, 0)
          break
        case 'ArrowUp':
          this.pan(0, step)
          break
        case 'ArrowDown':
          this.pan(0, -step)
          break
        case '+':
        case '=':
          this.setZoom(this.zoom * 1.1)
          break
        case '-':
          this.setZoom(this.zoom / 1.1)
          break
        default:
          return
      }
      e.preventDefault()
    })

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.recomputeBase(true))
      this.resizeObserver.observe(this.stage)
    }
  }

  /* ── Public API ───────────────────────────────────────────────────────── */

  async load(src: string): Promise<void> {
    const probe = await loadImageElement(src)
    if (this.destroyed) return
    this.naturalW = probe.naturalWidth
    this.naturalH = probe.naturalHeight
    this.img.src = src
    this.rotation = 0
    this.reset()
  }

  setAspect(aspect: number | null) {
    this.opts.aspect = aspect
    this.applyAspect()
    this.reset()
  }

  rotate() {
    this.rotation = ((this.rotation + 90) % 360) as 0 | 90 | 180 | 270
    this.img.style.rotate = `${this.rotation}deg`
    this.reset()
  }

  reset() {
    this.zoom = 1
    this.zoomInput.value = '1'
    this.recomputeBase(false)
    // Start centred.
    const { dw, dh } = this.displayedSize()
    this.tx = (this.stage.clientWidth - dw) / 2
    this.ty = (this.stage.clientHeight - dh) / 2
    this.clampAndDraw()
  }

  /** The crop rectangle in *rotated source* pixels. */
  getCropRect(): CropRect {
    const eff = this.baseScale * this.zoom
    const { sw, sh } = this.rotatedSize()
    const w = Math.min(sw, this.stage.clientWidth / eff)
    const h = Math.min(sh, this.stage.clientHeight / eff)
    return {
      x: clamp(-this.tx / eff, 0, Math.max(0, sw - w)),
      y: clamp(-this.ty / eff, 0, Math.max(0, sh - h)),
      width: w,
      height: h,
    }
  }

  /** Renders the current crop, honouring rotation, and returns an encoded Blob. */
  async toBlob(overrides: RenderOptions = {}): Promise<Blob> {
    const rect = this.getCropRect()
    const mimeType = overrides.mimeType ?? this.opts.mimeType
    const quality = overrides.quality ?? this.opts.quality
    const maxEdge = overrides.maxEdge ?? this.opts.maxEdge

    // Bake the rotation into an offscreen canvas first, so the crop rect
    // (which is expressed in rotated space) lines up with the pixels.
    const rotated = this.rotatedCanvas()

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
      ctx.fillStyle = overrides.background ?? '#FFFFFF'
      ctx.fillRect(0, 0, outW, outH)
    }
    ctx.drawImage(rotated, rect.x, rect.y, rect.width, rect.height, 0, 0, outW, outH)

    return canvasToBlob(canvas, mimeType, quality)
  }

  destroy() {
    this.destroyed = true
    this.resizeObserver?.disconnect()
    this.root.innerHTML = ''
    this.root.classList.remove('nv-cropper')
  }

  /* ── Internals ────────────────────────────────────────────────────────── */

  private rotatedSize() {
    const swapped = this.rotation === 90 || this.rotation === 270
    return { sw: swapped ? this.naturalH : this.naturalW, sh: swapped ? this.naturalW : this.naturalH }
  }

  private rotatedCanvas(): HTMLCanvasElement {
    const { sw, sh } = this.rotatedSize()
    const canvas = document.createElement('canvas')
    canvas.width = sw
    canvas.height = sh
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser cannot process images.')
    ctx.translate(sw / 2, sh / 2)
    ctx.rotate((this.rotation * Math.PI) / 180)
    ctx.drawImage(this.img, -this.naturalW / 2, -this.naturalH / 2, this.naturalW, this.naturalH)
    return canvas
  }

  private applyAspect() {
    this.stage.style.aspectRatio = this.opts.aspect ? String(this.opts.aspect) : '4 / 3'
  }

  private displayedSize() {
    const eff = this.baseScale * this.zoom
    const { sw, sh } = this.rotatedSize()
    return { dw: sw * eff, dh: sh * eff }
  }

  private recomputeBase(keepPosition: boolean) {
    const { sw, sh } = this.rotatedSize()
    if (!sw || !sh) return
    const SW = this.stage.clientWidth || 1
    const SH = this.stage.clientHeight || 1
    const previous = this.baseScale
    // "Cover": the crop window is always fully covered by the picture.
    this.baseScale = Math.max(SW / sw, SH / sh)
    if (keepPosition && previous > 0) {
      const ratio = this.baseScale / previous
      this.tx *= ratio
      this.ty *= ratio
      this.clampAndDraw()
    }
  }

  private setZoom(next: number) {
    const clamped = clamp(next, 1, 4)
    if (clamped === this.zoom) return
    // Zoom about the centre of the crop window so the framing stays put.
    const SW = this.stage.clientWidth
    const SH = this.stage.clientHeight
    const ratio = clamped / this.zoom
    this.tx = SW / 2 - (SW / 2 - this.tx) * ratio
    this.ty = SH / 2 - (SH / 2 - this.ty) * ratio
    this.zoom = clamped
    this.zoomInput.value = String(clamped)
    this.clampAndDraw()
  }

  private pan(dx: number, dy: number) {
    this.tx += dx
    this.ty += dy
    this.clampAndDraw()
  }

  private clampAndDraw() {
    const { dw, dh } = this.displayedSize()
    const SW = this.stage.clientWidth
    const SH = this.stage.clientHeight
    // Never let a gap open between the picture and the crop window.
    this.tx = dw <= SW ? (SW - dw) / 2 : clamp(this.tx, SW - dw, 0)
    this.ty = dh <= SH ? (SH - dh) / 2 : clamp(this.ty, SH - dh, 0)

    const { sw, sh } = this.rotatedSize()
    this.img.style.width = `${sw}px`
    this.img.style.height = `${sh}px`
    this.img.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.baseScale * this.zoom})`
    this.img.style.transformOrigin = '0 0'
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** Styles for the cropper — injected once, so both consumers get them free. */
export const CROPPER_STYLES = `
.nv-cropper { display: grid; gap: 0.75rem; }
.nv-cropper__stage {
  position: relative; overflow: hidden; width: 100%;
  background: color-mix(in srgb, var(--color-ink) 88%, transparent);
  border-radius: var(--radius-card); cursor: grab; touch-action: none;
  outline-offset: 3px;
}
.nv-cropper__stage.is-dragging { cursor: grabbing; }
.nv-cropper__img { position: absolute; inset-block-start: 0; inset-inline-start: 0; max-width: none; user-select: none; -webkit-user-drag: none; }
.nv-cropper__grid { position: absolute; inset: 0; pointer-events: none;
  background-image:
    linear-gradient(to right, rgba(255,255,255,.28) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255,255,255,.28) 1px, transparent 1px);
  background-size: 33.333% 33.333%;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.4);
}
.nv-cropper__controls { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
.nv-cropper__zoom { flex: 1 1 160px; display: flex; align-items: center; }
.nv-cropper__zoom input { width: 100%; accent-color: var(--color-accent); }
.nv-cropper__controls .btn { padding-block: 0.5rem; font-size: 0.9rem; }
.nv-cropper__hint { margin: 0; }
`

let stylesInjected = false
export function ensureCropperStyles() {
  if (stylesInjected || typeof document === 'undefined') return
  const style = document.createElement('style')
  style.dataset.narvyaka = 'cropper'
  style.textContent = CROPPER_STYLES
  document.head.appendChild(style)
  stylesInjected = true
}
