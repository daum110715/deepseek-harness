/** Sidebar settings and contact actions for deployments using API keys only. */
import { useRef, useState } from 'react'
import { Menu, IconEllipsisOutlineMedium, IconPaperPlaneOutlineMedium, IconSettingsOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ContactConfig, CONTACT_CONFIG_GLOBAL } from '../contact-config.ts'
import { contactUrl } from './contact-url.ts'
import css from './AccountMenu.module.css'

/** @param props - sidebar geometry, settings navigation and localized labels. @returns settings menu without account actions. */
export function SettingsMenu({ wide, settingsShortcut, openSettings, t }:
  PropsRuntime<'settings.launcher'> & PropsLocale<'settings.account'>) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return <div className={css.root}>
    <Menu open={open} side="top" portal autoFocus className={css.anchor} listClassName={css.signedOutMenu}
      anchor={<button ref={trigger} type="button" className={css.trigger} data-collapsed={!wide} data-signed-out="true"
        aria-label={t('more')} aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
        <IconEllipsisOutlineMedium size={14} />
        {wide && <span className={css.label}>{t('more')}</span>}
      </button>}
      items={[
        { id: 'settings', label: t('settings'), icon: <IconSettingsOutlineMedium size={16} />,
          ...(settingsShortcut === undefined ? {} : { shortcut: settingsShortcut }) },
        { id: 'contact', label: t('contactUs'), icon: <IconPaperPlaneOutlineMedium size={16} /> },
      ]}
      onClose={() => { setOpen(false) }}
      onSelect={id => {
        setOpen(false)
        trigger.current?.focus()
        if (id === 'settings') openSettings()
        else {
          const page = globalThis as Partial<Record<typeof CONTACT_CONFIG_GLOBAL, unknown>>
          window.open(contactUrl(ContactConfig(page[CONTACT_CONFIG_GLOBAL] ?? {}), {
            uid: null, version: process.env.DSH_CLIENT_VERSION, deviceInfo: navigator.userAgent,
            width: window.screen.width, height: window.screen.height, pixelRatio: window.devicePixelRatio,
          }), '_blank', 'noopener,noreferrer')
        }
      }} />
  </div>
}
