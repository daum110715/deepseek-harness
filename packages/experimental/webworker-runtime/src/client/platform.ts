/**
 * The page half of the Web platform: everything between opening the URL and the
 * harness answering. It keeps one host per origin across tabs, reconnects folders,
 * shows boot progress, answers the host's folder requests, and registers the
 * service worker. The harness itself still starts through {@link connectWorkerHost}.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/client/platform
 */

import type { HostToPageFrame, PageToHostFrame, PlatformMount, PlatformRequest, PlatformStatus } from '../platform/protocol.ts'
import { connectWorkerHost, holdWorkerHostBoot } from './index.ts'

const HOST_LOCK = 'dsh-web-host'
const FOLDER_DATABASE = 'dsh-web'
const FOLDER_STORE = 'folders'

const COPY = {
  en: {
    starting: 'Starting DSH Web',
    downloading: 'Downloading the runtime',
    restoring: 'Restoring your data',
    booting: 'Starting the agent',
    failed: 'DSH Web could not start',
    retry: 'Try again',
    otherTab: 'DSH Web is open in another tab',
    otherTabDetail: 'One tab at a time can use your data here.',
    useHere: 'Use this tab',
    movedTab: 'DSH Web moved to another tab',
    reload: 'Reload',
    reconnectTitle: 'Reconnect your folders',
    reconnectDetail: 'Your browser asks again for access to folders after a restart.',
    reconnect: 'Reconnect',
    skip: 'Not now',
    chooseTitle: 'Choose a folder',
    chooseDetail: 'The agent can read and change files in the folder you choose.',
    choose: 'Choose folder',
    cancel: 'Cancel',
    mounted: (name: string) => `Connected ${name}`,
    skipped: (count: number) => `, ${String(count)} large files left out`,
    storageFailed: (message: string) => `Your data is no longer being saved: ${message}`,
    update: 'A new version is ready.',
  },
  zh: {
    starting: '正在启动 DSH Web',
    downloading: '正在下载运行环境',
    restoring: '正在恢复你的数据',
    booting: '正在启动智能体',
    failed: 'DSH Web 启动失败',
    retry: '重试',
    otherTab: 'DSH Web 已在其他标签页打开',
    otherTabDetail: '同一时间只有一个标签页可以使用这里的数据。',
    useHere: '在此标签页使用',
    movedTab: 'DSH Web 已转到其他标签页',
    reload: '重新加载',
    reconnectTitle: '重新连接文件夹',
    reconnectDetail: '浏览器重启后，需要再次授权访问文件夹。',
    reconnect: '重新连接',
    skip: '暂不连接',
    chooseTitle: '选择文件夹',
    chooseDetail: '智能体可以读取和修改你选择的文件夹中的文件。',
    choose: '选择文件夹',
    cancel: '取消',
    mounted: (name: string) => `已连接 ${name}`,
    skipped: (count: number) => `，${String(count)} 个大文件未载入`,
    storageFailed: (message: string) => `数据已停止保存：${message}`,
    update: '新版本已就绪。',
  },
}

const copy = navigator.language.toLowerCase().startsWith('zh') ? COPY.zh : COPY.en

