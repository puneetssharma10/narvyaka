#!/usr/bin/env node
/**
 * npm run studio:apply <path-to-narvyaka-overrides.json>
 *
 * Turns a Studio export into a real code change:
 *
 *   theme.colors  →  src/data/site.json  +  src/styles/global.css (@theme block)
 *   theme.fonts   →  src/data/site.json  +  src/styles/global.css
 *   theme.logo    →  public/uploads/logo.<ext>  +  src/data/site.json
 *   text.*        →  src/data/site.json  (by dotted path)
 *   images.*      →  public/uploads/<name>.<ext>  +  src/data/site.json
 *   timing.*      →  src/data/site.json  (by dotted path, seconds per slide)
 *
 * Inlined data URIs are written out as real files, so the repository never
 * carries a megabyte of base64 and the browser gets a cacheable asset.
 *
 * Run with --dry-run to see what would change without touching anything.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SITE_JSON = join(root, 'src/data/site.json')
const GLOBAL_CSS = join(root, 'src/styles/global.css')
const UPLOAD_DIR = join(root, 'public/uploads')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const inputPath = args.find((arg) => !arg.startsWith('--'))

if (!inputPath) {
  console.error(`
Usage: npm run studio:apply <file> [--dry-run]

  <file>   The narvyaka-overrides.json exported from the Studio.

Example:
  npm run studio:apply ~/Downloads/narvyaka-overrides.json
`)
  process.exit(1)
}

const resolvedInput = resolve(process.cwd(), inputPath)
if (!existsSync(resolvedInput)) {
  console.error(`✗ No such file: ${resolvedInput}`)
  process.exit(1)
}

/* ── Load ─────────────────────────────────────────────────────────────────── */

let overrides
try {
  overrides = JSON.parse(readFileSync(resolvedInput, 'utf8'))
} catch (error) {
  console.error(`✗ That file is not valid JSON: ${error.message}`)
  process.exit(1)
}

const site = JSON.parse(readFileSync(SITE_JSON, 'utf8'))
let css = readFileSync(GLOBAL_CSS, 'utf8')

const applied = []
const skipped = []
const writtenFiles = []

/* ── Helpers ──────────────────────────────────────────────────────────────── */

const normaliseKey = (key) => (/^\d+$/.test(key) ? Number(key) : key)

function setPath(object, path, value) {
  const parts = path.split('.')
  const last = parts.pop()
  let cursor = object

  for (const part of parts) {
    const key = normaliseKey(part)
    if (cursor === null || cursor === undefined || !(key in cursor)) return false
    cursor = cursor[key]
  }

  const lastKey = normaliseKey(last)
  if (cursor === null || typeof cursor !== 'object' || !(lastKey in cursor)) return false
  cursor[lastKey] = value
  return true
}

const EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
}

/** Writes a data: URI out as a real file under public/uploads and returns its site path. */
function materialise(dataUri, basename) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUri)
  if (!match) return dataUri // already a URL or a site-relative path — leave it alone

  const [, mime, base64] = match
  const extension = EXT_BY_MIME[mime]
  if (!extension) {
    skipped.push(`${basename}: unsupported image type ${mime}`)
    return null
  }

  const filename = `${basename}.${extension}`
  const target = join(UPLOAD_DIR, filename)

  if (!dryRun) {
    mkdirSync(UPLOAD_DIR, { recursive: true })
    writeFileSync(target, Buffer.from(base64, 'base64'))
  }

  writtenFiles.push(`public/uploads/${filename}`)
  return `/uploads/${filename}`
}

/** Rewrites one custom property inside the @theme block of global.css. */
function setCssToken(name, value) {
  const pattern = new RegExp(`(^\\s*--${name.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&')}:\\s*)([^;\\n]+)(;)`, 'm')
  if (!pattern.test(css)) return false
  css = css.replace(pattern, `$1${value}$3`)
  return true
}

const slug = (value) =>
  value
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60)

/* ── Colours ──────────────────────────────────────────────────────────────── */

