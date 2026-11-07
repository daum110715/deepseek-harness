/**
 * The worker side of the Web platform layer: durable home and workspace data in
 * the origin-private file system, and the page interactions a harness running in
 * a Worker needs. Nothing here reaches the host machine's file system: every
 * workspace is a directory under `<root>/workspace`.
 *
 * Every mirrored subtree is a {@link DirectoryMirror}. This class routes committed
 * VFS mutations to the mirror owning the path, so a rename across subtrees works
 * as the remove and write records the VFS already publishes.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/platform/host
 */

import { DirectoryMirror } from '../storage/directory-mirror.ts'
import type { MemoryVfs } from '../storage/memory.ts'
import { packTar, parseTar } from '../storage/tar.ts'
import type { VfsMutation, VfsMutationSink } from '../storage/types.ts'
import { IMAGE_HOME_DIRECTORY } from '../image-layout.ts'
import type { BootStage, HostToPageFrame, PageToHostFrame, PlatformInitFrame, PlatformRequest, PlatformStatus } from './protocol.ts'

/** Origin-private directory holding this data layout's home and workspace trees. */
const DATA_DIRECTORY = 'dsh-data-v1'

/** Subtrees that survive a reload. `tmp/` and the image's code stay in memory. */
const DURABLE_TREES = [IMAGE_HOME_DIRECTORY, 'workspace'] as const

/** Pending page interaction. */
type Waiting = (frame: PageToHostFrame) => void

/** Worker half of the Web platform layer; one per host worker. */
export class WebPlatformHost implements VfsMutationSink {
  private readonly port: MessagePort
  private readonly mirrors: DirectoryMirror[] = []
  private readonly waiting = new Map<number, Waiting>()
  private nextId = 0
  private vfs: MemoryVfs | undefined
  private root = ''
  private durable = false

  /**
   * Take over the page's port.
   * @param frame - The page's opening frame.
   */
  constructor(frame: PlatformInitFrame) {
    this.port = frame.port
    this.port.onmessage = (event: MessageEvent<PageToHostFrame>) => { this.receive(event.data) }
  }

  /**
   * Report a boot stage to the page.
   * @param stage - Stage entered.
   * @param loaded - Bytes received, during `download`.
   * @param total - Bytes expected when the server says.
   */
  progress(stage: BootStage, loaded?: number, total?: number): void {
    this.post({ t: 'progress', stage, ...loaded === undefined ? {} : { loaded }, ...total === undefined ? {} : { total } })
  }

  /**
   * Restore durable data into the mounted image, which it overrides.
   * A browser denying origin-private storage leaves the session ephemeral and says so.
   * @param vfs - Filesystem holding the base image, constructed with this sink.
   * @param root - Virtual root.
   */
  async restore(vfs: MemoryVfs, root: string): Promise<void> {
    this.vfs = vfs
    this.root = root
    this.progress('restore')
    try {
      const origin = await navigator.storage.getDirectory()
      const data = await origin.getDirectoryHandle(DATA_DIRECTORY, { create: true })
      for (const tree of DURABLE_TREES) {
        const mirror = new DirectoryMirror({
          directory: await data.getDirectoryHandle(tree, { create: true }),
          vfsRoot: `${root}/${tree}`,
          onFailure: (reason) => { this.reportStorageFailure(reason) },
        })
        await mirror.hydrate(vfs)
        this.mirrors.push(mirror)
      }
      this.durable = true
    } catch (reason) {
      this.reportStorageFailure(reason)
    }
    this.progress('start')
  }

  /** @inheritdoc */
  record(mutation: VfsMutation): void {
    this.mirrorOf(mutation.path)?.record(mutation)
  }

  /** @inheritdoc */
  async flush(): Promise<void> {
    await Promise.all(this.mirrors.map(async (mirror) => { await mirror.flush() }))
  }

