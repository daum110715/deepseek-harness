/**
 * Write-behind mirror between one VFS subtree and one browser directory handle.
 *
 * The VFS stays the synchronous authority the Node compatibility layer reads;
 * this mirror hydrates it at mount time and replays committed mutations onto the
 * handle afterwards. Origin-private directories use synchronous access handles so
 * a Session log append costs one positioned write. User-picked directories only
 * offer `createWritable`, which rewrites through a swap file.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/storage/directory-mirror
 */

import type { MemoryVfs } from './memory.ts'
import type { VfsMutation, VfsMutationSink } from './types.ts'

/** Sidecar holding non-default permission bits, which browser directories cannot store. */
export const MODE_SIDECAR = '.dsh-modes.json'

/** Delay that groups the mutations of one synchronous burst into a single batch. */
const BATCH_DELAY_MS = 100

/** Parallel file reads during hydration; browsers serialize more without finishing sooner. */
const HYDRATE_CONCURRENCY = 32

/** Default file bits of {@link MemoryVfs}; the sidecar records only differing files. */
const DEFAULT_MODE = 0o644

/** Limits applied while reading a directory into memory. */
export interface HydrateLimits {
  /** Directory names left out of the VFS wherever they occur. */
  readonly ignoredDirectories: ReadonlySet<string>
  /** Largest single file read into memory. */
  readonly maxFileBytes: number
  /** Largest total read into memory. */
  readonly maxTotalBytes: number
}

/** What one hydration left out, reported to the person who mounted the directory. */
export interface HydrateReport {
  readonly files: number
  readonly bytes: number
  /** Paths relative to the mirror root that exceeded a limit. */
  readonly skipped: readonly string[]
}

/** Construction inputs for {@link DirectoryMirror}. */
export interface DirectoryMirrorOptions {
  /** Directory receiving the subtree. */
  readonly directory: FileSystemDirectoryHandle
  /** Absolute VFS path of the subtree. */
  readonly vfsRoot: string
  /** Whether the handle is origin-private, the only kind offering synchronous access. */
  readonly originPrivate: boolean
  /** Called once when the mirror stops; the VFS keeps working without durability. */
  onFailure(reason: unknown): void
}

/** Size and timestamp of a file as this mirror last saw it on the handle. */
interface KnownFile {
  size: number
  lastModified: number
}

/** Whether a DOMException names an absent entry. */
function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError'
}

/**
 * Run tasks with bounded parallelism, stopping at the first failure.
 * @param tasks - Task factories.
 * @param limit - Largest number running at once.
 */
async function runBounded(tasks: readonly (() => Promise<void>)[], limit: number): Promise<void> {
  let next = 0
  const runner = async (): Promise<void> => {
    while (next < tasks.length) {
      const task = tasks[next]
      next += 1
      if (task !== undefined) await task()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, runner))
}

