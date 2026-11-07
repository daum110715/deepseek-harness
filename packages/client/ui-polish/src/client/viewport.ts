/**
 * Keep the composer above an on-screen keyboard. Chromium resizes the layout
 * when the viewport asks for `interactive-widget=resizes-content`; Safari ignores
 * that and only shrinks the visual viewport, so there the root is sized to what
 * stays visible while the keyboard is up.
 */

/** Shrink of the visual viewport below the layout one that means a keyboard, not browser chrome. */
const KEYBOARD_THRESHOLD_PX = 120

/**
 * Ask Chromium to resize the layout for the keyboard, keeping the rest of the viewport declaration.
 * @param document - the page.
 * @returns disposer restoring the original declaration.
 */
export function requestKeyboardResize(document: Document): () => void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (meta === null || meta.content.includes('interactive-widget')) return () => undefined
  const original = meta.content
  meta.content = `${original}, interactive-widget=resizes-content`
  return () => { meta.content = original }
}

/**
 * Track the visible height while a keyboard covers part of the layout viewport.
 * @param view - the window.
 * @returns disposer.
 */
export function followVisualViewport(view: Window): () => void {
  const visual = view.visualViewport
  if (visual === null) return () => undefined
  const root = view.document.documentElement
  const update = (): void => {
    const covered = view.innerHeight - visual.height
    if (covered > KEYBOARD_THRESHOLD_PX) {
      root.style.setProperty('--dsh-visible-height', `${String(Math.round(visual.height))}px`)
      root.dataset.dshKeyboard = ''
      // Safari scrolls the page to reveal the field; the sized root already shows it.
      if (view.scrollY !== 0) view.scrollTo(0, 0)
    } else if ('dshKeyboard' in root.dataset) {
      delete root.dataset.dshKeyboard
      root.style.removeProperty('--dsh-visible-height')
    }
  }
  visual.addEventListener('resize', update)
  visual.addEventListener('scroll', update)
  return () => {
    visual.removeEventListener('resize', update)
    visual.removeEventListener('scroll', update)
    delete root.dataset.dshKeyboard
    root.style.removeProperty('--dsh-visible-height')
  }
}
