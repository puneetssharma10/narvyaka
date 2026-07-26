import {
  ACCESS_LEVELS,
  RECORD_STATUSES,
  VERIFICATION_STATUSES,
  type WisdomRecord,
} from '../../../shared/record-schema'
import { getSession } from '../../_shared/auth'
import { BadJson, PayloadTooLarge, fail, json, readJson, requireBindings, type Env } from '../../_shared/env'

interface SubmissionRow {
  id: string
  status: string
  object_key: string
  owner_user_id: string | null
  payload_json: string
}

function canView(session: { id: string; role: string } | null, row: SubmissionRow): boolean {
  if (!session) return false
  if (session.role === 'admin' || session.role === 'super_admin') return true
  return row.owner_user_id === session.id
}

function canEditContent(session: { id: string; role: string } | null, row: SubmissionRow): boolean {
  if (!session) return false
  if (session.role === 'admin' || session.role === 'super_admin') return true
  // A volunteer owns the content only up to publication — after that, a
  // change to what's live goes through a reviewer, same as everything else.
  return row.owner_user_id === session.id && row.status !== 'published' && row.status !== 'withdrawn'
}

/** GET /api/submissions/:id — the owner, or an admin/super_admin, may read the full record. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const missing = requireBindings(env, ['DB'])
  if (missing) return missing

  const session = await getSession(env, request)
  const row = await env.DB!.prepare(`SELECT * FROM submissions WHERE id = ?1`)
    .bind(params.id as string)
    .first<SubmissionRow>()
  if (!row) return fail(404, 'No such record.')
  if (!canView(session, row)) return fail(403, "Your account doesn't have access to this record.")

  return json({ record: JSON.parse(row.payload_json), status: row.status })
}

/**
 * PATCH /api/submissions/:id
 *
 * body: {
 *   record?: Partial<WisdomRecord> — content sections to merge in
 *   status?: RecordStatus            — admin/super_admin only
 *   verification_status?: string    — admin/super_admin only
 *   review_notes?: string           — admin/super_admin only
 * }
 *
 * A volunteer may edit the content of a record they own, right up until it
 * is published or withdrawn. Only an admin or super_admin can move a record
 * through the review workflow itself (status, verification, notes) — that
 * boundary is what makes "pending_review" mean something.
 */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const missing = requireBindings(env, ['DB'])
  if (missing) return missing

  const session = await getSession(env, request)
  const id = params.id as string
  const row = await env.DB!.prepare(`SELECT * FROM submissions WHERE id = ?1`).bind(id).first<SubmissionRow>()
  if (!row) return fail(404, 'No such record.')

  const isReviewer = session?.role === 'admin' || session?.role === 'super_admin'
  if (!canEditContent(session, row) && !isReviewer) {
    return fail(403, "Your account doesn't have access to edit this record.")
  }

  let body: unknown
  try {
    body = await readJson(request, 2 * 1024 * 1024)
  } catch (error) {
    if (error instanceof PayloadTooLarge) return fail(413, 'That request is too large.')
    if (error instanceof BadJson) return fail(400, 'That request was not valid JSON.')
    throw error
  }

  const patch = (body ?? {}) as {
    record?: Partial<WisdomRecord>
    status?: string
    verification_status?: string
    review_notes?: string
  }

  const record: WisdomRecord = JSON.parse(row.payload_json)

  if (patch.record && canEditContent(session, row)) {
    const r = patch.record
    if (r.contributor) Object.assign(record.contributor, r.contributor)
    if (r.wisdom_record) Object.assign(record.wisdom_record, r.wisdom_record)
    if (r.family_learning_note) Object.assign(record.family_learning_note, r.family_learning_note)
    if (Array.isArray(r.photos)) record.photos = r.photos.slice(0, 5)
    if (r.classification) {
      const { verification_status: _ignored, ...rest } = r.classification as unknown as Record<string, unknown>
      Object.assign(record.classification, rest)
    }
    if (r.access) {
      if (r.access.level && !ACCESS_LEVELS.includes(r.access.level)) {
        return fail(400, 'That access level is not recognised.')
      }
      Object.assign(record.access, r.access)
    }
  }

  if (isReviewer) {
    if (patch.status !== undefined) {
      if (!RECORD_STATUSES.includes(patch.status as (typeof RECORD_STATUSES)[number])) {
        return fail(400, 'That status is not recognised.')
      }
      record.status = patch.status as WisdomRecord['status']
    }
    if (patch.verification_status !== undefined) {
      if (!VERIFICATION_STATUSES.includes(patch.verification_status as (typeof VERIFICATION_STATUSES)[number])) {
        return fail(400, 'That verification status is not recognised.')
      }
      record.classification.verification_status = patch.verification_status as WisdomRecord['classification']['verification_status']
    }
    if (patch.status !== undefined || patch.verification_status !== undefined || patch.review_notes !== undefined) {
      record.review = {
        reviewed_by: session!.id,
        reviewed_at: new Date().toISOString(),
        notes: patch.review_notes ?? record.review.notes,
      }
    }
  }

  try {
    await env.DB!.prepare(
      `UPDATE submissions SET
         status = ?1, contributor_name = ?2, display_as_anonymous = ?3, contributor_location = ?4,
         contributor_profession = ?5, record_language = ?6, contact = ?7, age_confirmed_30_plus = ?8,
         exception_reason = ?9, key_lesson = ?10, access_level = ?11, release_date = ?12,
         verification_status = ?13, photo_count = ?14, payload_json = ?15,
         reviewed_by = ?16, reviewed_at = ?17, review_notes = ?18
       WHERE id = ?19`,
    )
      .bind(
        record.status,
        record.contributor.name,
        record.contributor.display_as_anonymous ? 1 : 0,
        record.contributor.location,
        record.contributor.profession,
        record.contributor.record_language,
        record.contributor.contact,
        record.contributor.age_confirmed_30_plus ? 1 : 0,
        record.contributor.exception_reason,
        record.wisdom_record.key_lesson_text,
        record.access.level,
        record.access.release_date,
        record.classification.verification_status,
        record.photos.length,
        JSON.stringify(record),
        record.review.reviewed_by,
        record.review.reviewed_at,
        record.review.notes,
        id,
      )
      .run()
  } catch (error) {
    return fail(502, 'That change could not be saved.', { details: (error as Error).message })
  }

  if (env.MEDIA) {
    try {
      await env.MEDIA.put(row.object_key, JSON.stringify(record, null, 2), {
        httpMetadata: { contentType: 'application/json; charset=utf-8' },
        customMetadata: { status: record.status, submitted_at: record.submitted_at },
      })
    } catch {
      /* the D1 row is the record of truth; R2 mirror will lag until next edit */
    }
  }

  return json({ record })
}
