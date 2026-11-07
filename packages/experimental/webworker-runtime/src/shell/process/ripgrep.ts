/**
 * The Worker's `rg`: what the `glob` and `grep` tools spawn through the
 * `@vscode/ripgrep` stub (`/dsh/bin/rg`).
 *
 * The shell's own `rg` neither accepts the flags those tools always pass
 * (`--no-config`, `--sort=modified`, `--` before a path) nor follows ripgrep's
 * glob rules (`**` matching zero directories, last matching glob winning,
 * negated globs pruning directories), so their argv shapes are answered here.
 * Any other invocation goes to the shell's `rg` unchanged, minus `--no-config`,
 * which means nothing where no ripgrep configuration file exists.
 *
 * Supported: `--files`, `--json`, `--regexp=PATTERN`, `--glob=GLOB`,
 * `--sort=modified`, `--hidden`, `--no-ignore`, `--no-config`, and paths after
 * `--`. Globs use gitignore syntax as ripgrep does: a glob without a slash
 * matches the file name at any depth, one with a slash matches the path from
 * the search root, and a trailing slash matches directories only. Without
 * `--no-ignore`, `.gitignore` and `.ignore` files under the search root apply.
 * Exit status follows ripgrep: 0 for results, 1 for none, 2 for an error.
 */
import picomatch from 'picomatch'
import { basename, join, resolve } from '../../module-system/posix-path.ts'
import type { ShellFileSystem } from '../types.ts'
import type { VirtualExecutable, VirtualExecutableExit, VirtualExecutablePreparation } from './virtual-executables.ts'

/** One parsed invocation of the supported subset. */
interface Invocation {
  readonly mode: 'files' | 'json'
  readonly pattern: string | undefined
  readonly globs: readonly string[]
  readonly paths: readonly string[]
  readonly hidden: boolean
  readonly noIgnore: boolean
  readonly sortModified: boolean
}

/** One gitignore-syntax rule, compiled. */
interface Rule {
  readonly negated: boolean
  readonly directoryOnly: boolean
  readonly test: (path: string) => boolean
  /** True for a rule without a slash, which matches the name at any depth. */
  readonly byName: boolean
}

/** Rules read from one directory's ignore files, relative to that directory. */
interface IgnoreScope {
  readonly base: string
  readonly rules: readonly Rule[]
}

/** A file found by the walk: how to print it, where it is, and when it changed. */
interface Found {
  readonly printed: string
  readonly absolute: string
  readonly mtimeMs: number
}

function exit(exitCode: number, stdout = '', stderr = ''): VirtualExecutableExit {
  return { kind: 'exit', exitCode, stdout, stderr }
}

/**
 * Read the supported subset, or report that the invocation needs the shell's `rg`.
 * @param args - Arguments after the executable path.
 * @returns The invocation, or undefined when any argument is outside the subset.
 */
function parse(args: readonly string[]): Invocation | undefined {
  let files = false
  let json = false
  let pattern: string | undefined
  const globs: string[] = []
  const paths: string[] = []
  let hidden = false
  let noIgnore = false
  let sortModified = false
  for (let index = 0; index < args.length; index++) {
    const argument = args[index] as string
    if (argument === '--') {
      paths.push(...args.slice(index + 1))
      break
    }
    if (argument === '--files') files = true
    else if (argument === '--json') json = true
    else if (argument === '--hidden') hidden = true
    else if (argument === '--no-ignore') noIgnore = true
    else if (argument === '--no-config') continue
    else if (argument === '--sort=modified') sortModified = true
    else if (argument.startsWith('--glob=')) globs.push(argument.slice('--glob='.length))
    else if (argument.startsWith('--regexp=') && pattern === undefined) pattern = argument.slice('--regexp='.length)
    else return undefined
  }
  if (files === json) return undefined
  if (json && pattern === undefined) return undefined
  return { mode: files ? 'files' : 'json', pattern, globs, paths, hidden, noIgnore, sortModified }
}

/**
 * Compile one gitignore-syntax line.
 * @param line - The glob or ignore-file line.
 * @returns The rule, or undefined for a blank line or comment.
 */
function compileRule(line: string): Rule | undefined {
  let text = line.replace(/(?<!\\)\s+$/u, '')
  if (text === '' || text.startsWith('#')) return undefined
  const negated = text.startsWith('!')
  if (negated) text = text.slice(1)
  if (text.startsWith('\\')) text = text.slice(1)
  const directoryOnly = text.endsWith('/')
  if (directoryOnly) text = text.replace(/\/+$/u, '')
  if (text === '') return undefined
  const byName = !text.includes('/')
  if (text.startsWith('/')) text = text.slice(1)
  // ripgrep reads `{a}` as a one-way alternation; picomatch would match the braces literally.
  text = text.replace(/(?<!\\)\{([^{},]*)\}/gu, '$1')
  const matcher = picomatch(text, { dot: true })
  // A rule naming a directory also covers everything inside it.
  const inside = text.endsWith('/**') ? undefined : picomatch(`${text}/**`, { dot: true })
  const test = (path: string): boolean => matcher(path) || (inside?.(path) ?? false)
  return { negated, directoryOnly, byName, test }
}

