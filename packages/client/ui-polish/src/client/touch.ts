/**
 * Touch ergonomics a stylesheet cannot decide alone: which small controls get a
 * larger invisible hit area, and when a tap vibrates.
 */

/** Controls a finger presses. */
export const CONTROL_SELECTOR = 'button, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="tab"], [role="switch"], [role="option"], [role="checkbox"]'

/** Smallest comfortable touch target in CSS pixels, from the platform guidelines. */
export const TOUCH_TARGET_PX = 44

/** Largest growth on each side, so neighbouring controls do not swallow each other's taps. */
const MAX_SLOP_PX = 8

/** Delay that folds one burst of DOM changes, such as a streamed reply, into one pass. */
const RESCAN_DELAY_MS = 250

/**
 * How far a control's hit area should grow on each side.
 * @param width - control width.
 * @param height - control height.
 * @returns the growth in pixels; 0 for controls that are already large enough or not laid out.
 */
export function hitSlop(width: number, height: number): number {
  const short = Math.min(width, height)
  if (short <= 0 || short >= TOUCH_TARGET_PX) return 0
  return Math.min(MAX_SLOP_PX, Math.ceil((TOUCH_TARGET_PX - short) / 2))
}

/**
 * Grow small controls' hit areas through an `::after` box the stylesheet draws.
 * A control whose own `::after` already shows something keeps its look and size.
 * @param document - the page.
 * @returns disposer that stops observing and removes the marks.
 */
export function enlargeTouchTargets(document: Document): () => void {
  const view = document.defaultView
  if (view === null) return () => undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const scan = (): void => {
    timer = undefined
    for (const control of document.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)) {
      const box = control.getBoundingClientRect()
      const slop = hitSlop(box.width, box.height)
      const marked = control.hasAttribute('data-dsh-hit')
      if (slop === 0) {
        if (marked) control.removeAttribute('data-dsh-hit')
        continue
      }
      if (!marked) {
        if (view.getComputedStyle(control, '::after').content !== 'none') continue
        // An absolutely placed control already anchors its pseudo-element; only a static one needs anchoring.
        if (view.getComputedStyle(control).position === 'static') control.setAttribute('data-dsh-hit-anchor', '')
        control.setAttribute('data-dsh-hit', '')
      }
      control.style.setProperty('--dsh-hit-slop', `${String(slop)}px`)
    }
  }
  const schedule = (): void => { timer ??= setTimeout(scan, RESCAN_DELAY_MS) }
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  view.addEventListener('resize', schedule)
  schedule()
  return () => {
    observer.disconnect()
    view.removeEventListener('resize', schedule)
    if (timer !== undefined) clearTimeout(timer)
    for (const control of document.querySelectorAll<HTMLElement>('[data-dsh-hit]')) {
      control.removeAttribute('data-dsh-hit')
      control.removeAttribute('data-dsh-hit-anchor')
      control.style.removeProperty('--dsh-hit-slop')
    }
  }
}

/** Vibration length for a tap that changes a state, such as a switch or a tab. */
const SELECT_MS = 10
/** Vibration length for any other tap. */
const TAP_MS = 6

/**
 * The vibration a tap on this element earns.
 * @param target - the clicked element.
 * @returns the duration in milliseconds, or 0 for no vibration.
 */
export function hapticFor(target: Element | null): number {
  const control = target?.closest(CONTROL_SELECTOR)
  if (control === null || control === undefined) return 0
  if (control.matches(':disabled, [aria-disabled="true"]')) return 0
  const role = control.getAttribute('role')
  const selects = role === 'switch' || role === 'tab' || role === 'option' || role === 'checkbox'
    || role === 'menuitemradio' || role === 'menuitemcheckbox' || control.hasAttribute('aria-pressed')
  return selects ? SELECT_MS : TAP_MS
}

/**
 * Vibrate lightly when a finger taps a control. A click, not a press, so starting
 * a scroll on a control stays silent.
 * @param view - the window.
 * @param enabled - read at each tap, so the setting applies at once.
 * @returns disposer.
 */
export function vibrateOnTap(view: Window, enabled: () => boolean): () => void {
  if (typeof view.navigator.vibrate !== 'function') return () => undefined
  let touched = false
  const pointer = (event: PointerEvent): void => { touched = event.pointerType === 'touch' }
  const click = (event: MouseEvent): void => {
    if (!touched || !enabled()) return
    const duration = hapticFor(event.target instanceof Element ? event.target : null)
    if (duration > 0) view.navigator.vibrate(duration)
  }
  view.addEventListener('pointerdown', pointer, { capture: true, passive: true })
  view.addEventListener('click', click, { capture: true, passive: true })
  return () => {
    view.removeEventListener('pointerdown', pointer, { capture: true })
    view.removeEventListener('click', click, { capture: true })
  }
}

/**
 * Whether this device can vibrate on a tap: a touch screen with the Vibration API.
 * @param view - the window.
 * @returns true when haptic feedback can work.
 */
export function canVibrate(view: Window): boolean {
  return typeof view.navigator.vibrate === 'function' && view.matchMedia('(pointer: coarse)').matches
}
