/**
 * The shell's `git`: the common porcelain over isomorphic-git, acting on whatever
 * filesystem the run was given, so a confined run keeps its grants. Network
 * commands go through `GIT_CORS_PROXY` when set, because most Git hosts refuse
 * browser requests; `GIT_TOKEN` authenticates them.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/commands/git
 */

import { createTwoFilesPatch } from 'diff'
import * as git from 'isomorphic-git'
import http from 'isomorphic-git/http/web'
import { defineCommand } from 'just-bash/browser'
import type { CommandContext, IFileSystem } from 'just-bash/browser'

interface GitFailure extends Error {
  code?: string
}

function fail(code: string, message: string): GitFailure {
  const error: GitFailure = new Error(message)
  error.code = code
  return error
}

/** Filesystem errors carry `code` already; isomorphic-git branches on it. */
function statOf(stats: Awaited<ReturnType<IFileSystem['stat']>>): Record<string, unknown> {
  const mtimeMs = stats.mtime.getTime()
  return {
    type: stats.isDirectory ? 'dir' : 'file',
    mode: stats.isDirectory ? 0o40755 : 0o100000 | stats.mode,
    size: stats.size,
    ino: 0,
    mtimeMs,
    ctimeMs: mtimeMs,
    uid: 1,
    gid: 1,
    dev: 1,
    isFile: () => !stats.isDirectory,
    isDirectory: () => stats.isDirectory,
    isSymbolicLink: () => false,
  }
}

/** The promise-style filesystem client isomorphic-git expects. */
function clientOf(fs: IFileSystem): git.PromiseFsClient {
  return {
    promises: {
      readFile: async (path: string, options?: { encoding?: string } | string) => {
        const encoding = typeof options === 'string' ? options : options?.encoding
        return encoding === 'utf8' ? await fs.readFile(path) : await fs.readFileBuffer(path)
      },
      writeFile: async (path: string, data: string | Uint8Array) => { await fs.writeFile(path, data) },
      unlink: async (path: string) => { await fs.rm(path) },
      readdir: async (path: string) => await fs.readdir(path),
      mkdir: async (path: string) => { await fs.mkdir(path) },
      rmdir: async (path: string) => { await fs.rm(path, { recursive: true }) },
      stat: async (path: string) => statOf(await fs.stat(path)),
      lstat: async (path: string) => statOf(await fs.lstat(path)),
      readlink: async (path: string) => await fs.readlink(path),
      symlink: async (target: string, path: string) => { await fs.symlink(target, path) },
      chmod: async (path: string, mode: number) => { await fs.chmod(path, mode) },
    },
  }
}

/** One run's parsed flags and positional arguments. */
class Arguments {
  readonly positional: string[] = []
  private readonly flags = new Map<string, string | true>()

  constructor(args: readonly string[], valueFlags: readonly string[] = []) {
    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index] as string
      if (argument === '--') {
        this.positional.push(...args.slice(index + 1))
        break
      }
      if (!argument.startsWith('-') || argument === '-') {
        this.positional.push(argument)
        continue
      }
      if (/^-[a-zA-Z]{2,}$/u.test(argument)) {
        // A short cluster such as `-qm message`: the first value flag takes the rest of the cluster or the next word.
        for (let letter = 1; letter < argument.length; letter += 1) {
          const flag = `-${argument[letter] as string}`
          if (!valueFlags.includes(flag)) {
            this.flags.set(flag, true)
            continue
          }
          const attached = argument.slice(letter + 1)
          if (attached === '') index += 1
          this.flags.set(flag, attached === '' ? args[index] ?? '' : attached)
          break
        }
        continue
      }
      const equals = argument.indexOf('=')
      if (equals !== -1) this.flags.set(argument.slice(0, equals), argument.slice(equals + 1))
      else if (valueFlags.includes(argument)) {
        index += 1
        this.flags.set(argument, args[index] ?? '')
      } else this.flags.set(argument, true)
    }
  }

  has(...names: readonly string[]): boolean {
    return names.some(name => this.flags.has(name))
  }

  value(...names: readonly string[]): string | undefined {
    for (const name of names) {
      const value = this.flags.get(name)
      if (typeof value === 'string') return value
    }
    return undefined
  }
}

/** Everything a subcommand works with. */
interface Run {
  readonly fs: git.PromiseFsClient
  readonly raw: IFileSystem
  readonly cwd: string
  readonly env: Map<string, string>
  dir: string
  out: string
}