/**
 * Decide one path against a rule list: the last rule that matches wins.
 * @param rules - Rules in their written order.
 * @param relative - Path from the rules' base directory.
 * @param directory - Whether the path is a directory.
 * @returns 'ignore', 'whitelist', or undefined when no rule matches.
 */
function decide(rules: readonly Rule[], relative: string, directory: boolean): 'ignore' | 'whitelist' | undefined {
  const name = basename(relative)
  for (let index = rules.length - 1; index >= 0; index--) {
    const rule = rules[index] as Rule
    if (rule.directoryOnly && !directory) continue
    if (rule.test(rule.byName ? name : relative)) return rule.negated ? 'whitelist' : 'ignore'
  }
  return undefined
}

/**
 * Decide one path against `--glob` overrides. Unlike an ignore file, a
 * non-negated glob selects files: once any exists, a file must match one.
 * Directories are only ever pruned by a negated glob.
 */
function decideOverride(rules: readonly Rule[], relative: string, directory: boolean): 'ignore' | 'whitelist' | undefined {
  if (rules.length === 0) return undefined
  const name = basename(relative)
  for (let index = rules.length - 1; index >= 0; index--) {
    const rule = rules[index] as Rule
    if (rule.directoryOnly && !directory) continue
    const tested = rule.byName ? name : relative
    if (rule.test(tested)) return rule.negated ? 'ignore' : 'whitelist'
  }
  if (directory) return undefined
  return rules.some(rule => !rule.negated) ? 'ignore' : undefined
}

async function readIgnoreScope(fs: ShellFileSystem, directory: string, names: ReadonlySet<string>): Promise<IgnoreScope | undefined> {
  const rules: Rule[] = []
  for (const file of ['.gitignore', '.ignore']) {
    if (!names.has(file)) continue
    try {
      for (const line of (await fs.readText(join(directory, file))).split(/\r?\n/u)) {
        const rule = compileRule(line)
        if (rule !== undefined) rules.push(rule)
      }
    } catch {
      // An unreadable ignore file ignores nothing, as ripgrep reports and continues.
    }
  }
  return rules.length === 0 ? undefined : { base: directory, rules }
}

function ignoredByScopes(scopes: readonly IgnoreScope[], absolute: string, directory: boolean): boolean {
  for (let index = scopes.length - 1; index >= 0; index--) {
    const scope = scopes[index] as IgnoreScope
    const decision = decide(scope.rules, absolute.slice(scope.base === '/' ? 1 : scope.base.length + 1), directory)
    if (decision !== undefined) return decision === 'ignore'
  }
  return false
}

/**
 * Walk every search path and collect the files ripgrep would search.
 * @returns The files in walk order, plus one diagnostic per missing path.
 */
