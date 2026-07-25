/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  NARVYAKA — TOP ENTRY CONFIG
 *  This is the only file you need to edit when you buy the domain.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  1. Bought the domain?  Put it in `domain` below (no https://, no trailing /).
 *  2. Got an email address?  Put it in `contactEmail`.
 *  3. Made the GitHub repo public / created an org?  Put it in `social.github`.
 *
 *  Anything left as "" is treated as "not ready yet" and is hidden from the
 *  site automatically — no broken links, no empty mailto:, no dead icons.
 *  Nothing else in the codebase needs to change.
 */

/**
 * The three fields at the top are typed as plain `string` rather than inferred
 * as literals, so the "is it set yet?" checks below stay meaningful whatever
 * you put in them.
 */
interface EditableConfig {
  domain: string
  contactEmail: string
  social: { github: string; instagram: string; youtube: string; linkedin: string; x: string }
}

export const siteConfig = {
  // ── ADD ON PURCHASE ───────────────────────────────────────────────────────
  /**
   * Currently the free Cloudflare Pages subdomain. Replace this single line
   * with your own domain the day you buy it — e.g. 'narvyaka.com' — and
   * canonical URLs, og:url and the sitemap all follow automatically.
   */
  domain: 'narvyaka.pages.dev',

  /** e.g. "hello@narvyaka.org" — leave "" until the mailbox exists. */
  contactEmail: '',

  /** e.g. "https://github.com/puneetssharma10/narvyaka" — leave "" for now. */
  social: {
    github: '',
    instagram: '',
    youtube: '',
    linkedin: '',
    x: '',
  },
  // ──────────────────────────────────────────────────────────────────────────

  /** Shown in the browser tab and social cards. */
  name: 'Narvyaka',
  tagline: 'Because No Generation Should Start From Zero.',
  philosophy: 'Preserve. Connect. Continue.',
  /** From the Founding Vision's closing page. */
  strapline: 'Preserving Humanity\'s Wisdom, One Life at a Time.',
  founder: 'Puneet Sharma',
  description:
    'Narvyaka is a global movement to preserve lived human wisdom before it disappears — not the facts already written down, but the understanding that only comes from having actually lived through something.',

  /**
   * Legal entity line used in the footer and the policy pages.
   * Update once the entity is registered (Master Reference Part XV).
   */
  legalEntity: 'Narvyaka (founding stage — entity registration pending)',

  /** Year the project started, used for the footer copyright range. */
  foundedYear: 2026,

  /**
   * Where the browser sends form submissions.
   * Leave as-is: these are the Cloudflare Pages Functions in /functions.
   */
  api: {
    submissions: '/api/submissions',
    volunteers: '/api/volunteers',
    uploads: '/api/uploads',
    studio: '/api/studio',
    health: '/api/health',
  },
} as const satisfies { [K in keyof EditableConfig]: EditableConfig[K] } & Record<string, unknown>

/** Canonical origin. Falls back to a relative-safe placeholder until the domain exists. */
export const siteUrl = siteConfig.domain ? `https://${siteConfig.domain}` : 'http://localhost:4321'

/** True once a real domain is configured — gates sitemap, canonical tags, og:url. */
export const hasDomain: boolean = (siteConfig.domain as string) !== ''

/** True once a real mailbox exists — gates every mailto: link in the UI. */
export const hasEmail: boolean = (siteConfig.contactEmail as string) !== ''

/** Social links that actually have a URL, in display order. */
export const activeSocials = Object.entries(siteConfig.social)
  .filter(([, url]) => url !== '')
  .map(([key, url]) => ({ key, url }))

export type SiteConfig = typeof siteConfig
