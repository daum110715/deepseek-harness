/** Real Cordis installation through the browser-hosted profile manager. */
import { randomUUID } from 'node:crypto'
import type { BrowserContext, Page } from 'playwright'

async function remote<T>(page: Page, method: string, args: object): Promise<T> {
  return page.evaluate(
    async ({ method, args, rpcId }) => {
      const root = globalThis as typeof globalThis & {
        __DSH_TRANSPORT__?: { fetch(input: string, init: RequestInit): Promise<Response> }
      }
      if (root.__DSH_TRANSPORT__ === undefined) throw new Error('Worker transport unavailable')
      const response = await root.__DSH_TRANSPORT__.fetch('/api/' + method, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }),
      })
      const body = (await response.json()) as { result: { ok: true; value: T } | { ok: false; error: { message: string } } }
      if (!body.result.ok) throw new Error(method + ' ' + body.result.error.message)
      return body.result.value
    },
    { method, args, rpcId: randomUUID() },
  )
}
async function community(page: Page): Promise<void> {
  await page.locator('[data-composer-input]').first().waitFor({ timeout: 150000 })
  const notice = page.getByRole('button', { name: '继续', exact: true })
  if (await notice.isVisible()) await notice.click()
  await remote(page, 'credentials/set', { ref: 'DEEPSEEK_API_KEY', value: 'sk-cordis-scenario' })
  for (const dialog of await page.getByRole('dialog').all()) {
    const close = dialog.getByRole('button', { name: /^(关闭|Close)$/ }).first()
    if (await close.isVisible()) await close.click()
  }
  const entry = page.getByRole('button', { name: '插件社区', exact: true })
  if (!(await entry.isVisible())) await page.getByRole('button', { name: '更多', exact: true }).first().click()
  await page.getByText('插件社区', { exact: true }).click()
  await page.getByRole('button', { name: '加载 Cordis 目录', exact: true }).waitFor()
}
/** Exercise the actual distribution and effect lifecycle without a paid model request.
 * @param context Fresh caller-owned browser context.
 * @param origin Assembled static site.
 * @param incompatible Prepared archive with an unsupported DSH requirement.
 * @param capture Optional screenshot evidence callback.
 * @returns Native tool output and verified lifecycle facts.
 */
