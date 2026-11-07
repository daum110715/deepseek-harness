/**
 * Web platform acceptance: the assembled static site runs the harness with no Node
 * Host. One browser context walks what a person does: first launch into the default
 * workspace, run an agent turn whose bash and git commands reach that workspace in
 * origin-private storage, reload, open a second tab, and start offline.
 *
 * Storage, the Worker boundary, and the service worker are the browser's own. The
 * DeepSeek endpoint is substituted with a scripted stream. Requires `pnpm --filter
 * @deepseek-ai/dsh-web-frontend run build:site`.
 */
import { existsSync } from 'node:fs'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { BrowserContext, Page, Route } from 'playwright'
import { expect, it } from 'vitest'

const SITE = fileURLToPath(new URL('../dist-site', import.meta.url))
const BOOT_TIMEOUT_MS = 150_000
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.gz': 'application/gzip',
}
const AGENT_SCRIPT = 'for i in 1 2 3; do echo "line $i" >> loop.txt; done; git init -q . && git add . && git commit -qm "from the agent" && git log --oneline && wc -l loop.txt'

/** Serve the site the way a static host does: stored bytes, and 404 for a missing file. */
async function serveSite(): Promise<{ origin: string; close(): void }> {
  const server = createServer((request, response) => {
    const pathname = normalize(new URL(request.url ?? '/', 'http://site').pathname)
    const file = pathname === '/' ? 'index.html' : pathname
    readFile(join(SITE, file)).then((body) => {
      response.writeHead(200, { 'content-type': MEDIA_TYPES[extname(file)] ?? 'application/octet-stream', 'content-length': body.length })
      response.end(body)
    }, () => {
      response.writeHead(404)
      response.end()
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { origin: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, close: () => { server.close() } }
}

/** What the scripted model saw. */
interface ModelObservations {
  tools: readonly string[]
  toolResult: string
}

/** Answer Messages requests with one bash call, then a closing text once its result returns. */
async function scriptModel(context: BrowserContext): Promise<ModelObservations> {
  const seen: ModelObservations = { tools: [], toolResult: '' }
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
  await context.route('https://api.deepseek.com/**', async (route: Route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return await route.fulfill({ status: 200, headers: cors })
    if (!request.url().endsWith('/messages')) {
      return await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: '{"object":"list","data":[]}' })
    }
    const body = request.postDataJSON() as { model: string; tools?: { name: string }[]; messages: unknown[] }
    const tools = (body.tools ?? []).map(tool => tool.name)
    if (tools.length > 0) seen.tools = tools
    const last = JSON.stringify(body.messages.at(-1))
    const events: string[] = []
    const emit = (type: string, data: object): void => { events.push(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`) }
    emit('message_start', { message: { id: 'scripted', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } })
    if (last.includes('RUN-SCRIPT') && tools.includes('bash')) {
      emit('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'call_1', name: 'bash', input: {} } })
      emit('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ command: AGENT_SCRIPT, description: 'loop and git' }) } })
      emit('content_block_stop', { index: 0 })
      emit('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 1 } })
    } else {
      if (last.includes('tool_result')) seen.toolResult = last
      emit('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
      emit('content_block_delta', { index: 0, delta: { type: 'text_delta', text: last.includes('tool_result') ? 'AGENT-DONE-MARKER' : 'Title' } })
      emit('content_block_stop', { index: 0 })
      emit('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } })
    }
    emit('message_stop', {})
    return await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: events.join('') })
  })
  return seen
}

/** Call one Host method over the page's tunnel. */
async function remote<T>(page: Page, endpoint: string, args: object): Promise<T> {
  return await page.evaluate(async ({ endpoint: method, args: payload }) => {
    const { fetch: tunnelFetch } = (globalThis as unknown as { __DSH_TRANSPORT__: { fetch(input: string, init: RequestInit): Promise<Response> } }).__DSH_TRANSPORT__
    const response = await tunnelFetch(`/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: `platform-${method}`, method, payload: { args: payload } }),
    })
    const body = await response.json() as { result: { ok: true; value: T } | { ok: false; error: { message: string } } }
    if (!body.result.ok) throw new Error(`${method} failed: ${body.result.error.message}`)
    return body.result.value
  }, { endpoint, args })
}

