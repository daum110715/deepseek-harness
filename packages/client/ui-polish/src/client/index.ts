/**
 * Device adaptation, motion, and touch feel for the Web client. Publishes device
 * facts on `<html>`, keeps the composer above an on-screen keyboard, gives small
 * controls touch-sized hit areas, animates presses, vibrates on taps where the
 * device can, and adds a Motion and touch row to General settings.
 *
 * @module @deepseek-ai/dsh-client-ui-polish/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the settings slot declarations.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import styles from './polish.css?inline'
import { publishDevice } from './device.ts'
import { pressFeedback } from './press.ts'
import { canVibrate, enlargeTouchTargets, vibrateOnTap } from './touch.ts'
import { followVisualViewport, requestKeyboardResize } from './viewport.ts'
import { createPolishStore } from './store.ts'
import { PolishRow, type PolishRowInjected } from './PolishRow.tsx'
import { en, ja, es, fr, de, ru, pt, NS, zh, type PolishKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Motion and touch settings copy. */
    'ui-polish': PolishKey
  }
}

const PLUGIN_ID = '@deepseek-ai/dsh-client-ui-polish'

/** Required services: copy and the settings slot. */
export const inject = ['locale', 'slots']

/**
 * Install the stylesheet and behaviors, and register the settings row.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-polish: dictionaries')
  const handle = createPolishStore()
  const store = handle.create()
  const view = typeof document === 'undefined' ? null : document.defaultView
  if (view !== null) {
    const { document } = view
    ctx.effect(() => {
      const tag = document.createElement('style')
      tag.dataset.plugin = PLUGIN_ID
      tag.dataset.pluginCss = `${PLUGIN_ID}/polish.css`
      tag.textContent = styles
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }, 'ui-polish: stylesheet')
    ctx.effect(() => publishDevice(view), 'ui-polish: device facts')
    ctx.effect(() => requestKeyboardResize(document), 'ui-polish: keyboard resizes the layout')
    ctx.effect(() => followVisualViewport(view), 'ui-polish: visible height under a keyboard')
    ctx.effect(() => {
      const touch = view.matchMedia('(pointer: coarse)')
      let stop = touch.matches ? enlargeTouchTargets(document) : undefined
      const change = (): void => {
        stop?.()
        stop = touch.matches ? enlargeTouchTargets(document) : undefined
      }
      touch.addEventListener('change', change)
      return () => {
        touch.removeEventListener('change', change)
        stop?.()
      }
    }, 'ui-polish: touch targets')
    const systemReduced = view.matchMedia('(prefers-reduced-motion: reduce)')
    ctx.effect(() => pressFeedback(view, () => store.getSnapshot().reduceMotion || systemReduced.matches), 'ui-polish: press feedback')
    ctx.effect(() => vibrateOnTap(view, () => store.getSnapshot().haptics), 'ui-polish: haptics')
    ctx.effect(() => {
      const root = document.documentElement
      const sync = (): void => {
        if (store.getSnapshot().reduceMotion) root.dataset.dshMotion = 'reduced'
        else delete root.dataset.dshMotion
      }
      sync()
      const off = store.subscribe(sync)
      return () => {
        off()
        delete root.dataset.dshMotion
      }
    }, 'ui-polish: motion preference')
  }
  const vibrates = view !== null && canVibrate(view)
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'motion-and-touch', order: 12, locale: NS,
    store: { ...handle, create: () => store },
    inject: (): PolishRowInjected => ({ canVibrate: vibrates }),
  }, PolishRow))
}
