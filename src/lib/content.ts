import siteContent from '../data/site.json'
import { getPath } from '../../shared/overrides'

export type SiteContent = typeof siteContent

/** The whole editable content tree. Import this in .astro files. */
export const content = siteContent as SiteContent

/**
 * Read a value by dotted path, e.g. t('home.hero.tagline').
 * Returns '' rather than throwing, so a typo in a path never breaks a build —
 * it shows up as an obviously empty slot on the page instead.
 */
export function t(path: string): string {
  const value = getPath(content, path)
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (import.meta.env.DEV && value === undefined) {
    console.warn(`[narvyaka] content path not found: ${path}`)
  }
  return ''
}

/** Read an array by dotted path — for repeated blocks. */
export function list<T = any>(path: string): T[] {
  const value = getPath(content, path)
  return Array.isArray(value) ? (value as T[]) : []
}

/**
 * Spread onto an element to make it editable in the Studio:
 *   <h1 {...editable('home.hero.tagline')}>{t('home.hero.tagline')}</h1>
 *
 * Outside the Studio this is a single inert data attribute — no JS, no cost.
 */
export function editable(path: string): { 'data-edit': string } {
  return { 'data-edit': path }
}

/**
 * Spread onto an <img> wrapper to make the image replaceable in the Studio.
 * `path` points at the string in site.json holding the image src.
 */
export function editableImage(path: string, opts: { aspect?: string } = {}) {
  return {
    'data-edit-image': path,
    ...(opts.aspect ? { 'data-edit-aspect': opts.aspect } : {}),
  }
}
