import type { StorageNode } from './storage-nodes'

/**
 * Presigned S3 URLs (AWS SigV4), signed with the platform's own WebCrypto.
 *
 * Why presigning exists at all: Cloudflare enforces a request-body-size
 * ceiling on every Worker/Pages Function invocation — 100 MB on Free/Pro,
 * 200 MB on Business, 500 MB only on Enterprise. Proxying a file's bytes
 * through a Function (the old /api/uploads path) means a 300 MB recording is
 * rejected by the platform itself before this code ever runs, no matter what
 * MAX_UPLOAD_BYTES says. A presigned URL sidesteps that entirely: the browser
 * PUTs the file straight to the bucket's own endpoint, and the Function only
 * hands out a short-lived, single-object, single-method signature.
 *
 * Why it is written against a generic S3 endpoint rather than R2 specifically:
 * this is the only mechanism that can reach a bucket in an account this
 * deployment does not own. A Cloudflare binding cannot; a signed request can.
 * See storage-nodes.ts.
 */

export type S3Method = 'PUT' | 'GET' | 'HEAD' | 'DELETE'

export async function presignUrl(
  node: StorageNode,
  key: string,
  method: S3Method = 'PUT',
  expiresSeconds = 600,
): Promise<{ url: string; expiresAt: string }> {
  const host = node.endpoint
  const now = new Date()
  const amzDate = toAmzDate(now)
  const dateStamp = amzDate.slice(0, 8)
  const region = node.region
  const service = 's3'
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`

  const canonicalUri = `/${encodeURIComponent(node.bucket)}/${encodePathSegments(key)}`

  const queryParams: [string, string][] = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${node.accessKeyId}/${credentialScope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expiresSeconds)],
    ['X-Amz-SignedHeaders', 'host'],
  ]
  const canonicalQueryString = queryParams
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')

  const canonicalHeaders = `host:${host}\n`
  const signedHeaders = 'host'
  const payloadHash = 'UNSIGNED-PAYLOAD'

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n')

  const signingKey = await deriveSigningKey(node.secretAccessKey, dateStamp, region, service)
  const signature = toHex(await hmac(signingKey, stringToSign))

  const url = `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`
  const expiresAt = new Date(now.getTime() + expiresSeconds * 1000).toISOString()
  return { url, expiresAt }
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

/** Percent-encodes everything RFC 3986 requires that encodeURIComponent leaves alone. */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** Encodes a key path segment-by-segment so literal "/" stays a path separator. */
function encodePathSegments(key: string): string {
  return key.split('/').map(encodeRfc3986).join('/')
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return toHex(new Uint8Array(digest))
}

async function hmac(key: CryptoKey, message: string): Promise<Uint8Array> {
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return new Uint8Array(signature)
}

async function hmacKey(rawKey: Uint8Array | ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', rawKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
}

async function deriveSigningKey(secret: string, dateStamp: string, region: string, service: string): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  let key: CryptoKey = await hmacKey(encoder.encode(`AWS4${secret}`))
  const kDate = await hmac(key, dateStamp)
  key = await hmacKey(kDate)
  const kRegion = await hmac(key, region)
  key = await hmacKey(kRegion)
  const kService = await hmac(key, service)
  key = await hmacKey(kService)
  const kSigning = await hmac(key, 'aws4_request')
  return hmacKey(kSigning)
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}
