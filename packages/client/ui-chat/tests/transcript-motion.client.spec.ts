// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installTranscriptMotion } from '../src/client/chat/transcript-motion.ts'

interface Recorded {
  element: HTMLElement
  keyframes: Keyframe[]
  animation: Animation
}

let animations: Recorded[]
let box = new DOMRect(8, 12, 40, 24)
let reduced = false
let stop = (): void => {}

function installAnimate(): void {
  animations = []
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value(this: HTMLElement, keyframes: Keyframe[]): Animation {
      const cancel = vi.fn<() => void>()
      const methods: Pick<Animation, 'onfinish' | 'oncancel' | 'cancel'> = { onfinish: null, oncancel: null, cancel }
      const animation = methods as Animation
      cancel.mockImplementation(() => {
        animation.oncancel?.call(animation, new Event('cancel') as AnimationPlaybackEvent)
      })
      animations.push({ element: this, keyframes, animation })
      return animation
    },
  })
}

function finishAnimations(): void {
  for (const recorded of [...animations]) {
    recorded.animation.onfinish?.call(recorded.animation, new Event('finish') as AnimationPlaybackEvent)
  }
}

function installBox(): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.style.position === 'fixed') {
      return new DOMRect(
        Number.parseFloat(this.style.left) || 0,
        Number.parseFloat(this.style.top) || 0,
        Number.parseFloat(this.style.width) || 0,
        Number.parseFloat(this.style.height) || 0,
      )
    }
    return box
  })
}

function media(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduced && query.includes('reduce'), media: query }))
}

function command(parent: ParentNode): HTMLElement {
  const row = document.createElement('div')
  row.setAttribute('data-chat-flow-kind', 'command')
  parent.append(row)
  return row
}

async function flush(): Promise<void> {
  await Promise.resolve()
}