const STYLE = `
  [data-dsh-web-boot] {
    --boot-bg: #fff; --boot-fg: #0f1115; --boot-muted: #6b7280; --boot-line: rgb(0 0 0 / 10%); --boot-accent: #4d6bfe;
    position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center;
    padding: 24px; box-sizing: border-box; color: var(--boot-fg); background: var(--boot-bg);
    font: 14px/22px system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    [data-dsh-web-boot] { --boot-bg: #15171a; --boot-fg: #f2f3f5; --boot-muted: #9ca3af; --boot-line: rgb(255 255 255 / 12%); }
  }
  [data-dsh-web-boot] > div { width: min(360px, 100%); }
  [data-dsh-web-boot] h1 { margin: 0 0 6px; font-size: 16px; line-height: 24px; font-weight: 600; }
  [data-dsh-web-boot] p { margin: 0 0 16px; color: var(--boot-muted); overflow-wrap: anywhere; }
  [data-dsh-web-boot] ul { margin: 0 0 16px; padding: 0; list-style: none; }
  [data-dsh-web-boot] li { padding: 6px 0; border-top: 1px solid var(--boot-line); overflow-wrap: anywhere; }
  [data-dsh-web-boot] [role=progressbar] { height: 4px; border-radius: 2px; overflow: hidden; background: var(--boot-line); }
  [data-dsh-web-boot] [role=progressbar] > i { display: block; height: 100%; width: 100%; transform-origin: left; background: var(--boot-accent); transition: transform 120ms linear; }
  [data-dsh-web-boot] [role=progressbar][data-indeterminate] > i { animation: dsh-boot-slide 1.2s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) { [data-dsh-web-boot] [role=progressbar][data-indeterminate] > i { animation: none; } }
  @keyframes dsh-boot-slide { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
  [data-dsh-web-boot] button, [data-dsh-toast] button {
    min-height: 40px; margin: 0 8px 0 0; padding: 0 16px; border: 1px solid var(--boot-line, rgb(128 128 128 / 40%));
    border-radius: 8px; color: inherit; background: transparent; font: inherit; cursor: pointer;
  }
  [data-dsh-web-boot] button[data-primary] { border-color: var(--boot-accent); color: #fff; background: var(--boot-accent); }
  [data-dsh-web-boot] button:focus-visible, [data-dsh-toast] button:focus-visible { outline: 2px solid #4d6bfe; outline-offset: 2px; }
  [data-dsh-toast] {
    position: fixed; left: 50%; bottom: max(16px, env(safe-area-inset-bottom)); z-index: 2147483001; display: flex; align-items: center; gap: 12px;
    width: max-content; max-width: calc(100vw - 32px); padding: 10px 16px; box-sizing: border-box; border-radius: 10px; transform: translateX(-50%);
    color: #fff; background: #23262b; box-shadow: 0 6px 24px rgb(0 0 0 / 24%);
    font: 14px/20px system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  [data-dsh-toast] button { min-height: 32px; margin: 0; padding: 0 12px; border-color: rgb(255 255 255 / 30%); }
`

/** One action button of a boot screen. */
interface ScreenAction {
  readonly label: string
  readonly primary?: boolean
  run(): void
}

/** The full-page surface shown until the harness renders. */
class BootScreen {
  private readonly root = document.createElement('div')
  private bar: HTMLElement | undefined

  constructor() {
    if (document.querySelector('style[data-dsh-web-boot-style]') === null) {
      const style = document.createElement('style')
      style.dataset.dshWebBootStyle = ''
      style.textContent = STYLE
      document.head.append(style)
    }
    this.root.dataset.dshWebBoot = ''
    document.body.append(this.root)
  }

  /** Show a titled message with optional list and actions. */
  message(title: string, detail: string, actions: readonly ScreenAction[], items: readonly string[] = []): void {
    this.bar = undefined
    const panel = document.createElement('div')
    const heading = document.createElement('h1')
    heading.textContent = title
    const text = document.createElement('p')
    text.textContent = detail
    panel.append(heading, text)
    if (items.length > 0) {
      const list = document.createElement('ul')
      for (const item of items) {
        const row = document.createElement('li')
        row.textContent = item
        list.append(row)
      }
      panel.append(list)
    }
    for (const action of actions) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = action.label
      if (action.primary === true) button.dataset.primary = ''
      button.addEventListener('click', () => { action.run() })
      panel.append(button)
    }
    this.root.replaceChildren(panel)
  }

  /** Show boot progress; `fraction` is undefined when the amount is unknown. */
  progress(label: string, fraction?: number): void {
    if (this.bar === undefined) {
      const panel = document.createElement('div')
      const heading = document.createElement('h1')
      heading.textContent = copy.starting
      const text = document.createElement('p')
      const bar = document.createElement('div')
      bar.setAttribute('role', 'progressbar')
      bar.append(document.createElement('i'))
      panel.append(heading, text, bar)
      this.root.replaceChildren(panel)
      this.bar = bar
    }
    const bar = this.bar
    const text = bar.previousElementSibling as HTMLElement
    text.textContent = label
    bar.setAttribute('aria-label', label)
    const fill = bar.firstElementChild as HTMLElement
    if (fraction === undefined) {
      bar.dataset.indeterminate = ''
      bar.removeAttribute('aria-valuenow')
      fill.style.transform = ''
    } else {
      delete bar.dataset.indeterminate
      bar.setAttribute('aria-valuenow', String(Math.round(fraction * 100)))
      fill.style.transform = `scaleX(${String(fraction)})`
    }
  }

  /** Remove the surface; the harness has rendered. */
  close(): void {
    this.root.remove()
  }
}

