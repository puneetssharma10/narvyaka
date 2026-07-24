import { fail, type Env } from '../_shared/env'

/**
 * GET /media/<key> — serves an object from R2.
 *
 * Only needed while the bucket has no public domain of its own. Set
 * PUBLIC_MEDIA_BASE_URL to an R2 custom domain and this route stops being used
 * (uploads will return that URL instead), which is cheaper and faster.
 *
 * Read-only, and scoped: nothing under submissions/ or volunteers/ is
 * reachable here, because those contain answers at every access level
 * including private ones.
 */

const PUBLIC_PREFIXES = ['uploads/', 'capsules/', 'site/']

export const onRequestGet: PagesFunction<Env> = async ({ params, env, request }) => {
  if (!env.MEDIA) return fail(503, 'Media storage is not connected on this deployment.', { code: 'not_configured' })

  const segments = Array.isArray(params.path) ? params.path : [params.path]
  const key = segments.filter(Boolean).join('/')

  if (!key || key.includes('..')) return fail(400, 'Not a valid media path.')

  // Private submissions live in the same bucket. They are not web-readable.
  if (!PUBLIC_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return fail(404, 'Not found.')
  }

  const object = await env.MEDIA.get(key, {
    range: request.headers,
    onlyIf: request.headers,
  })

  if (!object) return fail(404, 'Not found.')

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('x-content-type-options', 'nosniff')
  if (!headers.has('cache-control')) {
    headers.set('cache-control', 'public, max-age=31536000, immutable')
  }
  // Media is served for playback and display only.
  headers.set('content-disposition', 'inline')

  // A conditional or range request returns no body.
  if (!('body' in object) || object.body === null) {
    return new Response(null, { status: headers.has('content-range') ? 206 : 304, headers })
  }

  return new Response(object.body, { status: headers.has('content-range') ? 206 : 200, headers })
}
