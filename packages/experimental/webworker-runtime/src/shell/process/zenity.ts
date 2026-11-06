/**
 * The Worker's `zenity`: the Linux chooser command the native directory-picker
 * backend runs, answered by the page's folder picker. Exit status 1 means the
 * person cancelled, as zenity(1) reports it.
 */
import type { VirtualExecutable, VirtualExecutableExit } from './virtual-executables.ts'

/** Page-side folder selection; resolves with the folder's VFS path. */
export type DirectoryChooser = () => Promise<string | null>

let chooser: DirectoryChooser | undefined

/**
 * Install the chooser this command reports to; the platform layer calls this once its port exists.
 * @param next - Chooser that forwards to the page.
 */
export function setDirectoryChooser(next: DirectoryChooser): void {
  chooser = next
}

function exit(exitCode: number, stdout = '', stderr = ''): VirtualExecutableExit {
  return { kind: 'exit', exitCode, stdout, stderr }
}

/** Virtual executable connecting the directory chooser command to the page. */
export const ZENITY_EXECUTABLE: VirtualExecutable = {
  name: 'zenity',
  async prepare() {
    if (chooser === undefined) return exit(255, '', 'zenity: no page is attached\n')
    try {
      const path = await chooser()
      return path === null ? exit(1) : exit(0, `${path}\n`)
    } catch (error) {
      return exit(255, '', `zenity: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  },
  runSync() {
    return { kind: 'asynchronous' }
  },
}
