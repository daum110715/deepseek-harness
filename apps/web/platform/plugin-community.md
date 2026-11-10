# DSH Web plugin community

English | [中文](plugin-community.zh.md)

Plugin community discovers and installs Web distributions of ordinary DSH Cordis bundles. The installed inventory, enablement, configuration layers and removal belong to the existing Plugin Manager. Authors use the existing `Context`, services, tools, events and effect cleanup. There is no separate browser plugin SDK or execution engine.

## Install a plugin

Load the bundled Cordis catalog or enter another HTTPS market index URL. Review a downloaded release or import a local `.tgz` file. The community checks package identity, release SHA-256, DSH and Node requirements, Worker wrapper generation, supported Node capabilities and resolvable dependencies. Approval of the source is required. Install first records a disabled profile dependency; enable it through the community or the ordinary Plugins page. Refreshing the browser retains installed packages and selection in the browser's normal DSH home storage.

Cordis plugins have the same browser-host authority as shipped plugins, including workspace, Session, settings and credential access. Install only trusted publishers. The Node compatibility layer does not isolate one Cordis plugin from another. Compatibility preflight does not establish harmless behavior or prove that dynamic imports and every Node operation will succeed. Cordis reports activation failures through its normal lifecycle.

Disable and uninstall through either management view. Both use the same profile and lifecycle; package files are removed only after the manager withdraws their contributions. The Web host does not invoke pnpm or execute package installation scripts. Updating a prepared distribution uses the existing stop, uninstall and reinstall workflow; no independent upgrade database or recovery engine is added. The install manifest is published after package files reach the browser persistence barrier; a storage failure requires refreshing the inventory to determine its outcome.

## Prepare an ordinary bundle

The [hello example](../plugin-examples/hello/README.md) is a normal Cordis plugin that contributes `community_echo` through `ctx.tools.register`. Its `package.json` declares the existing `dsh.bundle.patch`, `engines.dsh` and peer dependencies. Its patch inserts its normal package entry. Build TypeScript and bundle private npm dependencies before preparing a Web distribution; host-provided dependencies can remain peers.

```sh
node --import tsx/esm scripts/pack-web-plugin.ts --src apps/web/plugin-examples/hello --out /tmp/hello-1.0.0.tgz
```

The author tool reuses `lowerModuleSource` from the Node compatibility layer and writes its existing wrapper generation to `package.json.dsh.web.lowered`. It records static module requests in `dsh.web.modules` and required Node proxies in `dsh.web.requires`. Client factory bundles keep their existing `window.__ModuleLoader__` registration. The result is a gzip-compressed ustar archive with the ordinary npm `package/` root, package manifest, bundle patch, built JavaScript and resources. It is a Web build of the same Cordis plugin rather than a new plugin API. The original source remains usable for the normal Node distribution.

Native addons, uncompiled TypeScript, encrypted or linked archive entries, unsafe paths, duplicate names and incompatible wrapper generations are refused. Dependencies must be bundled or supplied at a compatible version by the host. The default limits on `plugin-manager` are `webPackageArchiveBytes: 2097152`, `webPackageExpandedBytes: 33554432` and `webPackageFiles: 1024`. Inspection resolves imports without evaluating package JavaScript. Configuration expressions retain the existing bundle loader semantics after source approval.

## Publish a catalog

Use the existing [market index format 1](../../../packages/util/plugin-market-index/README.md). A version keeps its normal npm or pinned Git `source` and can add `web: { "url": "hello-1.0.0.tgz", "sha256": "<lowercase SHA-256>" }`. The Web URL resolves against the index URL and requires HTTPS except same-origin development. Native clients keep their original install source. The [bundled index](../public/plugin-community/cordis/index.json) provides the working Web example; it is not a populated third-party directory.

Requests omit credentials and reject redirects. The community bounds indexes to 512 KiB and 100 packages and uses a 15 second download deadline. Release metadata is advisory until inspection verifies the actual package. SHA-256 establishes consistency with the chosen index, not publisher identity. No npm dependency resolver or compiler is installed in the browser.

## Legacy page plugins

The collapsed Legacy page plugins section retains the version 1 JSON reader and browser-local inventory. Those pages keep their `sandbox="allow-scripts"` iframe without Cordis services or Session access. They are not converted into trusted Cordis bundles automatically. The [page example](../public/plugin-community/text-toolbox.dsh-plugin.json) and its [index](../public/plugin-community/index.json) remain available.
