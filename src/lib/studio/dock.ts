/**
 * Narvyaka Studio — the in-page visual editor.
 *
 * Loaded lazily (see StudioBoot.astro) so a normal visitor never downloads it.
 * Everything it changes is stored locally until you explicitly export or
 * publish, which keeps the "edit → review → apply to code" loop honest.
 */

import {
  COLOR_TOKENS,
  FONT_OPTIONS,
  FONT_SLOTS,
  MAX_ROTATION_SECONDS,
  MIN_ROTATION_SECONDS,
  clampRotationSeconds,
  parseOverrides,
  type ColorToken,
  type FontSlot,
} from '../../../shared/overrides'
import { Cropper, ensureCropperStyles } from '../cropper'
import { blobToDataUrl, fileIsImage, formatBytes, loadImageElement, MAX_UPLOAD_BYTES, readAsDataUrl } from '../image'
import { download, h, injectStyles } from './dom'
import { STUDIO_STYLES } from './styles'
import { studioStore, type StudioStore } from './store'

const STORAGE_OPEN = 'narvyaka.studio.open'
const STORAGE_TOKEN = 'narvyaka.studio.token'
const EXPORT_FILENAME = 'narvyaka-overrides.json'

// Video is stored inline as base64, same as a photo — but unlike a photo it
// is never re-encoded down first, so this cap is far stricter than
// MAX_UPLOAD_BYTES (300 MB, meant for a file the Cropper is about to shrink).
// 6 MB stays under isSafeImageSrc's 10M-character ceiling once base64
// inflates it by ~4/3 (6 MB -> ~8.39M characters).
const MAX_VIDEO_UPLOAD_BYTES = 6 * 1024 * 1024

let mounted = false

export function mountStudio() {
  if (mounted) return
  mounted = true

  injectStyles('studio', STUDIO_STYLES)
  ensureCropperStyles()

  const store = studioStore()
  new Dock(store).render()
}

class Dock {
  private store: StudioStore
  private root!: HTMLElement
  private countBadge!: HTMLElement
  private changeList!: HTMLElement
  private status!: HTMLElement
  private editing = false
  private logoPreview!: HTMLElement

  constructor(store: StudioStore) {
    this.store = store
  }

  render() {
    document.body.classList.add('nv-studio-open')
    document.documentElement.setAttribute('data-studio-active', '')

    this.countBadge = h('span', { class: 'nv-dock__count' }, [String(this.store.count())])
    this.status = h('div', { class: 'nv-status nv-status--info' }, [
      'Changes are saved in this browser only. Export them to put them into the code.',
    ])

    this.root = h('aside', { 'data-studio-dock': '', 'aria-label': 'Narvyaka Studio' }, [
      h('div', { class: 'nv-dock__head' }, [
        h('h2', { class: 'nv-dock__title' }, ['Narvyaka Studio']),
        this.countBadge,
        h('button', { class: 'nv-btn nv-btn--quiet', title: 'Close the Studio', onClick: () => this.close() }, ['Close']),
      ]),
      h('div', { class: 'nv-dock__body' }, [
        this.sectionText(),
        this.sectionColour(),
        this.sectionType(),
        this.sectionLogo(),
        this.sectionImages(),
        this.sectionTiming(),
        this.sectionPublish(),
      ]),
      h('div', { class: 'nv-dock__foot' }, [
        this.status,
        h('button', { class: 'nv-btn nv-btn--primary nv-btn--wide', onClick: () => this.exportOverrides() }, [
          'Export changes',
        ]),
      ]),
    ])

    document.body.appendChild(this.root)

    this.store.subscribe(() => this.refreshCount())
    this.store.onQuotaError(() =>
      this.say(
        'This browser ran out of local storage — that happens with large inlined images. Export what you have, then apply it to the code.',
        'warn',
      ),
    )

    this.wireImageClicks()
    this.wireImageGroupClicks()
    this.wireVideoClicks()
    this.wireGlobalDrop()
    this.refreshCount()
  }

  /* ── Sections ─────────────────────────────────────────────────────────── */

  private section(title: string, open: boolean, children: Node[]): HTMLElement {
    const details = h('details', { class: 'nv-sec', ...(open ? { open: true } : {}) }, [
      h('summary', { class: 'nv-sec__btn' }, [title, h('span', { class: 'nv-sec__chev' }, ['▸'])]),
      h('div', { class: 'nv-sec__panel' }, children),
    ])
    return details
  }

