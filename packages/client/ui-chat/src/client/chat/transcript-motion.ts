/**
 * Entrance motion for rows that appear after the transcript is already showing.
 * A loaded history batch and a prepended page stay still. Reduced motion keeps the end state.
 */
import { morphShared, playVerticalSwap, prefersReducedMotion } from '@deepseek-ai/dsh-client-ui-primitives'

const COMMAND = '[data-chat-flow-kind="command"]'
const FLOW = '[data-chat-flow-kind]'
const ECHO = '[data-submission-echo]'
const BUBBLE = '[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]'
const COMPOSER = '[data-composer-input]'

/** Composer box saved while it still held the text that was sent. */
interface Draft {
  rect: DOMRect
  clone: HTMLElement
}

/**
 * Watch one document subtree for transcript entrances.
 * @param root - subtree that contains the composer and the chat rows. `null` does nothing.
 * @returns a disposer that stops the watch.
 */
export function installTranscriptMotion(root: ParentNode | null): () => void {
  const view = viewOf(root)
  if (root === null || view === null) return () => {}
  const doc = view.document
  const echoRects = new WeakMap<HTMLElement, DOMRect>()
  const tracked = new Set<HTMLElement>()
  let draft: Draft | null = null

  const rememberEcho = (echo: HTMLElement): void => {
    if (!echo.isConnected) return
    const rect = echo.getBoundingClientRect()
    if (rect.width >= 1 && rect.height >= 1) echoRects.set(echo, rect)
  }

  const rememberEchoes = (): void => {
    for (const echo of tracked) rememberEcho(echo)
  }

  const rememberDraft = (): void => {
    const composer = doc.querySelector<HTMLElement>(COMPOSER)
    if (composer === null) return
    if (composer.textContent.trim() === '') return
    const rect = composer.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return
    draft = { rect, clone: composer.cloneNode(true) as HTMLElement }
  }

  const onScroll = (): void => { rememberEchoes() }
  doc.addEventListener('scroll', onScroll, true)
  view.addEventListener('resize', onScroll)
  doc.addEventListener('input', rememberDraft, true)

  const observer = new MutationObserver((records) => {
    const added = new Set<Node>()
    const commands: HTMLElement[] = []
    const echoes: HTMLElement[] = []
    const bubbles: HTMLElement[] = []
    const removed: HTMLElement[] = []
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue
        added.add(node)
        collect(node, commands, echoes, bubbles)
      }
      for (const node of record.removedNodes) {
        if (!(node instanceof HTMLElement)) continue
        collectRemoved(node, removed)
      }
    }
    for (const echo of echoes) {
      if (echo.tagName === 'LI') continue
      tracked.add(echo)
      rememberEcho(echo)
    }
    if (!prefersReducedMotion(view)) {
      if (commands.length === 1 && addedFlowCount(added) === 1) {
        for (const command of commands) {
          if (entersLive(command, added)) command.setAttribute('data-dsh-motion-enter', 'command')
        }
      }
      const arriving = echoes.filter(echo => echo.tagName !== 'LI' && echo.isConnected)
      const composer = doc.querySelector<HTMLElement>(COMPOSER)
      const cleared = composer === null || composer.textContent.trim() === ''
      const saved = draft
      if (arriving.length === 1 && saved !== null && cleared) {
        for (const echo of arriving) {
          if (!draftMatches(saved, echo)) continue
          morphDraft(view, saved, echo)
          draft = null
        }
      }
      if (removed.length === 1 && bubbles.length === 1) {
        for (const echo of removed) {
          const rect = echoRects.get(echo)
          if (rect === undefined) continue
          for (const bubble of bubbles) handoff(view, echo, rect, bubble)
        }
      }
    }
    for (const echo of removed) tracked.delete(echo)
  })
  observer.observe(root, { childList: true, subtree: true })

  return () => {
    observer.disconnect()
    doc.removeEventListener('scroll', onScroll, true)
    view.removeEventListener('resize', onScroll)
    doc.removeEventListener('input', rememberDraft, true)
    tracked.clear()
    draft = null
  }
}