/** Show a short notice above the harness. */
function toast(text: string, action?: { label: string; run(): void }): void {
  const node = document.createElement('div')
  node.dataset.dshToast = ''
  node.setAttribute('role', 'status')
  node.append(text)
  if (action !== undefined) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = action.label
    button.addEventListener('click', () => { action.run() })
    node.append(button)
  } else {
    setTimeout(() => { node.remove() }, 6000)
  }
  document.body.append(node)
}

async function openFolders(): Promise<IDBDatabase> {
  return await new Promise((settle, fail) => {
    const request = indexedDB.open(FOLDER_DATABASE, 1)
    request.onupgradeneeded = () => { request.result.createObjectStore(FOLDER_STORE) }
    request.onsuccess = () => { settle(request.result) }
    request.onerror = () => { fail(request.error) }
  })
}

async function folderTransaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openFolders()
  try {
    return await new Promise((settle, fail) => {
      const request = run(database.transaction(FOLDER_STORE, mode).objectStore(FOLDER_STORE))
      request.onsuccess = () => { settle(request.result) }
      request.onerror = () => { fail(request.error) }
    })
  } finally {
    database.close()
  }
}

/** Permission surface of a directory handle, present in browsers offering the picker. */
interface PermissionedHandle extends FileSystemDirectoryHandle {
  queryPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>
}

/** Reads a stored folder list; a browser refusing IndexedDB has none. */
async function storedFolders(): Promise<PlatformMount[]> {
  if (typeof indexedDB === 'undefined') return []
  const [names, handles] = await Promise.all([
    folderTransaction('readonly', store => store.getAllKeys()),
    folderTransaction('readonly', store => store.getAll() as IDBRequest<FileSystemDirectoryHandle[]>),
  ])
  return names.map((name, index) => ({ name: String(name), handle: handles[index] as FileSystemDirectoryHandle }))
}

/** Ask for access to saved folders before the harness discovers workspaces. */
async function reconnectFolders(screen: BootScreen): Promise<PlatformMount[]> {
  const folders = await storedFolders()
  const granted: PlatformMount[] = []
  const waiting: PlatformMount[] = []
  for (const folder of folders) {
    const state = await (folder.handle as PermissionedHandle).queryPermission?.({ mode: 'readwrite' })
    if (state === 'granted') granted.push(folder)
    else waiting.push(folder)
  }
  if (waiting.length === 0) return granted
  await new Promise<void>((settle) => {
    screen.message(copy.reconnectTitle, copy.reconnectDetail, [
      {
        label: copy.reconnect,
        primary: true,
        run: () => {
          void (async () => {
            for (const folder of waiting) {
              const state = await (folder.handle as PermissionedHandle).requestPermission?.({ mode: 'readwrite' })
              if (state === 'granted') granted.push(folder)
            }
            settle()
          })()
        },
      },
      { label: copy.skip, run: () => { settle() } },
    ], waiting.map(folder => folder.name))
  })
  screen.progress(copy.booting)
  return granted
}

/** Picker entry point, absent in browsers without the File System Access API. */
type DirectoryPicker = (options: { mode: 'readwrite'; id: string }) => Promise<FileSystemDirectoryHandle>

function directoryPicker(): DirectoryPicker | undefined {
  return (globalThis as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker
}

/** A folder request can arrive after the click's activation expired, so it may need its own click. */
async function withActivation<T>(attempt: () => Promise<T>, onCancel: () => T): Promise<T> {
  try {
    return await attempt()
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'SecurityError') throw error
  }
  const screen = new BootScreen()
  try {
    return await new Promise<T>((settle, fail) => {
      screen.message(copy.chooseTitle, copy.chooseDetail, [
        { label: copy.choose, primary: true, run: () => { attempt().then(settle, fail) } },
        { label: copy.cancel, run: () => { settle(onCancel()) } },
      ])
    })
  } finally {
    screen.close()
  }
}

