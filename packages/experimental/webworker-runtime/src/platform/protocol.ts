/**
 * Messages between the page and the worker host's platform layer. They travel on
 * a dedicated `MessagePort` beside the HTTP tunnel, because they carry browser
 * objects and page interactions rather than requests the harness serves.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/platform/protocol
 */

/** Posted on the Worker before `init`; it hands over the port and enables the platform layer. */
export interface PlatformInitFrame {
  readonly t: 'platform-init'
  readonly port: MessagePort
}

/** Stage reported while the host starts. */
export type BootStage = 'download' | 'restore' | 'start' | 'ready'

/** Operations the page requests from the host. */
export type PlatformRequest =
  | { readonly op: 'status' }
  | { readonly op: 'flush' }
  | { readonly op: 'export' }
  | { readonly op: 'import'; readonly archive: Uint8Array }
  | { readonly op: 'reset' }

/** Storage facts shown to the person using the page. */
export interface PlatformStatus {
  /** Whether home and workspace data survive a reload. */
  readonly durable: boolean
}

/** Page to worker frames. */
export type PageToHostFrame =
  | ({ readonly t: 'request'; readonly id: number } & PlatformRequest)
  | { readonly t: 'named-workspace'; readonly id: number; readonly name: string }
  | { readonly t: 'named-nothing'; readonly id: number }

/** Worker to page frames. */
export type HostToPageFrame =
  | { readonly t: 'progress'; readonly stage: BootStage; readonly loaded?: number; readonly total?: number }
  | { readonly t: 'name-workspace'; readonly id: number }
  | { readonly t: 'storage-failure'; readonly message: string }
  | { readonly t: 'reply'; readonly id: number; readonly value?: unknown; readonly failure?: string }

/**
 * Whether a Worker message is the frame that enables the platform layer.
 * @param data - Raw message payload.
 * @returns true for a {@link PlatformInitFrame}.
 */
export function isPlatformInitFrame(data: unknown): data is PlatformInitFrame {
  return typeof data === 'object' && data !== null && (data as { t?: unknown }).t === 'platform-init'
}
