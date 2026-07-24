/**
 * Loads the published archive from /content/capsules/*.json at build time.
 *
 * Phase 1 has no database in the render path (Build Brief §1). Records that
 * fail to parse are skipped with a warning rather than breaking the build —
 * a malformed file should never take the whole site down.
 */

import { toPublicRecord, type PublicRecord, type WisdomRecord } from '../../shared/record-schema'

export interface Capsule extends PublicRecord {
  /** Illustrative records are rendered but kept out of the archive listing. */
  is_example: boolean
}

const files = import.meta.glob<Record<string, unknown>>('../../content/capsules/*.json', { eager: true })

function load(): Capsule[] {
  const out: Capsule[] = []

  for (const [path, module] of Object.entries(files)) {
    const raw = ((module as any).default ?? module) as Partial<WisdomRecord> & { is_example?: boolean }

    if (!raw || typeof raw !== 'object' || !raw.id) {
      console.warn(`[narvyaka] skipping ${path}: no id`)
      continue
    }

    const publicRecord = toPublicRecord(raw as WisdomRecord)
    if (!publicRecord) {
      // Not an error: a record that is unpublished or not publicly accessible
      // is meant to sit here inertly.
      continue
    }

    out.push({ ...publicRecord, is_example: raw.is_example === true })
  }

  // Newest first.
  return out.sort((a, b) => b.published_at.localeCompare(a.published_at))
}

const all = load()

/** Everything renderable, including the illustrative example. */
export const allCapsules: Capsule[] = all

/** What the public archive lists — real records only. */
export const archiveCapsules: Capsule[] = all.filter((c) => !c.is_example)

export function getCapsule(id: string): Capsule | undefined {
  return all.find((c) => c.id === id)
}

/** Categories actually present in the archive, for the /browse filter. */
export function usedCategories(): string[] {
  const set = new Set<string>()
  for (const capsule of archiveCapsules) {
    if (capsule.classification.primary_category) set.add(capsule.classification.primary_category)
  }
  return [...set].sort()
}

/** Below this, a filter UI is noise rather than help (Build Brief §4.7). */
export const FILTER_THRESHOLD = 15

export function displayName(capsule: Pick<Capsule, 'contributor'>, anonymousLabel: string): string {
  if (capsule.contributor.anonymous) return anonymousLabel
  return capsule.contributor.preferred_name || capsule.contributor.name || anonymousLabel
}

export function contextLine(capsule: Pick<Capsule, 'contributor'>): string {
  const parts = [capsule.contributor.profession, capsule.contributor.location].filter(Boolean)
  return parts.join(' · ')
}
