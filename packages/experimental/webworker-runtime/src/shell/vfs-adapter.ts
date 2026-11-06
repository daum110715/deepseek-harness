/**
 * Presents one subtree of a {@link ShellFileSystem} as the filesystem the bash
 * interpreter runs on. Every call goes through the given filesystem, so a confined
 * run keeps its grants. The VFS has no symbolic links, so link operations report
 * `ENOSYS` and `lstat` equals `stat`.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/vfs-adapter
 */

import type { BufferEncoding, FileContent, FsStat, IFileSystem } from 'just-bash/browser'
import { resolve } from '../module-system/posix-path.ts'
import { filesystemError } from './fs-access.ts'
import type { ShellFileSystem, ShellStats } from './types.ts'

type EncodingOption = { encoding?: BufferEncoding | null } | BufferEncoding | undefined

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function encodingOf(options: EncodingOption): BufferEncoding {
  const encoding = typeof options === 'string' ? options : options?.encoding
  return encoding ?? 'utf8'
}

function decode(bytes: Uint8Array, encoding: BufferEncoding): string {
  switch (encoding) {
    case 'utf8':
    case 'utf-8':
      return decoder.decode(bytes)
    case 'hex':
      return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
    case 'base64':
      return btoa(String.fromCharCode(...bytes))
    default:
      return String.fromCharCode(...bytes)
  }
}

function encode(content: FileContent, encoding: BufferEncoding): Uint8Array {
  if (typeof content !== 'string') return content
  switch (encoding) {
    case 'utf8':
    case 'utf-8':
      return encoder.encode(content)
    case 'hex':
      return Uint8Array.from(content.match(/../gu) ?? [], pair => Number.parseInt(pair, 16))
    case 'base64':
      return Uint8Array.from(atob(content), character => character.charCodeAt(0))
    default:
      return Uint8Array.from(content, character => character.charCodeAt(0) & 0xff)
  }
}

function fsStatOf(stats: ShellStats): FsStat {
  return {
    isFile: !stats.directory,
    isDirectory: stats.directory,
    isSymbolicLink: false,
    mode: stats.mode ?? (stats.directory ? 0o755 : 0o644),
    size: stats.size,
    mtime: new Date(stats.mtimeMs),
  }
}

/** The bash interpreter's filesystem over one VFS subtree. */
export class ShellVfsAdapter implements IFileSystem {
  private readonly fs: ShellFileSystem
  private readonly root: string

  /**
   * Bind the adapter.
   * @param fs - Filesystem every call delegates to.
   * @param root - VFS path this adapter's `/` names.
   */
  constructor(fs: ShellFileSystem, root: string) {
    this.fs = fs
    this.root = root
  }

  private at(path: string): string {
    return path === '/' ? this.root : `${this.root}${path}`
  }

  async readFile(path: string, options?: EncodingOption): Promise<string> {
    return decode(await this.fs.readBytes(this.at(path)), encodingOf(options))
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    return await this.fs.readBytes(this.at(path))
  }

  async writeFile(path: string, content: FileContent, options?: EncodingOption): Promise<void> {
    await this.fs.writeBytes(this.at(path), encode(content, encodingOf(options)))
  }

  async appendFile(path: string, content: FileContent, options?: EncodingOption): Promise<void> {
    await this.fs.writeBytes(this.at(path), encode(content, encodingOf(options)), true)
  }

  async exists(path: string): Promise<boolean> {
    return await this.fs.stat(this.at(path)) !== undefined
  }

  async stat(path: string): Promise<FsStat> {
    const stats = await this.fs.stat(this.at(path))
    if (stats === undefined) throw filesystemError('ENOENT', 'stat', path)
    return fsStatOf(stats)
  }

  async lstat(path: string): Promise<FsStat> {
    return await this.stat(path)
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await this.fs.mkdir(this.at(path), options?.recursive === true)
  }

  async readdir(path: string): Promise<string[]> {
    return (await this.fs.list(this.at(path))).map(entry => entry.name)
  }

  async readdirWithFileTypes(path: string): Promise<{ name: string; isFile: boolean; isDirectory: boolean; isSymbolicLink: boolean }[]> {
    return (await this.fs.list(this.at(path))).map(entry => ({
      name: entry.name, isFile: !entry.directory, isDirectory: entry.directory, isSymbolicLink: false,
    }))
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    await this.fs.remove(this.at(path), { recursive: options?.recursive === true, force: options?.force === true })
  }

  async cp(source: string, destination: string, options?: { recursive?: boolean }): Promise<void> {
    const stats = await this.stat(source)
    if (!stats.isDirectory) {
      await this.fs.writeBytes(this.at(destination), await this.fs.readBytes(this.at(source)))
      return
    }
    if (options?.recursive !== true) throw filesystemError('EISDIR', 'cp', source)
    await this.mkdir(destination, { recursive: true })
    for (const name of await this.readdir(source)) {
      await this.cp(`${source}/${name}`, `${destination}/${name}`, options)
    }
  }

  async mv(source: string, destination: string): Promise<void> {
    await this.fs.rename(this.at(source), this.at(destination))
  }

  resolvePath(base: string, path: string): string {
    return resolve(base, path)
  }

  /** The walk commands read directories; this adapter holds no path index. */
  getAllPaths(): string[] {
    return []
  }

  async chmod(path: string, mode: number): Promise<void> {
    await this.fs.chmod(this.at(path), mode)
  }

  async symlink(_target: string, linkPath: string): Promise<void> {
    await Promise.reject(filesystemError('ENOSYS', 'symlink', linkPath))
  }

  async link(existing: string, next: string): Promise<void> {
    await this.cp(existing, next)
  }

  async readlink(path: string): Promise<string> {
    return await Promise.reject(filesystemError('EINVAL', 'readlink', path))
  }

  async realpath(path: string): Promise<string> {
    await this.stat(path)
    return path
  }

  /** The VFS sets modification times only by writing, and no command here depends on setting them. */
  async utimes(path: string): Promise<void> {
    await this.stat(path)
  }
}
