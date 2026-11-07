// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { formFactor } from '../src/client/device.ts'
import { pressScale } from '../src/client/press.ts'
import { hapticFor, hitSlop } from '../src/client/touch.ts'

describe('ui-polish decisions', () => {
  it('classifies by primary pointer and the short side', () => {
    expect(formFactor(375, 667, true)).toBe('phone')
    expect(formFactor(932, 430, true)).toBe('phone')
    expect(formFactor(820, 1180, true)).toBe('tablet')
    expect(formFactor(1180, 820, true)).toBe('tablet')
    expect(formFactor(375, 667, false)).toBe('desktop')
  })

  it('grows small controls toward 44 px, at most 8 px a side', () => {
    expect(hitSlop(28, 28)).toBe(8)
    expect(hitSlop(36, 36)).toBe(4)
    expect(hitSlop(159, 38)).toBe(3)
    expect(hitSlop(44, 44)).toBe(0)
    expect(hitSlop(0, 0)).toBe(0)
  })

  it('moves large rows as few pixels as small icons', () => {
    expect(pressScale(28, 28)).toBeCloseTo(0.96)
    expect(258 * (1 - pressScale(258, 32))).toBeCloseTo(4)
  })

  it('vibrates longer for a control that changes state, and never for a disabled one', () => {
    document.body.innerHTML = '<button id="plain"><span id="inner">x</span></button><div role="switch" id="toggle"></div><button id="off" disabled></button><p id="text"></p>'
    expect(hapticFor(document.getElementById('inner'))).toBe(6)
    expect(hapticFor(document.getElementById('toggle'))).toBe(10)
    expect(hapticFor(document.getElementById('off'))).toBe(0)
    expect(hapticFor(document.getElementById('text'))).toBe(0)
  })
})
