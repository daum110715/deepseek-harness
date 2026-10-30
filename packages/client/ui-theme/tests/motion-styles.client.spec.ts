/** Shared motion tokens stay on the documented scale and collapse under reduced motion. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const motion = readFileSync(fileURLToPath(new URL('../src/styles/motion.css', import.meta.url)), 'utf8')
const base = readFileSync(fileURLToPath(new URL('../src/styles/base.css', import.meta.url)), 'utf8')

describe('motion.css', () => {
  it('publishes the enter scale, the shorter exits, and the shared cap', () => {
    expect(motion).toContain('--dsw-motion-duration-fast: 160ms')
    expect(motion).toContain('--dsw-motion-duration: 240ms')
    expect(motion).toContain('--dsw-motion-duration-slow: 340ms')
    expect(motion).toContain('--dsw-motion-duration-shared: 480ms')
    expect(motion).toContain('--dsw-motion-duration-exit-fast: 112ms')
    expect(motion).toContain('--dsw-motion-duration-exit: 168ms')
    expect(motion).toContain('--dsw-motion-duration-exit-slow: 238ms')
    expect(motion).toContain('--dsw-motion-ease-enter: cubic-bezier(0.05, 0.7, 0.1, 1)')
    expect(motion).toContain('--dsw-motion-ease-exit: cubic-bezier(0.3, 0, 0.8, 0.15)')
    expect(motion).toContain('--dsw-motion-ease-move: cubic-bezier(0.2, 0, 0, 1)')
  })

  it('zeros durations and attribute motion when the user prefers reduced motion', () => {
    const reduced = motion.slice(motion.indexOf('@media (prefers-reduced-motion: reduce)'))
    for (const name of ['fast', '', 'slow', 'shared', 'exit-fast', 'exit', 'exit-slow']) {
      const token = name === '' ? '--dsw-motion-duration: 0ms' : `--dsw-motion-duration-${name}: 0ms`
      expect(reduced).toContain(token)
    }
    expect(reduced).toContain('[data-dsh-motion-enter]')
    expect(reduced).toContain('animation: none')
  })

  it('keeps legacy duration names on the same scale', () => {
    expect(base).toContain('--ds-transition-duration: var(--dsw-motion-duration, 240ms)')
    expect(base).toContain('--ds-ease-in-out: var(--dsw-motion-ease-move, cubic-bezier(0.2, 0, 0, 1))')
  })
})
