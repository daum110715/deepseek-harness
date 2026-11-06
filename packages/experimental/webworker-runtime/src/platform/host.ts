/**
 * The worker side of the Web platform layer: durable home and workspace data in
 * the origin-private file system, folders the person picked mounted under
 * `<root>/mnt/`, and the page interactions a harness running in a Worker needs.
 *
 * Every mirrored subtree is a {@link DirectoryMirror}. This class routes committed
 * VFS mutations to the mirror owning the path, so a rename across subtrees works
 * as the remove and write records the VFS already publishes.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/platform/host
 */

import { DirectoryMirror, type HydrateLimits } from '../storage/directory-mirror.ts'
import type { MemoryVfs } from '../storage/memory.ts'
import { packTar, parseTar } from '../storage/tar.ts'
import type { VfsMutation, VfsMutationSink } from '../storage/types.ts'
import { IMAGE_HOME_DIRECTORY } from '../image-layout.ts'
import type { BootStage, HostToPageFrame, PageToHostFrame, PlatformInitFrame, PlatformRequest, PlatformStatus } from './protocol.ts'

/** Origin-private directory holding this data layout's home and workspace trees. */
const DATA_DIRECTORY = 'dsh-data-v1'

/** Subtrees that survive a reload. `tmp/` and the image's code stay in memory. */
const DURABLE_TREES = [IMAGE_HOME_DIRECTORY, 'workspace'] as const

/** Directory under the virtual root where picked folders appear. */
const MOUNT_DIRECTORY = 'mnt'

/** Harness data is complete: everything the mirror wrote comes back. */
const DATA_LIMITS: HydrateLimits = {
  ignoredDirectories: new Set(),
  maxFileBytes: Number.MAX_SAFE_INTEGER,
  maxTotalBytes: Number.MAX_SAFE_INTEGER,
}

/**
 * Picked folders are held in memory, so dependency and build trees stay out and
 * large files are skipped. Skipped paths are reported to the page when mounting.
 */
const FOLDER_LIMITS: HydrateLimits = {
  ignoredDirectories: new Set(['node_modules', '.venv', 'venv', '__pycache__', '.next', '.nuxt', '.cache', '.turbo', 'target']),
  maxFileBytes: 32 * 1024 * 1024,
  maxTotalBytes: 768 * 1024 * 1024,
}

/** One mounted folder. */
interface Mount {
  readonly name: string
  readonly path: string
  readonly handle: FileSystemDirectoryHandle
  readonly mirror: DirectoryMirror
  files: number
  bytes: number
}

/** Pending page interaction. */
type Waiting = (frame: PageToHostFrame) => void

