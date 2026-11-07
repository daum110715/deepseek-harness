/**
 * Per-device motion and touch preferences. They live in this browser, not in the
 * shared settings document, because one person wants haptics on the phone and
 * not on the tablet.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** Stored preferences. */
export interface PolishState {
  /** Turn animations off in DSH Web whatever the system setting says. */
  reduceMotion: boolean
  /** Vibrate lightly when a finger taps a control, where the device can. */
  haptics: boolean
}

type PolishActions = {
  setReduceMotion: (draft: PolishState, value: boolean) => void
  setHaptics: (draft: PolishState, value: boolean) => void
}

/**
 * Declare the preference store.
 * @returns the store handle.
 */
export function createPolishStore(): EngineStoreHandle<PolishState, PolishActions> {
  return defineStore({
    init: (): PolishState => ({ reduceMotion: false, haptics: true }),
    persist: 'dsh.ui-polish.preferences.v1',
    actions: {
      setReduceMotion: (d, value: boolean) => { d.reduceMotion = value },
      setHaptics: (d, value: boolean) => { d.haptics = value },
    },
  })
}
