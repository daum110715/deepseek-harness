// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { ImageLightbox } from '../src/ImageLightbox.tsx'

afterEach(cleanup)

const labels = { dialog: '原图预览', close: '关闭原图预览' }

describe('ImageLightbox', () => {
  it('focuses its close control, closes by button and Escape, and restores focus', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const onClose = vi.fn()
    const view = render(<ImageLightbox src="blob:original" alt="原图" labels={labels} onClose={onClose} />)
    const close = view.getByRole('button', { name: '关闭原图预览' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(window, { key: 'a' })
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    expect(onClose).not.toHaveBeenCalled()
    const outerKey = vi.fn()
    document.body.addEventListener('keydown', outerKey)
    try {
      fireEvent.keyDown(close, { key: 'Escape' })
      expect(outerKey).not.toHaveBeenCalled()
    } finally { document.body.removeEventListener('keydown', outerKey) }
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledTimes(2)
    view.unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('tolerates a focus owner it cannot restore (no active element at mount)', () => {
    // jsdom always reports body as the fallback active element; stub the
    // element-less state a detached focus can leave.
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => null })
    try {
      const view = render(<ImageLightbox src="blob:original" alt="原图" labels={labels} onClose={vi.fn()} />)
      view.unmount()
    } finally {
      delete (document as { activeElement?: unknown }).activeElement
    }
  })

  it('closes on a mask press but not on a press over the image', () => {
    const onClose = vi.fn()
    const view = render(<ImageLightbox src="blob:original" alt="原图" labels={labels} onClose={onClose} />)
    fireEvent.mouseDown(view.getByRole('img'))
    expect(onClose).not.toHaveBeenCalled()
    const mask = document.querySelector('[aria-hidden="true"]') as HTMLElement
    fireEvent.mouseDown(mask)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('grows from a same-address thumbnail and glides back when that thumbnail has a box', () => {
    const animations: Animation[] = []
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value(this: HTMLElement): Animation {
        const animation = { onfinish: null, oncancel: null, cancel() {} } as Animation
        animations.push(animation)
        return animation
      },
    })
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    let preview = new DOMRect(0, 0, 0, 0)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (!(this instanceof HTMLImageElement)) return new DOMRect(0, 0, 0, 0)
      if (this.dataset.box === 'thumb') return new DOMRect(2, 3, 12, 8)
      if (this.dataset.box === 'flat') return new DOMRect(0, 0, 8, 0)
      if (this.dataset.box === 'empty') return new DOMRect(0, 0, 0, 6)
      if (this.dataset.box === 'other') return new DOMRect(0, 0, 5, 5)
      return preview
    })
    const thumb = document.createElement('img')
    thumb.src = 'blob:original'
    thumb.dataset.box = 'thumb'
    const flat = document.createElement('img')
    flat.src = 'blob:original'
    flat.dataset.box = 'flat'
    const empty = document.createElement('img')
    empty.src = 'blob:original'
    empty.dataset.box = 'empty'
    const other = document.createElement('img')
    other.src = 'blob:other'
    other.dataset.box = 'other'
    document.body.append(flat, empty, other)
    const onClose = vi.fn()
    const scanning = render(<ImageLightbox src="blob:original" alt="原图" labels={labels} onClose={onClose} />)
    expect(animations).toHaveLength(0)
    scanning.unmount()
    document.body.append(thumb)
    const first = render(<ImageLightbox src="blob:original" alt="原图" labels={labels} onClose={onClose} />)
    const image = within(first.getByRole('dialog')).getByRole('img')
    expect(animations).toHaveLength(0)
    preview = new DOMRect(8, 9, 40, 30)
    fireEvent.load(image)
    expect(animations).toHaveLength(3)
    first.unmount()
    animations.length = 0
    preview = new DOMRect(8, 9, 16, 0)
    const second = render(<ImageLightbox src="blob:original" alt="原图" labels={labels} onClose={onClose} />)
    expect(animations).toHaveLength(0)
    preview = new DOMRect(8, 9, 40, 30)
    fireEvent.load(within(second.getByRole('dialog')).getByRole('img'))
    expect(animations).toHaveLength(3)
    second.unmount()
    animations.length = 0
    preview = new DOMRect(8, 9, 40, 30)
    const third = render(<ImageLightbox src="blob:original" alt="原图" labels={labels} onClose={onClose} />)
    expect(animations).toHaveLength(3)
    fireEvent.click(third.getByRole('button', { name: '关闭原图预览' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(animations.length).toBeGreaterThan(3)
    third.unmount()
    for (const node of [thumb, flat, empty, other]) node.remove()
  })
})
