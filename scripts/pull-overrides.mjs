#!/usr/bin/env node
/**
 * npm run studio:pull -- https://your-site.pages.dev
 *
 * Fetches whatever the Studio has published to the live site and writes it to
 * studio-exports/published-overrides.json, so a quick correction made in the
 * browser can be brought back into the code with `npm run studio:apply`.
 *
 * Without this, a server-published edit and the repository drift apart — the
 * live site shows one thing and the code says another.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(root, 'studio-exports')
const OUT_FILE = join(OUT_DIR, 'published-overrides.json')

const origin = process.argv.slice(2).find((arg) => !arg.startsWith('--'))

if (!origin) {
  console.error(`
Usage: npm run studio:pull -- <site origin>

Example:
  npm run studio:pull -- https://narvyaka.pages.dev
`)
  process.exit(1)
}

const url = new URL('/api/studio', origin).href

try {
  const response = await fetch(url)
  if (!response.ok) {
    console.error(`✗ ${url} returned ${response.status}.`)
    process.exit(1)
  }

  const body = await response.json()

  if (!body.overrides) {
    console.log('Nothing has been published from the Studio on that deployment.')
    process.exit(0)
  }

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(OUT_FILE, `${JSON.stringify(body.overrides, null, 2)}\n`)

  const counts = {
    colours: Object.keys(body.overrides.theme?.colors ?? {}).length,
    fonts: Object.keys(body.overrides.theme?.fonts ?? {}).length,
    text: Object.keys(body.overrides.text ?? {}).length,
    images: Object.keys(body.overrides.images ?? {}).length,
    logo: body.overrides.theme?.logo?.src ? 1 : 0,
  }

  console.log(`
Saved to studio-exports/published-overrides.json
  colours: ${counts.colours}   fonts: ${counts.fonts}   text: ${counts.text}   images: ${counts.images}   logo: ${counts.logo}
  published: ${body.updated_at ?? 'unknown'}

Next:
  npm run studio:apply studio-exports/published-overrides.json
`)
} catch (error) {
  console.error(`✗ Could not reach ${url}: ${error.message}`)
  process.exit(1)
}
