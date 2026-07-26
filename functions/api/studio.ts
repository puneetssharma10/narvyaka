import { parseOverrides } from '../../shared/overrides'
import { getSession } from '../_shared/auth'
import { BadJson, PayloadTooLarge, fail, json, readJson, requireBindings, safeEqual, type Env } from '../_shared/env'

const OVERRIDES_KEY = 'site/overrides.json'
const MAX_OVERRIDES_BYTES = 4 * 1024 * 1024 // inlined images add up quickly

/**
 * GET  /api/studio — the overrides currently published to the live site.
 * POST /api/studio — publish overrides.
 *
 * Only the super_admin can publish site content directly (Founding Vision
 * decision — admins review records, they don't edit the site itself). The
 * older STUDIO_TOKEN secret still works too, as a fallback for scripted use
 * (`npm run studio:apply` and similar) — either one is accepted.
 *
 * This is the quick-correction path. The durable path is still
 * `npm run studio:apply`, which puts the change into the code where it can be
 * reviewed in a diff.
 */
async function canPublish(request: Request, env: Env): Promise<boolean> {
  const session = await getSession(env, request)
  if (session?.role === 'super_admin') return true

  if (!env.STUDIO_TOKEN) return false
  const provided = request.headers.get('x-studio-token') ?? ''
  return provided !== '' && safeEqual(provided, env.STUDIO_TOKEN)
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  if (!env.MEDIA) return json({ overrides: null, published: false })

  try {
    const object = await env.MEDIA.get(OVERRIDES_KEY)
    if (!object) return json({ overrides: null, published: false })

    const parsed = parseOverrides(await object.text())
    return json(
      { overrides: parsed, published: parsed !== null, updated_at: object.uploaded.toISOString() },
      200,
      { 'cache-control': 'public, max-age=60' },
    )
  } catch (error) {
    return fail(502, 'Published site edits could not be read.', { details: (error as Error).message })
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await canPublish(request, env))) {
    return fail(401, 'Sign in as the super_admin to publish, or use a valid Studio token.', {
      hint:
        'Sign in at /login, or set a STUDIO_TOKEN secret for scripted publishing: ' +
        '`npx wrangler pages secret put STUDIO_TOKEN`.',
    })
  }

  const missing = requireBindings(env, ['MEDIA'])
  if (missing) return missing

  let body: unknown
  try {
    body = await readJson(request, MAX_OVERRIDES_BYTES)
  } catch (error) {
    if (error instanceof PayloadTooLarge) {
      return fail(413, 'Those edits are too large to publish.', {
        hint: 'Large images inlined as data URIs are the usual cause. Export the changes and apply them to the code instead.',
      })
    }
    if (error instanceof BadJson) return fail(400, 'That was not valid JSON.')
    throw error
  }

  // Re-validate server-side. The client sanitises too, but a token holder
  // must still not be able to inject arbitrary CSS or a javascript: image.
  const overrides = parseOverrides(body)
  if (!overrides) return fail(422, 'Those edits could not be read as a Narvyaka changes file.')

  try {
    // Keep the previous version, so a bad publish is one copy away from undone.
    const existing = await env.MEDIA!.get(OVERRIDES_KEY)
    if (existing) {
      await env.MEDIA!.put(`site/history/overrides-${Date.now()}.json`, await existing.text(), {
        httpMetadata: { contentType: 'application/json; charset=utf-8' },
      })
    }

    await env.MEDIA!.put(OVERRIDES_KEY, JSON.stringify(overrides, null, 2), {
      httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'public, max-age=60' },
    })
  } catch (error) {
    return fail(502, 'Those edits could not be published.', { details: (error as Error).message })
  }

  return json({ published: true, updated_at: overrides.updated_at })
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await canPublish(request, env))) {
    return fail(401, 'Sign in as the super_admin to do this, or use a valid Studio token.')
  }

  const missing = requireBindings(env, ['MEDIA'])
  if (missing) return missing

  await env.MEDIA!.delete(OVERRIDES_KEY)
  return json({ published: false })
}
