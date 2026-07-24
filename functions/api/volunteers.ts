import { normaliseVolunteer } from '../../shared/record-schema'
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
 * POST /api/volunteers — a founding volunteer application.
 *
 * Master Reference Part IX.3: these are read by a person, every one of them.
 * Nothing here scores, ranks or auto-replies.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const missing = requireBindings(env, ['DB'])
  if (missing) return missing

  const ip = clientIp(request)
  const limit = await rateLimit(env, `volunteer:${ip}`, { limit: 5, windowSeconds: 3600 })
  if (!limit.ok) return fail(429, 'Too many applications from this connection.', { code: 'rate_limited' })

  let body: unknown
  try {
    body = await readJson(request, 256 * 1024)
  } catch (error) {
    if (error instanceof PayloadTooLarge) return fail(413, 'That application is longer than we can accept.')
    if (error instanceof BadJson) return fail(400, 'That request was not valid JSON.')
    throw error
  }

  const { ok, errors, application } = normaliseVolunteer(body)
  if (!ok) return fail(422, 'Some parts of the application still need attention.', { code: 'invalid', details: errors })

  try {
    await env.DB!.prepare(
      `INSERT INTO volunteers (
         id, status, submitted_at, name, contact, location,
         roles, languages, why, approach, time_commitment, client_ip
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    )
      .bind(
        application.id,
        application.status,
        application.submitted_at,
        application.name,
        application.contact,
        application.location,
        JSON.stringify(application.roles),
        JSON.stringify(application.languages),
        application.why,
        application.approach,
        application.time_commitment,
        ip,
      )
      .run()
  } catch (error) {
    return fail(502, 'Your application could not be saved.', {
      hint: 'Nothing was recorded, so please try again — or keep a copy with the download button and send it another way.',
      details: (error as Error).message,
    })
  }

  // Kept in R2 too, when it is available, so applications survive the database.
  if (env.MEDIA) {
    try {
      await env.MEDIA.put(`volunteers/${application.id}.json`, JSON.stringify(application, null, 2), {
        httpMetadata: { contentType: 'application/json; charset=utf-8' },
      })
    } catch {
      /* the D1 row is the record of truth here */
    }
  }

  return json({ id: application.id, status: application.status })
}
