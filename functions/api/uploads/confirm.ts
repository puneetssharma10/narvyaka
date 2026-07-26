import {
  BadJson,
  MAX_UPLOAD_BYTES,
  PayloadTooLarge,
  fail,
  json,
  publicUrlFor,
  readJson,
  requireBindings,
  type Env,
} from '../../_shared/env'

/**
 * POST /api/uploads/confirm — body: { key, record_id, kind, content_type }
 *
 * Called after the browser finishes PUTting straight to R2 via the presigned
 * URL. A presigned URL's signature doesn't bind the actual byte count, so
 * this is where the 300 MB cap is actually enforced: it HEADs the real
 * object, deletes anything over the limit, and only then indexes it.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const missing = requireBindings(env, ['MEDIA'])
  if (missing) return missing

  let body: unknown
  try {
    body = await readJson(request, 4096)
  } catch (error) {
    if (error instanceof PayloadTooLarge) return fail(413, 'That request is too large.')
    if (error instanceof BadJson) return fail(400, 'That request was not valid JSON.')
    throw error
  }

  const { key, record_id, kind, content_type } = (body ?? {}) as {
    key?: string
    record_id?: string
    kind?: string
    content_type?: string
  }

  if (typeof key !== 'string' || !key.startsWith(`uploads/${record_id}/`)) {
    return fail(400, "That upload doesn't match the record it claims to belong to.")
  }
  if (kind !== 'audio' && kind !== 'photo') return fail(400, 'An upload must say whether it is audio or a photo.')

  const object = await env.MEDIA!.head(key)
  if (!object) {
    return fail(404, 'That upload has not landed in storage yet — please try again.', { code: 'not_found' })
  }

  if (object.size > MAX_UPLOAD_BYTES) {
    await env.MEDIA!.delete(key)
    return fail(413, `That file is larger than the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit.`)
  }

  if (env.DB) {
    try {
      await env.DB.prepare(
        `INSERT INTO uploads (key, record_id, kind, content_type, bytes, uploaded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
        .bind(key, record_id, kind, content_type ?? object.httpMetadata?.contentType ?? '', object.size, new Date().toISOString())
        .run()
    } catch {
      /* the object is stored; the index can be rebuilt from the bucket */
    }
  }

  return json({ url: publicUrlFor(env, key), key, bytes: object.size })
}
