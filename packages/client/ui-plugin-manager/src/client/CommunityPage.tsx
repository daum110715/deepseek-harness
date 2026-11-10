/** Built-in discovery and installation page for isolated third-party browser plugins. */
import { useRef, useState, type ReactNode } from 'react'
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { communityIncompatibility, type CommunityPackage } from './community-package.ts'
import type { CommunityFace } from './community-store.ts'
import css from './CommunityPage.module.css'

/** Page inputs supplied by the slot renderer and community controller. */
export type CommunityPageProps = PropsRuntime<'main'> & PropsLocale<'pluginCommunity'>
  & InjectFace<CommunityFace> & PropsRenderSlots<'plugins.community.cordis'>

/**
 * Render discovery declarations and installed pages without executing package code in the application origin.
 * @param props Locale seat and community actions.
 * @returns The community page including the selected sandboxed plugin, if any.
 */
export function CommunityPage({
  t, useCommunity, discover, installUrl, installFile, remove, exportPackage, renderSlot,
}: CommunityPageProps): ReactNode {
  const state = useCommunity(value => value)
  const [source, setSource] = useState(state.source)
  const [url, setUrl] = useState('')
  const [search, setSearch] = useState('')
  const [opened, setOpened] = useState<CommunityPackage>()
  const fileInput = useRef<HTMLInputElement>(null)
  const matches = (pkg: { name: string; author: string; description: string }): boolean => `${pkg.name} ${pkg.author} ${pkg.description}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  const installed = state.installed.filter(matches)
  const entries = state.entries.filter(matches)
  const active = opened === undefined ? undefined : state.installed.find(pkg => pkg.id === opened.id && pkg.version === opened.version && pkg.html === opened.html)
  return (
    <div className={css.page}>
      <div className={css.content}>
        <header><h1>{t('title')}</h1><p>{t('intro')}</p></header>
        {renderSlot('plugins.community.cordis', {})}
        <details className={css.section}><summary>{t('cordisLegacy')}</summary>
          <p className={css.note}>{t('scope')}</p>
          <section className={css.setup}>
            <form className={css.form} onSubmit={(event) => { event.preventDefault(); void discover(source.trim()) }}>
              <label htmlFor="community-source">{t('source')}</label>
              <div className={css.row}>
                <Input id="community-source" value={source} onChange={(event) => { setSource(event.target.value) }} placeholder={t('sourceHint')} />
                <Button type="submit" variant="outline" disabled={state.busy || source.trim() === ''}>{t('discover')}</Button>
              </div>
            </form>
            <form className={css.form} onSubmit={(event) => { event.preventDefault(); void installUrl(url.trim()) }}>
              <label htmlFor="community-package">{t('packageUrl')}</label>
              <div className={css.row}>
                <Input id="community-package" value={url} onChange={(event) => { setUrl(event.target.value) }} placeholder={t('packageHint')} />
                <Button type="submit" variant="outline" disabled={state.busy || url.trim() === ''}>{t('installUrl')}</Button>
                <Button variant="outline" disabled={state.busy} onClick={() => fileInput.current?.click()}>{t('importFile')}</Button>
                <input ref={fileInput} className={css.file} type="file" accept=".json,application/json" aria-label={t('importFile')}
                  onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file !== undefined) void installFile(file) }} />
              </div>
            </form>
            <p className={css.note}>{t('trust')}</p>
          </section>
          <div className={css.feedback} aria-live="polite">
            {state.busy && <span role="status">{t('loading')}</span>}
            {state.problem !== undefined && <p role="alert">{t(state.problem)}</p>}
          </div>
          <Input type="search" aria-label={t('search')} placeholder={t('searchHint')} value={search} onChange={(event) => { setSearch(event.target.value) }} />
          <section className={css.section}>
            <h2>{t('installed')}</h2>
            {installed.length === 0 && <p className={css.note}>{t(state.installed.length === 0 ? 'noInstalled' : 'noResults')}</p>}
            <div className={css.grid}>{installed.map(pkg => (
              <article key={pkg.id} className={css.card}>
                <div className={css.heading}><h3>{pkg.name}</h3><Tag>{pkg.version}</Tag></div>
                <p>{pkg.description}</p><span className={css.note}>{pkg.author}</span>
                <div className={css.actions}>
                  <Button size="sm" variant="outline" disabled={state.busy} onClick={() => { setOpened(pkg) }}>{t('open')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => { exportPackage(pkg) }}>{t('download')}</Button>
                  <Button size="sm" variant="ghost" disabled={state.busy} onClick={() => { remove(pkg.id) }}>{t('remove')}</Button>
                </div>
              </article>
            ))}</div>
          </section>
          {active !== undefined && (
            <section className={css.section}>
              <div className={css.heading}><h2>{active.name}</h2><Button variant="outline" size="sm" onClick={() => { setOpened(undefined) }}>{t('close')}</Button></div>
              <iframe key={`${active.id}@${active.version}`} title={active.name} className={css.frame} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={active.html} />
            </section>
          )}
          <section className={css.section}>
            <h2>{t('available')}</h2>
            {entries.length === 0 && <p className={css.note}>{t(state.entries.length === 0 ? 'empty' : 'noResults')}</p>}
            <div className={css.grid}>{entries.map((entry, index) => {
              const problem = communityIncompatibility(entry)
              const previous = state.installed.find(pkg => pkg.id === entry.id)
              return (
                <article key={`${entry.id}@${entry.version}:${index}`} className={css.card}>
                  <div className={css.heading}><h3>{entry.name}</h3><Tag>{entry.version}</Tag></div>
                  <p>{entry.description}</p><span className={css.note}>{entry.author}</span>
                  <p className={css.note}>{problem === undefined ? t('compatible') : t(problem)}</p>
                  <Button variant="outline" size="sm" disabled={state.busy || problem !== undefined || previous?.version === entry.version}
                    onClick={() => { void installUrl(entry.url, entry) }}>{t(previous === undefined ? 'install' : previous.version === entry.version ? 'installed' : 'update')}</Button>
                </article>
              )
            })}</div>
          </section>
        </details>
      </div>
    </div>
  )
}
