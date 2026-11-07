/** General Settings controls for data the browser-hosted harness keeps in this browser. */
import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './BrowserDataRow.module.css'
import type { WebAppBridge } from './web-app.ts'

/** Storage facts the platform layer reports. */
interface BrowserDataStatus {
  readonly durable: boolean
}

/** The page's platform layer, present only when the harness runs inside this browser. */
export interface BrowserDataBridge {
  status(): Promise<BrowserDataStatus>
  exportData(): Promise<Uint8Array>
  importData(archive: Uint8Array): Promise<void>
  resetData(): Promise<void>
  readonly app: WebAppBridge
}

/**
 * Read the page's platform layer.
 * @returns The bridge, or undefined on a Node-hosted page.
 */
export function browserDataBridge(): BrowserDataBridge | undefined {
  return (globalThis as { __DSH_WEB_PLATFORM__?: BrowserDataBridge }).__DSH_WEB_PLATFORM__
}

function download(archive: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([archive as Uint8Array<ArrayBuffer>], { type: 'application/x-tar' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `dsh-backup-${new Date().toISOString().slice(0, 10)}.tar`
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Render browser storage state and data actions.
 * @param props - localized copy.
 * @returns The rows, or nothing on a Node-hosted page.
 */
export function BrowserDataRow({ t }: PropsRuntime<'settings.general.item'> & PropsLocale<'settings'>) {
  const bridge = browserDataBridge()
  const [status, setStatus] = useState<BrowserDataStatus>()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void bridge?.status().then(setStatus, () => { setFailed(true) })
  }, [bridge])

  if (bridge === undefined) return null
  const run = (action: () => Promise<void>): void => {
    setFailed(false)
    setBusy(true)
    void action().catch(() => { setFailed(true) }).finally(() => { setBusy(false) })
  }
  return <div className={css.section}>
    <div className={css.row}>
      <div>
        <div className={css.title}>{t('browserData.title')}</div>
        <div className={css.description}>{t(status?.durable === false ? 'browserData.ephemeral' : 'browserData.description')}</div>
        {failed && <div role="alert" className={css.description}>{t('browserData.error')}</div>}
      </div>
      <div className={css.actions}>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { run(async () => { download(await bridge.exportData()) }) }}>{t('browserData.backup')}</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { input.current?.click() }}>{t('browserData.restore')}</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => {
          if (!confirming) {
            setConfirming(true)
            return
          }
          run(async () => { await bridge.resetData() })
        }} onBlur={() => { setConfirming(false) }}>{t(confirming ? 'browserData.eraseConfirm' : 'browserData.erase')}</Button>
        <input ref={input} type="file" accept=".tar,application/x-tar" hidden aria-label={t('browserData.restore')} onChange={(event) => {
          const file = event.target.files?.[0]
          if (file !== undefined) run(async () => { await bridge.importData(new Uint8Array(await file.arrayBuffer())) })
        }} />
      </div>
    </div>
  </div>
}
