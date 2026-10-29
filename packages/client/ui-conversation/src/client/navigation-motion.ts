/**
 * Direction for a session change, and a shared move from the session row to its header title.
 * The first session on screen stays still. Reduced motion keeps the end state.
 */
import { morphShared, prefersReducedMotion } from '@deepseek-ai/dsh-client-ui-primitives'

const CONTENT = '[data-conversation-content]'

/**
 * Watch one document subtree for session changes.
 * @param root - subtree that contains the conversation. `null` does nothing.
 * @returns a disposer that stops the watch.
 */
export function installNavigationMotion(root: ParentNode | null): () => void {
  const view = viewOf(root)
  if (root === null || view === null) return () => {}
  const doc = view.document
  let current: string | null = null
  const stack: string[] = []

  const applyChange = (): void => {
    const content = root.querySelector<HTMLElement>(CONTENT)
    if (content === null) return
    const next = content.getAttribute('data-conversation-session') ?? ''
    if (next === '' || next === current) return
    if (current === null) {
      current = next
      stack.push(next)
      return
    }
    const earlier = stack.at(-2)
    const back = earlier === next
    if (back) stack.pop()
    else stack.push(next)
    current = next
    if (prefersReducedMotion(view)) return
    content.removeAttribute('data-dsh-motion-enter')
    void content.offsetWidth
    content.setAttribute('data-dsh-motion-enter', back ? 'back' : 'forward')
    const from = shared(doc, 'session-row', next)
    const to = shared(doc, 'session-title', next)
    if (from !== null && to !== null) morphShared(from, to)
  }

  applyChange()
  const observer = new MutationObserver(applyChange)
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-conversation-session'],
  })
  return () => { observer.disconnect() }
}

/** Shared marker whose id matches, including ids that are not safe inside a selector. */
function shared(doc: Document, kind: string, id: string): HTMLElement | null {
  for (const node of doc.querySelectorAll<HTMLElement>(`[data-dsh-shared="${kind}"]`)) {
    if (node.getAttribute('data-dsh-shared-id') === id) return node
  }
  return null
}

function viewOf(root: ParentNode | null): Window | null {
  if (root === null) return null
  if (root instanceof Document) return root.defaultView
  return root.ownerDocument?.defaultView ?? null
}
