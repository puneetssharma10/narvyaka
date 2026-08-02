/**
 * The Wisdom Record schema — Build Brief §6, Master Reference Part III + IV.
 *
 * Shared verbatim between the browser (form + preview) and the Cloudflare
 * Pages Functions (validation + persistence) so the two can never drift.
 * No dependencies: this file must run in a Worker, in Node, and in a browser.
 */

import { isCountry } from './countries'

/* ── Locked vocabularies ─────────────────────────────────────────────────── */

/**
 * EXACTLY THREE VALUES. Master Reference Part VII.1.
 * Do not add a fourth "unverified" default. A record with no independent
 * support is a Contributor's Account, which is a real status, not a lesser one.
 */
export const VERIFICATION_STATUSES = [
  'Documented',
  "Contributor's Account",
  'Family Tradition',
] as const
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]

/** Master Reference Part VI.2. */
export const ACCESS_LEVELS = [
  'public',
  'public_anonymous',
  'family_only',
  'restricted_research',
  'private',
  'preserved_not_published',
  'publish_after_date',
  'release_after_death',
] as const
export type AccessLevel = (typeof ACCESS_LEVELS)[number]

/** Nothing submitted through /preserve goes live automatically. */
export const RECORD_STATUSES = ['pending_review', 'approved', 'published', 'withdrawn'] as const
export type RecordStatus = (typeof RECORD_STATUSES)[number]

/** Only these access levels can ever appear in the public archive. */
export const PUBLIC_ACCESS_LEVELS: AccessLevel[] = ['public', 'public_anonymous']

/* ── Shapes ──────────────────────────────────────────────────────────────── */

export interface Contributor {
  name: string | null
  display_as_anonymous: boolean
  preferred_name: string | null
  location: string
  /** One of shared/countries.ts's COUNTRIES, or '' if not given — the
   *  free-text `location` field isn't reliable enough to filter by, this
   *  is what an admin's country-scoped access actually matches against. */
  country: string
  profession: string
  languages: string[]
  record_language: string
  age_confirmed_30_plus: boolean
  exception_reason: string | null
  /** Never published. Used only to come back to the contributor before publishing. */
  contact: string | null
}

export interface WisdomRecordBody {
  central_prompt_text: string
  central_prompt_audio_url: string | null
  what_happened: string
  what_they_did: string
  what_worked_failed: string
  what_differently: string
  key_lesson_text: string
  key_lesson_audio_url: string | null
  when_not_applicable: string
  who_can_confirm: string | null
  /** Audio for the remaining questions, keyed by question id. */
  audio: Record<string, string>
}

export interface Generation {
  name: string | null
  relation: string
  place: string | null
  what_they_knew: string
}

export interface FamilyLearningNote {
  summary: string
  generations: Generation[]
}

export interface Photo {
  url: string
  caption: string | null
}

export interface Classification {
  primary_category: string
  subcategory: string
  experience_type: string
  search_filters: {
    country: string
    state: string
    time_period: string
  }
  verification_status: VerificationStatus
}

export interface Access {
  level: AccessLevel
  release_date: string | null
}

export interface Review {
  reviewed_by: string | null
  reviewed_at: string | null
  notes: string | null
}

/** Present only when a volunteer filled the record in for someone else. */
export interface OnBehalf {
  submitted_by_name: string
  submitted_by_contact: string | null
  relationship: string
  contributor_consented: boolean
  contributor_present: boolean
}

export interface WisdomRecord {
  id: string
  status: RecordStatus
  submitted_at: string
  source: 'self' | 'on_behalf'
  contributor: Contributor
  wisdom_record: WisdomRecordBody
  family_learning_note: FamilyLearningNote
  photos: Photo[]
  classification: Classification
  access: Access
  review: Review
  on_behalf?: OnBehalf
}

export interface VolunteerApplication {
  id: string
  status: 'pending_review' | 'accepted' | 'declined'
  submitted_at: string
  name: string
  contact: string
  location: string
  roles: string[]
  languages: string[]
  why: string
  /** Master Reference Part IX.3 — the question the founding review turns on. */
  approach: string
  time_commitment: string
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  // Fallback for the rare runtime without randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

const str = (v: unknown, max = 20000): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : ''

const strOrNull = (v: unknown, max = 20000): string | null => {
  const s = str(v, max)
  return s === '' ? null : s
}

const bool = (v: unknown): boolean => v === true || v === 'true' || v === 'on' || v === 1

const strArray = (v: unknown, max = 40): string[] => {
  if (Array.isArray(v)) return v.map((x) => str(x, 200)).filter(Boolean).slice(0, max)
  if (typeof v === 'string')
    return v
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, max)
  return []
}

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(v as string) ? (v as T) : fallback

