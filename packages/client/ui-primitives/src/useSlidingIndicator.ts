/** Geometry tracker for a shared sliding active indicator inside a positioned container. */
import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'

/** Measurement options for {@link useSlidingIndicator}. */
export interface SlidingIndicatorOptions {
  /** Match `border` (full box) or `padding` (`background-clip: padding-box` rows). */
  readonly box?: 'border' | 'padding' | undefined
  /** Optional structural fingerprint that triggers re-measurement without snapping. */
  readonly layoutKey?: string | number | undefined
}

/** Positioned indicator state returned by {@link useSlidingIndicator}. */
export interface SlidingIndicatorState {
  /** Whether a measured active target currently exists inside the container. */
  readonly active: boolean
  /** Whether the indicator should animate to its latest geometry rather than snap. */
  readonly animated: boolean
  /** Transform and dimension style for the indicator element, or undefined while hidden. */
  readonly style: CSSProperties | undefined
}

interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

function measureTarget(container: HTMLElement, target: HTMLElement, box: 'border' | 'padding'): Rect | null {
  const containerRect = container.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  if (targetRect.width <= 0 || targetRect.height <= 0) return null

  let insetLeft = 0
  let insetRight = 0
  let insetTop = 0
  let insetBottom = 0
  if (box === 'padding') {
    const style = getComputedStyle(target)
    insetLeft = parseFloat(style.borderLeftWidth) || 0
    insetRight = parseFloat(style.borderRightWidth) || 0
    insetTop = parseFloat(style.borderTopWidth) || 0
    insetBottom = parseFloat(style.borderBottomWidth) || 0
  }

  return {
    x: targetRect.left - containerRect.left - container.clientLeft + container.scrollLeft + insetLeft,
    y: targetRect.top - containerRect.top - container.clientTop + container.scrollTop + insetTop,
    width: Math.max(0, targetRect.width - insetLeft - insetRight),
    height: Math.max(0, targetRect.height - insetTop - insetBottom),
  }
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  return Math.abs(a.x - b.x) < 0.5
    && Math.abs(a.y - b.y) < 0.5
    && Math.abs(a.width - b.width) < 0.5
    && Math.abs(a.height - b.height) < 0.5
}

/**
 * Measure the active descendant matching `selector` inside `containerRef` so a single shared
 * indicator element can glide smoothly between selections without an initial fly-in.
 * @param containerRef - positioned ancestor shared by the indicator and selectable items.
 * @param selector - CSS selector resolving the active item within the container.
 * @param activeKey - identity of the active item; undefined hides the indicator.
 * @param options - optional box-model matching and layout invalidation key.
 * @returns visibility, animation readiness, and positioning style for the indicator element.
 */
export function useSlidingIndicator(
  containerRef: RefObject<HTMLElement | null>,
  selector: string,
  activeKey: string | undefined,
  options?: SlidingIndicatorOptions,
): SlidingIndicatorState {
  const box = options?.box ?? 'border'
  const layoutKey = options?.layoutKey
  const [rect, setRect] = useState<Rect | null>(null)
  const [animated, setAnimated] = useState(false)
  const hadActive = useRef(false)
  const lastRect = useRef<Rect | null>(null)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (container === null || activeKey === undefined) {
      hadActive.current = false
      lastRect.current = null
      setRect(null)
      setAnimated(false)
      return
    }

    const update = (allowAnimate: boolean): HTMLElement | null => {
      const target = container.querySelector<HTMLElement>(selector)
      const next = target === null ? null : measureTarget(container, target, box)
      if (next === null) {
        hadActive.current = false
        lastRect.current = null
        setRect(null)
        setAnimated(false)
        return null
      }
      const shouldAnimate = allowAnimate && hadActive.current
      hadActive.current = true
      if (!sameRect(lastRect.current, next)) {
        lastRect.current = next
        setAnimated(shouldAnimate)
        setRect(next)
      }
      return target
    }

    const target = update(true)
    if (typeof ResizeObserver !== 'function') return

    const observer = new ResizeObserver(() => {
      update(false)
    })
    observer.observe(container)
    if (target !== null) observer.observe(target)
    return () => {
      observer.disconnect()
    }
  }, [containerRef, selector, activeKey, box, layoutKey])

  if (rect === null) {
    return { active: false, animated: false, style: undefined }
  }

  return {
    active: true,
    animated,
    style: {
      transform: `translate3d(${String(rect.x)}px, ${String(rect.y)}px, 0)`,
      width: `${String(rect.width)}px`,
      height: `${String(rect.height)}px`,
      transition: animated ? undefined : 'none',
    },
  }
}
