/**
 * Assemble the static site of the browser-hosted harness from a finished
 * `build:preview` output: the worker page becomes the site root and a generated
 * service worker precaches what a first launch needs. The Node-served index page,
 * source maps, and packaging fixtures stay out.
 *
 * Usage: tsx scripts/pack-web-platform.ts [--out dist-site]
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const webRoot = resolve(import.meta.dirname, '..')
const { values } = parseArgs({ options: { out: { type: 'string', default: 'dist-site' } } })
const source = join(webRoot, 'dist')
const out = resolve(webRoot, values.out)

if (!existsSync(join(source, 'preview.html'))) {
  throw new Error('pack-web-platform: dist/preview.html is missing; run build:preview first')
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(source, out, {
  recursive: true,
  filter: (path) => {
    const name = relative(source, path)
    return name === '' || (!name.endsWith('.map') && name !== 'index.html')
  },
})
renameSync(join(out, 'preview.html'), join(out, 'index.html'))

// The site is an independent build, so it must not present itself as the official application.
const manifest = JSON.parse(readFileSync(join(out, 'manifest.webmanifest'), 'utf8')) as Record<string, unknown>
writeFileSync(join(out, 'manifest.webmanifest'), `${JSON.stringify({
  ...manifest,
  name: 'DSH Web',
  short_name: 'DSH Web',
  description: 'An unofficial browser build of DSH. It is built on DeepSeek Harness and is not affiliated with DeepSeek.',
}, null, 2)}\n`)

/** List every file under a directory, relative to the site root. */
function listFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? listFiles(path) : [relative(out, path)]
  })
}

// Fixture overlays exist for packaging regressions, which run against dist/.
for (const name of readdirSync(join(out, 'preview'))) {
  if (name.includes('fixture')) rmSync(join(out, 'preview', name), { recursive: true, force: true })
}

const files = listFiles(out).sort()
const hash = createHash('sha256')
for (const file of files) hash.update(file).update(readFileSync(join(out, file)))
const version = hash.digest('hex').slice(0, 16)

// Grammars and page chunks load on demand and join the cache when used.
const precache = files.filter(file => !file.startsWith('assets/langs/') && !file.startsWith('preview/lazy/') && !file.startsWith('assets/fonts/KaTeX'))
const template = readFileSync(join(webRoot, 'platform', 'sw.js'), 'utf8')
writeFileSync(join(out, 'sw.js'), template
  .replace('__DSH_SITE_VERSION__', version)
  .replace('__DSH_PRECACHE__', JSON.stringify(precache.map(file => `./${file}`))))

const bytes = files.reduce((total, file) => total + statSync(join(out, file)).size, 0)
console.log(`pack-web-platform: ${String(files.length)} files, ${String(Math.round(bytes / 1048576))} MiB, ${String(precache.length)} precached, version ${version}, in ${relative(process.cwd(), out)}`)
