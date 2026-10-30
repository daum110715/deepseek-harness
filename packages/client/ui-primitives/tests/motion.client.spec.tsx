// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { useRef, type JSX } from 'react'
import { PresenceExit, PresenceExitParent } from '../src/PresenceExit.tsx'
import {
  MOTION_EASE, MOTION_MS, canAnimate, capturePresence, morphShared, playPresenceExit, playVerticalSwap,
  prefersReducedMotion, releasePresence,
} from '../src/motion.ts'

interface Recorded {
  element: HTMLElement
  keyframes: Keyframe[]
  options: KeyframeAnimationOptions
  animation: Animation
  cancel: ReturnType<typeof vi.fn>
}

const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
let animations: Recorded[]
let reduced = false

function installAnimate(): void {
  animations = []
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value(this: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation {
      const cancel = vi.fn<() => void>()
      const methods: Pick<Animation, 'onfinish' | 'oncancel' | 'cancel'> = { onfinish: null, oncancel: null, cancel }
      const animation = methods as Animation
      cancel.mockImplementation(() => { animation.oncancel?.call(animation, new Event('cancel') as AnimationPlaybackEvent) })
      animations.push({ element: this, keyframes, options, animation, cancel })
      return animation
    },
  })
}

function restoreAnimate(): void {
  if (originalAnimate === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'animate')
  else Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate)
}

function box(element: HTMLElement, rect: DOMRect): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect)
}

function finish(animation: Animation): void {
  animation.onfinish?.call(animation, new Event('finish') as AnimationPlaybackEvent)
}

afterEach(() => {
  cleanup()
  reduced = false
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  restoreAnimate()
  document.body.replaceChildren()
})

describe('motion queries', () => {
  it('reads the page window and treats a missing matcher as motion allowed', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') && reduced, media: query }))
    expect(prefersReducedMotion()).toBe(false)
    reduced = true
    expect(prefersReducedMotion()).toBe(true)
    expect(prefersReducedMotion(null)).toBe(false)
    vi.stubGlobal('matchMedia', undefined)
    expect(prefersReducedMotion()).toBe(false)
  })

  it('refuses animation without a window, without animate, or under reduced motion', () => {
    installAnimate()
    vi.stubGlobal('matchMedia', () => ({ matches: reduced }))
    const live = document.createElement('div')
    expect(canAnimate(live)).toBe(true)
    reduced = true
    expect(canAnimate(live)).toBe(false)
    reduced = false
    Reflect.deleteProperty(HTMLElement.prototype, 'animate')
    expect(canAnimate(live)).toBe(false)
    const detached = document.implementation.createHTMLDocument('').createElement('div')
    expect(canAnimate(detached)).toBe(false)
  })
})

describe('playPresenceExit', () => {
  it('skips a zero box, a missing window, and reduced motion', () => {
    installAnimate()
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const node = document.createElement('button')
    node.setAttribute('role', 'menu')
    expect(playPresenceExit(node, { rect: new DOMRect(0, 0, 0, 10), transformOrigin: '0 0' })).toBeNull()
    expect(playPresenceExit(node, { rect: new DOMRect(0, 0, 10, 0), transformOrigin: '0 0' })).toBeNull()
    const foreign = document.implementation.createHTMLDocument('').createElement('button')
    expect(playPresenceExit(foreign, { rect: new DOMRect(1, 2, 10, 10), transformOrigin: '50% 50%' })).toBeNull()
    reduced = true
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    expect(playPresenceExit(node, { rect: new DOMRect(1, 2, 10, 10), transformOrigin: 'top' })).toBeNull()
    expect(document.querySelector('[data-dsh-motion-ghost]')).toBeNull()
  })

  it('clones a concealed exit and removes it when the animation ends or is cancelled', () => {
    installAnimate()
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const node = document.createElement('div')
    node.id = 'live'
    node.setAttribute('role', 'menu')
    const item = document.createElement('button')
    item.id = 'row'
    item.setAttribute('role', 'menuitem')
    item.setAttribute('aria-modal', 'true')
    node.append(item)
    const animation = playPresenceExit(node, { rect: new DOMRect(4, 6, 40, 20), transformOrigin: '12px 8px' })
    const ghost = document.querySelector<HTMLElement>('[data-dsh-motion-ghost]')
    expect(animation).not.toBeNull()
    expect(ghost?.getAttribute('role')).toBeNull()
    expect(ghost?.id).toBe('')
    expect(ghost?.getAttribute('aria-hidden')).toBe('true')
    expect(ghost?.style.pointerEvents).toBe('none')
    expect(ghost?.style.left).toBe('4px')
    expect(ghost?.style.transformOrigin).toBe('12px 8px')
    expect(ghost?.querySelector('[role]')).toBeNull()
    expect(ghost?.querySelector('#row')).toBeNull()
    expect(animations[0]?.options).toMatchObject({ duration: MOTION_MS.exit, easing: MOTION_EASE.exit })
    finish(animation as Animation)
    expect(ghost?.isConnected).toBe(false)
    const second = playPresenceExit(node, { rect: new DOMRect(0, 0, 8, 8), transformOrigin: 'center' })
    second?.oncancel?.call(second, new Event('cancel') as AnimationPlaybackEvent)
    expect(document.querySelector('[data-dsh-motion-ghost]')).toBeNull()
  })
})