const STATUS_WORDS: Readonly<Record<string, string>> = { M: 'modified', A: 'new file', D: 'deleted' }

type StatusRow = [string, number, number, number]

function shortStatus([, head, workdir, stage]: StatusRow): string {
  if (head === 0 && stage === 0) return '??'
  const staged = head === 0 && stage !== 0 ? 'A' : stage === 0 ? 'D' : stage === 1 ? ' ' : 'M'
  const unstaged = workdir === 0 ? 'D' : (stage === 2 && workdir === 2) || stage === 1 && workdir === 1 ? ' ' : stage === 0 ? ' ' : 'M'
  return `${staged}${unstaged}`
}

async function statusRows(run: Run, filepaths?: readonly string[]): Promise<StatusRow[]> {
  const rows = await git.statusMatrix({ fs: run.fs, dir: run.dir, ...filepaths === undefined || filepaths.length === 0 ? {} : { filepaths: [...filepaths] } })
  return rows.filter(([, head, workdir, stage]) => !(head === 1 && workdir === 1 && stage === 1))
}

function relativeToRoot(run: Run, path: string): string {
  const absolute = run.raw.resolvePath(run.cwd, path)
  if (absolute === run.dir) return '.'
  return absolute.startsWith(`${run.dir}/`) ? absolute.slice(run.dir.length + 1) : path
}

async function author(run: Run): Promise<{ name: string; email: string }> {
  const name = run.env.get('GIT_AUTHOR_NAME') ?? await git.getConfig({ fs: run.fs, dir: run.dir, path: 'user.name' }) as string | undefined
  const email = run.env.get('GIT_AUTHOR_EMAIL') ?? await git.getConfig({ fs: run.fs, dir: run.dir, path: 'user.email' }) as string | undefined
  return { name: name ?? 'dsh', email: email ?? 'dsh@localhost' }
}

async function headBlob(run: Run, filepath: string, ref = 'HEAD'): Promise<string | undefined> {
  try {
    const oid = await git.resolveRef({ fs: run.fs, dir: run.dir, ref })
    const { blob } = await git.readBlob({ fs: run.fs, dir: run.dir, oid, filepath })
    return new TextDecoder().decode(blob)
  } catch (error) {
    if ((error as GitFailure).code === 'NotFoundError') return undefined
    throw error
  }
}

async function stageBlobs(run: Run): Promise<Map<string, string>> {
  const oids = new Map<string, string>()
  await git.walk({
    fs: run.fs,
    dir: run.dir,
    trees: [git.STAGE()],
    map: async (filepath, [entry]) => {
      if (entry !== null && await entry?.type() === 'blob') {
        const oid = await entry?.oid()
        if (oid !== undefined) oids.set(filepath, oid)
      }
      return undefined
    },
  })
  return oids
}

async function diff(run: Run, args: Arguments): Promise<void> {
  const cached = args.has('--cached', '--staged')
  const filters = args.positional.map(path => relativeToRoot(run, path))
  const stage = await stageBlobs(run)
  const stageText = async (filepath: string): Promise<string | undefined> => {
    const oid = stage.get(filepath)
    if (oid === undefined) return undefined
    const { blob } = await git.readBlob({ fs: run.fs, dir: run.dir, oid })
    return new TextDecoder().decode(blob)
  }
  for (const [filepath, head, workdir, staged] of await statusRows(run)) {
    if (filters.length > 0 && !filters.includes('.') && !filters.some(filter => filepath === filter || filepath.startsWith(`${filter}/`))) continue
    if (!cached && head === 0 && staged === 0) continue
    const before = cached ? (head === 0 ? undefined : await headBlob(run, filepath)) : await stageText(filepath) ?? await headBlob(run, filepath)
    const after = cached
      ? await stageText(filepath)
      : workdir === 0 ? undefined : await run.raw.readFile(`${run.dir}/${filepath}`)
    if (before === after) continue
    run.out += `diff --git a/${filepath} b/${filepath}\n`
    run.out += createTwoFilesPatch(
      before === undefined ? '/dev/null' : `a/${filepath}`,
      after === undefined ? '/dev/null' : `b/${filepath}`,
      before ?? '',
      after ?? '',
    ).split('\n').slice(1).join('\n')
  }
}

