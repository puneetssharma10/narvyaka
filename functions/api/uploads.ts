import {
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  clientIp,
  fail,
  json,
  publicUrlFor,
  rateLimit,
  requireBindings,
  type Env,
} from '../_shared/env'

/**
 * POST /api/uploads — one audio recording or photograph, multipart.
 *
 * Files land in R2 under uploads/<record id>/, so everything belonging to a
 * submission stays together and can be deleted together if the contributor
 * withdraws it.
 *
 * The intake form no longer calls this — see /api/uploads/presign and
 * /api/uploads/confirm, which upload straight to R2 and aren't bounded by a
 * Function's own request-size ceiling. This endpoint is kept for anything
 * small enough not to need that (well under the platform's ~100 MB floor).
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const missing = requireBindings(env, ['MEDIA'])
  if (missing) return missing

  const ip = clientIp(request)
  const limit = await rateLimit(env, `upload:${ip}`, { limit: 60, windowSeconds: 3600 })
  if (!limit.ok) {
    return fail(429, 'Too many uploads from this connection in the last hour.', { code: 'rate_limited' })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return fail(400, 'That upload was not readable as a form.')
  }

  const file = form.get('file')
  if (!(file instanceof File)) return fail(400, 'No file was included in the upload.')

  const kind = String(form.get('kind') ?? '')
  if (kind !== 'audio' && kind !== 'photo') {
    return fail(400, 'An upload must say whether it is audio or a photo.')
  }

  if (file.size === 0) return fail(400, 'That file is empty.')
  if (file.size > MAX_UPLOAD_BYTES) {
    return fail(413, `That file is larger than the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit.`)
  }

  // Trust the declared type only as far as the allowlist — anything not on it
  // is refused rather than stored under a guessed extension.
  const declaredType = (file.type || '').split(';')[0].trim().toLowerCase()
  const extension = ALLOWED_UPLOAD_TYPES[declaredType]
  if (!extension) {
    return fail(415, `Files of type "${declaredType || 'unknown'}" are not accepted.`, {
      hint: `Accepted: ${Object.keys(ALLOWED_UPLOAD_TYPES).join(', ')}`,
    })
  }

  const isAudio = declaredType.startsWith('audio/')
  if ((kind === 'audio') !== isAudio) {
    return fail(400, 'That file does not match the kind of upload it was sent as.')
  }

  const recordId = sanitiseId(String(form.get('record_id') ?? ''))
  if (!recordId) return fail(400, 'A valid record reference is required with every upload.')

  const key = `uploads/${recordId}/${crypto.randomUUID()}.${extension}`

  try {
    await env.MEDIA!.put(key, file.stream(), {
      httpMetadata: {
        contentType: declaredType,
        // Media for a record never changes once written.
        cacheControl: 'public, max-age=31536000, immutable',
      },
      customMetadata: { record_id: recordId, kind, original_name: safeName(file.name) },
    })
  } catch (error) {
    return fail(502, 'That file could not be stored.', { details: (error as Error).message })
  }

  // Best-effort index. A missing row must not fail an upload that succeeded.
  if (env.DB) {
    try {
      await env.DB.prepare(
        `INSERT INTO uploads (key, record_id, kind, content_type, bytes, uploaded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
        .bind(key, recordId, kind, declaredType, file.size, new Date().toISOString())
        .run()
    } catch {
      /* the object is stored; the index can be rebuilt from the bucket */
    }
  }

  return json({ url: publicUrlFor(env, key), key, bytes: file.size })
}

/** UUIDs only — this value becomes part of a storage path. */
function sanitiseId(value: string): string {
  return /^[a-f0-9-]{8,64}$/i.test(value) ? value.toLowerCase() : ''
}

function safeName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, '').slice(0, 120)
}
