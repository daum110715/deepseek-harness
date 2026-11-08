/** Instance-owned browser community inventory with commit-before-publish persistence. */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import {
  CommunityFailure, COMMUNITY_PACKAGE_BYTES, communityIncompatibility, downloadCommunityText,
  parseCommunityCatalog, parseCommunityPackage, verifyCommunityDownload,
  type CommunityEntry, type CommunityPackage, type CommunityProblem,
} from './community-package.ts'

const STORAGE_KEY = 'dsh.plugin-community.v1'

/** Community page data surviving panel remounts within this plugin instance. */
export interface CommunityState {
  readonly installed: readonly CommunityPackage[]
  readonly entries: readonly CommunityEntry[]
  readonly source: string
  readonly busy: boolean
  readonly problem: CommunityProblem | undefined
}

/** Commands and observable data injected into the community page. */
export interface CommunityFace {
  readonly hooks: { readonly community: HostObservable<CommunityState> }
  readonly discover: (url: string) => Promise<void>
  readonly installUrl: (url: string, entry?: CommunityEntry) => Promise<void>
  readonly installFile: (file: File) => Promise<void>
  readonly remove: (id: string) => void
  readonly exportPackage: (pkg: CommunityPackage) => void
}

/** Owns cancellation, persistence, and subscriptions for one mounted community plugin. */
export class CommunityController {
  private readonly lifetime = new AbortController()
  private readonly listeners = new Set<() => void>()
  private storageReadable = true
  private state: CommunityState = { installed: [], entries: [], source: '/plugin-community/index.json', busy: false, problem: undefined }

  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'>) {
    try {
      const text = storage.getItem(STORAGE_KEY)
      if (text === null) return
      const stored: unknown = JSON.parse(text)
      if (typeof stored !== 'object' || stored === null || !('version' in stored) || stored.version !== 1 || !('installed' in stored) || !Array.isArray(stored.installed) || !('source' in stored) || typeof stored.source !== 'string') throw new CommunityFailure('storage')
      const installed = stored.installed.map((value: unknown) => parseCommunityPackage(JSON.stringify(value)))
      if (new Set(installed.map(pkg => pkg.id)).size !== installed.length) throw new CommunityFailure('storage')
      this.state = { ...this.state, installed, source: stored.source }
    } catch (_unreadableInventory) {
      this.storageReadable = false
      this.state = { ...this.state, problem: 'storage' }
    }
  }

  /** Stop downloads and prevent publication after unload. */
  dispose(): void { this.lifetime.abort(); this.listeners.clear() }

  private publish(change: Partial<CommunityState>): void {
    if (this.lifetime.signal.aborted) return
    this.state = { ...this.state, ...change }
    for (const listener of this.listeners) listener()
  }

  private commit(installed: readonly CommunityPackage[], source: string): void {
    if (!this.storageReadable) throw new CommunityFailure('storage')
    try { this.storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, installed, source })) }
    catch (_storageWriteFailed) { throw new CommunityFailure('storage') }
    this.publish({ installed, source })
  }

  private async operation(action: () => Promise<void>): Promise<void> {
    if (this.state.busy || this.lifetime.signal.aborted) return
    this.publish({ busy: true, problem: undefined })
    try { await action() }
    catch (error) { this.publish({ problem: error instanceof CommunityFailure ? error.code : 'invalid' }) }
    finally { this.publish({ busy: false }) }
  }

  private install(pkg: CommunityPackage): void {
    this.lifetime.signal.throwIfAborted()
    // Every installation path applies the protocol check at the committing operation.
    const checked = parseCommunityPackage(JSON.stringify(pkg))
    this.commit([...this.state.installed.filter(item => item.id !== checked.id), checked], this.state.source)
  }

  /**
   * Create stable actions and an observable for the slot renderer.
   * @returns Community commands and a read-only state source.
   */
  face(): CommunityFace {
    return {
      hooks: { community: {
        getSnapshot: () => this.state,
        subscribe: (listener) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } },
      } },
      discover: url => this.operation(async () => {
        const text = await downloadCommunityText(url, 512 * 1024, this.lifetime.signal)
        const entries = parseCommunityCatalog(text, new URL(url, location.href).href)
        this.lifetime.signal.throwIfAborted()
        this.commit(this.state.installed, url)
        this.publish({ entries })
      }),
      installUrl: (url, entry) => this.operation(async () => {
        if (entry !== undefined) {
          const problem = communityIncompatibility(entry)
          if (problem !== undefined) throw new CommunityFailure(problem)
        }
        const text = await downloadCommunityText(url, COMMUNITY_PACKAGE_BYTES, this.lifetime.signal)
        this.install(entry === undefined ? parseCommunityPackage(text) : await verifyCommunityDownload(text, entry))
      }),
      installFile: file => this.operation(async () => {
        if (file.size > COMMUNITY_PACKAGE_BYTES) throw new CommunityFailure('size')
        this.install(parseCommunityPackage(await file.text()))
      }),
      remove: id => {
        if (this.state.busy || this.lifetime.signal.aborted) return
        try { this.commit(this.state.installed.filter(pkg => pkg.id !== id), this.state.source); this.publish({ problem: undefined }) }
        catch (_storageWriteFailed) { this.publish({ problem: 'storage' }) }
      },
      exportPackage: pkg => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(pkg, null, 2) + '\n'], { type: 'application/json' }))
        const link = document.createElement('a')
        link.href = url; link.download = `${pkg.id}-${pkg.version}.dsh-plugin.json`; link.click()
        setTimeout(() => { URL.revokeObjectURL(url) }, 0)
      },
    }
  }
}
