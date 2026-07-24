import { json, type Env } from '../_shared/env'

/**
 * GET /api/health
 *
 * Tells you, in one request, whether this deployment can actually receive a
 * record. Use it right after wiring up bindings — and before telling anyone
 * the site is live.
 */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const checks: Record<string, { ok: boolean; detail: string }> = {}

  // ── Database ──────────────────────────────────────────────────────────
  if (!env.DB) {
    checks.database = { ok: false, detail: 'No D1 binding named DB. See INTEGRATIONS.md §1.' }
  } else {
    try {
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('submissions','volunteers','uploads','rate_limits')`,
      ).first<{ n: number }>()
      const tables = row?.n ?? 0
      checks.database =
        tables === 4
          ? { ok: true, detail: 'D1 connected, schema present.' }
          : { ok: false, detail: `D1 connected but only ${tables}/4 tables exist. Run: npm run db:remote` }
    } catch (error) {
      checks.database = { ok: false, detail: `D1 query failed: ${(error as Error).message}` }
    }
  }

  // ── Object storage ────────────────────────────────────────────────────
  if (!env.MEDIA) {
    checks.storage = { ok: false, detail: 'No R2 binding named MEDIA. See INTEGRATIONS.md §2.' }
  } else {
    try {
      await env.MEDIA.head('healthcheck-probe')
      checks.storage = {
        ok: true,
        detail: env.PUBLIC_MEDIA_BASE_URL
          ? `R2 connected, served from ${env.PUBLIC_MEDIA_BASE_URL}`
          : 'R2 connected, served through /media/*',
      }
    } catch (error) {
      checks.storage = { ok: false, detail: `R2 unreachable: ${(error as Error).message}` }
    }
  }

  // ── Studio publishing ─────────────────────────────────────────────────
  checks.studio = env.STUDIO_TOKEN
    ? { ok: true, detail: 'Studio can publish overrides to the live site.' }
    : {
        ok: false,
        detail:
          'No STUDIO_TOKEN secret. Studio edits still work and can still be exported — only server publishing is off.',
      }

  const intakeReady = checks.database.ok && checks.storage.ok
  const paused = env.INTAKE_PAUSED === '1'

  return json(
    {
      ok: intakeReady && !paused,
      intake: paused ? 'paused' : intakeReady ? 'accepting submissions' : 'not connected',
      checks,
      checked_at: new Date().toISOString(),
    },
    intakeReady ? 200 : 503,
  )
}
