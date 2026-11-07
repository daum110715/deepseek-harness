/**
 * Capture the install-dialog screenshots from a finished site build. Run after
 * `build:site`, then build again so the packer ships them.
 *
 * Usage: tsx scripts/capture-site-screenshots.ts
 */
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize, resolve } from 'node:path'
import { chromium } from 'playwright'

const webRoot = resolve(import.meta.dirname, '..')
const site = join(webRoot, 'dist-site')
const types: Readonly<Record<string, string>> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }
const server = createServer((request, response) => {
  const pathname = normalize(new URL(request.url ?? '/', 'http://site').pathname)
  const path = pathname === '/' ? 'index.html' : pathname
  readFile(join(site, path)).then((body) => {
    response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(body)
  }, () => { response.writeHead(404).end() })
}).listen(0, '127.0.0.1')
await new Promise(settle => server.once('listening', settle))
const origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/`
const browser = await chromium.launch({ args: ['--no-sandbox'], ...process.env.DSH_E2E_CHROME === undefined ? {} : { executablePath: process.env.DSH_E2E_CHROME } })
for (const [name, viewport, scale] of [['wide', { width: 1280, height: 800 }, 1], ['narrow', { width: 390, height: 844 }, 2]] as const) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale, locale: 'en-US', colorScheme: 'light' })
  const page = await context.newPage()
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-composer-input]').first().waitFor({ timeout: 150_000 })
  // The app itself, without the first-launch dialog or passing notices.
  await page.getByRole('button', { name: 'Continue' }).click({ timeout: 8000 }).catch(() => undefined)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.waitForTimeout(1000)
    await page.keyboard.press('Escape')
  }
  await page.addStyleTag({ content: '[data-dsh-toasts] { display: none }' })
  await page.waitForTimeout(9000)
  await page.screenshot({ path: join(webRoot, 'platform', 'screenshots', `${name}.png`) })
  await context.close()
}
await browser.close()
server.close()
