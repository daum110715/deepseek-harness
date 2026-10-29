/** Exit clone for a host that unmounts in the same commit. */
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { capturePresence, releasePresence } from './motion.ts'

/**
 * Play an exit clone when this component unmounts with its host.
 * Layout cleanup runs before the host leaves the document, so the clone waits
 * for that removal. A re-render that keeps the host cancels the wait.
 * @param props.target - reads the host after commit. A null host does nothing.
 * @returns nothing.
 */
export function PresenceExit({ target }: { target: () => HTMLElement | null }): null {
  const watch = useRef<MutationObserver | null>(null)
  useLayoutEffect(() => {
    const node = target()
    if (node === null) return
    const saved = capturePresence(node)
    return () => { releasePresence(node, saved, watch) }
  })
  return null
}

/**
 * Mark the parent element for an exit clone when this subtree unmounts.
 * The marker is hidden. Place it after the parent's other children.
 * @returns a hidden marker.
 */
export function PresenceExitParent(): ReactNode {
  const marker = useRef<HTMLSpanElement>(null)
  const watch = useRef<MutationObserver | null>(null)
  useLayoutEffect(() => {
    // The marker span commits before this parent effect, so the ref is set.
    /* v8 ignore start -- the marker span is committed before this parent effect */
    const node = marker.current?.parentElement ?? null
    if (node === null) return
    /* v8 ignore end */
    const saved = capturePresence(node)
    return () => { releasePresence(node, saved, watch) }
  })
  return <span ref={marker} hidden />
}
