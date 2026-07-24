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

export const siteConfig = {
  // ── ADD ON PURCHASE ───────────────────────────────────────────────────────
  /** e.g. "narvyaka.org"  — leave "" until the domain is bought. */
  domain: '',

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
  description:
    'Narvyaka preserves first-hand human experience — in the person’s own voice — so that the next generation does not have to start from nothing.',

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
} as const

/** Canonical origin. Falls back to a relative-safe placeholder until the domain exists. */
export const siteUrl = siteConfig.domain ? `https://${siteConfig.domain}` : 'http://localhost:4321'

/** True once a real domain is configured — gates sitemap, canonical tags, og:url. */
export const hasDomain = siteConfig.domain !== ''

/** True once a real mailbox exists — gates every mailto: link in the UI. */
export const hasEmail = siteConfig.contactEmail !== ''

/** Social links that actually have a URL, in display order. */
export const activeSocials = Object.entries(siteConfig.social)
  .filter(([, url]) => url !== '')
  .map(([key, url]) => ({ key, url }))

export type SiteConfig = typeof siteConfig