/** Browsers without the picker hand over a copy of the folder's files through a file input. */
async function pickFilesFrame(id: number): Promise<PageToHostFrame> {
  return await new Promise((settle) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.setAttribute('webkitdirectory', '')
    input.addEventListener('cancel', () => { settle({ t: 'chosen-nothing', id }) })
    input.addEventListener('change', () => {
      const selected = [...input.files ?? []]
      const first = selected[0]?.webkitRelativePath.split('/')[0]
      if (first === undefined) {
        settle({ t: 'chosen-nothing', id })
        return
      }
      settle({
        t: 'chosen-files',
        id,
        name: first,
        files: selected.map(file => ({ path: file.webkitRelativePath.slice(first.length + 1), file })),
      })
    })
    input.click()
  })
}

async function answerFolderRequest(id: number, port: MessagePort): Promise<void> {
  const picker = directoryPicker()
  let frame: PageToHostFrame
  try {
    frame = picker === undefined
      ? await pickFilesFrame(id)
      : await withActivation<PageToHostFrame>(
        async () => ({ t: 'chosen-directory', id, handle: await picker({ mode: 'readwrite', id: 'dsh-workspace' }) }),
        () => ({ t: 'chosen-nothing', id }),
      )
  } catch (error) {
    frame = error instanceof DOMException && error.name === 'AbortError'
      ? { t: 'chosen-nothing', id }
      : { t: 'choose-failed', id, message: error instanceof Error ? error.message : String(error) }
  }
  port.postMessage(frame)
}

/** Registers the service worker that makes the app installable and available offline. */
function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !isSecureContext) return
  navigator.serviceWorker.register('./sw.js').then((registration) => {
    const offerUpdate = (worker: ServiceWorker): void => {
      toast(copy.update, {
        label: copy.reload,
        run: () => {
          navigator.serviceWorker.addEventListener('controllerchange', () => { location.reload() })
          worker.postMessage('skip-waiting')
        },
      })
    }
    if (registration.waiting !== null && navigator.serviceWorker.controller !== null) offerUpdate(registration.waiting)
    registration.addEventListener('updatefound', () => {
      const incoming = registration.installing
      incoming?.addEventListener('statechange', () => {
        if (incoming.state === 'installed' && navigator.serviceWorker.controller !== null) offerUpdate(incoming)
      })
    })
  }).catch((error: unknown) => {
    // The app works without offline support, for example on a static host without the worker file.
    console.warn('web platform: service worker unavailable', error)
  })
}

/** What Settings and other page surfaces can ask of the platform layer. */
export interface WebPlatformBridge {
  status(): Promise<PlatformStatus>
  /** Download a backup of home and workspace data. */
  exportData(): Promise<Uint8Array>
  /** Restore a backup and restart. */
  importData(archive: Uint8Array): Promise<void>
  /** Erase home and workspace data and restart. */
  resetData(): Promise<void>
  /** Disconnect one folder; its files stay on disk. */
  forgetFolder(name: string): Promise<void>
}

function startBridge(port: MessagePort): { bridge: WebPlatformBridge; settleReply(frame: Extract<HostToPageFrame, { t: 'reply' }>): void } {
  const pending = new Map<number, { settle(value: unknown): void; fail(reason: Error): void }>()
  let nextId = 0
  const request = async (operation: PlatformRequest, transfer: Transferable[] = []): Promise<unknown> => {
    nextId += 1
    const id = nextId
    return await new Promise((settle, fail) => {
      pending.set(id, { settle, fail })
      port.postMessage({ t: 'request', id, ...operation } satisfies PageToHostFrame, transfer)
    })
  }
  return {
    bridge: {
      status: async () => await request({ op: 'status' }) as PlatformStatus,
      exportData: async () => await request({ op: 'export' }) as Uint8Array,
      importData: async (archive) => {
        await request({ op: 'import', archive }, [archive.buffer as ArrayBuffer])
        location.reload()
      },
      resetData: async () => {
        await request({ op: 'reset' })
        location.reload()
      },
      forgetFolder: async (name) => {
        await request({ op: 'unmount', name })
        await folderTransaction('readwrite', store => store.delete(name))
      },
    },
    settleReply: (frame) => {
      const waiter = pending.get(frame.id)
      pending.delete(frame.id)
      if (frame.failure === undefined) waiter?.settle(frame.value)
      else waiter?.fail(new Error(frame.failure))
    },
  }
}