/** ISO-8601 date (YYYY-MM-DD) or full timestamp; anything else becomes null. */
const isoOrNull = (v: unknown): string | null => {
  const s = str(v, 40)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : s
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
  record: WisdomRecord
}

/**
 * Normalises whatever the browser sent into a valid WisdomRecord.
 *
 * This is deliberately forgiving about *shape* and strict about *policy*:
 * a missing optional answer is fine, but the status, the access level and the
 * verification status are decided here and cannot be set by the client.
 */
export function normaliseRecord(input: unknown, opts: { source?: 'self' | 'on_behalf' } = {}): ValidationResult {
  const raw = (input ?? {}) as Record<string, any>
  const errors: string[] = []

  const c = (raw.contributor ?? {}) as Record<string, any>
  const w = (raw.wisdom_record ?? {}) as Record<string, any>
  const f = (raw.family_learning_note ?? {}) as Record<string, any>
  const cl = (raw.classification ?? {}) as Record<string, any>
  const ac = (raw.access ?? {}) as Record<string, any>

  const centralPrompt = str(w.central_prompt_text)
  const centralAudio = strOrNull(w.central_prompt_audio_url, 2000)
  if (!centralPrompt && !centralAudio) {
    errors.push('The record needs an answer to the central question — typed or recorded.')
  }

  const keyLesson = str(w.key_lesson_text)
  const keyLessonAudio = strOrNull(w.key_lesson_audio_url, 2000)
  if (!keyLesson && !keyLessonAudio) {
    errors.push('The record needs an answer to “What should another person remember?”.')
  }

  const source = opts.source ?? oneOf(raw.source, ['self', 'on_behalf'] as const, 'self')

  const ageConfirmed = bool(c.age_confirmed_30_plus)
  const exceptionReason = strOrNull(c.exception_reason, 4000)
  // The age gate routes to review — it never blocks (Master Reference Part VIII.1).
  if (!ageConfirmed && !exceptionReason) {
    errors.push('If you are under 30, please tell us why this shouldn’t wait.')
  }

  const accessLevel = oneOf(ac.level, ACCESS_LEVELS, 'preserved_not_published')
  const releaseDate = isoOrNull(ac.release_date)
  if (accessLevel === 'publish_after_date' && !releaseDate) {
    errors.push('Choose the date this should be published on.')
  }

  const whoCanConfirm = strOrNull(w.who_can_confirm, 4000)

  const photos: Photo[] = Array.isArray(raw.photos)
    ? raw.photos
        .slice(0, 5)
        .map((p: any) => ({ url: str(p?.url, 2000), caption: strOrNull(p?.caption, 300) }))
        .filter((p) => p.url !== '')
    : []

  const generations: Generation[] = Array.isArray(f.generations)
    ? f.generations
        .slice(0, 12)
        .map((g: any) => ({
          name: strOrNull(g?.name, 200),
          relation: str(g?.relation, 100),
          place: strOrNull(g?.place, 200),
          what_they_knew: str(g?.what_they_knew, 4000),
        }))
        .filter((g) => g.name || g.relation || g.place || g.what_they_knew)
    : []

  const audio: Record<string, string> = {}
  if (w.audio && typeof w.audio === 'object') {
    for (const [k, v] of Object.entries(w.audio as Record<string, unknown>)) {
      const url = str(v, 2000)
      if (url) audio[str(k, 60)] = url
    }
  }

  const record: WisdomRecord = {
    id: str(raw.id, 64) || newId(),
    // Locked: never trust a client-supplied status.
    status: 'pending_review',
    submitted_at: new Date().toISOString(),
    source,
    contributor: {
      name: strOrNull(c.name, 300),
      display_as_anonymous: bool(c.display_as_anonymous),
      preferred_name: strOrNull(c.preferred_name, 300),
      location: str(c.location, 300),
      country: isCountry(c.country) ? c.country : '',
      profession: str(c.profession, 300),
      languages: strArray(c.languages),
      record_language: str(c.record_language, 100),
      age_confirmed_30_plus: ageConfirmed,
      exception_reason: exceptionReason,
      contact: strOrNull(c.contact, 300),
    },
    wisdom_record: {
      central_prompt_text: centralPrompt,
      central_prompt_audio_url: centralAudio,
      what_happened: str(w.what_happened),
      what_they_did: str(w.what_they_did),
      what_worked_failed: str(w.what_worked_failed),
      what_differently: str(w.what_differently),
      key_lesson_text: keyLesson,
      key_lesson_audio_url: keyLessonAudio,
      when_not_applicable: str(w.when_not_applicable),
      who_can_confirm: whoCanConfirm,
      audio,
    },
    family_learning_note: {
      summary: str(f.summary, 8000),
      generations,
    },
    photos,
    classification: {
      primary_category: str(cl.primary_category, 120),
      subcategory: str(cl.subcategory, 120),
      experience_type: str(cl.experience_type, 120),
      search_filters: {
        country: str(cl.search_filters?.country, 120),
        state: str(cl.search_filters?.state, 120),
        time_period: str(cl.search_filters?.time_period, 120),
      },
      // Set by a reviewer, never by the form. A record with someone who can
      // confirm it is still only an account until a person has checked.
      verification_status: "Contributor's Account",
    },
    access: {
      level: accessLevel,
      release_date: releaseDate,
    },
    review: {
      reviewed_by: null,
      reviewed_at: null,
      notes: null,
    },
  }

  if (source === 'on_behalf') {
    const ob = (raw.on_behalf ?? {}) as Record<string, any>
    const consented = bool(ob.contributor_consented)
    if (!consented) {
      errors.push('A record submitted for someone else needs their confirmed consent.')
    }
    record.on_behalf = {
      submitted_by_name: str(ob.submitted_by_name, 300),
      submitted_by_contact: strOrNull(ob.submitted_by_contact, 300),
      relationship: str(ob.relationship, 300),
      contributor_consented: consented,
      contributor_present: bool(ob.contributor_present),
    }
    if (!record.on_behalf.submitted_by_name) {
      errors.push('Please tell us who is submitting this record.')
    }
  }

  return { ok: errors.length === 0, errors, record }
}