function viewOf(root: ParentNode | null): Window | null {
  if (root === null) return null
  if (root instanceof Document) return root.defaultView
  return root.ownerDocument?.defaultView ?? null
}

function collect(node: HTMLElement, commands: HTMLElement[], echoes: HTMLElement[], bubbles: HTMLElement[]): void {
  const seen = node.matches(`${COMMAND}, ${ECHO}, ${BUBBLE}`) ? [node] : []
  for (const child of node.querySelectorAll<HTMLElement>(`${COMMAND}, ${ECHO}, ${BUBBLE}`)) seen.push(child)
  for (const element of seen) {
    if (element.matches(COMMAND)) commands.push(element)
    if (element.matches(ECHO)) echoes.push(element)
    if (element.matches(BUBBLE)) bubbles.push(element)
  }
}

function collectRemoved(node: HTMLElement, removed: HTMLElement[]): void {
  if (node.matches(ECHO) && node.tagName !== 'LI') removed.push(node)
  for (const echo of node.querySelectorAll<HTMLElement>(ECHO)) {
    if (echo.tagName !== 'LI') removed.push(echo)
  }
}

/** Flow rows inserted by this mutation, including rows nested under one added parent. */
function addedFlowCount(added: Set<Node>): number {
  let count = 0
  for (const node of added) {
    if (!(node instanceof HTMLElement)) continue
    if (node.matches(FLOW)) count += 1
    count += node.querySelectorAll(FLOW).length
  }
  return count
}

/**
 * A live command is one new flow row after a row that was already on screen.
 * A following flow row that was already there means the command was inserted earlier in the transcript.
 * Running status and submission echoes sit after the rows and do not count.
 */
function entersLive(node: HTMLElement, added: Set<Node>): boolean {
  const inserted = insertionRoot(node, added)
  if (!hasSettledFlowBefore(inserted, added)) return false
  let sibling = inserted.nextElementSibling
  while (sibling !== null) {
    if (!added.has(sibling) && sibling.matches(FLOW)) return false
    sibling = sibling.nextElementSibling
  }
  return true
}

function hasSettledFlowBefore(inserted: HTMLElement, added: Set<Node>): boolean {
  let sibling = inserted.previousElementSibling
  while (sibling !== null) {
    if (!added.has(sibling) && sibling.matches(FLOW)) return true
    sibling = sibling.previousElementSibling
  }
  return false
}

function insertionRoot(node: HTMLElement, added: Set<Node>): HTMLElement {
  let current = node
  for (;;) {
    if (added.has(current)) return current
    const parent = current.parentElement
    /* v8 ignore next -- a collected command stays under the node that was inserted */
    if (parent === null) return current
    current = parent
  }
}

function placeHolder(view: Window, source: HTMLElement, rect: DOMRect): HTMLElement {
  const holder = source.cloneNode(true) as HTMLElement
  const style = holder.style
  style.position = 'fixed'
  style.left = `${String(rect.left)}px`
  style.top = `${String(rect.top)}px`
  style.width = `${String(rect.width)}px`
  style.height = `${String(rect.height)}px`
  style.margin = '0'
  style.pointerEvents = 'none'
  view.document.body.append(holder)
  return holder
}

function draftMatches(draft: Draft, echo: HTMLElement): boolean {
  const sent = draft.clone.textContent.trim()
  return sent !== '' && echo.textContent.includes(sent)
}

function morphDraft(view: Window, draft: Draft, echo: HTMLElement): void {
  const holder = placeHolder(view, draft.clone, draft.rect)
  morphShared(holder, echo)
  holder.remove()
}

function handoff(view: Window, echo: HTMLElement, rect: DOMRect, bubble: HTMLElement): void {
  const holder = placeHolder(view, echo, rect)
  playVerticalSwap(holder, bubble)
  holder.remove()
}