  private sectionText(): HTMLElement {
    const toggle = h('div', { class: 'nv-toggle', role: 'switch', tabindex: '0', 'aria-checked': 'false' }, [
      h('span', { class: 'nv-toggle__dot' }),
      h('span', { class: 'nv-toggle__text' }, ['Click any text to edit it']),
    ])

    const setEditing = (on: boolean) => {
      this.editing = on
      toggle.toggleAttribute('data-on', on)
      toggle.setAttribute('aria-checked', String(on))
      this.setTextEditing(on)
    }

    toggle.addEventListener('click', () => setEditing(!this.editing))
    toggle.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        setEditing(!this.editing)
      }
    })

    this.changeList = h('div', { class: 'nv-changes' })

    return this.section('Text', true, [
      toggle,
      h('p', { class: 'nv-sec__note' }, [
        'Editable text is outlined on the page. Click it, type, then click away. Escape cancels an edit.',
      ]),
      this.changeList,
    ])
  }

  private sectionColour(): HTMLElement {
    const rows = COLOR_TOKENS.map((token) => {
      const current = this.currentColour(token.key)

      const swatch = h('input', {
        type: 'color',
        value: current,
        'aria-label': token.label,
        onInput: (e: Event) => {
          const value = (e.target as HTMLInputElement).value.toUpperCase()
          hex.value = value
          this.store.setColor(token.key as ColorToken, value)
        },
      }) as HTMLInputElement

      const hex = h('input', {
        class: 'nv-input nv-hex',
        value: current,
        'aria-label': `${token.label} hex value`,
        onChange: (e: Event) => {
          const raw = (e.target as HTMLInputElement).value.trim()
          const value = raw.startsWith('#') ? raw : `#${raw}`
          if (!/^#[0-9a-f]{3}([0-9a-f]{3}([0-9a-f]{2})?)?$/i.test(value)) {
            hex.value = this.currentColour(token.key)
            this.say('That is not a valid hex colour.', 'warn')
            return
          }
          swatch.value = value.length === 4 ? expandHex(value) : value.slice(0, 7)
          this.store.setColor(token.key as ColorToken, value.toUpperCase())
        },
      }) as HTMLInputElement

      return h('div', { class: 'nv-row', title: token.hint }, [
        h('label', {}, [token.label]),
        hex,
        swatch,
        h(
          'button',
          {
            class: 'nv-btn nv-btn--quiet',
            title: `Reset ${token.label}`,
            onClick: () => this.store.clearColor(token.key as ColorToken),
          },
          ['↺'],
        ),
      ])
    })

    return this.section('Colour', false, [
      h('p', { class: 'nv-sec__note' }, [
        'The palette is deliberately warm and low-contrast. Keep the background off-white and the text soft black — pure #FFF and #000 make a reading site harsher than it needs to be.',
      ]),
      ...rows,
    ])
  }

  private sectionType(): HTMLElement {
    const rows = FONT_SLOTS.map((slot) => {
      const current = getComputedStyle(document.documentElement).getPropertyValue(`--font-${slot.key}`).trim()
      const select = h('select', {
        class: 'nv-select',
        onChange: (e: Event) => this.store.setFont(slot.key as FontSlot, (e.target as HTMLSelectElement).value),
      }) as HTMLSelectElement

      for (const font of FONT_OPTIONS) {
        const option = h('option', { value: font.value }, [`${font.label} — ${font.note}`]) as HTMLOptionElement
        if (normaliseFont(font.value) === normaliseFont(current)) option.selected = true
        select.appendChild(option)
      }

      return h('div', {}, [
        h('label', { class: 'nv-label' }, [slot.label]),
        select,
        h('p', { class: 'nv-sec__note' }, [slot.hint]),
      ])
    })

    return this.section('Type', false, [
      ...rows,
      h(
        'button',
        {
          class: 'nv-btn nv-btn--ghost nv-btn--wide',
          onClick: () => {
            for (const slot of FONT_SLOTS) this.store.clearFont(slot.key as FontSlot)
          },
        },
        ['Reset all fonts'],
      ),
    ])
  }

  private sectionLogo(): HTMLElement {
    const input = h('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp,image/svg+xml,image/avif',
      style: 'display:none',
      onChange: (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (file) void this.acceptLogo(file)
        ;(e.target as HTMLInputElement).value = ''
      },
    }) as HTMLInputElement

    this.logoPreview = h('div', { class: 'nv-drop', tabindex: '0', role: 'button' }, [])
    this.renderLogoPreview()

    this.logoPreview.addEventListener('click', () => input.click())
    this.logoPreview.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        input.click()
      }
    })
    this.logoPreview.addEventListener('dragover', (e) => {
      e.preventDefault()
      this.logoPreview.setAttribute('data-over', '')
    })
    this.logoPreview.addEventListener('dragleave', () => this.logoPreview.removeAttribute('data-over'))
    this.logoPreview.addEventListener('drop', (e) => {
      e.preventDefault()
      this.logoPreview.removeAttribute('data-over')
      const file = e.dataTransfer?.files?.[0]
      if (file) void this.acceptLogo(file)
    })

    const logo = this.store.get().theme.logo

    const height = h('input', {
      type: 'range',
      min: '16',
      max: '80',
      step: '1',
      value: String(logo?.height ?? 30),
      style: 'width:100%;accent-color:var(--nv-accent)',
      onInput: (e: Event) => {
        const existing = this.store.get().theme.logo
        if (!existing) return
        this.store.setLogo({ ...existing, height: Number((e.target as HTMLInputElement).value) })
      },
    }) as HTMLInputElement

    const alt = h('input', {
      class: 'nv-input',
      value: logo?.alt ?? 'Narvyaka',
      placeholder: 'Narvyaka',
      onChange: (e: Event) => {
        const existing = this.store.get().theme.logo
        if (!existing) return
        this.store.setLogo({ ...existing, alt: (e.target as HTMLInputElement).value })
      },
    }) as HTMLInputElement

    return this.section('Logo', false, [
      h('p', { class: 'nv-sec__note' }, [
        'There is no logo file yet, so the header shows the wordmark set in Fraunces italic. Drop a real logomark here — PNG, SVG or WebP — and it replaces the text everywhere it appears.',
      ]),
      this.logoPreview,
      input,
      h('div', {}, [h('label', { class: 'nv-label' }, ['Height in the header']), height]),
      h('div', {}, [h('label', { class: 'nv-label' }, ['Alt text']), alt]),
      h(
        'button',
        { class: 'nv-btn nv-btn--ghost nv-btn--wide nv-btn--danger', onClick: () => this.store.clearLogo() },
        ['Go back to the text wordmark'],
      ),
    ])
  }

  private sectionImages(): HTMLElement {
    const list = h('div', { class: 'nv-changes' })
    const refresh = () => {
      list.innerHTML = ''
      const images = this.store.get().images
      const paths = Object.keys(images)
      if (paths.length === 0) {
        list.appendChild(h('p', { class: 'nv-sec__note' }, ['No pictures replaced yet.']))
        return
      }
      for (const path of paths) {
        list.appendChild(
          h('div', { class: 'nv-change' }, [
            h('img', { src: images[path], alt: '', style: 'width:38px;height:38px;object-fit:cover;border-radius:6px' }),
            h('span', { class: 'nv-change__path' }, [path]),
            h('button', { class: 'nv-btn nv-btn--quiet', onClick: () => this.store.clearImage(path) }, ['↺']),
          ]),
        )
      }
    }
    refresh()
    this.store.subscribe(refresh)

    return this.section('Photographs', false, [
      h('p', { class: 'nv-sec__note' }, [
        'Click any picture on the page to replace it. You can drag a file straight onto it. Every replacement opens a cropper first, so nothing goes in at the wrong shape.',
      ]),
      list,
    ])
  }

  /**
   * One slider per [data-timing] host found on the current page — the
   * example capsule photos, the wisdom-thoughts slider, and anything else
   * built the same way later. Deliberately not a fixed list: this section
   * doesn't know what "capsule photos" or "wisdom slider" are, only that
   * some element asked to have its rotation speed controlled.
   */
  private sectionTiming(): HTMLElement {
    const hosts = new Map<string, { label: string; el: HTMLElement; min: number; max: number; step: number }>()
    document.querySelectorAll<HTMLElement>('[data-timing]').forEach((el) => {
      const path = el.getAttribute('data-timing')
      if (!path || hosts.has(path)) return
      // A host can declare its own narrower range (the hero video's
      // crossfade wants ~0.2–2.5s, nothing like a photo rotator's 2–20s) —
      // absent that, it gets the same range every rotator has always used.
      const min = Number(el.dataset.timingMin)
      const max = Number(el.dataset.timingMax)
      const step = Number(el.dataset.timingStep)
      hosts.set(path, {
        label: el.getAttribute('data-timing-label') || path,
        el,
        min: Number.isFinite(min) ? min : MIN_ROTATION_SECONDS,
        max: Number.isFinite(max) ? max : MAX_ROTATION_SECONDS,
        step: Number.isFinite(step) && step > 0 ? step : 0.5,
      })
    })

    if (hosts.size === 0) {
      return this.section('Timing', false, [
        h('p', { class: 'nv-sec__note' }, ['No auto-rotating galleries on this page.']),
      ])
    }

    const children: Node[] = [
      h('p', { class: 'nv-sec__note' }, [
        'How long each picture (or, for a video crossfade, the fade itself) takes before the next one takes over. Applies live as you drag — no reload.',
      ]),
    ]

    for (const [path, { label, el, min, max, step }] of hosts) {
      const currentMs = Number(el.dataset.intervalMs)
      const initial = clampRotationSeconds(Number.isFinite(currentMs) && currentMs > 0 ? currentMs / 1000 : min, min, max)

      const valueLabel = h('span', { style: 'font-size:11.5px;color:#6B675F' }, [`${initial.toFixed(1)}s`])

      const slider = h('input', {
        type: 'range',
        min: String(min),
        max: String(max),
        step: String(step),
        value: String(initial),
        style: 'width:100%;accent-color:var(--nv-accent)',
        onInput: (e: Event) => {
          const seconds = clampRotationSeconds((e.target as HTMLInputElement).value, min, max)
          valueLabel.textContent = `${seconds.toFixed(1)}s`
          this.store.setTiming(path, seconds)
        },
      }) as HTMLInputElement

      children.push(
        h('div', { style: 'margin-top:14px' }, [
          h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;gap:8px' }, [
            h('label', { class: 'nv-label', style: 'margin-bottom:0' }, [label]),
            valueLabel,
          ]),
          slider,
        ]),
      )
    }

    children.push(
      h(
        'button',
        {
          class: 'nv-btn nv-btn--ghost nv-btn--wide',
          style: 'margin-top:12px',
          onClick: () => {
            for (const path of hosts.keys()) this.store.clearTiming(path)
          },
        },
        [hosts.size === 1 ? 'Reset to default' : `Reset all ${hosts.size} to default`],
      ),
    )

    return this.section('Timing', false, children)
  }

  private sectionPublish(): HTMLElement {
    const token = h('input', {
      class: 'nv-input',
      type: 'password',
      placeholder: 'Studio token — only needed if not signed in',
      value: localStorage.getItem(STORAGE_TOKEN) ?? '',
      onChange: (e: Event) => localStorage.setItem(STORAGE_TOKEN, (e.target as HTMLInputElement).value),
    }) as HTMLInputElement

    const importInput = h('input', {
      type: 'file',
      accept: 'application/json',
      style: 'display:none',
      onChange: (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (file) void this.importOverrides(file)
        ;(e.target as HTMLInputElement).value = ''
      },
    }) as HTMLInputElement

    return this.section('Save & publish', false, [
      h('p', { class: 'nv-sec__note' }, [
        'Publish sends everything above straight to the live site — every visitor sees it immediately, nothing to run. If you’re signed in as the admin, that alone is enough — just click. The token below is only a fallback for publishing while signed out.',
      ]),
      h('label', { class: 'nv-label' }, ['Studio token (optional)']),
      token,
      h('button', { class: 'nv-btn nv-btn--primary nv-btn--wide', onClick: () => void this.publish() }, [
        'Publish to server',
      ]),
      h('hr', { style: 'border:0;border-top:1px solid #E7E2DA;margin:4px 0' }),
      h('details', { style: 'margin:0' }, [
        h('summary', { class: 'nv-sec__note', style: 'cursor:pointer;user-select:none' }, [
          'Prefer a permanent code change instead?',
        ]),
        h('p', { class: 'nv-sec__note', style: 'margin-top:8px' }, [
          'Export writes a file you apply to the code, so it shows up in a diff and survives a rebuild — the one worth doing for anything you want to keep.',
        ]),
        h('button', { class: 'nv-btn nv-btn--ghost nv-btn--wide', onClick: () => this.exportOverrides() }, [
          'Export changes to a file',
        ]),
        h('p', { class: 'nv-sec__note' }, [
          'Then run this in the project folder:',
          h('code', { style: 'display:block;margin-top:5px;font-size:11.5px;overflow-wrap:anywhere' }, [
            `npm run studio:apply ~/Downloads/${EXPORT_FILENAME}`,
          ]),
        ]),
        h('button', { class: 'nv-btn nv-btn--ghost nv-btn--wide', onClick: () => this.copyApplyCommand() }, [
          'Copy that command',
        ]),
      ]),
      h('hr', { style: 'border:0;border-top:1px solid #E7E2DA;margin:4px 0' }),
      h('button', { class: 'nv-btn nv-btn--ghost nv-btn--wide', onClick: () => importInput.click() }, [
        'Load a changes file',
      ]),
      importInput,
      h(
        'button',
        {
          class: 'nv-btn nv-btn--ghost nv-btn--wide nv-btn--danger',
          onClick: () => {
            if (confirm('Undo every Studio change and go back to the site as it is in the code?')) {
              this.store.resetAll()
            }
          },
        },
        ['Discard all changes'],
      ),
    ])
  }

  /* ── Text editing ─────────────────────────────────────────────────────── */

  private setTextEditing(on: boolean) {
    const nodes = document.querySelectorAll<HTMLElement>('[data-edit]')

    nodes.forEach((node) => {
      if (this.root.contains(node)) return

      if (!on) {
        node.removeAttribute('contenteditable')
        node.onclick = null
        return
      }

      node.onclick = (event) => {
        if (node.getAttribute('contenteditable') === 'true') return
        event.preventDefault()
        this.beginEdit(node)
      }
    })

    this.say(
      on
        ? 'Editing is on. Click any outlined text on the page.'
        : 'Editing is off. Nothing on the page will change by accident.',
      'info',
    )
  }

  private beginEdit(node: HTMLElement) {
    const path = node.getAttribute('data-edit')
    if (!path) return

    const original = node.textContent ?? ''
    node.setAttribute('contenteditable', 'true')
    node.spellcheck = true
    node.focus()

    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(node)
    selection?.removeAllRanges()
    selection?.addRange(range)

    const finish = (commit: boolean) => {
      node.removeAttribute('contenteditable')
      node.removeEventListener('keydown', onKey)
      node.removeEventListener('blur', onBlur)

      const next = (node.textContent ?? '').trim()
      if (!commit) {
        node.textContent = original
        return
      }
      if (next === original.trim()) return
      this.store.setText(path, next)
      this.say(`Updated “${path}”.`, 'ok')
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        finish(false)
      }
      // Enter commits for single-line fields; Shift+Enter always inserts a break.
      if (e.key === 'Enter' && !e.shiftKey && node.tagName !== 'P' && node.tagName !== 'DIV') {
        e.preventDefault()
        finish(true)
      }
    }

    const onBlur = () => finish(true)

    node.addEventListener('keydown', onKey)
    node.addEventListener('blur', onBlur)
  }

  /* ── Images ───────────────────────────────────────────────────────────── */

  private wireImageClicks() {
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target as HTMLElement | null
        const holder = target?.closest<HTMLElement>('[data-edit-image]')
        if (!holder || this.root.contains(holder)) return
        event.preventDefault()
        event.stopPropagation()
        this.pickImageFor(holder)
      },
      true,
    )
  }

  private pickImageFor(holder: HTMLElement) {
    const input = h('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp,image/avif',
      style: 'display:none',
    }) as HTMLInputElement

    input.addEventListener('change', () => {
      const file = input.files?.[0]
      input.remove()
      if (file) void this.openCropper(holder, file)
    })

    document.body.appendChild(input)
    input.click()
  }

  /**
   * The one video slot (the example capsule photo area, when a video has
   * been set in place of the rotating photos). Same override field as
   * images — home.exampleCapsule.video is just another path in `images` —
   * so it gets clear/revert, export and studio:apply for free, but the
   * upload flow itself is separate: no cropper, and a much stricter size
   * cap, since nothing here ever gets re-encoded down.
   */
  private wireVideoClicks() {
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target as HTMLElement | null
        const holder = target?.closest<HTMLElement>('[data-edit-video]')
        if (!holder || this.root.contains(holder)) return
        event.preventDefault()
        event.stopPropagation()
        this.pickVideoFor(holder)
      },
      true,
    )
  }

  private pickVideoFor(holder: HTMLElement) {
    const input = h('input', {
      type: 'file',
      accept: 'video/mp4,video/webm',
      style: 'display:none',
    }) as HTMLInputElement

    input.addEventListener('change', () => {
      const file = input.files?.[0]
      input.remove()
      if (file) void this.applyVideo(holder, file)
    })

    document.body.appendChild(input)
    input.click()
  }

  private async applyVideo(holder: HTMLElement, file: File) {
    const path = holder.getAttribute('data-edit-video')
    if (!path) return

    if (!/^video\/(mp4|webm)$/.test(file.type)) {
      this.say('That file type is not supported. Use MP4 or WebM.', 'warn')
      return
    }
    if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
      this.say(
        `That file is ${formatBytes(file.size)} — video is stored inline rather than re-encoded, so the limit is ${formatBytes(MAX_VIDEO_UPLOAD_BYTES)}. Compress it and try again.`,
        'warn',
      )
      return
    }

    try {
      const url = await readAsDataUrl(file, (fraction) => {
        this.say(`Reading video… ${Math.round(fraction * 100)}%`, 'info')
      })
      this.store.setImage(path, url)

      // The trigger is a real <video> when one is already showing (clicking
      // the video itself to replace it), but the very first time — clicked
      // from the "Use a video instead" button on the photo rotator — there
      // is no <video> element on the page yet, because index.astro only
      // renders one once site.json's video field is non-empty. The override
      // is still saved correctly either way; only the *live preview* differs.
      //
      // A holder that doesn't directly contain one (e.g. the hero's two
      // corner buttons, which sit beside their slot rather than inside it,
      // so the *other* slot's opacity/pointer-events can't hide or disable
      // them too) falls back to whatever else on the page shares this exact
      // override path — same addressing the rest of the Studio already
      // relies on, just not assuming holder-contains-video this one time.
      const video = holder.querySelector('video') ?? document.querySelector<HTMLVideoElement>(`[data-edit-video="${path}"] video`)
      if (video) {
        this.say('Loading video…', 'info')
        // Preview from a blob URL built off the original File, not the
        // data: URI just saved to the store — <video src="data:...."> is
        // unreliably supported in some browsers (Safari in particular has
        // had bugs loading video, as opposed to images, from a data URI)
        // even for a file that decodes fine everywhere else. A blob: URL is
        // the exact original bytes with no such quirk, so it's what decides
        // whether this file can actually play — the stored override still
        // keeps the data: URI, which is what gets exported/published.
        const previewUrl = URL.createObjectURL(file)
        // Wait to hear back from the element itself before calling this a
        // success: a rejected play() alone can't tell a harmless autoplay
        // block (file is fine, will play on the first user gesture) apart
        // from a genuine decode failure (wrong codec, corrupt file — will
        // never play, ever). The 'error' event only fires for the latter,
        // so it — not play()'s rejection — decides which message to show.
        const settle = (playable: boolean) => {
          video.removeEventListener('loadeddata', onLoaded)
          video.removeEventListener('error', onError)
          if (playable) {
            void video.play().catch(() => {
              /* autoplay can be refused before a user gesture — the video is
                 still correctly set and will play once one occurs */
            })
            this.say(`Video replaced (${formatBytes(file.size)}). Export your changes to keep it.`, 'ok')
          } else {
            URL.revokeObjectURL(previewUrl)
            this.say(
              'That file saved, but this browser could not play it back — the codec is probably unsupported (H.264 MP4 or VP9 WebM both work) or the file is corrupt. Try re-exporting it and upload again.',
              'warn',
            )
          }
        }
        const onLoaded = () => settle(true)
        const onError = () => settle(false)
        video.addEventListener('loadeddata', onLoaded, { once: true })
        video.addEventListener('error', onError, { once: true })
        video.src = previewUrl
        video.load()
      } else {
        this.say(
          `Video saved (${formatBytes(file.size)}). This slot switches to it only after you export and run npm run studio:apply — there's nothing to preview live here yet.`,
          'ok',
        )
      }
    } catch {
      this.say('That video could not be read.', 'warn')
    }
  }

  private async openCropper(holder: HTMLElement, file: File) {
    const path = holder.getAttribute('data-edit-image')
    if (!path) return

    if (!fileIsImage(file)) {
      this.say('That file type is not supported. Use JPEG, PNG or WebP.', 'warn')
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      this.say(`That file is ${formatBytes(file.size)} — the limit is 300 MB.`, 'warn')
      return
    }

    const declared = holder.getAttribute('data-edit-aspect')
    let aspect: number | null = parseAspect(declared)
    if (aspect === null && !declared) {
      const img = holder.querySelector('img')
      if (img && img.clientWidth && img.clientHeight) aspect = img.clientWidth / img.clientHeight
    }

    const stage = h('div')
    const cropper = new Cropper(stage, { aspect, maxEdge: 1800, mimeType: 'image/jpeg', quality: 0.86 })

    const dataUrl = await readAsDataUrl(file)
    await cropper.load(dataUrl)

    const chips = [
      { label: 'Original', value: null as number | null },
      { label: 'Square', value: 1 },
      { label: '4:3', value: 4 / 3 },
      { label: '3:2', value: 3 / 2 },
      { label: '16:9', value: 16 / 9 },
    ]

    const chipRow = h(
      'div',
      { class: 'nv-modal__aspects' },
      chips.map((chip) =>
        h(
          'button',
          {
            class: 'nv-chip',
            ...(chip.value === aspect ? { 'data-on': '' } : {}),
            onClick: (e: Event) => {
              chipRow.querySelectorAll('.nv-chip').forEach((c) => c.removeAttribute('data-on'))
              ;(e.currentTarget as HTMLElement).setAttribute('data-on', '')
              cropper.setAspect(chip.value)
            },
          },
          [chip.label],
        ),
      ),
    )

    const close = this.modal('Replace this picture', [
      chipRow,
      stage,
      h('p', { class: 'nv-sec__note' }, [
        'The crop is applied when you save — the original file is never uploaded, only the finished picture.',
      ]),
    ], async () => {
      const blob = await cropper.toBlob()
      const url = await blobToDataUrl(blob)
      this.store.setImage(path, url)

      const img = holder.querySelector('img')
      if (img) {
        img.src = url
        img.removeAttribute('srcset')
      }
      this.say(`Picture replaced (${formatBytes(blob.size)}). Export your changes to keep it.`, 'ok')
      cropper.destroy()
    })

    // Ensure the cropper measures itself after the modal has been laid out.
    requestAnimationFrame(() => cropper.reset())
    void close
  }

  /**
   * "Upload all N" — a single file picker for a whole set of images at once
   * (e.g. the ten example-capsule photos), instead of clicking through them
   * one at a time. Deliberately not interactive per image: with ten files at
   * once there is no reasonable UI for cropping each in turn, so every file
   * gets the same automatic centred crop at the slot's declared aspect,
   * through the same Cropper class the single-image flow uses — mounted
   * off-screen so it can measure real layout without ever being shown.
   * Files beyond the slot count, or past the first N selected, are ignored;
   * fewer files than slots just fills the first ones and leaves the rest as
   * they were.
   */
  private wireImageGroupClicks() {
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target as HTMLElement | null
        const trigger = target?.closest<HTMLElement>('[data-edit-image-group]')
        if (!trigger || this.root.contains(trigger)) return
        event.preventDefault()
        event.stopPropagation()
        this.pickImagesForGroup(trigger)
      },
      true,
    )
  }

  private pickImagesForGroup(trigger: HTMLElement) {
    const base = trigger.getAttribute('data-edit-image-group')
    const count = Number(trigger.getAttribute('data-edit-image-group-count') ?? '0')
    if (!base || !Number.isFinite(count) || count < 1) return

    // Appended after the index in each computed path — '' for a flat array of
    // image strings (home.exampleCapsule.photos.3), '.image' for an array of
    // { image, quote } objects (home.wisdomSlider.slides.3.image). Keeps this
    // mechanism usable against either data shape without assuming one.
    const suffix = trigger.getAttribute('data-edit-image-group-suffix') ?? ''

    const input = h('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp,image/avif',
      multiple: true,
      style: 'display:none',
    }) as HTMLInputElement

    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? [])
      input.remove()
      if (files.length) void this.applyImageGroup(base, suffix, count, files, trigger.getAttribute('data-edit-aspect'))
    })

    document.body.appendChild(input)
    input.click()
  }

  private async applyImageGroup(
    base: string,
    suffix: string,
    count: number,
    files: File[],
    aspectAttr: string | null,
  ) {
    const aspect = parseAspect(aspectAttr)
    const slots = Math.min(files.length, count)
    let applied = 0
    let rejected = 0

    for (let i = 0; i < slots; i++) {
      const file = files[i]
      if (!fileIsImage(file)) {
        rejected++
        continue
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        rejected++
        continue
      }

      try {
        const url = await this.autoCrop(file, aspect)
        const path = `${base}.${i}${suffix}`
        this.store.setImage(path, url)

        // CSS.escape isn't guaranteed in every runtime this bundle targets,
        // and a dotted-numeric path never contains characters that need it.
        const holder = document.querySelector<HTMLElement>(`[data-edit-image="${path}"]`)
        const img = holder?.querySelector('img')
        if (img) {
          img.src = url
          img.removeAttribute('srcset')
        }
        applied++
      } catch {
        rejected++
      }
    }

    if (files.length > count) {
      this.say(`Only the first ${count} were used — that's how many slots there are.`, 'warn')
    }
    if (applied) {
      this.say(`${applied} picture${applied === 1 ? '' : 's'} replaced. Export your changes to keep them.`, 'ok')
    }
    if (rejected) {
      this.say(`${rejected} file${rejected === 1 ? '' : 's'} could not be used (wrong type or over 300 MB).`, 'warn')
    }
  }

  /** Same crop/resize pipeline as the interactive cropper, run without a UI:
   *  mounted off-screen (not display:none — it needs real layout to measure
   *  against) so Cropper's own default centred framing does the work. */
  private async autoCrop(file: File, aspect: number | null): Promise<string> {
    const stage = h('div', {
      style: `position:fixed;left:-9999px;top:0;width:800px;height:${Math.round(800 / (aspect ?? 1))}px;`,
    })
    document.body.appendChild(stage)
    try {
      const cropper = new Cropper(stage, { aspect, maxEdge: 1800, mimeType: 'image/jpeg', quality: 0.86 })
      const dataUrl = await readAsDataUrl(file)
      await cropper.load(dataUrl)
      const blob = await cropper.toBlob()
      cropper.destroy()
      return blobToDataUrl(blob)
    } finally {
      stage.remove()
    }
  }

  private async acceptLogo(file: File) {
    if (!fileIsImage(file, true)) {
      this.say('Use a PNG, SVG, WebP or JPEG for the logo.', 'warn')
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      this.say(`That file is ${formatBytes(file.size)} — the limit is 300 MB.`, 'warn')
      return
    }

    // SVG goes in untouched: rasterising a vector logo would be a downgrade.
    let src: string
    if (file.type === 'image/svg+xml') {
      const text = await file.text()
      if (/<script|javascript:|onload=/i.test(text)) {
        this.say('That SVG contains script and cannot be used as a logo.', 'warn')
        return
      }
      src = `data:image/svg+xml;base64,${utf8ToBase64(text)}`
    } else {
      const dataUrl = await readAsDataUrl(file)
      const img = await loadImageElement(dataUrl)
      src = img.naturalHeight > 240 ? await shrinkLogo(img) : dataUrl
    }

    const existing = this.store.get().theme.logo
    this.store.setLogo({ src, alt: existing?.alt ?? 'Narvyaka', height: existing?.height ?? 30 })
    this.renderLogoPreview()
    this.say('Logo set. It now replaces the wordmark everywhere.', 'ok')
  }

  private renderLogoPreview() {
    const logo = this.store.get().theme.logo
    this.logoPreview.innerHTML = ''
    if (logo?.src) {
      this.logoPreview.append(
        h('img', { src: logo.src, alt: logo.alt }),
        h('p', { class: 'nv-drop__hint', style: 'margin-top:8px' }, ['Click or drop to replace']),
      )
    } else {
      this.logoPreview.append(
        h('p', { class: 'nv-drop__title' }, ['Drop a logo here']),
        h('p', { class: 'nv-drop__hint' }, ['PNG, SVG or WebP — or click to choose a file']),
      )
    }
  }

  private wireGlobalDrop() {
    let depth = 0

    window.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      depth += 1
      document.documentElement.setAttribute('data-studio-dropping', '')
    })

    window.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) document.documentElement.removeAttribute('data-studio-dropping')
    })

    window.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    })

    window.addEventListener('drop', (e) => {
      depth = 0
      document.documentElement.removeAttribute('data-studio-dropping')

      const file = e.dataTransfer?.files?.[0]
      if (!file) return

      const target = e.target as HTMLElement | null
      const imageHolder = target?.closest<HTMLElement>('[data-edit-image]')
      const videoHolder = target?.closest<HTMLElement>('[data-edit-video]')
      const logoSlot = target?.closest<HTMLElement>('[data-logo-slot]')

      if (imageHolder && !this.root.contains(imageHolder)) {
        e.preventDefault()
        void this.openCropper(imageHolder, file)
      } else if (videoHolder && !this.root.contains(videoHolder)) {
        e.preventDefault()
        void this.applyVideo(videoHolder, file)
      } else if (logoSlot) {
        e.preventDefault()
        void this.acceptLogo(file)
      }
    })
  }

  /* ── Export / publish ─────────────────────────────────────────────────── */

  private exportOverrides() {
    if (this.store.count() === 0) {
      this.say('Nothing has been changed yet.', 'warn')
      return
    }
    download(EXPORT_FILENAME, this.store.export())
    this.say(
      `Exported ${this.store.count()} change${this.store.count() === 1 ? '' : 's'} (${formatBytes(this.store.size())}). Apply it with npm run studio:apply.`,
      'ok',
    )
  }

  private async importOverrides(file: File) {
    try {
      const parsed = parseOverrides(await file.text())
      if (!parsed) throw new Error('unreadable')
      this.store.replaceAll(parsed)
    } catch {
      this.say('That file could not be read as a Narvyaka changes file.', 'warn')
    }
  }

  private async copyApplyCommand() {
    const command = `npm run studio:apply ~/Downloads/${EXPORT_FILENAME}`
    try {
      await navigator.clipboard.writeText(command)
      this.say('Command copied.', 'ok')
    } catch {
      this.say(command, 'info')
    }
  }

  private async publish() {
    // A signed-in super_admin needs no token at all — the server accepts
    // that session by itself (functions/api/studio.ts's canPublish checks
    // it first, the token second). This used to hard-block here whenever no
    // token happened to be saved in *this* browser, even for someone
    // already logged in, for whom the request would otherwise have just
    // worked. Send whatever's available and let the server (which actually
    // knows whether either one is valid) be the one to say no.
    const token = localStorage.getItem(STORAGE_TOKEN) ?? ''

    this.say('Publishing…', 'info')
    try {
      const response = await fetch('/api/studio', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { 'x-studio-token': token } : {}),
        },
        body: this.store.export(),
      })

      const body = (await response.json().catch(() => ({}))) as { error?: string; hint?: string }

      if (response.ok) {
        this.say('Published. Every visitor now sees these changes.', 'ok')
        return
      }
      this.say(body.hint ?? body.error ?? `The server refused that (${response.status}).`, 'warn')
    } catch {
      this.say('Could not reach the server. Export the changes instead — nothing is lost.', 'warn')
    }
  }

  /* ── Chrome ───────────────────────────────────────────────────────────── */

  private modal(title: string, body: Node[], onSave: () => Promise<void> | void): () => void {
    const overlay = h('div', { class: 'nv-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title })
    const close = () => {
      overlay.remove()
      document.removeEventListener('keydown', onKey)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }

    const save = h(
      'button',
      {
        class: 'nv-btn nv-btn--primary',
        onClick: async () => {
          save.setAttribute('disabled', '')
          try {
            await onSave()
            close()
          } catch (err) {
            this.say(err instanceof Error ? err.message : 'That did not work.', 'warn')
            save.removeAttribute('disabled')
          }
        },
      },
      ['Save'],
    )

    overlay.appendChild(
      h('div', { class: 'nv-modal__panel' }, [
        h('h3', { class: 'nv-modal__title' }, [title]),
        ...body,
        h('div', { class: 'nv-modal__row' }, [
          h('button', { class: 'nv-btn nv-btn--ghost', onClick: close }, ['Cancel']),
          save,
        ]),
      ]),
    )

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close()
    })
    document.addEventListener('keydown', onKey)
    document.body.appendChild(overlay)

    return close
  }

  private refreshCount() {
    const count = this.store.count()
    this.countBadge.textContent = String(count)
    this.countBadge.style.visibility = count ? 'visible' : 'hidden'

    if (!this.changeList) return
    this.changeList.innerHTML = ''
    const text = this.store.get().text
    const paths = Object.keys(text)
    if (paths.length === 0) {
      this.changeList.appendChild(h('p', { class: 'nv-sec__note' }, ['No text changed yet.']))
      return
    }
    for (const path of paths) {
      this.changeList.appendChild(
        h('div', { class: 'nv-change' }, [
          h('span', { class: 'nv-change__path' }, [
            path,
            h('span', { class: 'nv-change__val' }, [truncate(text[path], 90)]),
          ]),
          h(
            'button',
            { class: 'nv-btn nv-btn--quiet', title: 'Undo this change', onClick: () => this.store.clearText(path) },
            ['↺'],
          ),
        ]),
      )
    }
  }

  private say(message: string, kind: 'ok' | 'warn' | 'info') {
    this.status.className = `nv-status nv-status--${kind}`
    this.status.textContent = message
  }

  private close() {
    localStorage.removeItem(STORAGE_OPEN)
    document.body.classList.remove('nv-studio-open')
    document.documentElement.removeAttribute('data-studio-active')
    this.setTextEditing(false)
    this.root.remove()
    mounted = false

    const fab = h(
      'button',
      {
        class: 'nv-fab',
        onClick: () => {
          fab.remove()
          localStorage.setItem(STORAGE_OPEN, '1')
          mountStudio()
        },
      },
      ['Open Studio'],
    )
    document.body.appendChild(fab)
  }

  /**
   * The colour a token is showing right now: the Studio's own override if there
   * is one, otherwise whatever the stylesheet resolved to. Normalised to hex,
   * because <input type="color"> accepts nothing else.
   */
  private currentColour(token: string): string {
    const override = this.store.get().theme.colors[token as ColorToken]
    if (override) return toHex(override) || '#000000'

    const computed = getComputedStyle(document.documentElement).getPropertyValue(`--color-${token}`).trim()
    return toHex(computed) || '#000000'
  }
}

