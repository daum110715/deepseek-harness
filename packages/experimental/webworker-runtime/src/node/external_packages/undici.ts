/**
 * `undici` stand-in. The package is a Node socket client and cannot load in a
 * worker, so `fetch` is served by the browser's own and every dispatcher member
 * refuses by name.
 *
 * The browser decides what a page may read. A site that does not allow
 * cross-origin reads fails with a message saying so rather than the browser's
 * bare `Failed to fetch`. Redirects are followed by the browser, because a
 * manual redirect comes back opaque, with neither status nor `Location`. A
 * `user-agent` header is dropped: the browser keeps its own, and asking for
 * another forces a preflight that many sites refuse.
 */
import { notImplementedFail } from '../notImplementedFail.ts'

const MODULE = 'undici'

/**
 * Fetch through the browser.
 * @param input - Request URL.
 * @param init - Request options, as undici accepts them.
 * @returns The browser's response.
 */
export async function fetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.delete('user-agent')
  const redirect = init.redirect === 'manual' ? 'follow' : init.redirect
  try {
    return await globalThis.fetch(input, { ...init, headers, ...redirect === undefined ? {} : { redirect } })
  } catch (error) {
    if (init.signal?.aborted === true || !(error instanceof TypeError)) throw error
    const origin = new URL(String(input)).origin
    throw new TypeError(`${origin} could not be reached from the browser. Either it does not allow cross-origin reads or the network is down`, { cause: error })
  }
}

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts). */
export const __esModule = true

export const Agent = notImplementedFail(MODULE, 'Agent')
export const Pool = notImplementedFail(MODULE, 'Pool')
export const ProxyAgent = notImplementedFail(MODULE, 'ProxyAgent')
export const getGlobalDispatcher = notImplementedFail(MODULE, 'getGlobalDispatcher')
export const setGlobalDispatcher = notImplementedFail(MODULE, 'setGlobalDispatcher')

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default { fetch, Agent, Pool, ProxyAgent, getGlobalDispatcher, setGlobalDispatcher }
