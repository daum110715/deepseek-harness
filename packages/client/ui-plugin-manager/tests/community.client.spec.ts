import { expect, it } from 'vitest'
import { CommunityController } from '../src/client/community-store.ts'
import { CommunityFailure, parseCommunityPackage, verifyCommunityDownload } from '../src/client/community-package.ts'

it('installs a compatible package durably while refusing incompatible or changed packages without replacing it', async () => {
  const pkg = { format: 'dsh-web-plugin', id: 'third-party', name: 'Third party', version: '1.0.0', description: 'An independent page', author: 'Example author', runtime: 'dsh-web', apiVersion: 1, dependencies: {}, permissions: [], html: '<h1>Independent page</h1>' }
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  const controller = new CommunityController(storage)
  const face = controller.face()
  const file = (value: object): File => ({ size: JSON.stringify(value).length, text: async () => JSON.stringify(value) }) as File
  try {
    await face.installFile(file(pkg))
    expect(face.hooks.community.getSnapshot().installed).toEqual([pkg])
    const persisted = [...values.values()]
    for (const [change, code] of [
      [{ runtime: 'node' }, 'runtime'], [{ apiVersion: 2 }, 'api'],
      [{ dependencies: { native: '1' } }, 'dependencies'], [{ permissions: ['sessions'] }, 'permissions'],
      [{ format: 'npm' }, 'invalid'],
    ] as const) {
      await face.installFile(file({ ...pkg, ...change }))
      expect(face.hooks.community.getSnapshot().problem).toBe(code)
      expect([...values.values()]).toEqual(persisted)
      expect(face.hooks.community.getSnapshot().installed).toEqual([pkg])
    }
    expect(() => parseCommunityPackage(JSON.stringify({ ...pkg, html: 'x'.repeat(2 * 1024 * 1024) }))).toThrow(CommunityFailure)
    await expect(verifyCommunityDownload(JSON.stringify(pkg), { ...pkg, url: 'https://example.invalid/plugin.json', sha256: '0'.repeat(64) })).rejects.toMatchObject({ code: 'integrity' })
    const restored = new CommunityController(storage)
    expect(restored.face().hooks.community.getSnapshot().installed).toEqual([pkg])
    restored.face().remove(pkg.id)
    expect(restored.face().hooks.community.getSnapshot().installed).toEqual([])
    restored.dispose()
  } finally { controller.dispose() }
})
