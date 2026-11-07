// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { serveWebApp, type WebAppBridge, type WebAppServices } from '../src/client/web-app.ts'

type Status = { running: boolean | undefined; pendingInteraction: unknown; completionUnread: boolean }

function harness(byId: Record<string, { title?: string; subagent?: unknown }>) {
  let status: ReadonlyMap<string, Status> = new Map()
  const listeners = new Set<() => void>()
  const notify = vi.fn()
  const setBadge = vi.fn()
  const launchHandlers: Parameters<WebAppBridge['onLaunch']>[0][] = []
  const app = { notify, setBadge, onLaunch: (handler: Parameters<WebAppBridge['onLaunch']>[0]) => { launchHandlers.push(handler); return () => undefined } } as unknown as WebAppBridge
  const startSession = vi.fn()
  const openSession = vi.fn()
  const openSettings = vi.fn()
  const services: WebAppServices = {
    sessionStatus: { getSnapshot: () => status, subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } } },
    sessionList: { getSnapshot: () => ({ byId }), subscribe: () => () => undefined },
    workspace: { startSession, openSession },
    t: key => key,
    openSettings,
  }
  const dispose = serveWebApp(app, services)
  return {
    notify, setBadge, startSession, openSession, openSettings, dispose,
    launch: launchHandlers[0]!,
    set(next: Record<string, Partial<Status>>) {
      status = new Map(Object.entries(next).map(([id, value]) => [id, { running: false, pendingInteraction: undefined, completionUnread: false, ...value }]))
      for (const listener of listeners) listener()
    },
  }
}

describe('serveWebApp attention', () => {
  let hidden = false
  beforeEach(() => {
    hidden = false
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => hidden ? 'hidden' : 'visible')
    vi.spyOn(document, 'hasFocus').mockImplementation(() => !hidden)
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('stays quiet while the person is watching', () => {
    const app = harness({ a: { title: 'Alpha' } })
    app.set({ a: { running: true } })
    app.set({ a: { running: false } })
    expect(app.notify).not.toHaveBeenCalled()
  })

  it('notifies once when a session finishes unseen, badges it, and clears on return', () => {
    const app = harness({ a: { title: 'Alpha' } })
    app.set({ a: { running: true } })
    hidden = true
    app.set({ a: { running: false } })
    app.set({ a: { running: false } })
    expect(app.notify).toHaveBeenCalledTimes(1)
    expect(app.notify).toHaveBeenCalledWith('webApp.finished', 'Alpha', 'a')
    expect(app.setBadge).toHaveBeenLastCalledWith(1)
    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    expect(app.setBadge).toHaveBeenLastCalledWith(0)
  })

  it('notifies when a session starts waiting for the person, even while it runs', () => {
    const app = harness({ a: { title: 'Alpha' } })
    app.set({ a: { running: true } })
    hidden = true
    app.set({ a: { running: true, pendingInteraction: {} } })
    expect(app.notify).toHaveBeenCalledWith('webApp.needsYou', 'Alpha', 'a')
    expect(app.setBadge).toHaveBeenLastCalledWith(1)
  })

  it('ignores subagents and names untitled sessions', () => {
    const app = harness({ child: { title: 'Child', subagent: { parent: 'a' } }, a: {} })
    app.set({ child: { running: true }, a: { running: true } })
    hidden = true
    app.set({ child: { running: false }, a: { running: false } })
    expect(app.notify.mock.calls).toEqual([['webApp.finished', 'webApp.untitled', 'a']])
  })

  it('routes launches to the session and settings actions', () => {
    const app = harness({})
    app.launch({ kind: 'new' })
    app.launch({ kind: 'settings' })
    app.launch({ kind: 'session', sessionId: 'a' })
    expect(app.startSession).toHaveBeenCalledOnce()
    expect(app.openSettings).toHaveBeenCalledOnce()
    expect(app.openSession).toHaveBeenCalledWith('a')
  })
})