/** Worker half of the Web platform layer; one per host worker. */
export class WebPlatformHost implements VfsMutationSink {
  private readonly port: MessagePort
  private readonly restoredMounts: PlatformInitFrame['mounts']
  private readonly mirrors: DirectoryMirror[] = []
  private readonly mounts = new Map<string, Mount>()
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
    this.restoredMounts = frame.mounts
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
   * Restore durable data and folders into the mounted image, which they override.
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
          originPrivate: true,
          onFailure: (reason) => { this.reportStorageFailure(reason) },
        })
        await mirror.hydrate(vfs, DATA_LIMITS)
        this.mirrors.push(mirror)
      }
      this.durable = true
    } catch (reason) {
      this.reportStorageFailure(reason)
    }
    for (const mount of this.restoredMounts) await this.mount(mount.name, mount.handle, false)
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
   * Ask the page for a folder and mount it.
   * @returns The folder's VFS path, or null when the person cancels.
   */
  async chooseDirectory(): Promise<string | null> {
    this.nextId += 1
    const id = this.nextId
    const answer = await new Promise<PageToHostFrame>((settle) => {
      this.waiting.set(id, settle)
      this.post({ t: 'choose-directory', id })
    })
    switch (answer.t) {
      case 'chosen-directory':
        return await this.mount(answer.handle.name, answer.handle, true)
      case 'chosen-files':
        return this.importFolder(answer.name, answer.files)
      case 'choose-failed':
        throw new Error(answer.message)
      default:
        return null
    }
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

  private async mount(requestedName: string, handle: FileSystemDirectoryHandle, announce: boolean): Promise<string> {
    const vfs = this.requireVfs()
    for (const existing of this.mounts.values()) {
      if (await existing.handle.isSameEntry(handle)) return existing.path
    }
    const base = requestedName.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[-.]+/u, '') || 'folder'
    let name = base
    for (let suffix = 2; this.mounts.has(name); suffix += 1) name = `${base}-${String(suffix)}`
    const path = `${this.root}/${MOUNT_DIRECTORY}/${name}`
    const mirror = new DirectoryMirror({
      directory: handle,
      vfsRoot: path,
      originPrivate: false,
      onFailure: (reason) => { this.reportStorageFailure(reason) },
    })
    const report = await mirror.hydrate(vfs, FOLDER_LIMITS)
    this.mirrors.push(mirror)
    this.mounts.set(name, { name, path, handle, mirror, files: report.files, bytes: report.bytes })
    if (announce) {
      this.post({ t: 'mounted', name, path, handle, files: report.files, skipped: report.skipped.slice(0, 20) })
    }
    return path
  }

  /** Browsers without a directory picker hand over a copy, which lives in the durable workspace. */
  private async importFolder(requestedName: string, files: readonly { readonly path: string; readonly file: File }[]): Promise<string> {
    const vfs = this.requireVfs()
    const base = requestedName.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[-.]+/u, '') || 'folder'
    let name = base
    for (let suffix = 2; vfs.existsSync(`${this.root}/workspace/${name}`); suffix += 1) name = `${base}-${String(suffix)}`
    const path = `${this.root}/workspace/${name}`
    vfs.mkdirSync(path, { recursive: true })
    for (const { path: relative, file } of files) {
      const target = `${path}/${relative}`
      vfs.mkdirSync(target.slice(0, target.lastIndexOf('/')), { recursive: true })
      vfs.writeFileSync(target, new Uint8Array(await file.arrayBuffer()))
    }
    this.post({ t: 'mounted', name, path, files: files.length, skipped: [] })
    return path
  }

  private receive(frame: PageToHostFrame): void {
    switch (frame.t) {
      case 'rescan':
        void this.rescan()
        return
      case 'request':
        void this.answer(frame.id, frame)
        return
      default: {
        const settle = this.waiting.get(frame.id)
        this.waiting.delete(frame.id)
        settle?.(frame)
      }
    }
  }

  private async rescan(): Promise<void> {
    const vfs = this.vfs
    if (vfs === undefined) return
    try {
      for (const mount of this.mounts.values()) await mount.mirror.rescan(vfs, FOLDER_LIMITS)
    } catch (reason) {
      // A revoked permission or a folder removed outside the browser; the next focus retries.
      console.warn('webworker platform: folder rescan failed', reason)
    }
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
        await Promise.all(this.mirrors.filter(mirror => !mirror.vfsRoot.includes(`/${MOUNT_DIRECTORY}/`)).map(async (mirror) => { await mirror.clear() }))
        return undefined
      case 'unmount':
        return await this.unmount(request.name)
      default:
        throw new Error(`webworker platform: unknown operation ${String((request as { op?: unknown }).op)}`)
    }
  }

  private status(): PlatformStatus {
    return {
      durable: this.durable,
      mounts: [...this.mounts.values()].map(({ name, path, files, bytes }) => ({ name, path, files, bytes })),
    }
  }

  private async unmount(name: string): Promise<void> {
    const mount = this.mounts.get(name)
    if (mount === undefined) return
    await mount.mirror.flush()
    this.mirrors.splice(this.mirrors.indexOf(mount.mirror), 1)
    this.mounts.delete(name)
    // The mirror is detached, so this drops the memory copy and leaves the folder untouched.
    this.requireVfs().rmSync(mount.path, { recursive: true, force: true })
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
