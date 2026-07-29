/**
 * Talking to the Pages Functions in /functions.
 *
 * Every failure path here is designed around one rule: a contributor must
 * never lose twenty minutes of work because a binding was not configured.
 * If the backend is not ready, we say so honestly and hand back the answers
 * as a file rather than pretending the submission succeeded.
 */

export class ApiError extends Error {
  status: number
  hint?: string
  /** True when the backend is reachable but not wired up to D1/R2 yet. */
  notConfigured: boolean

  constructor(message: string, status: number, opts: { hint?: string; notConfigured?: boolean } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.hint = opts.hint
    this.notConfigured = opts.notConfigured ?? false
  }
}

async function readError(response: Response): Promise<ApiError> {
  let body: { error?: string; hint?: string; code?: string } = {}
  try {
    body = (await response.json()) as typeof body
  } catch {
    /* not JSON — fall through to the status text */
  }

  return new ApiError(body.error ?? `The server returned ${response.status}.`, response.status, {
    hint: body.hint,
    notConfigured: body.code === 'not_configured' || response.status === 501,
  })
}

export interface UploadResult {
  url: string
  key: string
  bytes: number
}

/**
 * Uploads one file to object storage and returns the URL to store in the record.
 *
 * Goes straight to R2 via a presigned URL rather than through a Pages
 * Function — Cloudflare caps a Function's own request body at 100–500 MB
 * depending on plan, which a 300 MB recording can exceed on anything but
 * Enterprise. The `endpoint` parameter is kept for compatibility with
 * existing callers but is no longer used to receive the file's bytes.
 */
export async function uploadFile(
  _endpoint: string,
  blob: Blob,
  opts: { filename: string; kind: 'audio' | 'photo'; recordId: string },
): Promise<UploadResult> {
  const contentType = blob.type || (opts.kind === 'audio' ? 'audio/webm' : 'image/jpeg')

  const presignResponse = await fetch('/api/uploads/presign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      record_id: opts.recordId,
      kind: opts.kind,
      content_type: contentType,
      bytes: blob.size,
    }),
  })
  if (!presignResponse.ok) throw await readError(presignResponse)
  // `node` names which bucket the signature points at — it is passed back to
  // /confirm so the size check runs against the bucket the file actually
  // reached, which need not be this account's own.
  const { uploadUrl, key, node } = (await presignResponse.json()) as {
    uploadUrl: string
    key: string
    node?: string
  }

  const putResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: blob,
  })
  if (!putResponse.ok) {
    throw new ApiError('That upload did not reach storage.', putResponse.status)
  }

  const confirmResponse = await fetch('/api/uploads/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, record_id: opts.recordId, kind: opts.kind, content_type: contentType, node }),
  })
  if (!confirmResponse.ok) throw await readError(confirmResponse)
  return (await confirmResponse.json()) as UploadResult
}

export interface SubmitResult {
  id: string
  status: string
}

export async function submitJson<T>(endpoint: string, payload: unknown): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw await readError(response)
  return (await response.json()) as T
}

/** Lets the contributor keep their own copy when anything goes wrong. */
export function downloadBackup(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function extensionFor(mimeType: string): string {
  const map: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
  }
  const base = mimeType.split(';')[0].trim()
  return map[base] ?? 'bin'
}
