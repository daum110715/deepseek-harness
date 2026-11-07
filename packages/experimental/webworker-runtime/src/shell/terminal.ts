/**
 * The Worker's pseudo-terminal: what `node-pty` spawns in a browser.
 *
 * A browser has no terminal driver, so this module plays both halves. As the
 * line discipline it echoes input, handles erase and Ctrl-C, and turns output
 * newlines into CRLF. As the interactive shell it collects complete command
 * lines, runs each one in its own shell process (`./process/host.ts`, which
 * the session can preempt), carries the working directory and variables from
 * one line to the next, runs `PROMPT_COMMAND` with the line's status, and
 * prints `PS1`. Shell functions and aliases end with the line that defined them.
 *
 * The shell is listed in a minimal `/proc` (`/proc/<pid>/stat`), so the
 * subprocess service finds it as the terminal's foreground process group.
 * `process.kill` reaches it through the Worker's process table: SIGINT stops the
 * running line, and SIGTERM, SIGHUP, or SIGKILL end the session.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/terminal
 */
import { basename } from '../module-system/posix-path.ts'
import { registerProcess, releaseProcess } from '../node/process-table.ts'
import { requireActiveVfs } from '../storage/active.ts'
import { DSH_ROOT } from '../storage/paths.ts'
import { runShellCommand } from './interpret.ts'
import { hostFileSystem } from './fs-access.ts'
import { startProcess } from './process/host.ts'
import type { RunningProcess } from './process/host.ts'
import { virtualExecutable } from './process/virtual-executables.ts'
import type { ShellFileSystem } from './types.ts'

/** Spawn options, as `node-pty` accepts them. */
export interface WorkerPtyOptions {
  name?: string | undefined
  cols?: number | undefined
  rows?: number | undefined
  cwd?: string | undefined
  env?: Record<string, string | undefined> | undefined
}

/** A `node-pty` event subscription. */
export interface Disposable {
  dispose(): void
}

type Listener<T> = (value: T) => void

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash'])
const SIGNAL_NUMBERS: Readonly<Record<string, number>> = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 }
/** How long a stopped line may take to reach its next command boundary before its process is destroyed. */
const INTERRUPT_GRACE_MS = 500
/** Variables the interpreter owns; a session never hands them back to it. */
const SHELL_OWNED = new Set(['?', 'SHELLOPTS', 'BASHOPTS', 'OPTIND', 'IFS', 'OSTYPE', 'MACHTYPE', 'HOSTTYPE'])

let processStarts = 0

/** Write the shell's `/proc/<pid>/stat`, the fields the subprocess service reads. */
function publishProc(pid: number, started: number): void {
  const vfs = requireActiveVfs()
  vfs.mkdirSync(`/proc/${String(pid)}`, { recursive: true })
  // state, ppid, pgrp, session, tty_nr, tpgid, then flags through itrealvalue, then starttime.
  const fields = ['S', '1', String(pid), String(pid), String(34816 + pid), String(pid), ...Array<string>(13).fill('0'), String(started)]
  vfs.writeFileSync(`/proc/${String(pid)}/stat`, `${String(pid)} (bash) ${fields.join(' ')}\n`)
}

function withdrawProc(pid: number): void {
  try {
    requireActiveVfs().rmSync(`/proc/${String(pid)}`, { recursive: true, force: true })
  } catch {
    // Nothing published, nothing to withdraw.
  }
}

/** Terminal output: newlines become CRLF, as the driver's ONLCR does. */
function toTerminal(text: string): string {
  return text.replace(/\r?\n/gu, '\r\n')
}

/**
 * Whether the collected lines still need more input, as bash decides before it
 * runs anything: an open quote or compound command, a trailing operator or
 * backslash, or a here-document whose terminator has not arrived.
 * @param script - The collected lines.
 * @returns true when bash would print PS2 and keep reading.
 */
