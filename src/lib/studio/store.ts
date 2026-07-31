/**
 * Studio state: the working copy of the overrides, saved to localStorage on
 * every change and re-applied to the live page immediately.
 *
 * Nothing here talks to the network. Publishing is a separate, explicit step.
 */

import {
  OVERRIDES_STORAGE_KEY,
  OVERRIDES_VERSION,
  clampRotationSeconds,
  countOverrides,
  emptyOverrides,
  parseOverrides,
  type ColorToken,
  type FontSlot,
  type LogoOverride,
  type StudioOverrides,
} from '../../../shared/overrides'

declare global {
  interface Window {
    __narvyaka?: {
      KEY: string
      applyTheme: (o: StudioOverrides) => void
      applyContent: (o: StudioOverrides) => void
      applyTiming: (o: StudioOverrides) => void
      current: StudioOverrides | null
    }
  }
}

type Listener = (state: StudioOverrides) => void

class StudioStore {
  private state: StudioOverrides
  private listeners = new Set<Listener>()

  constructor() {
    this.state = parseOverrides(localStorage.getItem(OVERRIDES_STORAGE_KEY)) ?? emptyOverrides()
  }

  get(): StudioOverrides {
    return this.state
  }

  count(): number {
    return countOverrides(this.state)
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /* ── Mutations ────────────────────────────────────────────────────────── */

  setColor(token: ColorToken, value: string) {
    this.state.theme.colors[token] = value
    this.commit()
  }

  clearColor(token: ColorToken) {
    delete this.state.theme.colors[token]
    this.commit({ reload: true })
  }

  setFont(slot: FontSlot, value: string) {
    this.state.theme.fonts[slot] = value
    this.commit()
  }

  clearFont(slot: FontSlot) {
    delete this.state.theme.fonts[slot]
    this.commit({ reload: true })
  }

  setLogo(logo: LogoOverride) {
    this.state.theme.logo = logo
    this.commit()
  }

  clearLogo() {
    delete this.state.theme.logo
    this.commit({ reload: true })
  }

  setText(path: string, value: string) {
    this.state.text[path] = value
    this.commit()
  }

  clearText(path: string) {
    delete this.state.text[path]
    this.commit({ reload: true })
  }

  setImage(path: string, src: string) {
    this.state.images[path] = src
    this.commit()
  }

  clearImage(path: string) {
    delete this.state.images[path]
    this.commit({ reload: true })
  }

  setTiming(path: string, seconds: number) {
    this.state.timing[path] = clampRotationSeconds(seconds)
    this.commit()
  }

  clearTiming(path: string) {
    delete this.state.timing[path]
    this.commit({ reload: true })
  }

  replaceAll(next: StudioOverrides) {
    this.state = next
    this.commit({ reload: true })
  }

  resetAll() {
    this.state = emptyOverrides()
    localStorage.removeItem(OVERRIDES_STORAGE_KEY)
    window.location.reload()
  }

  /* ── Persistence + live apply ─────────────────────────────────────────── */

  private commit(opts: { reload?: boolean } = {}) {
    this.state.version = OVERRIDES_VERSION
    this.state.updated_at = new Date().toISOString()

    try {
      localStorage.setItem(OVERRIDES_STORAGE_KEY, JSON.stringify(this.state))
    } catch {
      // Almost always the 5 MB quota, hit by inlining large images.
      this.notifyQuotaError()
      return
    }

    if (opts.reload) {
      // Removing an override cannot be undone in the DOM (the original text is
      // gone), so the honest way to revert is to re-render from source.
      window.location.reload()
      return
    }

    window.__narvyaka?.applyTheme(this.state)
    window.__narvyaka?.applyContent(this.state)
    window.__narvyaka?.applyTiming(this.state)
    this.listeners.forEach((fn) => fn(this.state))
  }

  private quotaHandler: (() => void) | null = null

  onQuotaError(fn: () => void) {
    this.quotaHandler = fn
  }

  private notifyQuotaError() {
    this.quotaHandler?.()
  }

  export(): string {
    return JSON.stringify(this.state, null, 2)
  }

  /** Rough byte size — used to warn before localStorage runs out. */
  size(): number {
    return new Blob([JSON.stringify(this.state)]).size
  }
}

let instance: StudioStore | null = null

export function studioStore(): StudioStore {
  if (!instance) instance = new StudioStore()
  return instance
}

export type { StudioStore }
