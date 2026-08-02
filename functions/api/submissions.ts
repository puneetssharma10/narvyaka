import { normaliseRecord } from '../../shared/record-schema'
import { getSession } from '../_shared/auth'
import {
  BadJson,
  PayloadTooLarge,
  clientIp,
  fail,
  json,
  rateLimit,
  readJson,
  requireBindings,
  type Env,
} from '../_shared/env'

/**
 * POST /api/submissions — receive one Wisdom Record.
 *
 * LOCKED BEHAVIOUR (Build Brief §9, Master Reference Part IX.4):
 * every record is written with status 'pending_review'. There is no code path
 * here that publishes anything, and there must not be one. Publication happens
 * when a person moves an approved record into /content/capsules and rebuilds.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const missing = requireBindings(env, ['DB', 'MEDIA'])
  if (missing) return missing

  if (env.INTAKE_PAUSED === '1') {
    return fail(503, 'Narvyaka is not accepting new records at the moment.', {
      code: 'paused',
      hint: 'This is deliberate, not a fault. Please try again later — or keep a copy of your answers using the download button.',
    })
  }

  const ip = clientIp(request)
  const limit = await rateLimit(env, `submit:${ip}`, { limit: 8, windowSeconds: 3600 })
  if (!limit.ok) {
    return fail(429, 'That is a lot of records in one hour.', {
      code: 'rate_limited',
      hint: 'If this is genuine, get in touch through the volunteer page and we will lift the limit.',
    })
  }

  let body: unknown
  try {
    body = await readJson(request)
  } catch (error) {
    if (error instanceof PayloadTooLarge) {
      return fail(413, 'That record is larger than we can accept in one piece.', {
        hint: 'Photographs and recordings are uploaded separately — only the text should be in this request.',
      })
    }
    if (error instanceof BadJson) return fail(400, 'That request was not valid JSON.')
    throw error
  }

  const { ok, errors, record } = normaliseRecord(body)
  if (!ok) {
    return fail(422, 'Some parts of the record still need attention.', { code: 'invalid', details: errors })
  }

  // Signed-in volunteers/admins own the records they submit — nothing changes
  // for the public intake form, which has no session at all.
  const session = await getSession(env, request)

  // Two representations, written together (Master Reference Part XI):
  //  - the untouched submission in R2, which is the evidence
  //  - the structured row in D1, which is what makes it findable
  const objectKey = `submissions/${record.id}.json`

  try {
    await env.MEDIA!.put(objectKey, JSON.stringify(record, null, 2), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
      customMetadata: { status: record.status, submitted_at: record.submitted_at },
    })
  } catch (error) {
    return fail(502, 'Your record could not be stored.', {
      hint: 'Nothing was saved, so nothing is half-written. Please try again — and use the download button to keep your own copy.',
      details: (error as Error).message,
    })
  }

  try {
    await env.DB!.prepare(
      `INSERT INTO submissions (
         id, status, submitted_at, source, object_key,
         contributor_name, display_as_anonymous, contributor_location, contributor_country, contributor_profession,
         record_language, contact, age_confirmed_30_plus, exception_reason,
         key_lesson, access_level, release_date, verification_status,
         has_audio, photo_count, payload_json, client_ip, owner_user_id
       ) VALUES (
         ?1, ?2, ?3, ?4, ?5,
         ?6, ?7, ?8, ?9, ?10,
         ?11, ?12, ?13, ?14,
         ?15, ?16, ?17, ?18,
         ?19, ?20, ?21, ?22, ?23
       )`,
    )
      .bind(
        record.id,
        record.status,
        record.submitted_at,
        record.source,
        objectKey,
        record.contributor.name,
        record.contributor.display_as_anonymous ? 1 : 0,
        record.contributor.location,
        record.contributor.country || null,
        record.contributor.profession,
        record.contributor.record_language,
        record.contributor.contact,
        record.contributor.age_confirmed_30_plus ? 1 : 0,
        record.contributor.exception_reason,
        record.wisdom_record.key_lesson_text,
        record.access.level,
        record.access.release_date,
        record.classification.verification_status,
        record.wisdom_record.central_prompt_audio_url || Object.keys(record.wisdom_record.audio).length > 0 ? 1 : 0,
        record.photos.length,
        JSON.stringify(record),
        ip,
        session?.id ?? null,
      )
      .run()
  } catch (error) {
    const message = (error as Error).message
    if (/UNIQUE constraint failed/i.test(message)) {
      // The same record submitted twice — treat as success rather than
      // making someone re-type everything because of a double click.
      return json({ id: record.id, status: record.status, duplicate: true })
    }
    return fail(502, 'Your record was stored but could not be indexed.', {
      hint: `The submission itself is safe in object storage under ${objectKey}. Please tell us the reference so we can recover it.`,
      details: message,
    })
  }

  // Under-30 submissions and on-behalf records both go to the same queue —
  // the age gate is a routing decision, never a rejection (Part VIII.1).
  return json({
    id: record.id,
    status: record.status,
    needs_exception_review: !record.contributor.age_confirmed_30_plus,
  })
}
