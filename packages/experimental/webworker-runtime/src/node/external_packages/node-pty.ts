/**
 * `node-pty` over the Worker's own terminal (`src/shell/terminal.ts`): an
 * interactive shell whose lines run as Worker shell processes, so the persistent
 * bash tool and the sidebar terminal work without an operating-system PTY.
 */
import { notImplementedFail } from '../notImplementedFail.ts'
import { spawnTerminal } from '../../shell/terminal.ts'

/** Spawn a terminal session. */
export const spawn = spawnTerminal

/** Open a bare pseudo-terminal pair (unavailable: nothing here can hold the other end). */
export const open = notImplementedFail('node-pty', 'open')

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts). */
export const __esModule = true

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default { spawn, open }
