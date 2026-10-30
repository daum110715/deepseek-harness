import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { IconCloseOutlineRegular } from './icons/index.tsx'
import { glideShared, morphShared } from './motion.ts'
import css from './ImageLightbox.module.css'

/** Lightbox strings the owner resolves from its own locale namespace. */
export interface ImageLightboxLabels {
  /** Accessible name of the preview dialog. */
  dialog: string
  /** Accessible label of the close control. */
  close: string
}

/**
 * Document-level original-image preview opened by clicking a thumbnail.
 * When another image with the same address has a box, the preview grows from it
 * and a shell glides back on close. A missing image or reduced motion stays put.
 * Closes on Escape, backdrop press, or the close control, and restores focus
 * to the opener on unmount. Rendered through a body portal: an opener inside
 * a transformed or filtered ancestor would otherwise trap the fixed backdrop
 * in that ancestor's box instead of covering the viewport.
 *
 * @param props.src - the original image URL.
 * @param props.alt - the image's alt text.
 * @param props.labels - dialog and close-control strings.
 * @param props.onClose - dismiss callback owned by the opener.
 * @returns the modal preview dialog.
 */
export function ImageLightbox({ src, alt, labels, onClose }: {
  src: string
  alt: string
  labels: ImageLightboxLabels
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const dismiss = useCallback(() => {
    const image = imageRef.current
    /* v8 ignore next -- the preview image is mounted with the close control */
    if (image === null) { onClose(); return }
    const thumb = otherImage(image)
    if (thumb !== null) glideShared(image, thumb)
    onClose()
  }, [onClose])

  useLayoutEffect(() => {
    const image = imageRef.current
    /* v8 ignore next -- the preview image is committed before this effect */
    if (image === null) return
    const thumb = otherImage(image)
    if (thumb === null) return
    const play = (): void => { morphShared(thumb, image) }
    const rect = image.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) {
      image.addEventListener('load', play, { once: true })
      return () => { image.removeEventListener('load', play) }
    }
    play()
  }, [src])

  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') { event.stopPropagation(); dismiss() }
      if (event.key === 'Tab') { event.preventDefault(); closeRef.current?.focus() }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      restoreRef.current?.focus()
    }
  }, [dismiss])

  return createPortal(
    <div
      className={css.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={labels.dialog}
    >
      <div className={css.stage}>
        <div className={css.mask} aria-hidden="true" onMouseDown={dismiss} />
        <img ref={imageRef} className={css.image} src={src} alt={alt} />
        <button ref={closeRef} type="button" className={css.close} aria-label={labels.close} onClick={dismiss}>
          <IconCloseOutlineRegular size={16} />
        </button>
      </div>
    </div>,
    document.body,
  )
}

/** Another on-screen image with the same address and a measurable box. */
function otherImage(image: HTMLImageElement): HTMLImageElement | null {
  for (const candidate of image.ownerDocument.images) {
    if (candidate === image || candidate.src !== image.src) continue
    const rect = candidate.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) continue
    return candidate
  }
  return null
}