  /**
   * Ask the page for a workspace name and create that directory in durable storage.
   * A name already in use opens the existing workspace.
   * @returns The workspace's VFS path, or null when the person cancels.
   */
  async chooseWorkspace(): Promise<string | null> {
    this.nextId += 1
    const id = this.nextId
    const answer = await new Promise<PageToHostFrame>((settle) => {
      this.waiting.set(id, settle)
      this.post({ t: 'name-workspace', id })
    })
    if (answer.t !== 'named-workspace') return null
    // Separators and leading dots go, so a name stays one directory under the workspace tree.
    const name = answer.name.trim().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[-.]+/u, '') || 'workspace'
    const path = `${this.root}/workspace/${name}`
    this.requireVfs().mkdirSync(path, { recursive: true })
    return path
  }

  private post(frame: HostToPageFrame, transfer: Transferable[] = []): void {
    this.port.postMessage(frame, transfer)
  }

  private reportStorageFailure(reason: unknown): void {
    this.durable = false
    this.post({ t: 'storage-failure', message: reason instanceof Error ? reason.message : String(reason) })
  }

  private mirrorOf(path: string): DirectoryMirror | undefined {
    return this.mirrors.find(mirror => path === mirror.vfsRoot || path.startsWith(`${mirror.vfsRoot}/`))
  }

  private requireVfs(): MemoryVfs {
    if (this.vfs === undefined) throw new Error('webworker platform: no filesystem is mounted yet')
    return this.vfs
  }

  private receive(frame: PageToHostFrame): void {
    if (frame.t === 'request') {
      void this.answer(frame.id, frame)
      return
    }
    const settle = this.waiting.get(frame.id)
    this.waiting.delete(frame.id)
    settle?.(frame)
  }

  private async answer(id: number, request: PlatformRequest): Promise<void> {
    try {
      const value = await this.perform(request)
      const transfer = value instanceof Uint8Array ? [value.buffer as ArrayBuffer] : []
      this.post({ t: 'reply', id, value }, transfer)
    } catch (reason) {
      this.post({ t: 'reply', id, failure: reason instanceof Error ? reason.message : String(reason) })
    }
  }

  private async perform(request: PlatformRequest): Promise<unknown> {
    switch (request.op) {
      case 'status':
        return this.status()
      case 'flush':
        return await this.flush()
      case 'export':
        return this.exportData()
      case 'import':
        this.importData(request.archive)
        return await this.flush()
      case 'reset':
        await Promise.all(this.mirrors.map(async (mirror) => { await mirror.clear() }))
        return undefined
      default:
        throw new Error(`webworker platform: unknown operation ${String((request as { op?: unknown }).op)}`)
    }
  }

  private status(): PlatformStatus {
    return { durable: this.durable }
  }

  private exportData(): Uint8Array {
    const vfs = this.requireVfs()
    const entries: Record<string, Uint8Array> = {}
    const walk = (relative: string): void => {
      entries[`${relative}/`] = new Uint8Array()
      for (const name of vfs.readdirSync(`${this.root}/${relative}`) as string[]) {
        const child = `${relative}/${name}`
        if (vfs.statSync(`${this.root}/${child}`).isDirectory()) walk(child)
        else entries[child] = vfs.readFileSync(`${this.root}/${child}`) as Uint8Array
      }
    }
    for (const tree of DURABLE_TREES) walk(tree)
    return packTar(entries)
  }

  private importData(archive: Uint8Array): void {
    const vfs = this.requireVfs()
    for (const entry of parseTar(archive)) {
      const relative = entry.name.replace(/^\.\//u, '').replace(/\/$/u, '')
      const segments = relative.split('/')
      if (!DURABLE_TREES.some(tree => tree === segments[0]) || segments.some(segment => segment === '..' || segment === '.' || segment === '')) {
        throw new Error(`webworker platform: backup entry must stay under home/ or workspace/, received "${entry.name}"`)
      }
      const target = `${this.root}/${relative}`
      if (entry.directory) {
        vfs.mkdirSync(target, { recursive: true })
        continue
      }
      vfs.mkdirSync(target.slice(0, target.lastIndexOf('/')), { recursive: true })
      vfs.writeFileSync(target, entry.bytes)
    }
  }
}
