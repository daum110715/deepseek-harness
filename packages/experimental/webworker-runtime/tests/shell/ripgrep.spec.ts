/** The Worker's `rg` answers the `glob` and `grep` tools' argv the way ripgrep does. */
import { beforeEach, expect, it } from 'vitest'
import { MemoryVfs } from '../../src/storage/memory.ts'
import { setActiveVfs } from '../../src/storage/active.ts'
import { spawn } from '../../src/node/builtin_modules/implemented/child_process.ts'

const ROOT = '/dsh/workspace/demo'
// What `@vscode/ripgrep` reports in the Worker, and what the search tools spawn.
const RG = '/dsh/bin/rg'
const VCS = ['.git', 'node_modules'].flatMap(name => [`--glob=!**/${name}`, `--glob=!**/${name}/**`])

beforeEach(() => {
  const vfs = new MemoryVfs()
  const files: Record<string, string> = {
    'a.md': 'alpha\n',
    'notes/b.md': 'alpha\ngamma\n',
    'notes/deep/c.md': 'gamma',
    'src/main.ts': 'const gamma = 1\n',
    '.hidden/h.md': 'gamma\n',
    '.git/HEAD': 'gamma\n',
    'node_modules/x/index.md': 'gamma\n',
    '.gitignore': 'build/\nnode_modules\n',
    'build/out.md': 'gamma\n',
  }
  for (const [path, text] of Object.entries(files)) {
    const absolute = `${ROOT}/${path}`
    vfs.mkdirSync(absolute.slice(0, absolute.lastIndexOf('/')), { recursive: true })
    vfs.writeFileSync(absolute, text)
  }
  setActiveVfs(vfs)
})

async function rg(args: readonly string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(RG, ['--no-config', ...args], { cwd: ROOT })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk: unknown) => { stdout += String(chunk) })
  child.stderr?.on('data', (chunk: unknown) => { stderr += String(chunk) })
  const code = await new Promise<number | null>((settle) => { child.on('close', (value: unknown) => { settle(value as number | null) }) })
  return { code, stdout, stderr }
}

async function glob(pattern: string, extra: readonly string[] = []): Promise<string[]> {
  const result = await rg(['--files', ...extra, `--glob=${pattern}`, '--sort=modified', '--no-ignore', '--hidden', ...VCS])
  return result.stdout.split('\n').filter(Boolean).sort()
}

function matches(stdout: string): string[] {
  return stdout.split('\n').filter(Boolean).map(line => JSON.parse(line) as { type: string; data: { path: { text: string }; line_number: number } })
    .filter(record => record.type === 'match').map(record => `${record.data.path.text}:${String(record.data.line_number)}`)
}

it('lists files for glob with ripgrep glob rules and the tool exclusions', async () => {
  expect(await glob('*.md')).toEqual(['.hidden/h.md', 'a.md', 'build/out.md', 'notes/b.md', 'notes/deep/c.md'])
  expect(await glob('**/*.md')).toContain('a.md')
  expect(await glob('notes/**/*.md')).toEqual(['notes/b.md', 'notes/deep/c.md'])
  expect(await glob('*')).not.toContain('.git/HEAD')
  // The directory-pruning pair glob adds for a pattern with directories.
  expect(await glob('notes/*.md', ['--glob=!**', '--glob={notes}/'])).toEqual(['notes/b.md'])
})

it('searches for grep as rg --json, skipping hidden and ignored files', async () => {
  const all = await rg(['--json', '--regexp=gamma'])
  expect(all.code).toBe(0)
  expect(matches(all.stdout).sort()).toEqual(['notes/b.md:2', 'notes/deep/c.md:1', 'src/main.ts:1'])
  const scoped = await rg(['--json', '--regexp=gam+a', '--glob=*.md', '--', 'notes'])
  expect(matches(scoped.stdout)).toEqual(['notes/b.md:2', 'notes/deep/c.md:1'])
})

it('reports no match, a bad pattern, and a missing path with ripgrep statuses', async () => {
  expect((await rg(['--json', '--regexp=absent'])).code).toBe(1)
  const invalid = await rg(['--json', '--regexp=(unclosed'])
  expect(invalid.code).toBe(2)
  expect(invalid.stderr).toContain('regex parse error')
  expect((await rg(['--json', '--regexp=gamma', '--', 'missing'])).code).toBe(2)
})
