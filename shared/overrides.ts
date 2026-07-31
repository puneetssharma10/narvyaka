/**
 * The override format produced by the Studio and consumed by three places:
 *
 *   1. the browser at runtime  (src/lib/studio-runtime.ts — live preview)
 *   2. `npm run studio:apply`  (scripts/apply-overrides.mjs — writes to code)
 *   3. the API                 (functions/api/studio.ts — optional server copy)
 *
 * Keep it boring and JSON-serialisable. No dependencies.
 */

export const OVERRIDES_STORAGE_KEY = 'narvyaka.studio.overrides.v1'
export const OVERRIDES_VERSION = 1

/** Design tokens the Studio can recolour. Order is the order shown in the UI. */
export const COLOR_TOKENS = [
  { key: 'bg', label: 'Page', hint: 'Cool platinum. Keep it very light — never cream or beige.' },
  { key: 'surface', label: 'Cards', hint: 'Panels and cards sitting on the page.' },
  { key: 'carbon', label: 'Dark sections', hint: 'The hero and footer. Near-black, slightly blue.' },
  { key: 'ink', label: 'Text', hint: 'Near-black. Avoid pure #000000.' },
  { key: 'muted', label: 'Secondary text', hint: 'Captions, hints, metadata.' },
  { key: 'hairline', label: 'Lines', hint: 'Borders and dividers.' },
  { key: 'accent', label: 'Primary', hint: 'Buttons, links, the brand colour. Electric cobalt.' },
  { key: 'accent-hover', label: 'Primary (hover)', hint: 'A step deeper than the primary.' },
  { key: 'accent-soft', label: 'Primary (soft)', hint: 'Tag and badge backgrounds.' },
  { key: 'signal', label: 'Signal', hint: 'Rosso. Emphasis only — never a whole surface.' },
  { key: 'signal-soft', label: 'Signal (soft)', hint: 'Backgrounds for signal badges.' },
  { key: 'verified', label: 'Verified', hint: 'The “Documented” badge. Verde.' },
  { key: 'caution', label: 'Caution', hint: 'Warnings and placeholder notices. Giallo.' },
] as const

export type ColorToken = (typeof COLOR_TOKENS)[number]['key']

/** Every family bundled with the site. Nothing here hits an external CDN. */
export const FONT_OPTIONS = [
  {
    label: 'Space Grotesk',
    value: "'Space Grotesk Variable', system-ui, sans-serif",
    kind: 'sans',
    note: 'The wordmark face. Technical and precise — reads like badging.',
  },
  {
    label: 'Sora',
    value: "'Sora Variable', system-ui, sans-serif",
    kind: 'sans',
    note: 'The default heading face. Geometric, confident, modern.',
  },
  {
    label: 'Outfit',
    value: "'Outfit Variable', system-ui, sans-serif",
    kind: 'sans',
    note: 'Cleaner and rounder than Sora. Good for a softer look.',
  },
  {
    label: 'Inter',
    value: "'Inter Variable', system-ui, sans-serif",
    kind: 'sans',
    note: 'The default body face. Neutral and clear at small sizes.',
  },
  {
    label: 'Public Sans',
    value: "'Public Sans Variable', system-ui, sans-serif",
    kind: 'sans',
    note: 'A touch more open than Inter.',
  },
  {
    label: 'System default',
    value: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
    kind: 'sans',
    note: 'Whatever the reader’s device uses. Fastest, least distinctive.',
  },
] as const

export const FONT_SLOTS = [
  { key: 'wordmark', label: 'Wordmark', hint: 'The “Narvyaka” lockup in the header.' },
  { key: 'heading', label: 'Headings', hint: 'H1–H4 across the site.' },
  { key: 'body', label: 'Body text', hint: 'Paragraphs, forms, buttons.' },
] as const

export type FontSlot = (typeof FONT_SLOTS)[number]['key']

export interface LogoOverride {
  /** Data URI or a URL from object storage. Empty string means "use the wordmark". */
  src: string
  alt: string
  /** Rendered height in the header, in px. */
  height: number
}

export interface StudioOverrides {
  version: number
  updated_at: string
  theme: {
    colors: Partial<Record<ColorToken, string>>
    fonts: Partial<Record<FontSlot, string>>
    logo?: LogoOverride
  }
  /** Dotted path into src/data/site.json → replacement text. */
  text: Record<string, string>
  /** Dotted path into src/data/site.json → replacement image src. */
  images: Record<string, string>
  /** Dotted path into src/data/site.json → seconds between slides, for an
   *  auto-rotating gallery (the example capsule photos, the wisdom slider). */
  timing: Record<string, number>
}

/** Slower than this and a rotation reads as broken, not deliberate; faster
 *  and nobody can actually read what changed. Shared by validation and by
 *  the Studio's range input, so the two can never disagree. */
export const MIN_ROTATION_SECONDS = 2
export const MAX_ROTATION_SECONDS = 20

export function clampRotationSeconds(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return MIN_ROTATION_SECONDS
  return Math.min(MAX_ROTATION_SECONDS, Math.max(MIN_ROTATION_SECONDS, Math.round(n * 2) / 2))
}