export function needsMoreInput(script: string): boolean {
  const trimmed = script.replace(/\s+$/u, '')
  if (/(?:\|\||&&|\||\\)$/u.test(trimmed)) return true
  const lines = script.split('\n')
  for (const match of script.matchAll(/<<(-?)\s*(['"]?)([A-Za-z_]\w*)\2/gu)) {
    if (script[match.index - 1] === '<' || script[(match.index) + 2] === '<') continue
    const start = script.slice(0, match.index).split('\n').length
    const strip = match[1] === '-'
    const terminated = lines.slice(start).some(line => (strip ? line.replace(/^\t+/u, '') : line) === match[3])
    if (!terminated) return true
  }
  return false
}

/**
 * Whether a syntax error only says the input ended early.
 * @param stderr - The interpreter's error output.
 * @param script - The script it parsed.
 * @returns true for an unterminated quote or construct at the end of the input.
 */
export function endedEarly(stderr: string, script: string): boolean {
  if (/got EOF|unexpected EOF/u.test(stderr)) return true
  const position = /Parse error at (\d+):(\d+)/u.exec(stderr)
  if (position === null) return false
  const lines = script.replace(/\n$/u, '').split('\n')
  const line = Number(position[1])
  const column = Number(position[2])
  return line >= lines.length && column > (lines.at(-1) ?? '').length
}

/** Expand the prompt escapes bash honors in PS1 and PS2. */
function expandPrompt(prompt: string, env: Readonly<Record<string, string>>, cwd: string): string {
  const home = env.HOME
  const shown = home !== undefined && home !== '' && (cwd === home || cwd.startsWith(`${home}/`)) ? `~${cwd.slice(home.length)}` : cwd
  return prompt.replace(/\\(\[|\]|[uhHwWsv$nae\\]|0[0-7]{2})/gu, (_all, code: string) => {
    switch (code) {
      case '[': case ']': return ''
      case 'u': return env.USER ?? 'user'
      case 'h': return (env.HOSTNAME ?? 'localhost').split('.')[0] ?? 'localhost'
      case 'H': return env.HOSTNAME ?? 'localhost'
      case 'w': return shown
      case 'W': return shown === '~' ? '~' : basename(cwd) || '/'
      case 's': return 'bash'
      case 'v': return '5.2'
      case '$': return '$'
      case 'n': return '\n'
      case 'a': return '\u0007'
      case 'e': return '\u001b'
      case '\\': return '\\'
      default: return String.fromCharCode(Number.parseInt(code, 8))
    }
  })
}

/**
 * One terminal session, with the `IPty` members the subprocess service reads.
 */
export class WorkerPty {
  readonly pid: number
  cols: number
  rows: number
  readonly process: string
  readonly handleFlowControl = false

  private readonly dataListeners = new Set<Listener<string>>()
  private readonly exitListeners = new Set<Listener<{ exitCode: number; signal?: number }>>()
  private readonly queued: string[] = []
  private paused = false
  private env: Record<string, string>
  private cwd: string
  private status = 0
  private line = ''
  private pending = ''
  private input = ''
  private running: RunningProcess | undefined
  private interruptTimer: ReturnType<typeof setTimeout> | undefined
  private exited = false
  private escape = false
  /** True while PROMPT_COMMAND runs; typed keys wait, as they would in bash's input queue. */
  private prompting = false
  /** The filesystem a launcher such as `landlock-run` confined the shell to; the mounted VFS otherwise. */
  private fs: ShellFileSystem | undefined

  constructor(file: string, args: readonly string[], options: WorkerPtyOptions) {
    const entry = registerProcess()
    this.pid = entry.pid
    this.cols = options.cols ?? 80
    this.rows = options.rows ?? 24
    this.process = basename(file)
    this.cwd = options.cwd ?? DSH_ROOT
    this.env = Object.fromEntries(Object.entries(options.env ?? {}).filter(([, value]) => value !== undefined)) as Record<string, string>
    this.env.TERM = options.name ?? this.env.TERM ?? 'xterm-256color'
    this.env.PWD = this.cwd
    this.env.COLUMNS = String(this.cols)
    this.env.LINES = String(this.rows)
    processStarts += 1
    publishProc(this.pid, processStarts)
    entry.process = {
      interrupt: (signal) => {
        // The table records the first signal for an ordinary process; a shell lives on after SIGINT.
        if (signal === 'SIGINT' || signal === 'SIGQUIT') {
          entry.signal = undefined
          this.interruptLine()
          return
        }
        this.end(SIGNAL_NUMBERS[signal ?? 'SIGTERM'] ?? 15)
      },
      destroy: () => { this.end(9) },
    }

    queueMicrotask(() => {
      void this.start([file, ...args]).catch((error: unknown) => {
        this.emit(toTerminal(`${basename(file)}: ${error instanceof Error ? error.message : String(error)}\n`))
        this.end(undefined, 1)
      })
    })
  }

  /** Unwrap launchers the Worker implements (such as the sandbox's `landlock-run`), then start the program. */
  private async start(argv: readonly string[]): Promise<void> {
    let command = argv
    for (let executable = virtualExecutable(command[0] as string); executable !== undefined; executable = virtualExecutable(command[0] as string)) {
      const prepared = await executable.prepare(command.slice(1), { cwd: this.cwd, filesystem: this.fs ?? hostFileSystem() })
      if (prepared.kind === 'exit') {
        this.emit(toTerminal(prepared.stdout + prepared.stderr))
        this.end(undefined, prepared.exitCode)
        return
      }
      command = prepared.argv
      this.fs = prepared.filesystem
    }
    if (this.exited) return
    const program = basename(command[0] as string)
    const args = command.slice(1)
    if (!SHELLS.has(program)) {
      this.runOnce({ argv: [program, ...args] })
    } else if (args[0] === '-c' && args[1] !== undefined) {
      this.runOnce({ script: args[1], argv: [program, ...args] })
    } else {
      this.showPrompt()
    }
  }

  onData(listener: Listener<string>): Disposable {
    this.dataListeners.add(listener)
    return { dispose: () => { this.dataListeners.delete(listener) } }
  }

  onExit(listener: Listener<{ exitCode: number; signal?: number }>): Disposable {
    this.exitListeners.add(listener)
    return { dispose: () => { this.exitListeners.delete(listener) } }
  }

  /**
   * Type into the terminal.
   * @param data - Keys as the terminal sends them: `\r` submits, `\x7f` erases, `\x03` interrupts.
   */
  write(data: string): void {
    if (this.exited) return
    this.input += data
    this.consume()
  }

  resize(cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
    this.env.COLUMNS = String(cols)
    this.env.LINES = String(rows)
  }

  kill(signal = 'SIGHUP'): void {
    if (signal === 'SIGINT') {
      this.interruptLine()
      return
    }
    this.end(SIGNAL_NUMBERS[signal] ?? 1)
  }

  pause(): void {
    this.paused = true
  }

  resume(): void {
    this.paused = false
    for (const chunk of this.queued.splice(0)) this.emit(chunk)
  }

  clear(): void {
    // Nothing is buffered on the driver side.
  }

  private emit(text: string): void {
    if (text === '' || this.exited) return
    if (this.paused) {
      this.queued.push(text)
      return
    }
    for (const listener of this.dataListeners) listener(text)
  }

  /** Read typed keys until a complete command is collected, then run it. */
  private consume(): void {
    while (this.input.length > 0 && this.running === undefined && !this.prompting && !this.exited) {
      const character = this.input[0] as string
      this.input = this.input.slice(1)
      if (this.escape) {
        // Cursor and function keys: ESC [ ... final byte, or ESC O x. Line editing is not offered.
        if (/[@-~]/u.test(character) && character !== '[' && character !== 'O') this.escape = false
        continue
      }
      if (character === '\u001b') {
        this.escape = true
        continue
      }
      if (character === '\r' || character === '\n') {
        // A terminal sends CR for Enter; a pasted CRLF is one line.
        if (character === '\r' && this.input[0] === '\n') this.input = this.input.slice(1)
        this.emit('\r\n')
        this.pending += `${this.line}\n`
        this.line = ''
        // Lines pasted together run together, as bash would read them before the next prompt.
        if (this.input.length > 0 && /[\r\n]/u.test(this.input)) continue
        this.submit()
        continue
      }
      if (character === '\u0003') {
        this.emit('^C\r\n')
        this.line = ''
        this.pending = ''
        this.status = 130
        this.showPrompt()
        continue
      }
      if (character === '\u0004') {
        if (this.line === '' && this.pending === '') this.end(undefined, this.status)
        continue
      }
      if (character === '\u007f' || character === '\b') {
        if (this.line.length > 0) {
          this.line = [...this.line].slice(0, -1).join('')
          this.emit('\b \b')
        }
        continue
      }
      if (character === '\u0015') {
        this.emit('\b \b'.repeat([...this.line].length))
        this.line = ''
        continue
      }
      if (character < ' ' && character !== '\t') continue
      this.line += character
      this.emit(character)
    }
  }

  private submit(): void {
    const script = this.pending
    if (script.trim() === '') {
      this.pending = ''
      this.showPrompt()
      return
    }
    if (needsMoreInput(script)) {
      this.continuation()
      return
    }
    const exit = /^\s*(?:exit|logout)(?:\s+(\d+))?\s*;?\s*$/u.exec(script)
    if (exit !== null) {
      this.end(undefined, exit[1] === undefined ? this.status : Number(exit[1]) & 0xff)
      return
    }
    this.run(script)
  }

  private continuation(): void {
    this.emit(toTerminal(expandPrompt(this.env.PS2 ?? '> ', this.env, this.cwd)))
  }

  /** Run one complete command in its own shell process. */
  private run(script: string): void {
    let stdout = ''
    let stderr = ''
    this.running = startProcess({
      script,
      argv: ['bash', '-c', script],
      cwd: this.cwd,
      env: this.shellEnvironment(),
      stdin: '',
      fs: this.fs,
      onOutput: (stream, text) => {
        if (stream === 'stdout') stdout += text
        else stderr += text
      },
      onExit: (code, env) => {
        this.running = undefined
        if (this.interruptTimer !== undefined) clearTimeout(this.interruptTimer)
        this.interruptTimer = undefined
        if (this.exited) return
        if (code === 2 && stdout === '' && endedEarly(stderr, script)) {
          // bash would have kept reading: nothing ran, and the next line completes the command.
          this.continuation()
          this.consume()
          return
        }
        this.pending = ''
        this.adopt(env)
        this.emit(toTerminal(stdout))
        this.emit(toTerminal(stderr))
        this.status = code
        this.showPrompt()
      },
    })
  }

  /** Run a program or `-c` script as the whole session, then exit with its status. */
  private runOnce(start: { script?: string; argv: readonly string[] }): void {
    this.running = startProcess({
      ...start,
      cwd: this.cwd,
      env: this.shellEnvironment(),
      stdin: '',
      fs: this.fs,
      onOutput: (_stream, text) => { this.emit(toTerminal(text)) },
      onExit: (code) => {
        this.running = undefined
        this.end(undefined, code)
      },
    })
  }

  /** The environment the next line starts with. */
  private shellEnvironment(): Record<string, string> {
    return Object.fromEntries(Object.entries(this.env).filter(([name]) => !SHELL_OWNED.has(name)))
  }

  /** Carry a settled line's directory and variables into the next one. */
  private adopt(env: Record<string, string> | undefined): void {
    if (env === undefined) return
    this.env = Object.fromEntries(Object.entries(env).filter(([name]) => !SHELL_OWNED.has(name)))
    this.env.COLUMNS = String(this.cols)
    this.env.LINES = String(this.rows)
    if (env.PWD !== undefined && env.PWD !== '') this.cwd = env.PWD
  }

  /** Show the next prompt, then go on with any keys typed meanwhile. */
  private showPrompt(): void {
    this.prompting = true
    void this.prompt().finally(() => {
      this.prompting = false
      this.consume()
    })
  }

  /** Run PROMPT_COMMAND with the last status, as bash does before each prompt, then print PS1. */
  private async prompt(): Promise<void> {
    const command = this.env.PROMPT_COMMAND
    if (command !== undefined && command.trim() !== '') {
      try {
        const outcome = await runShellCommand(`(exit ${String(this.status)})\n${command}`, {
          cwd: this.cwd,
          env: this.shellEnvironment(),
          fs: this.fs,
        })
        if (this.exited) return
        this.adopt(outcome.env)
        this.emit(toTerminal(outcome.stdout))
        this.emit(toTerminal(outcome.stderr))
      } catch (error) {
        this.emit(toTerminal(`bash: PROMPT_COMMAND: ${error instanceof Error ? error.message : String(error)}\n`))
      }
    }
    if (this.exited) return
    this.emit(toTerminal(expandPrompt(this.env.PS1 ?? '\\s-\\v\\$ ', this.env, this.cwd)))
  }

  /** Ctrl-C: stop the running line at its next command boundary, then preempt it. */
  private interruptLine(): void {
    const running = this.running
    if (running === undefined) {
      this.write('\u0003')
      return
    }
    this.emit('^C')
    running.interrupt('SIGINT')
    this.interruptTimer ??= setTimeout(() => { running.destroy() }, INTERRUPT_GRACE_MS)
  }

  /** End the session: stop any running line, withdraw the process, and report the exit. */
  private end(signal: number | undefined, exitCode = 128 + (signal ?? 0)): void {
    if (this.exited) return
    const running = this.running
    this.running = undefined
    running?.destroy()
    if (this.interruptTimer !== undefined) clearTimeout(this.interruptTimer)
    this.exited = true
    withdrawProc(this.pid)
    releaseProcess(this.pid)
    const event = signal === undefined ? { exitCode } : { exitCode: 0, signal }
    queueMicrotask(() => {
      for (const listener of this.exitListeners) listener(event)
    })
  }
}

/**
 * Start a terminal session.
 * @param file - Program to run; a shell runs interactively unless given `-c`.
 * @param args - Its arguments.
 * @param options - Terminal type, size, directory, and environment.
 * @returns The session.
 */
export function spawnTerminal(file: string, args: readonly string[] | string = [], options: WorkerPtyOptions = {}): WorkerPty {
  return new WorkerPty(file, typeof args === 'string' ? [args] : args, options)
}
