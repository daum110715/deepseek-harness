/**
 * Types of the in-worker shell: the filesystem one command line acts on and the
 * outcome it reports.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/types
 */

/** One directory entry. */
export interface ShellDirent {
  readonly name: string
  readonly directory: boolean
}

/** What a command can learn about one path. */
export interface ShellStats {
  readonly directory: boolean
  readonly size: number
  readonly mtimeMs: number
  /** Permission bits; absent means the default for the entry's kind. */
  readonly mode?: number
}

/**
 * The filesystem a shell run acts on.
 *
 * Asynchronous by construction: a command that runs in its own worker reaches
 * the VFS by message, and the browser offers no way to block on that (a
 * synchronous face would need `SharedArrayBuffer`, which requires
 * cross-origin isolation this deployment cannot have). The in-host
 * implementation answers immediately from the mounted VFS.
 */
export interface ShellFileSystem {
  /**
   * Stat one path.
   * @param path - absolute VFS path.
   * @returns the entry's facts, or undefined when nothing is there.
   */
  stat(path: string): Promise<ShellStats | undefined>
  /**
   * List one directory.
   * @param path - absolute VFS path of the directory.
   * @returns its entries, sorted by name.
   * @throws a Node-shaped error when the path is absent or is not a directory.
   */
  list(path: string): Promise<ShellDirent[]>
  /**
   * Read one file as UTF-8 text.
   * @param path - absolute VFS path.
   * @returns the file's contents.
   * @throws a Node-shaped error when the path is absent or is a directory.
   */
  readText(path: string): Promise<string>
  /**
   * Write text to one file.
   * @param path - absolute VFS path; its parent must exist.
   * @param text - the text to store.
   * @param append - true to keep the existing contents and add after them.
   */
  writeText(path: string, text: string, append?: boolean): Promise<void>
  /**
   * Create one directory.
   * @param path - absolute VFS path.
   * @param recursive - true to create missing parents and tolerate an existing directory.
   */
  mkdir(path: string, recursive: boolean): Promise<void>
  /**
   * Remove one path.
   * @param path - absolute VFS path.
   * @param options - `recursive` to take a whole subtree, `force` to tolerate absence.
   */
  remove(path: string, options: { recursive: boolean; force: boolean }): Promise<void>
  /**
   * Move one file or subtree.
   * @param from - absolute source path.
   * @param to - absolute destination path.
   */
  rename(from: string, to: string): Promise<void>
  /**
   * Read one file as bytes.
   * @param path - absolute VFS path.
   * @returns the file's contents.
   * @throws a Node-shaped error when the path is absent or is a directory.
   */
  readBytes(path: string): Promise<Uint8Array>
  /**
   * Write bytes to one file.
   * @param path - absolute VFS path; its parent must exist.
   * @param bytes - the bytes to store.
   * @param append - true to keep the existing contents and add after them.
   */
  writeBytes(path: string, bytes: Uint8Array, append?: boolean): Promise<void>
  /**
   * Set one entry's permission bits.
   * @param path - absolute VFS path.
   * @param mode - permission bits.
   */
  chmod(path: string, mode: number): Promise<void>
}

/** Outcome of one interpreted command line. */
export interface ShellRunOutcome {
  /** Exit status of the last command the line ran. */
  exitCode: number
  /** Everything written to standard output. */
  stdout: string
  /** Everything written to standard error. */
  stderr: string
}