async function status(run: Run, args: Arguments): Promise<void> {
  const rows = await statusRows(run)
  if (args.has('-s', '--short', '--porcelain')) {
    for (const row of rows) run.out += `${shortStatus(row)} ${row[0]}\n`
    return
  }
  const branch = await git.currentBranch({ fs: run.fs, dir: run.dir })
  run.out += `On branch ${branch === undefined || branch === null ? '(detached)' : branch}\n`
  if (rows.length === 0) {
    run.out += 'nothing to commit, working tree clean\n'
    return
  }
  const sections: Record<string, string[]> = { staged: [], unstaged: [], untracked: [] }
  for (const row of rows) {
    const [first, second] = shortStatus(row)
    if (first === '?') sections.untracked?.push(row[0])
    if (first !== undefined && first !== ' ' && first !== '?') sections.staged?.push(`${STATUS_WORDS[first] ?? 'modified'}: ${row[0]}`)
    if (second !== undefined && second !== ' ' && second !== '?') sections.unstaged?.push(`${STATUS_WORDS[second] ?? 'modified'}: ${row[0]}`)
  }
  const titles: Record<string, string> = { staged: 'Changes to be committed:', unstaged: 'Changes not staged for commit:', untracked: 'Untracked files:' }
  for (const [key, lines] of Object.entries(sections)) {
    if (lines.length === 0) continue
    run.out += `${titles[key] ?? key}\n${lines.map(line => `\t${line}\n`).join('')}`
  }
}

async function add(run: Run, args: Arguments): Promise<void> {
  const everything = args.has('-A', '--all') || args.positional.includes('.')
  const filters = args.positional.map(path => relativeToRoot(run, path))
  for (const [filepath, , workdir] of await statusRows(run)) {
    if (!everything && !filters.some(filter => filepath === filter || filepath.startsWith(`${filter}/`))) continue
    if (workdir === 0) await git.remove({ fs: run.fs, dir: run.dir, filepath })
    else await git.add({ fs: run.fs, dir: run.dir, filepath })
  }
}

async function commit(run: Run, args: Arguments): Promise<void> {
  const message = args.value('-m', '--message')
  if (message === undefined) throw fail('EUSAGE', 'git commit: this shell needs -m <message>')
  if (args.has('-a', '--all')) {
    for (const [filepath, head, workdir] of await statusRows(run)) {
      if (head === 0) continue
      if (workdir === 0) await git.remove({ fs: run.fs, dir: run.dir, filepath })
      else await git.add({ fs: run.fs, dir: run.dir, filepath })
    }
  }
  const oid = await git.commit({ fs: run.fs, dir: run.dir, message, author: await author(run) })
  const branch = await git.currentBranch({ fs: run.fs, dir: run.dir })
  run.out += `[${branch === undefined || branch === null ? 'detached' : branch} ${oid.slice(0, 7)}] ${message.split('\n')[0] ?? ''}\n`
}

async function log(run: Run, args: Arguments, rest: readonly string[]): Promise<void> {
  const short = rest.find(argument => /^-\d+$/u.test(argument))
  const depth = Number(args.value('-n', '--max-count') ?? short?.slice(1) ?? 0)
  const entries = await git.log({ fs: run.fs, dir: run.dir, ...depth > 0 ? { depth } : {} })
  for (const { oid, commit: entry } of entries) {
    if (args.has('--oneline')) {
      run.out += `${oid.slice(0, 7)} ${entry.message.split('\n')[0] ?? ''}\n`
      continue
    }
    run.out += `commit ${oid}\nAuthor: ${entry.author.name} <${entry.author.email}>\nDate:   ${new Date(entry.author.timestamp * 1000).toUTCString()}\n\n`
    run.out += `${entry.message.trimEnd().split('\n').map(line => `    ${line}`).join('\n')}\n\n`
  }
}

async function branch(run: Run, args: Arguments): Promise<void> {
  const remove = args.value('-d', '-D')
  if (remove !== undefined) {
    await git.deleteBranch({ fs: run.fs, dir: run.dir, ref: remove })
    return
  }
  const [name] = args.positional
  if (name !== undefined) {
    await git.branch({ fs: run.fs, dir: run.dir, ref: name })
    return
  }
  const current = await git.currentBranch({ fs: run.fs, dir: run.dir })
  for (const entry of await git.listBranches({ fs: run.fs, dir: run.dir })) {
    run.out += `${entry === current ? '*' : ' '} ${entry}\n`
  }
}

