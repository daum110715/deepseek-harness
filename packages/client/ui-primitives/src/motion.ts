/**
 * Interruptible transform and opacity playback shared by client surfaces.
 * Durations and curves match `--dsw-motion-*` in ui-theme `motion.css`.
 * Exit durations are seven tenths of the matching enter duration.
 * A missing destination, a zero-size box, or reduced motion leaves the end state in place.
 */

/** Enter durations and the shorter exits paired with them. Shared motion stays at or under 480 ms. */
export const MOTION_MS = {
  fast: 160,
  base: 240,
  slow: 340,
  shared: 480,
  exitFast: 112,
  exit: 168,
  exitSlow: 238,
} as const

/** Material 3 emphasized enter, emphasized exit, standard move, and a slight gesture overshoot. */
export const MOTION_EASE = {
  enter: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
  exit: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
  move: 'cubic-bezier(0.2, 0, 0, 1)',
  snap: 'cubic-bezier(0.34, 1.25, 0.64, 1)',
} as const

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * Whether the view asks to reduce motion.
 * @param view - window that owns the document. Omit it to read the page window.
 * @returns true when reduced motion matches. A missing view or `matchMedia` does not force motion off.
 */
export function prefersReducedMotion(view?: Window | null): boolean {
  const target = view === undefined ? globalThis.window : view
  if (target == null || typeof target.matchMedia !== 'function') return false
  return target.matchMedia(REDUCED_QUERY).matches
}

/**
 * Whether Web Animations can play for this element.
 * @param node - element that would own the animation.
 * @returns false without a window, without `animate`, or when reduced motion matches.
 */
export function canAnimate(node: Element): boolean {
  const view = node.ownerDocument.defaultView
  if (view === null || typeof node.animate !== 'function') return false
  return !prefersReducedMotion(view)
}

/** Geometry captured while an element is still connected. */
export interface PresenceSnapshot {
  rect: DOMRect
  transformOrigin: string
}

/**
 * Read the box and transform origin used by a later exit clone.
 * @param node - connected element.
 * @returns the box and origin from the current frame.
 */
export function capturePresence(node: HTMLElement): PresenceSnapshot {
  return {
    rect: node.getBoundingClientRect(),
    transformOrigin: getComputedStyle(node).transformOrigin,
  }
}

function conceal(root: HTMLElement): void {
  root.removeAttribute('id')
  root.removeAttribute('role')
  root.removeAttribute('aria-modal')
  root.setAttribute('aria-hidden', 'true')
  root.dataset.dshMotionGhost = ''
  root.style.pointerEvents = 'none'
  for (const node of root.querySelectorAll<HTMLElement>('[id], [role], [aria-modal]')) {
    node.removeAttribute('id')
    node.removeAttribute('role')
    node.removeAttribute('aria-modal')
  }
}

function dropOnEnd(animation: Animation, node: HTMLElement): void {
  const remove = (): void => { node.remove() }
  animation.onfinish = remove
  animation.oncancel = remove
}

/**
 * Start an exit clone for a host that is about to leave, or already has.
 * The caller disconnects any previous watcher. A host that is still connected
 * waits until its parent reports the removal.
 * @param node - host element captured for the exit.
 * @param snapshot - box and origin from the last connected frame.
 * @param watch - slot for the removal observer. Replaced on each call.
 * @returns nothing. A zero-size or reduced-motion host leaves no clone.
 */
export function releasePresence(
  node: HTMLElement,
  snapshot: PresenceSnapshot,
  watch: { current: MutationObserver | null },
): void {
  watch.current?.disconnect()
  watch.current = null
  if (!node.isConnected) {
    playPresenceExit(node, snapshot)
    return
  }
  const parent = node.parentElement
  /* v8 ignore next -- a connected element has a parent */
  if (parent === null) return
  const observer = new MutationObserver(() => {
    if (node.isConnected) return
    observer.disconnect()
    if (watch.current === observer) watch.current = null
    playPresenceExit(node, snapshot)
  })
  watch.current = observer
  observer.observe(parent, { childList: true })
}

/**
 * Clone a detached element and play its exit. The live tree is already gone.
 * @param source - element that just disconnected. The clone is taken from it.
 * @param snapshot - box and origin captured while `source` was connected.
 * @returns the exit animation, or null when motion cannot run. A null result leaves no ghost.
 */
export function playPresenceExit(source: HTMLElement, snapshot: PresenceSnapshot): Animation | null {
  const view = source.ownerDocument.defaultView
  if (snapshot.rect.width < 1 || snapshot.rect.height < 1 || view === null || !canAnimate(source)) return null
  const ghost = source.cloneNode(true) as HTMLElement
  conceal(ghost)
  const style = ghost.style
  style.position = 'fixed'
  style.left = `${String(snapshot.rect.left)}px`
  style.top = `${String(snapshot.rect.top)}px`
  style.width = `${String(snapshot.rect.width)}px`
  style.height = `${String(snapshot.rect.height)}px`
  style.margin = '0'
  style.transformOrigin = snapshot.transformOrigin
  style.zIndex = '1200'
  view.document.body.append(ghost)
  const animation = ghost.animate(
    [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.96)' }],
    { duration: MOTION_MS.exit, easing: MOTION_EASE.exit, fill: 'forwards' },
  )
  dropOnEnd(animation, ghost)
  return animation
}

function radiusOf(node: HTMLElement): string {
  const radius = getComputedStyle(node).borderRadius
  return radius === '' ? '0px' : radius
}

/**
 * Move a transient shell from one element to another.
 * Position, size, and corner radius interpolate together. Text is crossfaded and not scaled.
 * @param from - source element. A missing or zero-size source skips the morph.
 * @param to - destination element. A missing, disconnected, or zero-size destination skips the morph.
 * @returns false when the morph does not start. Callers leave the destination at its end state.
 */
