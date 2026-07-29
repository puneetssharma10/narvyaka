import type { Env } from './env'

/**
 * The storage registry: one archive, many buckets, in many accounts.
 *
 * WHY THIS EXISTS
 *
 * A Cloudflare binding (`env.MEDIA`) can only ever reach a bucket inside the
 * same Cloudflare account. There is no way to bind a bucket that belongs to
 * someone else — not another person's R2, not a university's S3, not a
 * partner archive in another country. That is a hard platform limit.
 *
 * The S3-compatible API is not limited that way. Anything that speaks S3 —
 * another account's R2, AWS S3, Backblaze B2, Wasabi, a MinIO box in a
 * university basement — can be reached with nothing but an endpoint and a
 * pair of keys, signed per request (see s3-presign.ts). So that is how a
 * second, third or tenth bucket joins the archive: as a registered *node*,
 * not as a binding.
 *
 * This is what `howItWorks.storage` already promises the reader — "deliberate
 * redundancy … so the archive does not depend on any one organisation
 * continuing to exist". A node in someone else's account, holding records
 * this account cannot delete, is that promise made real.
 *
 * CONFIGURATION
 *
 * One Pages secret, `STORAGE_NODES`, holding a JSON array:
 *
 *   [
 *     { "id": "in-mumbai", "label": "R2 — founder's account",
 *       "endpoint": "<account-id>.r2.cloudflarestorage.com", "region": "auto",
 *       "bucket": "narvyaka-media", "accessKeyId": "…", "secretAccessKey": "…" },
 *     { "id": "de-partner", "label": "Partner archive, Frankfurt",
 *       "endpoint": "s3.eu-central-1.amazonaws.com", "region": "eu-central-1",
 *       "bucket": "narvyaka-mirror", "accessKeyId": "…", "secretAccessKey": "…",
 *       "publicBaseUrl": "https://media.partner.example", "writable": false }
 *   ]
 *
 * Set it with:  npx wrangler pages secret put STORAGE_NODES
 *
 * If it is absent, the registry falls back to a single node built from the
 * existing R2_* secrets, which is exactly the behaviour this site had before
 * nodes existed. Nothing needs configuring to keep working.
 */

/** The id used for the bucket bound as `env.MEDIA`. Objects stored before the
 *  registry existed have no node recorded, and are read as this one. */
export const PRIMARY_NODE_ID = 'primary'

export interface StorageNode {
  /** Short stable slug. Written into the database next to every object, so it
   *  must never be reused for a different bucket once records point at it. */
  id: string
  label: string
  /** Hostname only — no scheme, no path. Always reached over HTTPS. */
  endpoint: string
  /** "auto" for R2; a real region for S3 and most others. */
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** A custom domain or CDN in front of this bucket, if it has one. Reads go
   *  straight there instead of being signed. */
  publicBaseUrl?: string
  /** False for a mirror or a partner's read-only copy. Defaults to true. */
  writable: boolean
}

/**
 * A hostname, and nothing more. Rejects schemes, paths, ports, credentials
 * and anything that resolves inward — a node endpoint arrives from
 * configuration, but configuration is still not a reason to let this sign a
 * request at an internal address.
 */
function isSafeEndpoint(value: string): boolean {
  if (!/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i.test(value)) return false
  if (!value.includes('.')) return false
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(value)) return false
  // Bare IP addresses — no legitimate S3 endpoint is one, and they are the
  // usual way to point a signer at a metadata service or a private network.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return false
  return true
}

function isSafeId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/.test(value)
}

function parseNode(raw: unknown): StorageNode | null {
  if (!raw || typeof raw !== 'object') return null
  const n = raw as Record<string, unknown>

  const id = String(n.id ?? '').trim()
  const endpoint = String(n.endpoint ?? '')
    .trim()
    .toLowerCase()
  const bucket = String(n.bucket ?? '').trim()
  const accessKeyId = String(n.accessKeyId ?? '').trim()
  const secretAccessKey = String(n.secretAccessKey ?? '').trim()

  if (!isSafeId(id) || !isSafeEndpoint(endpoint)) return null
  if (!bucket || !accessKeyId || !secretAccessKey) return null

  let publicBaseUrl: string | undefined
  const rawBase = String(n.publicBaseUrl ?? '').trim()
  if (rawBase) {
    // Must be an absolute https URL; anything else is dropped rather than
    // guessed at, so a typo cannot silently redirect readers off-site.
    if (!/^https:\/\/[^\s"'<>\\]+$/i.test(rawBase)) return null
    publicBaseUrl = rawBase.replace(/\/+$/, '')
  }

  return {
    id,
    label: String(n.label ?? id).slice(0, 120),
    endpoint,
    region: String(n.region ?? 'auto').trim() || 'auto',
    bucket,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl,
    writable: n.writable === undefined ? true : n.writable === true,
  }
}

/**
 * Every configured node. A malformed entry is skipped rather than throwing —
 * one bad line of JSON must not take uploads down for every other node.
 */
export function storageNodes(env: Env): StorageNode[] {
  const nodes: StorageNode[] = []
  const seen = new Set<string>()

  if (env.STORAGE_NODES) {
    let parsed: unknown
    try {
      parsed = JSON.parse(env.STORAGE_NODES)
    } catch {
      parsed = null
    }
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        const node = parseNode(entry)
        if (!node || seen.has(node.id)) continue
        seen.add(node.id)
        nodes.push(node)
      }
    }
  }

  // The original single-bucket configuration, still first-class. Only added
  // if STORAGE_NODES did not already define a node under this id.
  if (!seen.has(PRIMARY_NODE_ID)) {
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = env
    if (R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME) {
      nodes.unshift({
        id: PRIMARY_NODE_ID,
        label: 'Primary R2 bucket',
        endpoint: `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        region: 'auto',
        bucket: R2_BUCKET_NAME,
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
        publicBaseUrl: env.PUBLIC_MEDIA_BASE_URL?.replace(/\/+$/, '') || undefined,
        writable: true,
      })
    }
  }

  return nodes
}

export function nodeById(env: Env, id: string): StorageNode | null {
  return storageNodes(env).find((node) => node.id === id) ?? null
}

/**
 * Which node a given record's files belong on.
 *
 * Chosen by hashing the record id, so every file belonging to one submission
 * lands in one bucket. That is deliberate: a contributor who withdraws their
 * record must be satisfiable by deleting from a single place, not by chasing
 * fragments across several jurisdictions.
 *
 * Adding a node changes the placement of *future* records only — existing
 * objects are found through the node id stored beside them, never by
 * recomputing this.
 */
export function pickWriteNode(env: Env, recordId: string): StorageNode | null {
  const writable = storageNodes(env).filter((node) => node.writable)
  if (writable.length === 0) return null
  if (writable.length === 1) return writable[0]

  let hash = 2166136261
  for (let i = 0; i < recordId.length; i += 1) {
    hash ^= recordId.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return writable[(hash >>> 0) % writable.length]
}