async function collect(fs: ShellFileSystem, cwd: string, invocation: Invocation): Promise<{ found: Found[]; errors: string[] }> {
  const overrides = invocation.globs.map(compileRule).filter((rule): rule is Rule => rule !== undefined)
  const found: Found[] = []
  const errors: string[] = []
  const roots = invocation.paths.length === 0 ? [undefined] : invocation.paths

  for (const given of roots) {
    const root = given === undefined ? cwd : resolve(cwd, given)
    const printedRoot = given ?? ''
    const stats = await fs.stat(root)
    if (stats === undefined) {
      errors.push(`rg: ${given ?? root}: No such file or directory (os error 2)\n`)
      continue
    }
    if (!stats.directory) {
      // A file named on the command line is searched whatever the filters say.
      found.push({ printed: given ?? basename(root), absolute: root, mtimeMs: stats.mtimeMs })
      continue
    }
    const visit = async (directory: string, relative: string, scopes: readonly IgnoreScope[]): Promise<void> => {
      let entries
      try {
        entries = await fs.list(directory)
      } catch {
        errors.push(`rg: ${directory}: Permission denied (os error 13)\n`)
        return
      }
      const names = new Set(entries.map(entry => entry.name))
      const scope = invocation.noIgnore ? undefined : await readIgnoreScope(fs, directory, names)
      const active = scope === undefined ? scopes : [...scopes, scope]
      for (const entry of entries) {
        const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`
        const absolute = join(directory, entry.name)
        const override = decideOverride(overrides, childRelative, entry.directory)
        if (override === 'ignore') continue
        if (override !== 'whitelist') {
          if (!invocation.hidden && entry.name.startsWith('.')) continue
          if (ignoredByScopes(active, absolute, entry.directory)) continue
        }
        if (entry.directory) {
          await visit(absolute, childRelative, active)
          continue
        }
        const printed = printedRoot === '' ? childRelative : join(printedRoot, childRelative)
        const childStats = invocation.sortModified ? await fs.stat(absolute) : undefined
        found.push({ printed, absolute, mtimeMs: childStats?.mtimeMs ?? 0 })
      }
    }
    await visit(root, '', [])
  }
  return { found, errors }
}

/**
 * Compile a ripgrep pattern as a JavaScript regular expression. Leading inline
 * flags (`(?i)`, `(?m)`, `(?s)`) become RegExp flags, and a pattern that strict
 * Unicode mode rejects for an escape ripgrep accepts is retried without it.
 */
function compilePattern(pattern: string): RegExp {
  let source = pattern
  let flags = 'g'
  const inline = /^\(\?([imsux]+)\)/u.exec(source)
  if (inline !== null) {
    source = source.slice(inline[0].length)
    for (const flag of inline[1] as string) if ('ims'.includes(flag) && !flags.includes(flag)) flags += flag
  }
  try {
    return new RegExp(source, `${flags}u`)
  } catch {
    return new RegExp(source, flags)
  }
}

function jsonLine(type: string, data: object): string {
  return `${JSON.stringify({ type, data })}\n`
}

async function search(fs: ShellFileSystem, files: readonly Found[], regex: RegExp): Promise<{ stdout: string; matches: number }> {
  let stdout = ''
  let matches = 0
  for (const file of files) {
    let text: string
    try {
      text = await fs.readText(file.absolute)
    } catch {
      continue
    }
    // ripgrep skips a file that holds a NUL byte unless asked to search binary data.
    if (text.includes('\u0000')) continue
    const lines = text.split('\n')
    if (lines.at(-1) === '') lines.pop()
    let offset = 0
    let fileMatches = 0
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index] as string
      regex.lastIndex = 0
      const submatches: { match: { text: string }; start: number; end: number }[] = []
      for (let found = regex.exec(line); found !== null; found = regex.exec(line)) {
        submatches.push({ match: { text: found[0] }, start: found.index, end: found.index + found[0].length })
        if (found[0] === '') regex.lastIndex++
      }
      if (submatches.length > 0) {
        if (fileMatches === 0) stdout += jsonLine('begin', { path: { text: file.printed } })
        fileMatches++
        stdout += jsonLine('match', {
          path: { text: file.printed },
          lines: { text: index < lines.length - 1 || text.endsWith('\n') ? `${line}\n` : line },
          line_number: index + 1,
          absolute_offset: offset,
          submatches,
        })
      }
      offset += line.length + 1
    }
    if (fileMatches > 0) {
      stdout += jsonLine('end', { path: { text: file.printed }, binary_offset: null, stats: { matched_lines: fileMatches } })
      matches += fileMatches
    }
  }
  return { stdout: `${stdout}${jsonLine('summary', { stats: { matched_lines: matches } })}`, matches }
}

/**
 * Run one supported invocation.
 * @param invocation - The parsed arguments.
 * @param cwd - Directory relative paths resolve against.
 * @param fs - The filesystem to search.
 * @returns ripgrep's exit status and output.
 */
async function runRipgrep(invocation: Invocation, cwd: string, fs: ShellFileSystem): Promise<VirtualExecutableExit> {
  let regex: RegExp | undefined
  if (invocation.pattern !== undefined) {
    try {
      regex = compilePattern(invocation.pattern)
    } catch (error) {
      return exit(2, '', `rg: regex parse error:\n    ${invocation.pattern}\nerror: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
  const { found, errors } = await collect(fs, cwd, invocation)
  if (invocation.sortModified) {
    found.sort((left, right) => left.mtimeMs - right.mtimeMs || left.printed.localeCompare(right.printed))
  }
  const stderr = errors.join('')
  if (regex === undefined) {
    const stdout = found.map(file => `${file.printed}\n`).join('')
    return exit(found.length > 0 ? 0 : errors.length > 0 ? 2 : 1, stdout, stderr)
  }
  const result = await search(fs, found, regex)
  return exit(result.matches > 0 ? 0 : errors.length > 0 ? 2 : 1, result.stdout, stderr)
}

/** Virtual executable answering the search tools' ripgrep invocations. */
export const RIPGREP_EXECUTABLE: VirtualExecutable = {
  name: 'rg',
  async prepare(args, { cwd, filesystem }): Promise<VirtualExecutablePreparation> {
    const invocation = parse(args)
    if (invocation !== undefined) return await runRipgrep(invocation, cwd, filesystem)
    return {
      kind: 'delegate',
      argv: ['rg', ...args.filter(argument => argument !== '--no-config')],
      filesystem,
      missingExecutable: exit(127, '', 'rg: command not found\n'),
    }
  },
  runSync() {
    return { kind: 'asynchronous' }
  },
}
