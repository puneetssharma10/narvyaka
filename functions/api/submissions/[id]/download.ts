import { zipSync, strToU8 } from 'fflate'
import { getSession } from '../../../_shared/auth'
import { fail, requireBindings, type Env } from '../../../_shared/env'
import { nodeById, PRIMARY_NODE_ID } from '../../../_shared/storage-nodes'
import { presignUrl } from '../../../_shared/s3-presign'

interface SubmissionRow {
  id: string
  owner_user_id: string | null
  payload_json: string
}

interface UploadRow {
  key: string
  kind: 'audio' | 'photo'
  storage_node: string
}

/**
 * GET /api/submissions/:id/download — a zip: record.json (the full record,
 * same shape GET /api/submissions/:id returns) plus every audio/photo file.
 *
 * Access mirrors that endpoint's canView, with one narrower case: a
 * volunteer who doesn't own the record can only download it once the
 * super_admin has granted can_download (functions/api/admin/users/[id].ts).
 * A reader — logged in or not — never can, regardless of anything.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const missing = requireBindings(env, ['DB'])
  if (missing) return missing

  const session = await getSession(env, request)
  if (!session) return fail(401, 'Please sign in to continue.', { code: 'unauthenticated' })

  const id = params.id as string
  const row = await env.DB!.prepare(`SELECT id, owner_user_id, payload_json FROM submissions WHERE id = ?1`)
    .bind(id)
    .first<SubmissionRow>()
  if (!row) return fail(404, 'No such record.')

  const isReviewer = session.role === 'admin' || session.role === 'super_admin'
  const isOwner = row.owner_user_id === session.id
  const allowed = isReviewer || (session.role === 'volunteer' && (isOwner || session.canDownload))
  if (!allowed) return fail(403, "Your account doesn't have access to download this record.")

  const uploads = await env.DB!.prepare(
    `SELECT key, kind, storage_node FROM uploads WHERE record_id = ?1`,
  )
    .bind(id)
    .all<UploadRow>()

  const files: Record<string, Uint8Array> = {
    'record.json': strToU8(JSON.stringify(JSON.parse(row.payload_json), null, 2)),
  }

  for (const upload of uploads.results ?? []) {
    const bytes = await fetchUploadBytes(env, upload)
    if (!bytes) continue
    const folder = upload.kind === 'audio' ? 'audio' : 'photos'
    const filename = upload.key.split('/').pop() || upload.key
    files[`${folder}/${filename}`] = bytes
  }

  const zipped = zipSync(files, { level: 6 })
  return new Response(zipped, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${id}.zip"`,
      'cache-control': 'no-store',
    },
  })
}

async function fetchUploadBytes(env: Env, upload: UploadRow): Promise<Uint8Array | null> {
  if (!upload.storage_node || upload.storage_node === PRIMARY_NODE_ID) {
    if (!env.MEDIA) return null
    const object = await env.MEDIA.get(upload.key)
    if (!object) return null
    return new Uint8Array(await object.arrayBuffer())
  }

  const node = nodeById(env, upload.storage_node)
  if (!node) return null
  const { url } = await presignUrl(node, upload.key, 'GET')
  const response = await fetch(url)
  if (!response.ok) return null
  return new Uint8Array(await response.arrayBuffer())
}
