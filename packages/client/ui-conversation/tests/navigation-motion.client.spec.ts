// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installNavigationMotion } from '../src/client/navigation-motion.ts'

let reduced = false
let stop = (): void => {}

function media(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduced && query.includes('reduce'), media: query }))
}

function content(parent: ParentNode, id: string): HTMLElement {
  const node = document.createElement('div')
  node.setAttribute('data-conversation-content', '')
  node.setAttribute('data-conversation-session', id)
  parent.append(node)
  return node
}

async function flush(): Promise<void> {
  await Promise.resolve()
}

afterEach(() => {
  stop()
  stop = () => {}
  reduced = false
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('navigation motion', () => {
  it('does nothing without a root or a window', () => {
    installNavigationMotion(null)()
    const foreign = document.implementation.createHTMLDocument('foreign')
    const dispose = installNavigationMotion(foreign.body)
    content(foreign.body, 'a')
    expect(foreign.body.querySelector('[data-dsh-motion-enter]')).toBeNull()
    dispose()
  })

  it('enters forward and back after the first session, and morphs a visible row into the title', async () => {
    media()
    const animations: Element[] = []
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value(this: HTMLElement) {
        animations.push(this)
        return { onfinish: null, oncancel: null, cancel() {} }
      },
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(1, 2, 20, 12))
    const root = document.createElement('div')
    document.body.append(root)
    stop = installNavigationMotion(root)
    const pane = content(root, 'a')
    await flush()
    expect(pane.hasAttribute('data-dsh-motion-enter')).toBe(false)
    pane.setAttribute('data-conversation-session', 'b')
    await flush()
    expect(pane.getAttribute('data-dsh-motion-enter')).toBe('forward')
    expect(animations).toHaveLength(0)
    const row = document.createElement('span')
    row.setAttribute('data-dsh-shared', 'session-row')
    row.setAttribute('data-dsh-shared-id', 'c"d')
    const title = document.createElement('span')
    title.setAttribute('data-dsh-shared', 'session-title')
    title.setAttribute('data-dsh-shared-id', 'c"d')
    document.body.append(row, title)
    pane.setAttribute('data-conversation-session', 'c"d')
    await flush()
    expect(pane.getAttribute('data-dsh-motion-enter')).toBe('forward')
    expect(animations.length).toBeGreaterThan(0)
    pane.setAttribute('data-conversation-session', 'b')
    await flush()
    expect(pane.getAttribute('data-dsh-motion-enter')).toBe('back')
    pane.setAttribute('data-conversation-session', '')
    await flush()
    expect(pane.getAttribute('data-dsh-motion-enter')).toBe('back')
    stop()
    pane.setAttribute('data-conversation-session', 'd')
    await flush()
    expect(pane.getAttribute('data-dsh-motion-enter')).toBe('back')
  })

  it('keeps the end state when motion is reduced', async () => {
    reduced = true
    media()
    stop = installNavigationMotion(document)
    const pane = content(document.body, 'a')
    await flush()
    pane.setAttribute('data-conversation-session', 'b')
    await flush()
    expect(pane.hasAttribute('data-dsh-motion-enter')).toBe(false)
  })
})
