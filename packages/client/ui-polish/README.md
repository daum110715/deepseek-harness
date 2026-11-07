# @deepseek-ai/dsh-client-ui-polish

English | [中文](README.zh.md)

Device adaptation, motion, and touch feel for the Web client. It is a built-in plugin of the web bundle; remove its `ui-polish` row from `packages/bundle/web-app/cordis.patch.yml` to go without it.

## What it does

- **Device facts on `<html>`**: `data-dsh-form-factor` (`phone`, `tablet`, `desktop`), `data-dsh-pointer` (`coarse`, `fine`), `data-dsh-input` (the pointer last used, for hybrid devices), and `data-dsh-standalone`. Stylesheets key on these instead of guessing from width alone.
- **Touch ergonomics** on coarse pointers: no tap flash, no double-tap zoom on controls (pinch zoom stays), and a long press does not select a control's label. Controls smaller than 44 px get an invisible hit area of up to 8 px on each side, drawn through `::after`; a control whose `::after` already shows something is left alone.
- **Keyboard-aware viewport**: Chromium resizes the layout for an on-screen keyboard through `interactive-widget=resizes-content`; in Safari the app is sized to the visible part of the screen while the keyboard is up.
- **No pull-to-refresh**: the document does not overscroll, so pulling down at the top cannot reload the app and stop a running agent.
- **Press feedback**: a control gives way under a press and settles back with a slight overshoot. It animates the independent `scale` property through the Web Animations API, so components keep their own transitions, and a large row moves as few pixels as a small icon. It respects `prefers-reduced-motion`.
- **Haptics**: a light vibration when a finger taps a control, slightly longer for a control that changes state, on devices with the Vibration API (Android browsers; Safari has none).
- **Settings → General → Motion and touch**: Reduce motion turns animations off in DSH Web whatever the system setting is; Haptic feedback appears only where vibration works. Both are kept per device in `localStorage`.

## Opting out

Put `data-dsh-no-press` on an element to keep press feedback off it and everything inside.