async function checkout(run: Run, args: Arguments, rest: readonly string[]): Promise<void> {
  const created = args.value('-b', '-c')
  if (created !== undefined) {
    await git.branch({ fs: run.fs, dir: run.dir, ref: created, checkout: true })
    return
  }
  const separator = rest.indexOf('--')
  if (separator !== -1) {
    const filepaths = rest.slice(separator + 1).map(path => relativeToRoot(run, path))
    await git.checkout({ fs: run.fs, dir: run.dir, filepaths, force: true })
    return
  }
  const [ref] = args.positional
  if (ref === undefined) throw fail('EUSAGE', 'git checkout: name a branch, or use -- <paths>')
  await git.checkout({ fs: run.fs, dir: run.dir, ref, force: args.has('-f', '--force') })
}

async function reset(run: Run, args: Arguments): Promise<void> {
  if (args.has('--hard')) {
    const branchName = await git.currentBranch({ fs: run.fs, dir: run.dir })
    const oid = await git.resolveRef({ fs: run.fs, dir: run.dir, ref: args.positional[0] ?? 'HEAD' })
    if (typeof branchName === 'string') await git.writeRef({ fs: run.fs, dir: run.dir, ref: `refs/heads/${branchName}`, value: oid, force: true })
    await git.checkout({ fs: run.fs, dir: run.dir, ...typeof branchName === 'string' ? { ref: branchName } : { ref: oid }, force: true })
    return
  }
  for (const [filepath] of await statusRows(run)) await git.resetIndex({ fs: run.fs, dir: run.dir, filepath })
}

function networkOptions(run: Run): Record<string, unknown> {
  const proxy = run.env.get('GIT_CORS_PROXY')
  const token = run.env.get('GIT_TOKEN')
  return {
    http,
    ...proxy === undefined ? {} : { corsProxy: proxy },
    ...token === undefined ? {} : { onAuth: () => ({ username: token, password: 'x-oauth-basic' }) },
  }
}

async function runSubcommand(run: Run, command: string, rest: readonly string[]): Promise<void> {
  const client = { fs: run.fs, dir: run.dir }
  const args = new Arguments(rest, ['-m', '--message', '-n', '--max-count', '-b', '-c', '-d', '-D', '--branch', '--depth'])
  switch (command) {
    case 'status': return await status(run, args)
    case 'add': return await add(run, args)
    case 'commit': return await commit(run, args)
    case 'log': return await log(run, args, rest)
    case 'diff': return await diff(run, args)
    case 'branch': return await branch(run, args)
    case 'checkout':
    case 'switch': return await checkout(run, args, rest)
    case 'reset': return await reset(run, args)
    case 'rm': {
      for (const path of args.positional) {
        const filepath = relativeToRoot(run, path)
        await git.remove({ ...client, filepath })
        if (!args.has('--cached')) await run.raw.rm(`${run.dir}/${filepath}`, { force: true })
      }
      return undefined
    }
    case 'merge': {
      const [theirs] = args.positional
      if (theirs === undefined) throw fail('EUSAGE', 'git merge: name a branch')
      const result = await git.merge({ ...client, theirs, author: await author(run) })
      if (result.alreadyMerged === true) run.out += 'Already up to date.\n'
      else if (result.oid !== undefined) {
        await git.checkout({ ...client, ref: await git.currentBranch(client) as string, force: true })
        run.out += `Merged ${theirs} (${result.oid.slice(0, 7)})\n`
      }
      return undefined
    }
    case 'tag': {
      const [name] = args.positional
      if (name !== undefined) await git.tag({ ...client, ref: name })
      else for (const entry of await git.listTags(client)) run.out += `${entry}\n`
      return undefined
    }
    case 'rev-parse': {
      if (args.has('--show-toplevel')) run.out += `${run.dir}\n`
      else if (args.has('--git-dir')) run.out += `${run.dir}/.git\n`
      else if (args.has('--is-inside-work-tree')) run.out += 'true\n'
      else if (args.has('--abbrev-ref')) run.out += `${await git.currentBranch(client) as string}\n`
      else run.out += `${await git.resolveRef({ ...client, ref: args.positional[0] ?? 'HEAD' })}\n`
      return undefined
    }
    case 'config': {
      const [path, value] = args.positional
      if (path === undefined) throw fail('EUSAGE', 'git config: name a key')
      if (value !== undefined) await git.setConfig({ ...client, path, value })
      else {
        const current = await git.getConfig({ ...client, path }) as string | undefined
        if (current === undefined) throw fail('ECONFIG', '')
        run.out += `${current}\n`
      }
      return undefined
    }
    case 'remote': {
      const [action, name, url] = args.positional
      if (action === 'add' && name !== undefined && url !== undefined) await git.addRemote({ ...client, remote: name, url })
      else if (action === 'remove' && name !== undefined) await git.deleteRemote({ ...client, remote: name })
      else for (const remote of await git.listRemotes(client)) run.out += args.has('-v') ? `${remote.remote}\t${remote.url}\n` : `${remote.remote}\n`
      return undefined
    }
    case 'fetch': {
      await git.fetch({ ...client, ...networkOptions(run), ...args.positional[0] === undefined ? {} : { remote: args.positional[0] } } as Parameters<typeof git.fetch>[0])
      return undefined
    }
    case 'pull': {
      await git.pull({ ...client, ...networkOptions(run), author: await author(run), singleBranch: true } as Parameters<typeof git.pull>[0])
      return undefined
    }
    case 'push': {
      const [remote, ref] = args.positional
      const result = await git.push({ ...client, ...networkOptions(run), ...remote === undefined ? {} : { remote }, ...ref === undefined ? {} : { ref } } as Parameters<typeof git.push>[0])
      run.out += result.ok ? 'Pushed.\n' : `Push failed: ${String(result.error)}\n`
      return undefined
    }
    default:
      throw fail('EUSAGE', `git: '${command}' is not available in this shell. Available: init clone status add rm commit log diff branch checkout switch reset merge tag rev-parse config remote fetch pull push`)
  }
}

