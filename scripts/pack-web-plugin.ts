/** Prepare an ordinary Cordis npm bundle with the existing Web Worker transform. */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve, relative } from 'node:path'
import { gzipSync } from 'node:zlib'
import { parseArgs } from 'node:util'
import { lowerModuleSource } from '../packages/experimental/webworker-runtime/src/compile/transform.ts'
import { packTar } from '../packages/experimental/webworker-runtime/src/storage/tar.ts'
import { MODULE_PROXIES } from '../packages/experimental/webworker-runtime/src/module-proxies.ts'
import { LOWERING_VERSION } from '../packages/experimental/webworker-runtime/src/image-layout.ts'
import type { DshPackageManifest } from '../packages/util/package-manifest/src/types.ts'

const { values } = parseArgs({ options: { src: { type: 'string' }, out: { type: 'string' } } })
async function main(): Promise<void> {
  if (values.src === undefined || values.out === undefined)
    throw new Error('Usage: pack-web-plugin --src <built npm package> --out <package.tgz>')
  const directory = resolve(values.src),
    files: Record<string, Uint8Array> = {},
    modules: Record<string, string[]> = {}
  const requires = new Set<string>()
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as DshPackageManifest
  if (manifest.dsh?.bundle === undefined) throw new Error('The package must declare dsh.bundle.patch')
  const walk = async (path: string): Promise<void> => {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(path, entry.name),
        name = relative(directory, full).replaceAll('\\', '/')
      if (entry.isSymbolicLink()) throw new Error('Bundle dependencies before packing Symlinks are not distributed')
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (name === 'package.json') continue
      let bytes = new Uint8Array(await readFile(full))
      if (/\.(?:ts|tsx|node)$/.test(name)) throw new Error('Distribute built JavaScript without native addons')
      if (/\.(?:js|mjs|cjs)$/.test(name)) {
        const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        const client = source.includes('window.__ModuleLoader__.load(')
        const transformed = client
          ? { code: source, moduleRequests: [], metaResolveRequests: [] }
          : lowerModuleSource({ filename: name, source })
        modules[name] = [...new Set([...transformed.moduleRequests, ...transformed.metaResolveRequests])]
        for (const request of modules[name])
          if (Object.hasOwn(MODULE_PROXIES, request) || request === 'process' || request === 'node:process') requires.add(request)
        bytes = new TextEncoder().encode(transformed.code)
      }
      files['package/' + name] = bytes
    }
  }
  await walk(directory)
  manifest.dsh = { ...manifest.dsh, web: { lowered: LOWERING_VERSION, modules, requires: [...requires].sort() } }
  files['package/package.json'] = new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n')
  await writeFile(resolve(values.out), gzipSync(packTar(files)))
  console.log(`${manifest.name}@${manifest.version}`)
}
void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