export function emptyOverrides(): StudioOverrides {
  return {
    version: OVERRIDES_VERSION,
    updated_at: new Date().toISOString(),
    theme: { colors: {}, fonts: {} },
    text: {},
    images: {},
    timing: {},
  }
}

export function isEmptyOverrides(o: StudioOverrides | null | undefined): boolean {
  if (!o) return true
  return (
    Object.keys(o.theme?.colors ?? {}).length === 0 &&
    Object.keys(o.theme?.fonts ?? {}).length === 0 &&
    !o.theme?.logo?.src &&
    Object.keys(o.text ?? {}).length === 0 &&
    Object.keys(o.images ?? {}).length === 0 &&
    Object.keys(o.timing ?? {}).length === 0
  )
}

export function countOverrides(o: StudioOverrides | null | undefined): number {
  if (!o) return 0
  return (
    Object.keys(o.theme?.colors ?? {}).length +
    Object.keys(o.theme?.fonts ?? {}).length +
    (o.theme?.logo?.src ? 1 : 0) +
    Object.keys(o.text ?? {}).length +
    Object.keys(o.images ?? {}).length +
    Object.keys(o.timing ?? {}).length
  )
}

/** Defensive parse — a corrupt localStorage entry must never blank the site. */
export function parseOverrides(input: unknown): StudioOverrides | null {
  try {
    const raw = (typeof input === 'string' ? JSON.parse(input) : input) as Record<string, any>
    if (!raw || typeof raw !== 'object') return null

    const colors: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw.theme?.colors ?? {})) {
      if (typeof v === 'string' && isSafeCssValue(v)) colors[k] = v
    }

    const fonts: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw.theme?.fonts ?? {})) {
      if (typeof v === 'string' && isSafeCssValue(v)) fonts[k] = v
    }

    const text: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw.text ?? {})) {
      if (typeof v === 'string') text[k] = v
    }

    const images: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw.images ?? {})) {
      if (typeof v === 'string' && isSafeImageSrc(v)) images[k] = v
    }

    const timing: Record<string, number> = {}
    for (const [k, v] of Object.entries(raw.timing ?? {})) {
      if (typeof v === 'number' && Number.isFinite(v)) timing[k] = clampRotationSeconds(v)
    }

    const logoSrc = raw.theme?.logo?.src
    const logo: LogoOverride | undefined =
      typeof logoSrc === 'string' && isSafeImageSrc(logoSrc)
        ? {
            src: logoSrc,
            alt: typeof raw.theme.logo.alt === 'string' ? raw.theme.logo.alt : 'Narvyaka',
            height: clampHeight(raw.theme.logo.height),
          }
        : undefined

    return {
      version: typeof raw.version === 'number' ? raw.version : OVERRIDES_VERSION,
      updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : new Date().toISOString(),
      theme: { colors, fonts, ...(logo ? { logo } : {}) },
      text,
      images,
      timing,
    }
  } catch {
    return null
  }
}

function clampHeight(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 30
  return Math.min(120, Math.max(16, Math.round(n)))
}

/**
 * A CSS value is injected into a custom property, so it must not be able to
 * close the declaration and start a new one, or smuggle in a url().
 */
export function isSafeCssValue(v: string): boolean {
  if (v.length > 300) return false
  if (/[;{}<>\\]/.test(v)) return false
  if (/url\s*\(/i.test(v)) return false
  if (/expression\s*\(/i.test(v)) return false
  if (/@import/i.test(v)) return false
  return true
}

/**
 * Only same-origin paths and inline image data — never javascript:, and never
 * a remote host that could serve something other than an image.
 *
 * SVG is allowed because a logomark should stay vector. It is only ever
 * rendered through <img src>, which is a passive context: scripts and external
 * references inside an SVG do not execute there. The Studio additionally
 * refuses any SVG containing a <script> before it gets this far.
 */
export function isSafeImageSrc(v: string): boolean {
  if (v === '') return true
  if (v.length > 8_000_000) return false
  if (/^data:image\/(png|jpeg|jpg|webp|gif|avif|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/i.test(v)) return true
  if (/^\/[^\s"'<>\\]*$/.test(v)) return true // same-origin absolute path
  if (/^https:\/\/[^\s"'<>\\]+$/i.test(v)) return true // object storage URL
  return false
}

/* ── Dotted-path helpers, used by the runtime and the apply script ───────── */

export function getPath(obj: any, path: string): unknown {
  return path.split('.').reduce((acc, key) => {
    if (acc === null || acc === undefined) return undefined
    return acc[normaliseKey(key)]
  }, obj)
}

export function setPath(obj: any, path: string, value: unknown): boolean {
  const parts = path.split('.')
  const last = parts.pop()
  if (!last) return false

  let cursor = obj
  for (const part of parts) {
    const key = normaliseKey(part)
    if (cursor === null || cursor === undefined) return false
    if (!(key in cursor)) return false // never invent new keys in site.json
    cursor = cursor[key]
  }

  const lastKey = normaliseKey(last)
  if (cursor === null || typeof cursor !== 'object') return false
  if (!(lastKey in cursor)) return false
  cursor[lastKey] = value
  return true
}

/** "items.0.title" → array index 0 */
function normaliseKey(key: string): string | number {
  return /^\d+$/.test(key) ? Number(key) : (key as any)
}
