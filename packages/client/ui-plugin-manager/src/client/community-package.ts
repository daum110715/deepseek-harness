/** Browser plugin protocol and bounded downloads shared by discovery and installation. */
import { z } from 'zod'

/** The browser plugin API supported by this client. */
export const COMMUNITY_API_VERSION = 1
/** Maximum UTF-8 bytes of one self-contained browser plugin package. */
export const COMMUNITY_PACKAGE_BYTES = 2 * 1024 * 1024

const identity = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/)
const version = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
const packageSchema = z.object({
  format: z.literal('dsh-web-plugin'),
  id: identity,
  name: z.string().trim().min(1).max(120),
  version,
  description: z.string().max(1000),
  author: z.string().trim().min(1).max(120),
  runtime: z.string(),
  apiVersion: z.number().int().positive(),
  dependencies: z.record(z.string(), z.string()),
  permissions: z.array(z.string()),
  html: z.string().min(1),
}).strict()

/** A self-contained third-party page requiring no host module installation. */
export type CommunityPackage = z.infer<typeof packageSchema>
/** A pinned discovery entry whose downloaded bytes must match its digest. */
export const communityEntrySchema = packageSchema.omit({ html: true }).extend({
  url: z.string().min(1).max(2048),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
/** One catalogue entry before its package has been downloaded. */
export type CommunityEntry = z.infer<typeof communityEntrySchema>
const catalogSchema = z.object({ format: z.literal('dsh-web-plugin-index'), version: z.literal(1), plugins: z.array(communityEntrySchema).max(100) }).strict()

/** Stable failure codes translated by the community page. */
export type CommunityProblem = 'invalid' | 'runtime' | 'api' | 'dependencies' | 'permissions' | 'network' | 'size' | 'integrity' | 'storage'
/** Expected installation refusal with no installed-state mutation. */
export class CommunityFailure extends Error {
  constructor(readonly code: CommunityProblem) { super(code); this.name = 'CommunityFailure' }
}

/**
 * Check declarations without evaluating downloaded code.
 * @param entry Plugin declarations from a package or index.
 * @returns The first incompatibility, if present.
 */
export function communityIncompatibility(entry: Pick<CommunityPackage, 'runtime' | 'apiVersion' | 'dependencies' | 'permissions'>): CommunityProblem | undefined {
  if (entry.runtime !== 'dsh-web') return 'runtime'
  if (entry.apiVersion !== COMMUNITY_API_VERSION) return 'api'
  if (Object.keys(entry.dependencies).length !== 0) return 'dependencies'
  if (entry.permissions.length !== 0) return 'permissions'
  return undefined
}

/**
 * Parse and reject incompatible packages before storage or execution.
 * @param text UTF-8 JSON package text.
 * @returns Validated compatible package.
 * @throws CommunityFailure for size, format or compatibility failures.
 */
export function parseCommunityPackage(text: string): CommunityPackage {
  if (new TextEncoder().encode(text).byteLength > COMMUNITY_PACKAGE_BYTES) throw new CommunityFailure('size')
  let json: unknown
  try { json = JSON.parse(text) } catch (_invalidJson) { throw new CommunityFailure('invalid') }
  const parsed = packageSchema.safeParse(json)
  if (!parsed.success) throw new CommunityFailure('invalid')
  const problem = communityIncompatibility(parsed.data)
  if (problem !== undefined) throw new CommunityFailure(problem)
  return parsed.data
}

/**
 * Validate a bounded catalogue without trusting its compatibility claims.
 * @param text JSON index text.
 * @param baseUrl Absolute index URL used to resolve package addresses.
 * @returns Validated discovery declarations including incompatible entries.
 * @throws CommunityFailure when the index is malformed.
 */
export function parseCommunityCatalog(text: string, baseUrl: string): CommunityEntry[] {
  let json: unknown
  try { json = JSON.parse(text) } catch (_invalidJson) { throw new CommunityFailure('invalid') }
  const parsed = catalogSchema.safeParse(json)
  if (!parsed.success) throw new CommunityFailure('invalid')
  try { return parsed.data.plugins.map(entry => ({ ...entry, url: new URL(entry.url, baseUrl).href })) }
  catch (_invalidPackageUrl) { throw new CommunityFailure('invalid') }
}

/**
 * Read credential-free HTTPS JSON with a deadline and streamed byte limit.
 * @param address Absolute HTTPS URL or same-origin URL for local development.
 * @param limit Maximum response bytes.
 * @param signal Owner cancellation signal.
 * @returns UTF-8 response text.
 * @throws CommunityFailure on an invalid URL, failed fetch or excessive response.
 */
export async function downloadCommunityText(address: string, limit: number, signal: AbortSignal): Promise<string> {
  let url: URL
  try { url = new URL(address, location.href) } catch (_invalidUrl) { throw new CommunityFailure('invalid') }
  if ((url.protocol !== 'https:' && url.origin !== location.origin) || url.username !== '' || url.password !== '') throw new CommunityFailure('invalid')
  try {
    const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) })
    if (!response.ok || response.body === null) throw new CommunityFailure('network')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > limit) throw new CommunityFailure('size')
        chunks.push(value)
      }
    } finally { await reader.cancel() }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    if (error instanceof CommunityFailure) throw error
    throw new CommunityFailure('network')
  }
}

/**
 * Verify discovery identity and digest before accepting downloaded content.
 * @param text Unmodified downloaded package JSON.
 * @param expected Index entry selected by the user.
 * @returns Compatible package with matching identity and SHA-256 digest.
 * @throws CommunityFailure for changed or incompatible packages.
 */
export async function verifyCommunityDownload(text: string, expected: CommunityEntry): Promise<CommunityPackage> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  if (hex !== expected.sha256) throw new CommunityFailure('integrity')
  const pkg = parseCommunityPackage(text)
  if (pkg.id !== expected.id || pkg.version !== expected.version) throw new CommunityFailure('integrity')
  return pkg
}
