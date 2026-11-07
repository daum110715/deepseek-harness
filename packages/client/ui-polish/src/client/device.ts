/**
 * Device facts published on `<html>` for stylesheets: form factor, primary
 * pointer, the input last used, and whether the app runs installed. Hybrid
 * devices switch between touch and mouse, so the last input follows
 * `pointerdown` while the form factor follows the viewport and primary pointer.
 */

/** Rough device class from the primary pointer and the viewport's short side. */
export type FormFactor = 'phone' | 'tablet' | 'desktop'

/** Short side at which a touch device stops being a phone; matches common tablet widths. */
const TABLET_SHORT_SIDE = 600

/**
 * Classify the device.
 * @param width - viewport width in CSS pixels.
 * @param height - viewport height in CSS pixels.
 * @param coarse - whether the primary pointer is coarse (a finger).
 * @returns the form factor.
 */
export function formFactor(width: number, height: number, coarse: boolean): FormFactor {
  if (!coarse) return 'desktop'
  return Math.min(width, height) < TABLET_SHORT_SIDE ? 'phone' : 'tablet'
}

/**
 * Keep the device attributes current on the document element.
 * @param view - the window whose document is described.
 * @returns disposer that removes the attributes and listeners.
 */
export function publishDevice(view: Window): () => void {
  const root = view.document.documentElement
  const coarse = view.matchMedia('(pointer: coarse)')
  const standalone = view.matchMedia('(display-mode: standalone)')
  const update = (): void => {
    root.dataset.dshFormFactor = formFactor(view.innerWidth, view.innerHeight, coarse.matches)
    root.dataset.dshPointer = coarse.matches ? 'coarse' : 'fine'
    root.dataset.dshStandalone = String(standalone.matches || (view.navigator as { standalone?: boolean }).standalone === true)
  }
  const input = (event: PointerEvent): void => {
    if (event.pointerType !== '' && root.dataset.dshInput !== event.pointerType) root.dataset.dshInput = event.pointerType
  }
  update()
  root.dataset.dshInput = coarse.matches ? 'touch' : 'mouse'
  view.addEventListener('resize', update)
  coarse.addEventListener('change', update)
  standalone.addEventListener('change', update)
  view.addEventListener('pointerdown', input, { capture: true, passive: true })
  return () => {
    view.removeEventListener('resize', update)
    coarse.removeEventListener('change', update)
    standalone.removeEventListener('change', update)
    view.removeEventListener('pointerdown', input, { capture: true })
    for (const name of ['dshFormFactor', 'dshPointer', 'dshStandalone', 'dshInput']) delete root.dataset[name]
  }
}