export function normaliseVolunteer(input: unknown): {
  ok: boolean
  errors: string[]
  application: VolunteerApplication
} {
  const raw = (input ?? {}) as Record<string, any>
  const errors: string[] = []

  const name = str(raw.name, 300)
  const contact = str(raw.contact, 300)
  const approach = str(raw.approach, 8000)
  const roles = strArray(raw.roles, 12)

  if (!name) errors.push('Please tell us your name.')
  if (!contact) errors.push('Please give us a way to reply to you.')
  if (roles.length === 0) errors.push('Choose at least one role.')
  if (!approach) errors.push('Please answer the question about privacy and consent.')

  return {
    ok: errors.length === 0,
    errors,
    application: {
      id: str(raw.id, 64) || newId(),
      status: 'pending_review',
      submitted_at: new Date().toISOString(),
      name,
      contact,
      location: str(raw.location, 300),
      roles,
      languages: strArray(raw.languages),
      why: str(raw.why, 8000),
      approach,
      time_commitment: str(raw.time_commitment, 200),
    },
  }
}

/**
 * Strips everything that must never leave the server for a given access level.
 * Used when building the public archive and the /capsule/[id] pages.
 */
export function toPublicRecord(record: WisdomRecord): PublicRecord | null {
  if (record.status !== 'published') return null
  if (!PUBLIC_ACCESS_LEVELS.includes(record.access.level)) return null

  const anonymous = record.access.level === 'public_anonymous' || record.contributor.display_as_anonymous

  return {
    id: record.id,
    published_at: record.submitted_at,
    contributor: {
      name: anonymous ? null : record.contributor.name,
      anonymous,
      preferred_name: anonymous ? null : record.contributor.preferred_name,
      location: anonymous ? '' : record.contributor.location,
      profession: anonymous ? '' : record.contributor.profession,
      record_language: record.contributor.record_language,
    },
    key_lesson: record.wisdom_record.key_lesson_text,
    key_lesson_audio_url: record.wisdom_record.key_lesson_audio_url,
    audio_url: record.wisdom_record.central_prompt_audio_url,
    note: {
      central_prompt: record.wisdom_record.central_prompt_text,
      what_happened: record.wisdom_record.what_happened,
      what_they_did: record.wisdom_record.what_they_did,
      what_worked_failed: record.wisdom_record.what_worked_failed,
      what_differently: record.wisdom_record.what_differently,
      when_not_applicable: record.wisdom_record.when_not_applicable,
      who_can_confirm: record.wisdom_record.who_can_confirm,
    },
    family_learning_note: record.family_learning_note,
    photos: record.photos,
    classification: record.classification,
  }
}

export interface PublicRecord {
  id: string
  published_at: string
  contributor: {
    name: string | null
    anonymous: boolean
    preferred_name: string | null
    location: string
    profession: string
    record_language: string
  }
  key_lesson: string
  key_lesson_audio_url: string | null
  audio_url: string | null
  note: {
    central_prompt: string
    what_happened: string
    what_they_did: string
    what_worked_failed: string
    what_differently: string
    when_not_applicable: string
    who_can_confirm: string | null
  }
  family_learning_note: FamilyLearningNote
  photos: Photo[]
  classification: Classification
}
