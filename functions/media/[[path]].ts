import { fail, type Env } from '../_shared/env'
import { presignUrl } from '../_shared/s3-presign'
import { PRIMARY_NODE_ID, nodeById } from '../_shared/storage-nodes'

/**
 * GET /media/<key> — serves an object from whichever bucket holds it.
 *
 * Only needed while a bucket has no public domain of its own. Set
 * PUBLIC_MEDIA_BASE_URL (or a node's publicBaseUrl) to a custom domain and
 * this route stops being used for it, which is cheaper and faster.
 *
 * Objects can live in buckets this deployment has no binding for — a partner
 * archive in another account, in another country. The `uploads` index records
 * which node each key went to; the URL shape is unchanged, so every link
 * written before storage nodes existed still resolves.
 *
 * Read-only, and scoped: nothing under submissions/ or volunteers/ is
 * reachable here, because those contain answers at every access level
 * including private ones.
 */

const PUBLIC_PREFIXES = ['uploads/', 'capsules/', 'site/']

export const onRequestGet: PagesFunction<Env> = async ({ params, env, request }) => {
  const segments = Array.isArray(params.path) ? params.path : [params.path]
  const key = segments.filter(Boolean).join('/')

  if (!key || key.includes('..')) return fail(400, 'Not a valid media path.')

  // Private submissions live in the same buckets. They are not web-readable.
  if (!PUBLIC_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return fail(404, 'Not found.')
  }

  // Anything not on the primary bucket is redirected to its own node rather
  // than streamed through here — the bytes should not cross this Function.
  const remote = await resolveRemoteNode(env, key)
  if (remote) {
    if (remote.publicBaseUrl) {
      return Response.redirect(`${remote.publicBaseUrl}/${key}`, 302)
    }
    const { url } = await presignUrl(remote, key, 'GET', 900)
    return Response.redirect(url, 302)
  }

  if (!env.MEDIA) return fail(503, 'Media storage is not connected on this deployment.', { code: 'not_configured' })

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

/**
 * The node holding this key, or null when it is the primary bucket (which is
 * also the answer for every object stored before nodes existed, and whenever
 * the index is unavailable — falling back to the binding keeps media served
 * even if the database is down).
 */
async function resolveRemoteNode(env: Env, key: string) {
  if (!env.DB || !env.STORAGE_NODES) return null
  try {
    const row = await env.DB.prepare(`SELECT storage_node FROM uploads WHERE key = ?1`).bind(key).first<{
      storage_node: string | null
    }>()
    const id = row?.storage_node
    if (!id || id === PRIMARY_NODE_ID) return null
    return nodeById(env, id)
  } catch {
    return null
  }
}