/** Write-behind {@link VfsMutationSink} over one directory handle. */
export class DirectoryMirror implements VfsMutationSink {
  /** Absolute VFS path of the mirrored subtree. */
  readonly vfsRoot: string
  private readonly directory: FileSystemDirectoryHandle
  private readonly originPrivate: boolean
  private readonly onFailure: (reason: unknown) => void
  private queue: VfsMutation[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private draining: Promise<void> | undefined
  private stopped = false
  private readonly directories = new Map<string, FileSystemDirectoryHandle>()
  private readonly modes = new Map<string, number>()
  private modesDirty = false
  private readonly known = new Map<string, KnownFile>()

  /**
   * Bind the mirror to its directory; nothing is read until {@link hydrate}.
   * @param options - Directory, subtree, and failure report.
   */
  constructor(options: DirectoryMirrorOptions) {
    this.directory = options.directory
    this.vfsRoot = options.vfsRoot
    this.originPrivate = options.originPrivate
    this.onFailure = options.onFailure
  }

  /**
   * Seed the VFS from the directory without publishing mutations.
   * @param vfs - Filesystem to seed.
   * @param limits - Limits for this directory.
   * @returns The counts and the paths left out.
   */
  async hydrate(vfs: MemoryVfs, limits: HydrateLimits): Promise<HydrateReport> {
    vfs.seedDirectory(this.vfsRoot)
    await this.loadModes()
    let files = 0
    let bytes = 0
    const skipped: string[] = []
    const reads: (() => Promise<void>)[] = []
    await this.walk('', this.directory, limits, (relative, handle) => {
      reads.push(async () => {
        const file = await handle.getFile()
        if (file.size > limits.maxFileBytes || bytes + file.size > limits.maxTotalBytes) {
          skipped.push(relative)
          return
        }
        bytes += file.size
        files += 1
        vfs.seed(`${this.vfsRoot}/${relative}`, new Uint8Array(await file.arrayBuffer()), {
          mode: this.modes.get(relative) ?? DEFAULT_MODE,
          mtimeMs: file.lastModified,
        })
        this.known.set(relative, { size: file.size, lastModified: file.lastModified })
      })
    }, (relative) => { vfs.seedDirectory(`${this.vfsRoot}/${relative}`) })
    await runBounded(reads, HYDRATE_CONCURRENCY)
    return { files, bytes, skipped }
  }

  /**
   * Bring changes other programs made to the directory into the VFS. Paths with
   * mutations still queued keep the VFS content, which the next drain writes.
   * @param vfs - Filesystem to update.
   * @param limits - Limits for this directory.
   * @returns Number of files added, changed, or removed.
   */
  async rescan(vfs: MemoryVfs, limits: HydrateLimits): Promise<number> {
    await this.flush()
    const present = new Set<string>()
    const reads: (() => Promise<void>)[] = []
    let changed = 0
    await this.walk('', this.directory, limits, (relative, handle) => {
      present.add(relative)
      reads.push(async () => {
        const file = await handle.getFile()
        const known = this.known.get(relative)
        if (known?.size === file.size && known.lastModified === file.lastModified) return
        this.known.set(relative, { size: file.size, lastModified: file.lastModified })
        if (file.size > limits.maxFileBytes) return
        vfs.seedObserved(`${this.vfsRoot}/${relative}`, new Uint8Array(await file.arrayBuffer()), {
          mode: this.modes.get(relative) ?? DEFAULT_MODE,
          mtimeMs: file.lastModified,
        })
        changed += 1
      })
    }, (relative) => { vfs.seedDirectory(`${this.vfsRoot}/${relative}`) })
    await runBounded(reads, HYDRATE_CONCURRENCY)
    for (const relative of this.known.keys()) {
      if (present.has(relative)) continue
      this.known.delete(relative)
      vfs.unseedObserved(`${this.vfsRoot}/${relative}`)
      changed += 1
    }
    return changed
  }

  /**
   * Queue one committed mutation; `path` is absolute within {@link vfsRoot}.
   * @param mutation - Post-commit state to mirror.
   */
  record(mutation: VfsMutation): void {
    if (this.stopped) return
    const last = this.queue.at(-1)
    if (mutation.kind === 'write' && last?.kind === 'write' && last.path === mutation.path) {
      // The newer record carries the complete bytes, so only the earliest append offset must survive.
      const appendedFrom = last.appendedFrom === undefined || mutation.appendedFrom === undefined
        ? undefined
        : Math.min(last.appendedFrom, mutation.appendedFrom)
      this.queue[this.queue.length - 1] = {
        kind: 'write',
        path: mutation.path,
        bytes: mutation.bytes,
        mode: mutation.mode,
        entryChanged: last.entryChanged || mutation.entryChanged,
        ...appendedFrom === undefined ? {} : { appendedFrom },
      }
    } else {
      this.queue.push(mutation)
    }
    this.timer ??= setTimeout(() => {
      this.timer = undefined
      void this.drain()
    }, BATCH_DELAY_MS)
  }

  /**
   * Settle every recorded mutation.
   * @returns A promise that resolves when nothing is pending.
   */
  async flush(): Promise<void> {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    while (this.queue.length > 0 || this.draining !== undefined) await this.drain()
  }

  /**
   * Remove everything under the directory, for a data reset. The mirror stops recording.
   * @returns A promise that resolves when the directory is empty.
   */
  async clear(): Promise<void> {
    this.stopped = true
    this.queue = []
    for await (const name of this.directory.keys()) {
      await this.directory.removeEntry(name, { recursive: true })
    }
  }

  private async walk(
    prefix: string,
    directory: FileSystemDirectoryHandle,
    limits: HydrateLimits,
    onFile: (relative: string, handle: FileSystemFileHandle) => void,
    onDirectory: (relative: string) => void,
  ): Promise<void> {
    for await (const handle of directory.values()) {
      const relative = prefix === '' ? handle.name : `${prefix}/${handle.name}`
      if (handle.kind === 'file') {
        if (relative !== MODE_SIDECAR) onFile(relative, handle as FileSystemFileHandle)
        continue
      }
      if (limits.ignoredDirectories.has(handle.name)) continue
      onDirectory(relative)
      await this.walk(relative, handle as FileSystemDirectoryHandle, limits, onFile, onDirectory)
    }
  }

  private drain(): Promise<void> {
    this.draining ??= this.drainQueue().finally(() => { this.draining = undefined })
    return this.draining
  }

  private async drainQueue(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        const batch = this.queue
        this.queue = []
        for (const mutation of batch) await this.apply(mutation)
        if (this.modesDirty) await this.saveModes()
      }
    } catch (reason) {
      this.stopped = true
      this.queue = []
      console.error(`webworker storage: mirror of ${this.vfsRoot} stopped`, reason)
      this.onFailure(reason)
    }
  }

  private relativeOf(path: string): string {
    return path === this.vfsRoot ? '' : path.slice(this.vfsRoot.length + 1)
  }

  private setMode(relative: string, mode: number): void {
    if ((this.modes.get(relative) ?? DEFAULT_MODE) === mode) return
    if (mode === DEFAULT_MODE) this.modes.delete(relative)
    else this.modes.set(relative, mode)
    this.modesDirty = true
  }

  private async apply(mutation: VfsMutation): Promise<void> {
    const relative = this.relativeOf(mutation.path)
    switch (mutation.kind) {
      case 'mkdir':
        if (relative !== '') await this.directoryAt(relative, true)
        return
      case 'chmod':
        if (this.originPrivate) this.setMode(relative, mutation.mode)
        return
      case 'write':
        if (this.originPrivate) this.setMode(relative, mutation.mode)
        await this.writeFile(relative, mutation.bytes, mutation.appendedFrom)
        return
      case 'remove':
        await this.removeEntry(relative)
        return
      default:
        throw new Error(`webworker storage: unknown mutation ${String((mutation as { kind?: unknown }).kind)}`)
    }
  }

  private async directoryAt(relative: string, create: boolean): Promise<FileSystemDirectoryHandle> {
    if (relative === '') return this.directory
    const cached = this.directories.get(relative)
    if (cached !== undefined) return cached
    const split = relative.lastIndexOf('/')
    const parent = await this.directoryAt(split === -1 ? '' : relative.slice(0, split), create)
    const handle = await parent.getDirectoryHandle(relative.slice(split + 1), { create })
    this.directories.set(relative, handle)
    return handle
  }

  private async writeFile(relative: string, bytes: Uint8Array, appendedFrom: number | undefined): Promise<void> {
    const split = relative.lastIndexOf('/')
    const parent = await this.directoryAt(split === -1 ? '' : relative.slice(0, split), true)
    const handle = await parent.getFileHandle(relative.slice(split + 1), { create: true })
    if (this.originPrivate) {
      const access = await handle.createSyncAccessHandle()
      try {
        if (appendedFrom === undefined) {
          access.truncate(0)
          access.write(bytes as Uint8Array<ArrayBuffer>, { at: 0 })
        } else {
          access.truncate(appendedFrom)
          access.write(bytes.subarray(appendedFrom) as Uint8Array<ArrayBuffer>, { at: appendedFrom })
        }
        access.flush()
      } finally {
        access.close()
      }
    } else {
      const writable = await handle.createWritable({ keepExistingData: false })
      await writable.write(bytes as Uint8Array<ArrayBuffer>)
      await writable.close()
    }
    const file = await handle.getFile()
    this.known.set(relative, { size: file.size, lastModified: file.lastModified })
  }

  private async removeEntry(relative: string): Promise<void> {
    if (relative === '') return
    const split = relative.lastIndexOf('/')
    try {
      const parent = await this.directoryAt(split === -1 ? '' : relative.slice(0, split), false)
      await parent.removeEntry(relative.slice(split + 1), { recursive: true })
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
    for (const map of [this.directories, this.known, this.modes]) {
      for (const key of map.keys()) {
        if (key === relative || key.startsWith(`${relative}/`)) {
          map.delete(key)
          if (map === this.modes) this.modesDirty = true
        }
      }
    }
  }

  private async loadModes(): Promise<void> {
    if (!this.originPrivate) return
    let text: string
    try {
      const handle = await this.directory.getFileHandle(MODE_SIDECAR)
      text = await (await handle.getFile()).text()
    } catch (error) {
      if (isNotFound(error)) return
      throw error
    }
    for (const [path, mode] of Object.entries(JSON.parse(text) as Record<string, number>)) {
      this.modes.set(path, mode)
    }
  }

  private async saveModes(): Promise<void> {
    this.modesDirty = false
    const handle = await this.directory.getFileHandle(MODE_SIDECAR, { create: true })
    const access = await handle.createSyncAccessHandle()
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(Object.fromEntries(this.modes)))
      access.truncate(0)
      access.write(bytes, { at: 0 })
      access.flush()
    } finally {
      access.close()
    }
  }
}
