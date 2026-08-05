import { presignUrl } from '../../_shared/s3-presign'
import { PRIMARY_NODE_ID, nodeById, type StorageNode } from '../../_shared/storage-nodes'
import {
  BadJson,
  MAX_UPLOAD_BYTES,
  PayloadTooLarge,
  fail,
  json,
  publicUrlFor,
  readJson,
  type Env,
} from '../../_shared/env'

/**
 * POST /api/uploads/confirm — body: { key, record_id, kind, content_type, node }
 *
 * Called after the browser finishes PUTting straight to the bucket via the
 * presigned URL. A presigned URL's signature doesn't bind the actual byte
 * count, so this is where the 300 MB cap is actually enforced: it HEADs the
 * real object, deletes anything over the limit, and only then indexes it.
 *
 * `node` names which bucket the file went to. The primary bucket is checked
 * through its binding; any other node is checked over the S3 API, because a
 * binding cannot see a bucket in an account this deployment does not own.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: unknown
  try {
    body = await readJson(request, 4096)
  } catch (error) {
    if (error instanceof PayloadTooLarge) return fail(413, 'That request is too large.')
    if (error instanceof BadJson) return fail(400, 'That request was not valid JSON.')
    throw error
  }

  const { key, record_id, kind, content_type, node: nodeId } = (body ?? {}) as {
    key?: string
    record_id?: string
    kind?: string
    content_type?: string
    node?: string
  }

  if (typeof key !== 'string' || !key.startsWith(`uploads/${record_id}/`)) {
    return fail(400, "That upload doesn't match the record it claims to belong to.")
  }
  if (kind !== 'audio' && kind !== 'photo') return fail(400, 'An upload must say whether it is audio or a photo.')

  const resolvedNodeId = typeof nodeId === 'string' && nodeId ? nodeId : PRIMARY_NODE_ID
  const remote = resolvedNodeId === PRIMARY_NODE_ID ? null : nodeById(env, resolvedNodeId)
  if (resolvedNodeId !== PRIMARY_NODE_ID && !remote) {
    return fail(400, 'That upload names a storage node this site does not know about.')
  }

  let size: number
  let storedType: string
  try {
    const head = remote ? await headRemote(remote, key) : await headPrimary(env, key)
    if (!head) {
      return fail(404, 'That upload has not landed in storage yet — please try again.', { code: 'not_found' })
    }
    size = head.size
    storedType = head.contentType
  } catch (error) {
    return fail(502, 'That upload could not be checked in storage.', { details: (error as Error).message })
  }

  if (size > MAX_UPLOAD_BYTES) {
    // Best-effort removal. If it fails the object is still unindexed, so it is
    // unreachable from the site and can be swept later.
    try {
      if (remote) {
        const { url } = await presignUrl(remote, key, 'DELETE', 120)
        await fetch(url, { method: 'DELETE' })
      } else if (env.MEDIA) {
        await env.MEDIA.delete(key)
      }
    } catch {
      /* the index is the thing that matters; an orphan can be swept later */
    }
    return fail(413, `That file is larger than the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit.`)
  }

  if (env.DB) {
    try {
      await env.DB.prepare(
        `INSERT INTO uploads (key, record_id, kind, content_type, bytes, uploaded_at, storage_node)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
        .bind(key, record_id, kind, content_type ?? storedType, size, new Date().toISOString(), resolvedNodeId)
        .run()
    } catch {
      /* the object is stored; the index can be rebuilt from the bucket */
    }
  }

  return json({ url: publicUrlFor(env, key, remote), key, bytes: size, node: resolvedNodeId })
}

async function headPrimary(env: Env, key: string): Promise<{ size: number; contentType: string } | null> {
  if (!env.MEDIA) throw new Error('The primary media bucket is not bound to this deployment.')
  const object = await env.MEDIA.head(key)
  if (!object) return null
  return { size: object.size, contentType: object.httpMetadata?.contentType ?? '' }
}

async function headRemote(node: StorageNode, key: string): Promise<{ size: number; contentType: string } | null> {
  const { url } = await presignUrl(node, key, 'HEAD', 120)
  const response = await fetch(url, { method: 'HEAD' })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`${node.id} returned ${response.status}`)

  const length = Number(response.headers.get('content-length') ?? NaN)
  if (!Number.isFinite(length)) {
    // Without a byte count the size limit cannot be enforced, and an
    // unverifiable upload is refused rather than indexed on trust.
    throw new Error(`${node.id} did not report a content length`)
  }
  return { size: length, contentType: response.headers.get('content-type') ?? '' }
}