export async function cordisCommunityScenario(
  context: BrowserContext,
  origin: string,
  incompatible: string,
  capture?: (page: Page, name: string) => Promise<void>,
): Promise<{ toolResult: string; checks: string[]; errors: string[] }> {
  const errors: string[] = [],
    checks: string[] = []
  let toolResult = '',
    removed = false
  let complete: (() => void) | undefined, removalComplete: (() => void) | undefined
  const invoked = new Promise<void>((resolve) => {
      complete = resolve
    }),
    withdrew = new Promise<void>((resolve) => {
      removalComplete = resolve
    })
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
  await context.route('https://api.deepseek.com/**', async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 200, headers: cors })
      return
    }
    if (!request.url().endsWith('/messages')) {
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: '{"object":"list","data":[]}',
      })
      return
    }
    const body = request.postDataJSON() as { model: string; tools?: { name: string }[]; messages: unknown[] }
    const tools = (body.tools ?? []).map(t => t.name),
      last = JSON.stringify(body.messages.at(-1))
    const events: string[] = []
    const emit = (type: string, data: object): void => {
      events.push(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
    }
    emit('message_start', {
      message: {
        id: 'cordis-example',
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [],
        stop_reason: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    })
    if (last.includes('CORDIS-CALL') && tools.includes('community_echo')) {
      emit('content_block_start', {
        index: 0,
        content_block: { type: 'tool_use', id: 'cordis_call', name: 'community_echo', input: {} },
      })
      emit('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"text":"ordinary-plugin"}' } })
      emit('content_block_stop', { index: 0 })
      emit('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 1 } })
    } else {
      if (last.includes('tool_result')) {
        toolResult = last
        complete?.()
      }
      if (last.includes('CORDIS-REMOVED') && tools.length > 0) {
        removed = !tools.includes('community_echo')
        removalComplete?.()
      }
      emit('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
      emit('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'CORDIS-DONE' } })
      emit('content_block_stop', { index: 0 })
      emit('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } })
    }
    emit('message_stop', {})
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: events.join('') })
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => {
    errors.push(error.message)
  })
  const wait = async (promise: Promise<void>): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new Error('Native Cordis model request did not complete'))
          }, 45000)
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' })
    await community(page)
    await page.getByRole('button', { name: '加载 Cordis 目录', exact: true }).click()
    const listing = page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: '@dsh-community/hello', exact: true }) })
    await listing.getByRole('button', { name: '检查发行包', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '检查 Cordis 插件', exact: true })
    await dialog.waitFor()
    if (!(await dialog.getByRole('button', { name: '安装到插件管理器', exact: true }).isDisabled()))
      throw new Error('Full host trust was bypassed')
    await dialog.getByRole('checkbox').check()
    await dialog.getByRole('button', { name: '安装到插件管理器', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.getByText('已停用', { exact: true }).waitFor()
    checks.push('An existing-format market release installed as a disabled dependency in the shared plugin manager')
    await page.getByRole('button', { name: '启用插件', exact: true }).click()
    await page.getByText('已启用', { exact: true }).waitFor()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await community(page)
    await page.getByText('已启用', { exact: true }).waitFor()
    checks.push('The ordinary profile package and module files survived reload and enabled through Cordis')
    const session = await remote<{ sessionId: string }>(page, 'session/create', { request: {} })
    await remote(page, 'session/prompt', {
      request: {
        requestId: randomUUID(),
        sessionId: session.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: 'CORDIS-CALL' }],
      },
    })
    await wait(invoked)
    if (!toolResult.includes('Cordis ordinary-plugin'))
      throw new Error('Native plugin returned the wrong model-visible result ' + toolResult)
    checks.push('The real agent loop called the ordinary ctx.tools registration and logged its result')
    await page.locator('input[type=file][accept*=".tgz"]').setInputFiles(incompatible)
    await dialog.getByText('插件要求的 DSH 版本与当前版本不兼容', { exact: true }).waitFor()
    if (!(await dialog.getByRole('button', { name: '安装到插件管理器', exact: true }).isDisabled()))
      throw new Error('An incompatible plugin was installable')
    await dialog.getByRole('button', { name: '取消', exact: true }).last().click()
    checks.push('An incompatible ordinary bundle was refused before installation')
    await page.getByRole('heading', { name: '插件社区', exact: true }).scrollIntoViewIfNeeded()
    await capture?.(page, 'cordis-community-desktop')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ colorScheme: 'dark' })
    const collapse = page.getByRole('button', { name: '收起侧边栏', exact: true })
    if (await collapse.isVisible()) await collapse.click()
    await page.getByRole('heading', { name: '插件社区', exact: true }).scrollIntoViewIfNeeded()
    await capture?.(page, 'cordis-community-mobile')
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error('Community overflowed the narrow viewport')
    await page.getByText('卸载插件', { exact: true }).click()
    await page.getByRole('button', { name: '确认卸载插件', exact: true }).click()
    await page.getByText('尚未安装第三方 Cordis 插件', { exact: true }).waitFor()
    await remote(page, 'session/prompt', {
      request: {
        requestId: randomUUID(),
        sessionId: session.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: 'CORDIS-REMOVED' }],
      },
    })
    await wait(withdrew)
    if (!removed) throw new Error('Uninstall left the plugin tool registered')
    checks.push('The shared manager stopped contributions and removed the package and its model tool')
    if (errors.length > 0) throw new Error(errors.join('\n'))
    return { checks, toolResult, errors }
  } catch (error) {
    await capture?.(page, 'cordis-community-failed')
    throw error
  } finally {
    await page.close()
  }
}