/** Hold the single-host lock for this tab's lifetime, asking first when another tab has it. */
async function acquireHostLock(screen: BootScreen, onLost: () => void): Promise<void> {
  if (!('locks' in navigator)) return
  const hold = (options: LockOptions): Promise<boolean> => new Promise((acquired, failed) => {
    navigator.locks.request(HOST_LOCK, options, async (lock) => {
      acquired(lock !== null)
      if (lock !== null) await new Promise(() => {})
    }).catch((error: unknown) => {
      // A later tab stole the lock; before acquisition this is a real failure.
      failed(error)
      onLost()
    })
  })
  if (await hold({ ifAvailable: true })) return
  await new Promise<void>((settle) => {
    screen.message(copy.otherTab, copy.otherTabDetail, [{
      label: copy.useHere,
      primary: true,
      run: () => {
        screen.progress(copy.booting)
        void hold({ steal: true }).then(() => { settle() })
      },
    }])
  })
}

/** Inputs for {@link startWebPlatform}. */
export interface WebPlatformOptions {
  /** Base VFS image URL. */
  readonly image: string
  /** Constructs the host worker, so the page's bundler resolves its URL. */
  createWorker(): Worker
}

/**
 * Start the harness in this page.
 * @param options - Image location and worker constructor.
 * @returns Resolves when the host serves the page; failures are shown on the boot screen and rethrown.
 */
export async function startWebPlatform(options: WebPlatformOptions): Promise<void> {
  holdWorkerHostBoot()
  const screen = new BootScreen()
  screen.progress(copy.starting)
  registerServiceWorker()
  let worker: Worker | undefined
  try {
    await acquireHostLock(screen, () => {
      worker?.terminate()
      screen.close()
      new BootScreen().message(copy.movedTab, '', [{ label: copy.reload, primary: true, run: () => { location.reload() } }])
    })
    const mounts = await reconnectFolders(screen)
    void navigator.storage?.persist?.()
    const channel = new MessageChannel()
    const { port1: port, port2: remote } = channel
    const { bridge, settleReply } = startBridge(port)
    ;(globalThis as { __DSH_WEB_PLATFORM__?: WebPlatformBridge }).__DSH_WEB_PLATFORM__ = bridge
    port.onmessage = (event: MessageEvent<HostToPageFrame>) => {
      const frame = event.data
      switch (frame.t) {
        case 'progress':
          if (frame.stage === 'download') screen.progress(copy.downloading, frame.total === undefined || frame.loaded === undefined ? undefined : Math.min(frame.loaded / frame.total, 1))
          else if (frame.stage === 'restore') screen.progress(copy.restoring)
          else if (frame.stage === 'start') screen.progress(copy.booting)
          return
        case 'choose-directory':
          void answerFolderRequest(frame.id, port)
          return
        case 'mounted':
          if (frame.handle !== undefined) {
            const handle = frame.handle
            void folderTransaction('readwrite', store => store.put(handle, frame.name))
          }
          toast(copy.mounted(frame.name) + (frame.skipped.length > 0 ? copy.skipped(frame.skipped.length) : ''))
          return
        case 'storage-failure':
          toast(copy.storageFailed(frame.message))
          return
        case 'reply':
          settleReply(frame)
          return
        default:
          console.warn('web platform: unknown host frame', frame)
      }
    }
    worker = options.createWorker()
    worker.postMessage({ t: 'platform-init', port: remote, mounts }, [remote])
    addEventListener('focus', () => { port.postMessage({ t: 'rescan' } satisfies PageToHostFrame) })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') port.postMessage({ t: 'request', id: 0, op: 'flush' } satisfies PageToHostFrame)
    })
    await connectWorkerHost(worker, {
      image: options.image,
      overlays: [],
      localizeSourceMaps: new URLSearchParams(location.search).has('debug-source-maps'),
    })
    screen.close()
  } catch (reason) {
    worker?.terminate()
    screen.message(copy.failed, reason instanceof Error ? reason.message : String(reason), [
      { label: copy.retry, primary: true, run: () => { location.reload() } },
    ])
    throw reason
  }
}