afterEach(() => {
  stop()
  stop = () => {}
  reduced = false
  box = new DOMRect(8, 12, 40, 24)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('transcript motion', () => {
  it('does nothing without a root or a window', () => {
    installTranscriptMotion(null)()
    const foreign = document.implementation.createHTMLDocument('foreign')
    const dispose = installTranscriptMotion(foreign.body)
    command(foreign.body)
    expect(foreign.body.querySelector('[data-dsh-motion-enter]')).toBeNull()
    dispose()
  })

  it('enters one command appended after settled rows and ignores history, prepending, and text', async () => {
    installAnimate()
    installBox()
    media()
    const root = document.createElement('div')
    document.body.append(root)
    const older = document.createElement('div')
    older.setAttribute('data-chat-flow-kind', 'user')
    root.append(older)
    stop = installTranscriptMotion(root)
    const wrapped = document.createElement('div')
    const inside = document.createElement('div')
    inside.setAttribute('data-chat-flow-kind', 'command')
    wrapped.append(inside)
    const status = document.createElement('div')
    status.setAttribute('data-chat-running', '')
    root.append(status)
    root.insertBefore(document.createTextNode(' '), status)
    root.insertBefore(wrapped, status)
    await flush()
    expect(inside.getAttribute('data-dsh-motion-enter')).toBe('command')
    const prepended = document.createElement('div')
    prepended.setAttribute('data-chat-flow-kind', 'command')
    root.insertBefore(prepended, older)
    const first = command(root)
    const second = command(root)
    await flush()
    expect(prepended.hasAttribute('data-dsh-motion-enter')).toBe(false)
    expect(first.hasAttribute('data-dsh-motion-enter')).toBe(false)
    expect(second.hasAttribute('data-dsh-motion-enter')).toBe(false)
    const empty = document.createElement('div')
    root.append(empty)
    await flush()
    const lonely = command(empty)
    await flush()
    expect(lonely.hasAttribute('data-dsh-motion-enter')).toBe(false)
    const batch = document.createElement('div')
    const batchUser = document.createElement('div')
    batchUser.setAttribute('data-chat-flow-kind', 'user')
    const batchCommand = document.createElement('div')
    batchCommand.setAttribute('data-chat-flow-kind', 'command')
    batch.append(batchUser, batchCommand)
    root.append(batch)
    await flush()
    expect(batchCommand.hasAttribute('data-dsh-motion-enter')).toBe(false)
    stop()
    const after = command(root)
    await flush()
    expect(after.hasAttribute('data-dsh-motion-enter')).toBe(false)
  })

  it('skips command entrance when motion is reduced', async () => {
    installAnimate()
    installBox()
    reduced = true
    media()
    const root = document.createElement('div')
    document.body.append(root)
    stop = installTranscriptMotion(document)
    command(root)
    await flush()
    expect(root.querySelector('[data-dsh-motion-enter]')).toBeNull()
  })

  it('morphs a cleared composer into one new echo and ignores a queued row', async () => {
    installAnimate()
    installBox()
    media()
    const root = document.createElement('div')
    document.body.append(root)
    const composer = document.createElement('div')
    composer.setAttribute('data-composer-input', '')
    stop = installTranscriptMotion(root)
    document.dispatchEvent(new Event('input', { bubbles: true }))
    root.append(composer)
    document.dispatchEvent(new Event('input', { bubbles: true }))
    composer.textContent = '   '
    composer.dispatchEvent(new Event('input', { bubbles: true }))
    composer.textContent = 'hello'
    box = new DOMRect(0, 0, 0, 0)
    composer.dispatchEvent(new Event('input', { bubbles: true }))
    box = new DOMRect(8, 12, 40, 24)
    composer.dispatchEvent(new Event('input', { bubbles: true }))
    const kept = document.createElement('div')
    kept.setAttribute('data-submission-echo', '')
    root.append(kept)
    await flush()
    expect(animations).toHaveLength(0)
    composer.textContent = ''
    const other = document.createElement('div')
    other.setAttribute('data-submission-echo', '')
    other.textContent = 'other'
    root.append(other)
    await flush()
    expect(animations).toHaveLength(0)
    const queued = document.createElement('li')
    queued.setAttribute('data-submission-echo', '')
    root.append(queued)
    await flush()
    expect(animations).toHaveLength(0)
    const echo = document.createElement('div')
    echo.setAttribute('data-submission-echo', '')
    echo.textContent = 'hello'
    root.append(echo)
    await flush()
    expect(animations.some(recorded => String(recorded.keyframes[0]?.transform).includes('scale'))).toBe(true)
    finishAnimations()
    composer.remove()
    composer.textContent = 'again'
    document.body.append(composer)
    composer.dispatchEvent(new Event('input', { bubbles: true }))
    composer.remove()
    const next = document.createElement('div')
    next.setAttribute('data-submission-echo', '')
    next.textContent = 'again'
    root.append(next)
    await flush()
    expect(animations.some(recorded => recorded.element === next)).toBe(true)
    finishAnimations()
  })

  it('swaps one replaced echo vertically and keeps a missing box or a burst still', async () => {
    installAnimate()
    installBox()
    media()
    const root = document.createElement('div')
    document.body.append(root)
    stop = installTranscriptMotion(root)
    const echo = document.createElement('div')
    echo.setAttribute('data-submission-echo', '')
    echo.textContent = 'sent'
    root.append(echo)
    await flush()
    echo.remove()
    document.dispatchEvent(new Event('scroll'))
    const bubble = document.createElement('div')
    bubble.setAttribute('data-chat-flow-kind', 'user')
    root.append(bubble)
    await flush()
    const swapped = animations.find(recorded => String(recorded.keyframes[1]?.transform).includes('translateY'))
    expect(swapped?.element.style.left).toBe('8px')
    finishAnimations()
    box = new DOMRect(30, 4, 48, 20)
    const moving = document.createElement('div')
    moving.setAttribute('data-submission-echo', '')
    root.append(moving)
    await flush()
    moving.remove()
    document.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('resize'))
    const steering = document.createElement('div')
    steering.setAttribute('data-chat-flow-kind', 'steering')
    root.append(steering)
    await flush()
    expect(animations.some(recorded => recorded.element.style.left === '30px')).toBe(true)
    finishAnimations()
    animations = []
    box = new DOMRect(0, 0, 0, 0)
    const unseen = document.createElement('div')
    unseen.setAttribute('data-submission-echo', '')
    root.append(unseen)
    await flush()
    unseen.remove()
    const quiet = document.createElement('div')
    quiet.setAttribute('data-chat-flow-kind', 'user')
    root.append(quiet)
    await flush()
    expect(animations.some(recorded => String(recorded.keyframes[1]?.transform).includes('translateY'))).toBe(false)
    animations = []
    const group = document.createElement('div')
    const one = document.createElement('div')
    const two = document.createElement('div')
    one.setAttribute('data-submission-echo', '')
    two.setAttribute('data-submission-echo', '')
    group.append(one, two)
    root.append(group)
    await flush()
    box = new DOMRect(8, 12, 40, 24)
    group.remove()
    const burstUser = document.createElement('div')
    burstUser.setAttribute('data-chat-flow-kind', 'user')
    const burstSteering = document.createElement('div')
    burstSteering.setAttribute('data-chat-flow-kind', 'steering')
    root.append(burstUser, burstSteering)
    await flush()
    expect(animations).toHaveLength(0)
  })
})
