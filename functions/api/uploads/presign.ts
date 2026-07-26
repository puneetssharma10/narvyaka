import { r2Credentials, presignPutUrl } from '../../_shared/r2-presign'
import {
  ALLOWED_UPLOAD_TYPES,
  BadJson,
  MAX_UPLOAD_BYTES,
  PayloadTooLarge,
  clientIp,
  fail,
  json,
  rateLimit,
  readJson,
  type Env,
} from '../../_shared/env'

/**
 * POST /api/uploads/presign — body: { record_id, kind, content_type, bytes }
 *
 * Returns a short-lived URL the browser PUTs the file to directly, bypassing
 * this Function's own request-size ceiling entirely (see r2-presign.ts for
 * why that matters at 300 MB). The declared byte count is only a courtesy
 * check here — /api/uploads/confirm verifies the real size against R2 after
 * the upload lands, and removes anything over the limit.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const creds = r2Credentials(env)
  if (!creds) {
    return fail(503, 'Direct uploads are not connected to object storage yet.', {
      code: 'not_configured',
      hint:
        'Create an R2 API token (R2 → Manage R2 API Tokens → Object Read & Write, scoped to this bucket) ' +
        'and set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME as Pages secrets. See INTEGRATIONS.md.',
    })
  }

  const ip = clientIp(request)
  const limit = await rateLimit(env, `upload:${ip}`, { limit: 60, windowSeconds: 3600 })
  if (!limit.ok) {
    return fail(429, 'Too many uploads from this connection in the last hour.', { code: 'rate_limited' })
  }

  let body: unknown
  try {
    body = await readJson(request, 4096)
  } catch (error) {
    if (error instanceof PayloadTooLarge) return fail(413, 'That request is too large.')
    if (error instanceof BadJson) return fail(400, 'That request was not valid JSON.')
    throw error
  }

  const { record_id, kind, content_type, bytes } = (body ?? {}) as {
    record_id?: string
    kind?: string
    content_type?: string
    bytes?: number
  }

  const recordId = sanitiseId(String(record_id ?? ''))
  if (!recordId) return fail(400, 'A valid record reference is required with every upload.')

  if (kind !== 'audio' && kind !== 'photo') {
    return fail(400, 'An upload must say whether it is audio or a photo.')
  }

  const declaredType = String(content_type ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase()
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

  if (!Number.isFinite(bytes) || (bytes as number) <= 0) return fail(400, 'That file is empty.')
  if ((bytes as number) > MAX_UPLOAD_BYTES) {
    return fail(413, `That file is larger than the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit.`)
  }

  const key = `uploads/${recordId}/${crypto.randomUUID()}.${extension}`
  const { url, expiresAt } = await presignPutUrl(creds, key)

  return json({ uploadUrl: url, key, expiresAt })
}

function sanitiseId(value: string): string {
  return /^[a-f0-9-]{8,64}$/i.test(value) ? value.toLowerCase() : ''
}