for (const [token, value] of Object.entries(overrides.theme?.colors ?? {})) {
  if (!/^#[0-9a-f]{3,8}$/i.test(value)) {
    skipped.push(`colour ${token}: "${value}" is not a hex colour`)
    continue
  }
  const inJson = setPath(site, `theme.colors.${token}`, value.toUpperCase())
  const inCss = setCssToken(`color-${token}`, value.toLowerCase())

  if (inJson || inCss) applied.push(`colour ${token} → ${value.toUpperCase()}`)
  else skipped.push(`colour ${token}: not a known design token`)
}

/* ── Fonts ────────────────────────────────────────────────────────────────── */

for (const [slot, value] of Object.entries(overrides.theme?.fonts ?? {})) {
  if (/[;{}<>]/.test(value)) {
    skipped.push(`font ${slot}: value contains characters that are not allowed in CSS`)
    continue
  }
  const inJson = setPath(site, `theme.fonts.${slot}`, value)
  const inCss = setCssToken(`font-${slot}`, value)

  if (inJson || inCss) applied.push(`font ${slot} → ${value.split(',')[0]}`)
  else skipped.push(`font ${slot}: not a known font slot`)
}

/* ── Logo ─────────────────────────────────────────────────────────────────── */

const logo = overrides.theme?.logo
if (logo?.src) {
  const src = materialise(logo.src, 'logo')
  if (src) {
    setPath(site, 'theme.logo.src', src)
    setPath(site, 'theme.logo.alt', logo.alt ?? 'Narvyaka')
    setPath(site, 'theme.logo.height', Number(logo.height) || 30)
    applied.push(`logo → ${src}`)
  }
}

/* ── Text ─────────────────────────────────────────────────────────────────── */

for (const [path, value] of Object.entries(overrides.text ?? {})) {
  if (setPath(site, path, value)) {
    applied.push(`text ${path}`)
  } else {
    skipped.push(`text ${path}: no such key in src/data/site.json`)
  }
}

/* ── Images ───────────────────────────────────────────────────────────────── */

for (const [path, value] of Object.entries(overrides.images ?? {})) {
  const src = materialise(value, slug(path) || 'image')
  if (src === null) continue

  if (setPath(site, path, src)) {
    applied.push(`image ${path} → ${src}`)
  } else {
    skipped.push(`image ${path}: no such key in src/data/site.json`)
  }
}

/* ── Timing ───────────────────────────────────────────────────────────────── */

for (const [path, value] of Object.entries(overrides.timing ?? {})) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds)) {
    skipped.push(`timing ${path}: "${value}" is not a number`)
    continue
  }
  if (setPath(site, path, seconds)) {
    applied.push(`timing ${path} → ${seconds}s`)
  } else {
    skipped.push(`timing ${path}: no such key in src/data/site.json`)
  }
}

/* ── Write ────────────────────────────────────────────────────────────────── */

if (!dryRun) {
  writeFileSync(SITE_JSON, `${JSON.stringify(site, null, 2)}\n`)
  writeFileSync(GLOBAL_CSS, css)
}

/* ── Report ───────────────────────────────────────────────────────────────── */

const label = dryRun ? 'would change' : 'applied'

console.log(`\n${dryRun ? 'Dry run — nothing was written.\n' : ''}${applied.length} ${label}:`)
for (const item of applied) console.log(`  ✓ ${item}`)

if (writtenFiles.length) {
  console.log(`\n${writtenFiles.length} file${writtenFiles.length === 1 ? '' : 's'} ${dryRun ? 'would be' : ''} written:`)
  for (const file of writtenFiles) console.log(`  → ${file}`)
}

if (skipped.length) {
  console.log(`\n${skipped.length} skipped:`)
  for (const item of skipped) console.log(`  – ${item}`)
}

if (applied.length === 0) {
  console.log('\nNothing to do.')
  process.exit(0)
}

console.log(`
Next:
  git diff                 # read the change
  npm run build            # confirm it builds
  git add -A && git commit -m "Studio: update site content"
`)