export function morphShared(from: HTMLElement | null, to: HTMLElement | null): boolean {
  const view = to?.ownerDocument.defaultView ?? null
  if (from === null || to === null || !to.isConnected || view === null || !canAnimate(to)) return false
  const fromRect = from.getBoundingClientRect()
  const toRect = to.getBoundingClientRect()
  if (fromRect.width < 1 || fromRect.height < 1 || toRect.width < 1 || toRect.height < 1) return false
  const sx = fromRect.width / toRect.width
  const sy = fromRect.height / toRect.height
  const shell = view.document.createElement('div')
  shell.dataset.dshMotionGhost = ''
  shell.setAttribute('aria-hidden', 'true')
  shell.style.position = 'fixed'
  shell.style.left = '0'
  shell.style.top = '0'
  shell.style.width = `${String(toRect.width)}px`
  shell.style.height = `${String(toRect.height)}px`
  shell.style.transformOrigin = '0 0'
  shell.style.pointerEvents = 'none'
  shell.style.zIndex = '1200'
  shell.style.background = getComputedStyle(to).backgroundColor
  view.document.body.append(shell)
  const sourceClone = from.cloneNode(true) as HTMLElement
  conceal(sourceClone)
  sourceClone.style.position = 'fixed'
  sourceClone.style.left = `${String(fromRect.left)}px`
  sourceClone.style.top = `${String(fromRect.top)}px`
  sourceClone.style.width = `${String(fromRect.width)}px`
  sourceClone.style.height = `${String(fromRect.height)}px`
  sourceClone.style.margin = '0'
  sourceClone.style.transform = 'none'
  sourceClone.style.zIndex = '1201'
  view.document.body.append(sourceClone)
  const previousOpacity = to.style.opacity
  to.style.opacity = '0'
  const options: KeyframeAnimationOptions = { duration: MOTION_MS.shared, easing: MOTION_EASE.move, fill: 'forwards' }
  const shellAnimation = shell.animate([
    {
      transform: `translate(${String(fromRect.left)}px, ${String(fromRect.top)}px) scale(${String(sx)}, ${String(sy)})`,
      borderRadius: radiusOf(from),
      opacity: 1,
    },
    {
      transform: `translate(${String(toRect.left)}px, ${String(toRect.top)}px) scale(1, 1)`,
      borderRadius: radiusOf(to),
      opacity: 1,
    },
  ], options)
  const fadeOut = sourceClone.animate([{ opacity: 1 }, { opacity: 0 }], options)
  const fadeIn = to.animate([{ opacity: 0 }, { opacity: 1 }], options)
  const session = new MorphSession(view, to, () => {
    shellAnimation.cancel()
    fadeOut.cancel()
    fadeIn.cancel()
    shell.remove()
    sourceClone.remove()
    to.style.opacity = previousOpacity
  })
  session.arm(shellAnimation)
  return true
}

/** Removes the morph ghosts when the animation ends, the destination leaves, or the deadline passes. */
class MorphSession {
  private cleaned = false
  private timer = 0
  private readonly observer: MutationObserver

  constructor(
    private readonly view: Window,
    private readonly to: HTMLElement,
    private readonly release: () => void,
  ) {
    this.observer = new MutationObserver(() => {
      if (!this.to.isConnected) this.finish()
    })
  }

  /**
   * Watch the destination and stop at the shared-motion deadline.
   * @param animation - shell animation whose finish or cancel ends the morph.
   */
  arm(animation: Animation): void {
    this.observer.observe(this.view.document.body, { childList: true, subtree: true })
    this.timer = this.view.setTimeout(() => { this.finish() }, MOTION_MS.shared + 32)
    animation.onfinish = () => { this.finish() }
    animation.oncancel = () => { this.finish() }
  }

  /** Drop ghosts and restore the destination. A second call is a no-op. */
  finish(): void {
    if (this.cleaned) return
    this.cleaned = true
    this.view.clearTimeout(this.timer)
    this.observer.disconnect()
    this.release()
  }
}

/**
 * Replace one element with another along the vertical axis.
 * The outgoing copy moves up and fades. The incoming element moves up into place.
 * @param outgoing - element leaving this position. A missing or zero-size element is skipped.
 * @param incoming - element taking the position. A missing element stays at its end state.
 * @returns true when at least one side animates.
 */
export function playVerticalSwap(outgoing: HTMLElement | null, incoming: HTMLElement | null): boolean {
  let played = false
  if (outgoing !== null) {
    const rect = outgoing.getBoundingClientRect()
    const view = outgoing.ownerDocument.defaultView
    if (view !== null && rect.width >= 1 && rect.height >= 1 && canAnimate(outgoing)) {
      const ghost = outgoing.cloneNode(true) as HTMLElement
      conceal(ghost)
      ghost.style.position = 'fixed'
      ghost.style.left = `${String(rect.left)}px`
      ghost.style.top = `${String(rect.top)}px`
      ghost.style.width = `${String(rect.width)}px`
      ghost.style.height = `${String(rect.height)}px`
      ghost.style.margin = '0'
      ghost.style.zIndex = '1200'
      view.document.body.append(ghost)
      const animation = ghost.animate(
        [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-8px)' }],
        { duration: MOTION_MS.exit, easing: MOTION_EASE.exit, fill: 'forwards' },
      )
      dropOnEnd(animation, ghost)
      played = true
    }
  }
  if (incoming !== null && incoming.isConnected && canAnimate(incoming)) {
    const animation = incoming.animate(
      [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: MOTION_MS.base, easing: MOTION_EASE.enter, fill: 'forwards' },
    )
    animation.onfinish = () => { animation.cancel() }
    played = true
  }
  return played
}
