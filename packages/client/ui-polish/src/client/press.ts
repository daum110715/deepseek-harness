/**
 * Press feedback: a control gives way under a press and settles back with a
 * slight overshoot. Web Animations on the independent `scale` property, so a
 * component's own transitions and transforms keep working.
 */
import { CONTROL_SELECTOR } from './touch.ts'

/** Most a control shrinks, as a fraction of its size. */
const MAX_SHRINK = 0.04
/** Most a control shrinks, in pixels across its longer side; large rows give way as much as small icons. */
const MAX_SHRINK_PX = 4
const PRESS_MS = 90
const RELEASE_MS = 280
const PRESS_EASING = 'cubic-bezier(0.3, 0, 0.8, 0.15)'
/** A small overshoot on release reads as a physical button settling back. */
const RELEASE_EASING = 'cubic-bezier(0.34, 1.56, 0.64, 1)'

/**
 * The scale a pressed control shrinks to.
 * @param width - control width.
 * @param height - control height.
 * @returns a scale factor just below 1.
 */
export function pressScale(width: number, height: number): number {
  const longer = Math.max(width, height, 1)
  return 1 - Math.min(MAX_SHRINK, MAX_SHRINK_PX / longer)
}

/**
 * Animate presses on controls.
 * @param view - the window.
 * @param reduced - read at each press: whether motion is reduced right now.
 * @returns disposer.
 */
export function pressFeedback(view: Window, reduced: () => boolean): () => void {
  let pressed: { control: Element; scale: number; animation: Animation } | undefined
  const down = (event: PointerEvent): void => {
    if (event.button !== 0 || reduced() || !(event.target instanceof Element)) return
    const control = event.target.closest(CONTROL_SELECTOR)
    if (control === null || control.matches(':disabled, [aria-disabled="true"], [data-dsh-no-press], [data-dsh-no-press] *')) return
    const box = control.getBoundingClientRect()
    const scale = pressScale(box.width, box.height)
    pressed = {
      control,
      scale,
      animation: control.animate([{ scale: '1' }, { scale: String(scale) }], { duration: PRESS_MS, easing: PRESS_EASING, fill: 'forwards' }),
    }
  }
  const up = (): void => {
    if (pressed === undefined) return
    const { control, scale, animation } = pressed
    pressed = undefined
    animation.cancel()
    control.animate([{ scale: String(scale) }, { scale: '1' }], { duration: RELEASE_MS, easing: RELEASE_EASING })
  }
  view.addEventListener('pointerdown', down, { capture: true, passive: true })
  // A scroll that starts on a control cancels the pointer, which releases it too.
  for (const type of ['pointerup', 'pointercancel', 'blur'] as const) view.addEventListener(type, up, { capture: true, passive: true })
  return () => {
    view.removeEventListener('pointerdown', down, { capture: true })
    for (const type of ['pointerup', 'pointercancel', 'blur'] as const) view.removeEventListener(type, up, { capture: true })
    pressed?.animation.cancel()
  }
}