/* ── Small helpers ──────────────────────────────────────────────────────── */

/** btoa() only handles Latin-1; an SVG can contain any UTF-8. */
function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Accepts #abc, #aabbcc and rgb(...) — returns #rrggbb, or '' if unreadable. */
function toHex(value: string): string {
  const trimmed = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toUpperCase()
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) return expandHex(trimmed).toUpperCase()

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(trimmed)
  if (rgb) {
    const channel = (raw: string) => Math.max(0, Math.min(255, Math.round(Number(raw)))).toString(16).padStart(2, '0')
    return `#${channel(rgb[1])}${channel(rgb[2])}${channel(rgb[3])}`.toUpperCase()
  }

  return ''
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function expandHex(value: string): string {
  const [, r, g, b] = value.match(/^#(.)(.)(.)$/) ?? []
  return r ? `#${r}${r}${g}${g}${b}${b}` : value
}

function normaliseFont(value: string): string {
  return value.replace(/['"]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function parseAspect(value: string | null): number | null {
  if (!value) return null
  if (value === 'free') return null
  const [w, hh] = value.split(/[:/]/).map(Number)
  return Number.isFinite(w) && Number.isFinite(hh) && hh !== 0 ? w / hh : null
}

async function shrinkLogo(img: HTMLImageElement): Promise<string> {
  const scale = 240 / img.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * scale)
  canvas.height = 240
  const ctx = canvas.getContext('2d')
  if (!ctx) return img.src
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}
