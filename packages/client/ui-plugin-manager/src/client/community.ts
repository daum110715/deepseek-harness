/** Preinstalled plugin community using browser-local storage and sandboxed third-party pages. */
import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { CordisCommunityPage } from './CordisCommunityPage.tsx'
import { cordisZh, cordisEn } from './cordis-community-locales.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { CommunityPage } from './CommunityPage.tsx'
import { CommunityController } from './community-store.ts'
import { communityEn, communityZh } from './community-locales.ts'
import { PluginsPanelIcon } from './PluginsPanelIcon.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'plugins.community.cordis': { kind: 'single'; scope: 'root'; owner: Record<never, never> }
  }
  interface LocaleNamespaceMap {
    /** Browser plugin community labels and installation refusals. */
    pluginCommunity: keyof typeof communityZh | keyof typeof cordisZh
  }
}

/** Built-in plugin identity visible in the client plugin tree. */
export const name = 'plugin-community'
/** Services needed independently of native profile installation access. */
export const inject = ['slots', 'locale', 'layout', 'remote', 'remote.pluginManager']

/**
 * Register the community as a separate main panel and sidebar entry.
 * @param ctx Owning browser plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('pluginCommunity', { en: { ...communityEn, ...cordisEn }, zh: { ...communityZh, ...cordisZh } }), 'plugin-community: dictionaries')
  // Access can be denied by browser policy even before the first storage read.
  const storage = {
    getItem: (key: string): string | null => localStorage.getItem(key),
    setItem: (key: string, value: string): void => { localStorage.setItem(key, value) },
  }
  const controller = new CommunityController(storage)
  ctx.effect(() => () => { controller.dispose() }, 'plugin-community: controller')
  const panel = 'plugin-community' as MainPanelId
  const t = ctx.locale.bind('pluginCommunity')
  const face = controller.face()
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: panel, locale: 'pluginCommunity', inject: () => face, children: { 'plugins.community.cordis': { kind: 'single', scope: 'root' } } }, CommunityPage))
  const manager = ctx.remote.pluginManager
  const unwrap = <T>(result: RemoteResult<T>): T => { if (!result.ok) throw result.error; return result.value }
  ctx.slots.inject('plugins.community.cordis', () => ctx.slots.register({
    name: 'plugins.community.cordis', locale: 'pluginCommunity', inject: () => ({
      policy: async () => unwrap(await manager.webBundlePolicy()),
      list: async () => unwrap(await manager.listBundles()),
      inspect: async (encoded: string) => unwrap(await manager.inspectWebBundle(encoded)),
      install: async (encoded: string, trusted: boolean) => unwrap(await manager.importWebBundle(encoded, trusted)),
      enable: async (name: string, enabled: boolean) => unwrap(await manager.setBundleEnabled(name, enabled)),
      remove: async (name: string) => unwrap(await manager.removeBundle(name)),
    }),
  }, CordisCommunityPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: panel, order: 1, label: () => t('title'), locale: 'pluginCommunity' }, PluginsPanelIcon))
}
