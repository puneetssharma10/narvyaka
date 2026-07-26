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

  private sectionPublish(): HTMLElement {
    const token = h('input', {
      class: 'nv-input',
      type: 'password',
      placeholder: 'Studio token (see INTEGRATIONS.md)',
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
        'Two ways to keep these changes. Export writes a file you apply to the code — that is the permanent one. Publishing to the server stores them for every visitor without a rebuild, which is useful for a quick correction.',
      ]),
      h('button', { class: 'nv-btn nv-btn--primary nv-btn--wide', onClick: () => this.exportOverrides() }, [
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
      h('hr', { style: 'border:0;border-top:1px solid #E7E2DA;margin:4px 0' }),
      h('label', { class: 'nv-label' }, ['Publish to the live site']),
      token,
      h('button', { class: 'nv-btn nv-btn--ghost nv-btn--wide', onClick: () => void this.publish() }, [
        'Publish to server',
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
      const logoSlot = target?.closest<HTMLElement>('[data-logo-slot]')

      if (imageHolder && !this.root.contains(imageHolder)) {
        e.preventDefault()
        void this.openCropper(imageHolder, file)
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
    const token = localStorage.getItem(STORAGE_TOKEN) ?? ''
    if (!token) {
      this.say('Publishing needs the Studio token. See INTEGRATIONS.md for where to set it.', 'warn')
      return
    }

    this.say('Publishing…', 'info')
    try {
      const response = await fetch('/api/studio', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-studio-token': token },
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
