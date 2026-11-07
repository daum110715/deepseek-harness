/** The Worker terminal behaves as the persistent bash tool and the sidebar terminal expect of a PTY. */
import { beforeEach, expect, it } from 'vitest'
import { MemoryVfs } from '../../src/storage/memory.ts'
import { setActiveVfs } from '../../src/storage/active.ts'
import { spawn } from '../../src/node/external_packages/node-pty.ts'
import type { WorkerPty } from '../../src/shell/terminal.ts'
import { signalProcess } from '../../src/node/process-table.ts'

const ROOT = '/dsh/workspace/demo'
// What terminal-bash sets: a fixed prompt after an OSC 133 status marker.
const ENV = { HOME: ROOT, PS1: 'dsh> ', PROMPT_COMMAND: 'printf "\\033]133;D;%s\\007" "$?"; PS1=\'dsh> \'' }
const MARK = (status: number): string => `\u001b]133;D;${String(status)}\u0007dsh> `

let vfs: MemoryVfs
beforeEach(() => {
  vfs = new MemoryVfs()
  vfs.mkdirSync(`${ROOT}/sub`, { recursive: true })
  setActiveVfs(vfs)
})

function open(argv: readonly string[] = ['/bin/bash']): { pty: WorkerPty; output: () => string; next: (status?: number) => Promise<string> } {
  const pty = spawn(argv[0] as string, argv.slice(1), { name: 'dumb', cwd: ROOT, env: ENV, cols: 80, rows: 24 })
  let output = ''
  let read = 0
  const waiters: (() => void)[] = []
  pty.onData((data) => { output += data; for (const wake of waiters.splice(0)) wake() })
  // Resolve with the output up to the next prompt carrying this status.
  const next = async (status = 0): Promise<string> => {
    for (;;) {
      const at = output.indexOf(MARK(status), read)
      if (at >= 0) {
        const chunk = output.slice(read, at)
        read = at + MARK(status).length
        return chunk
      }
      await new Promise<void>((wake) => { waiters.push(wake) })
    }
  }
  return { pty, output: () => output, next }
}

it('prompts with the status marker, echoes input, and keeps the directory and variables', async () => {
  const { pty, next } = open()
  expect(await next()).toBe('')
  pty.write('echo hi\r')
  expect(await next()).toBe('echo hi\r\nhi\r\n')
  pty.write('cd sub && export NAME=web\r')
  await next()
  pty.write('pwd; echo $NAME\r')
  expect(await next()).toBe(`pwd; echo $NAME\r\n${ROOT}/sub\r\nweb\r\n`)
  pty.write('false\r')
  await next(1)
  pty.kill('SIGTERM')
})

it('collects a multi-line command before running it', async () => {
  const { pty, next } = open()
  await next()
  pty.write('if true; then\necho yes\nfi\r')
  expect(await next()).toContain('yes\r\n')
  pty.write('cat <<EOF\r')
  pty.write('one\r')
  pty.write('EOF\r')
  expect(await next()).toContain('one\r\n')
  pty.kill('SIGTERM')
})

it('lists the shell in /proc as its own foreground group and withdraws it on exit', async () => {
  const { pty, next } = open()
  await next()
  const stat = vfs.readFileSync(`/proc/${String(pty.pid)}/stat`, { encoding: 'utf8' }) as string
  const fields = stat.slice(stat.indexOf(')') + 2).trim().split(' ')
  expect(fields[2]).toBe(String(pty.pid))
  expect(fields[5]).toBe(String(pty.pid))
  expect(fields[19]).toBeDefined()
  const exited = new Promise<{ exitCode: number; signal?: number }>((settle) => { pty.onExit(settle) })
  // What the Worker's process.kill does for the subprocess service's group signal.
  expect(signalProcess(-pty.pid, 'SIGTERM')).toBe(true)
  expect(await exited).toEqual({ exitCode: 0, signal: 15 })
  expect(vfs.existsSync(`/proc/${String(pty.pid)}`)).toBe(false)
})

it('ends on exit with its status', async () => {
  const { pty, next } = open()
  await next()
  const exited = new Promise<{ exitCode: number; signal?: number }>((settle) => { pty.onExit(settle) })
  pty.write('exit 3\r')
  expect(await exited).toEqual({ exitCode: 3 })
})

it('runs a shell the sandbox wrapped in landlock-run, confined to its paths', async () => {
  const { pty, next } = open(['/dsh/bin/landlock-run', '--rw', ROOT, '--', '/bin/bash'])
  await next()
  pty.write('echo inside > note.txt && cat note.txt\r')
  expect(await next()).toContain('inside\r\n')
  pty.write('echo outside > /dsh/escape.txt\r')
  const denied = await Promise.race([next(1), next(2)])
  expect(denied).toContain('escape.txt')
  expect(vfs.existsSync('/dsh/escape.txt')).toBe(false)
  pty.kill('SIGTERM')
})