/** The `git` command the interpreter registers. */
export const gitCommand = defineCommand('git', async (args: string[], context: CommandContext) => {
  const fs = clientOf(context.fs)
  const run: Run = { fs, raw: context.fs, cwd: context.cwd, env: context.env, dir: context.cwd, out: '' }
  const directory = args[0] === '-C' ? args[1] : undefined
  const rest = directory === undefined ? args : args.slice(2)
  if (directory !== undefined) run.dir = context.fs.resolvePath(context.cwd, directory)
  const [command, ...commandArgs] = rest
  try {
    switch (command) {
      case undefined:
      case '--version':
        run.out += 'git version isomorphic-git\n'
        break
      case 'init': {
        const parsed = new Arguments(commandArgs, ['-b', '--initial-branch'])
        const target = parsed.positional[0]
        if (target !== undefined) run.dir = context.fs.resolvePath(run.dir, target)
        await context.fs.mkdir(run.dir, { recursive: true })
        await git.init({ fs, dir: run.dir, defaultBranch: parsed.value('-b', '--initial-branch') ?? 'main' })
        run.out += `Initialized empty Git repository in ${run.dir}/.git/\n`
        break
      }
      case 'clone': {
        const parsed = new Arguments(commandArgs, ['--branch', '-b', '--depth'])
        const [url, target] = parsed.positional
        if (url === undefined) throw fail('EUSAGE', 'git clone: name a repository')
        const name = target ?? url.replace(/\/$/u, '').split('/').pop()?.replace(/\.git$/u, '') ?? 'repo'
        const dir = context.fs.resolvePath(run.dir, name)
        await context.fs.mkdir(dir, { recursive: true })
        const depth = parsed.value('--depth')
        const ref = parsed.value('--branch', '-b')
        await git.clone({
          ...networkOptions(run), fs, dir, url, singleBranch: true,
          ...depth === undefined ? {} : { depth: Number(depth) },
          ...ref === undefined ? {} : { ref },
        } as Parameters<typeof git.clone>[0])
        run.out += `Cloned into '${name}'\n`
        break
      }
      default: {
        run.dir = await git.findRoot({ fs, filepath: run.dir })
        await runSubcommand(run, command, commandArgs)
      }
    }
    return { stdout: run.out, stderr: '', exitCode: 0 }
  } catch (error) {
    const failure = error as GitFailure
    if (failure.code === 'NotFoundError' && command !== 'clone') {
      return { stdout: run.out, stderr: `fatal: ${failure.message}\n`, exitCode: 128 }
    }
    return { stdout: run.out, stderr: failure.message === '' ? '' : `git: ${failure.message}\n`, exitCode: 1 }
  }
})
