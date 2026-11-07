/**
 * `@vscode/ripgrep` stub. The package's only export is the binary path, read by
 * the search plugins. Spawning it reaches the Worker's own `rg`
 * (`src/shell/process/ripgrep.ts`), which the process launcher finds by name.
 */

/** Path the search plugins spawn; the launcher answers it with the Worker's `rg`. */
export const rgPath = '/dsh/bin/rg'

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts). */
export const __esModule = true

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default { rgPath }
