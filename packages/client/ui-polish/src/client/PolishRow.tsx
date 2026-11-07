/** Motion and touch preferences in General settings. */
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createPolishStore } from './store.ts'
import css from './PolishRow.module.css'

/** Injected device fact: haptics only appear where they can work. */
export interface PolishRowInjected {
  readonly canVibrate: boolean
}

/** Full component props. */
export type PolishRowProps = PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createPolishStore>>
  & PropsLocale<'ui-polish'> & PolishRowInjected

/**
 * Render the preferences.
 * @param props - composed slot props.
 * @returns the row.
 */
export function PolishRow({ t, useStore, actions, canVibrate }: PolishRowProps) {
  const reduceMotion = useStore(state => state.reduceMotion)
  const haptics = useStore(state => state.haptics)
  return (
    <div className={css.group}>
      <div className={css.title}>{t('title')}</div>
      <div className={css.row}>
        <div>
          <div className={css.label}>{t('reduceMotion')}</div>
          <div className={css.description}>{t('reduceMotion.description')}</div>
        </div>
        <Switch checked={reduceMotion} onChange={actions.setReduceMotion} label={t('reduceMotion')} />
      </div>
      {canVibrate && <div className={css.row}>
        <div>
          <div className={css.label}>{t('haptics')}</div>
          <div className={css.description}>{t('haptics.description')}</div>
        </div>
        <Switch checked={haptics} onChange={actions.setHaptics} label={t('haptics')} />
      </div>}
    </div>
  )
}