describe('morphShared', () => {
  it('leaves the end state when either side cannot move', () => {
    installAnimate()
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const from = document.createElement('div')
    const to = document.createElement('div')
    document.body.append(from, to)
    expect(morphShared(null, to)).toBe(false)
    expect(morphShared(from, null)).toBe(false)
    to.remove()
    expect(morphShared(from, to)).toBe(false)
    document.body.append(to)
    box(from, new DOMRect(0, 0, 0, 10))
    box(to, new DOMRect(0, 0, 20, 20))
    expect(morphShared(from, to)).toBe(false)
    box(from, new DOMRect(0, 0, 10, 0))
    expect(morphShared(from, to)).toBe(false)
    box(from, new DOMRect(0, 0, 10, 10))
    box(to, new DOMRect(0, 0, 0, 10))
    expect(morphShared(from, to)).toBe(false)
    box(to, new DOMRect(0, 0, 10, 0))
    expect(morphShared(from, to)).toBe(false)
    const foreign = document.implementation.createHTMLDocument('')
    const parked = foreign.createElement('div')
    foreign.body.append(parked)
    expect(morphShared(from, parked)).toBe(false)
    reduced = true
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    box(to, new DOMRect(30, 40, 20, 20))
    expect(morphShared(from, to)).toBe(false)
    expect(document.querySelector('[data-dsh-motion-ghost]')).toBeNull()
  })

  it('crossfades text, morphs the shell, and restores the destination', async () => {
    installAnimate()
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    vi.spyOn(window, 'getComputedStyle').mockImplementation((node) => {
      const element = node as HTMLElement
      return {
        borderRadius: element.dataset.radius ?? '',
        transformOrigin: '4px 6px',
        backgroundColor: 'rgb(1, 2, 3)',
      } as CSSStyleDeclaration
    })
    const from = document.createElement('div')
    from.dataset.radius = '8px'
    from.textContent = 'sent'
    from.setAttribute('role', 'group')
    const to = document.createElement('div')
    to.textContent = 'bubble'
    to.style.opacity = '0.4'
    document.body.append(from, to)
    box(from, new DOMRect(10, 20, 40, 20))
    box(to, new DOMRect(80, 90, 80, 40))
    expect(capturePresence(from).transformOrigin).toBe('4px 6px')
    expect(morphShared(from, to)).toBe(true)
    const ghosts = [...document.querySelectorAll<HTMLElement>('[data-dsh-motion-ghost]')]
    expect(ghosts).toHaveLength(2)
    const shell = ghosts.find(node => node.tagName === 'DIV' && node.textContent === '')
    const copy = ghosts.find(node => node.textContent === 'sent')
    expect(shell?.style.width).toBe('80px')
    expect(shell?.style.transformOrigin).toBe('0 0')
    expect(copy?.style.transform).toBe('none')
    expect(copy?.getAttribute('role')).toBeNull()
    const shellFrames = animations.find(call => call.element === shell)?.keyframes
    expect(shellFrames?.[0]).toMatchObject({ borderRadius: '8px', opacity: 1 })
    expect(shellFrames?.[1]).toMatchObject({ borderRadius: '0px' })
    expect(animations.find(call => call.element === copy)?.keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }])
    expect(to.style.opacity).toBe('0')
    document.body.append(document.createElement('span'))
    await Promise.resolve()
    expect(to.style.opacity).toBe('0')
    const shellAnimation = animations.find(call => call.element === shell)?.animation as Animation
    finish(shellAnimation)
    finish(shellAnimation)
    expect(document.querySelector('[data-dsh-motion-ghost]')).toBeNull()
    expect(to.style.opacity).toBe('0.4')
  })

  it('interrupts an active morph and restores the original opacity after the latest animation', () => {
    installAnimate()
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const from = document.createElement('div')
    const to = document.createElement('div')
    to.style.opacity = '0.4'
    document.body.append(from, to)
    box(from, new DOMRect(0, 0, 10, 10))
    box(to, new DOMRect(20, 20, 10, 10))
    expect(morphShared(from, to)).toBe(true)
    const first = animations[0]!
    expect(morphShared(from, to)).toBe(true)
    expect(first.cancel).toHaveBeenCalled()
    expect(document.querySelectorAll('[data-dsh-motion-ghost]')).toHaveLength(2)
    expect(to.style.opacity).toBe('0')
    finish(animations[3]!.animation)
    expect(to.style.opacity).toBe('0.4')
    expect(document.querySelector('[data-dsh-motion-ghost]')).toBeNull()
  })

  it('stops when the destination leaves or the deadline passes', async () => {
    installAnimate()
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const from = document.createElement('div')
    const to = document.createElement('div')
    document.body.append(from, to)
    box(from, new DOMRect(0, 0, 10, 10))
    box(to, new DOMRect(20, 20, 10, 10))
    expect(morphShared(from, to)).toBe(true)
    to.remove()
    await Promise.resolve()
    expect(document.querySelector('[data-dsh-motion-ghost]')).toBeNull()
    document.body.append(from, to)
    expect(morphShared(from, to)).toBe(true)
    const shell = animations.at(-3)?.animation as Animation
    shell.oncancel?.call(shell, new Event('cancel') as AnimationPlaybackEvent)
    expect(to.style.opacity).toBe('')
    document.body.append(from, to)
    expect(morphShared(from, to)).toBe(true)
    vi.advanceTimersByTime(MOTION_MS.shared + 32)
    expect(document.querySelector('[data-dsh-motion-ghost]')).toBeNull()
  })
})