/** Read a file of the default workspace straight from origin-private storage. */
async function workspaceFile(page: Page, path: string): Promise<string | null> {
  return await page.evaluate(async (relative) => {
    try {
      let directory = await navigator.storage.getDirectory()
      const segments = ['dsh-data-v1', 'workspace', 'deepseek-harness', 'default-workspace', ...relative.split('/')]
      const name = segments.pop() as string
      for (const segment of segments) directory = await directory.getDirectoryHandle(segment)
      return await (await (await directory.getFileHandle(name)).getFile()).text()
    } catch {
      return null
    }
  }, path)
}

async function sessionCount(page: Page): Promise<number> {
  return (await remote<{ items: unknown[] }>(page, 'session/list', { _request: {} })).items.length
}

const composer = (page: Page) => page.locator('[data-composer-input]').first()

it('runs the harness in the browser, keeps its data, and starts offline', { timeout: 600_000 }, async () => {
  expect(existsSync(join(SITE, 'sw.js')), 'build the site first: pnpm --filter @deepseek-ai/dsh-web-frontend run build:site').toBe(true)
  const site = await serveSite()
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...process.env.DSH_E2E_CHROME === undefined ? {} : { executablePath: process.env.DSH_E2E_CHROME } })
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' })
    const model = await scriptModel(context)
    // Any reach for the host machine's file system fails the run.
    await context.addInitScript(() => {
      (globalThis as unknown as { showDirectoryPicker(): never }).showDirectoryPicker = () => {
        throw new Error('the site asked for a host folder')
      }
    })
    const page = await context.newPage()
    const pageErrors: string[] = []
    page.on('pageerror', (error) => { pageErrors.push(error.message) })

    await page.goto(site.origin, { waitUntil: 'domcontentloaded' })
    await composer(page).waitFor({ timeout: BOOT_TIMEOUT_MS })
    await page.getByRole('button', { name: 'Continue' }).click({ timeout: 8000 }).catch(() => undefined)
    await remote(page, 'credentials/set', { ref: 'DEEPSEEK_API_KEY', value: 'sk-scripted' })

    await page.locator('[data-composer-input][contenteditable="true"]').first().waitFor({ timeout: 30_000 })
    await composer(page).click()
    await page.keyboard.type('RUN-SCRIPT please')
    await page.keyboard.press('Enter')
    await page.getByText('AGENT-DONE-MARKER').first().waitFor({ timeout: 60_000 })
    expect(model.tools).toContain('bash')
    expect(model.tools).not.toContain('workflow')
    expect(model.toolResult).toContain('from the agent')
    expect(model.toolResult).toContain('3 loop.txt')
    await page.waitForTimeout(1000)
    expect(await workspaceFile(page, 'loop.txt')).toBe('line 1\nline 2\nline 3\n')
    expect(await workspaceFile(page, '.git/HEAD')).not.toBeNull()
    expect(await sessionCount(page)).toBe(1)

    await page.reload({ waitUntil: 'domcontentloaded' })
    await composer(page).waitFor({ timeout: BOOT_TIMEOUT_MS })
    expect(await sessionCount(page)).toBe(1)
    expect((await remote<Record<string, { configured: boolean }>>(page, 'credentials/describe', { refs: ['DEEPSEEK_API_KEY'] })).DEEPSEEK_API_KEY?.configured).toBe(true)
    const status = await page.evaluate(async () => await (globalThis as unknown as { __DSH_WEB_PLATFORM__: { status(): Promise<{ durable: boolean }> } }).__DSH_WEB_PLATFORM__.status())
    expect(status.durable).toBe(true)

    await page.getByText('More', { exact: true }).last().click()
    await page.getByText('Settings', { exact: true }).first().click()
    await page.getByText('Browser data').first().waitFor({ timeout: 10_000 })
    await page.keyboard.press('Escape')

    const second = await context.newPage()
    second.on('pageerror', (error) => { pageErrors.push(error.message) })
    await second.goto(site.origin, { waitUntil: 'domcontentloaded' })
    await second.getByText('open in another tab').waitFor({ timeout: 20_000 })
    await second.getByRole('button', { name: 'Use this tab' }).click()
    await page.getByText('moved to another tab').waitFor({ timeout: 20_000 })
    await composer(second).waitFor({ timeout: BOOT_TIMEOUT_MS })
    expect(await sessionCount(second)).toBe(1)
    await page.close()

    await context.setOffline(true)
    await second.reload({ waitUntil: 'domcontentloaded' })
    await composer(second).waitFor({ timeout: BOOT_TIMEOUT_MS })
    expect(await sessionCount(second)).toBe(1)
    expect(pageErrors).toEqual([])
  } finally {
    await browser.close()
    site.close()
  }
})