describe('playVerticalSwap', () => {
  it('moves the outgoing copy up and the incoming row in, then clears the incoming fill', () => {
    installAnimate()
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    expect(playVerticalSwap(null, null)).toBe(false)
    const outgoing = document.createElement('div')
    outgoing.textContent = 'old'
    const incoming = document.createElement('div')
    document.body.append(incoming)
    box(outgoing, new DOMRect(0, 0, 0, 10))
    expect(playVerticalSwap(outgoing, null)).toBe(false)
    box(outgoing, new DOMRect(0, 0, 12, 0))
    expect(playVerticalSwap(outgoing, null)).toBe(false)
    const foreign = document.implementation.createHTMLDocument('').createElement('div')
    expect(playVerticalSwap(foreign, null)).toBe(false)
    box(outgoing, new DOMRect(1, 2, 30, 16))
    Reflect.deleteProperty(HTMLElement.prototype, 'animate')
    expect(playVerticalSwap(outgoing, incoming)).toBe(false)
    installAnimate()
    incoming.remove()
    expect(playVerticalSwap(outgoing, incoming)).toBe(true)
    expect(animations).toHaveLength(1)
    const ghost = document.querySelector('[data-dsh-motion-ghost]')
    expect(animations[0]?.keyframes).toEqual([
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: 'translateY(-8px)' },
    ])
    finish(animations[0]!.animation)
    expect(ghost?.isConnected).toBe(false)
    document.body.append(incoming)
    expect(playVerticalSwap(null, incoming)).toBe(true)
    const entered = animations.at(-1) as Recorded
    expect(entered.options.duration).toBe(MOTION_MS.base)
    expect(entered.options.easing).toBe(MOTION_EASE.enter)
    finish(entered.animation)
    expect(entered.cancel).toHaveBeenCalled()
  })
})

describe('releasePresence', () => {
  it('plays a detached host immediately and a connected host only after removal', async () => {
    installAnimate()
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const snapshot = { rect: new DOMRect(1, 2, 10, 10), transformOrigin: 'center' }
    const watch: { current: MutationObserver | null } = { current: null }
    releasePresence(document.createElement('div'), snapshot, watch)
    expect(animations).toHaveLength(1)

    const parent = document.createElement('div')
    const node = document.createElement('div')
    parent.append(node)
    document.body.append(parent)
    animations.length = 0
    releasePresence(node, snapshot, watch)
    const observer = watch.current
    expect(observer).not.toBeNull()
    parent.append(document.createElement('span'))
    await Promise.resolve()
    expect(animations).toEqual([])
    const decoy = new MutationObserver(() => {})
    watch.current = decoy
    node.remove()
    await Promise.resolve()
    expect(watch.current).toBe(decoy)
    expect(animations).toHaveLength(1)

    animations.length = 0
    const again = document.createElement('div')
    parent.append(again)
    releasePresence(again, snapshot, watch)
    releasePresence(again, snapshot, watch)
    again.remove()
    await Promise.resolve()
    expect(watch.current).toBeNull()
    expect(animations).toHaveLength(1)
  })
})

describe('PresenceExit', () => {
  it('does nothing when the host is missing and exits only after the host disconnects', async () => {
    installAnimate()
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 24, 12))
    const missing = render(<PresenceExit target={() => null} />)
    missing.unmount()
    expect(animations).toEqual([])

    function Host({ open }: { open: boolean }): JSX.Element | null {
      const ref = useRef<HTMLDivElement>(null)
      if (!open) return null
      return <div ref={ref}><PresenceExit target={() => ref.current} /></div>
    }
    const view = render(<Host open />)
    view.rerender(<Host open />)
    expect(animations).toEqual([])
    view.rerender(<Host open={false} />)
    await Promise.resolve()
    expect(animations).toHaveLength(1)
    expect(animations[0]?.options.duration).toBe(MOTION_MS.exit)
  })

  it('marks the parent element from a hidden marker', async () => {
    installAnimate()
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(2, 3, 16, 16))
    function Card({ open }: { open: boolean }): JSX.Element | null {
      if (!open) return null
      return <div role="dialog"><PresenceExitParent /><span>body</span></div>
    }
    const view = render(<Card open />)
    expect(view.getByRole('dialog').querySelector('span[hidden]')).not.toBeNull()
    view.rerender(<Card open={false} />)
    await Promise.resolve()
    expect(view.queryByRole('dialog')).toBeNull()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(animations).toHaveLength(1)
  })
})
