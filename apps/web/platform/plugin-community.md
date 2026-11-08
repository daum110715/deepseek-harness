# DSH Web plugin community

The preinstalled **Plugin community** entry discovers and installs self-contained browser page plugins. It does not load npm packages into the harness. Plugins receive no host API, model tools, filesystem access, session data or credentials. Their HTML runs only after **Open** in an iframe with `sandbox="allow-scripts"`; storage belonging to the DSH Web origin is inaccessible. Plugin network traffic follows normal browser sandbox and CORS rules. Closing its panel destroys its frame, so authors must not depend on durable iframe state.

Publish a UTF-8 JSON package like the [working text toolbox example](../public/plugin-community/text-toolbox.dsh-plugin.json):

```json
{
  "format": "dsh-web-plugin",
  "id": "my-plugin",
  "name": "My plugin",
  "version": "1.0.0",
  "description": "A standalone browser page",
  "author": "Your name",
  "runtime": "dsh-web",
  "apiVersion": 1,
  "dependencies": {},
  "permissions": [],
  "html": "<!doctype html><html><meta charset=\"utf-8\"><h1>My plugin</h1></html>"
}
```

All fields are required and unknown fields are rejected. IDs use lowercase letters, digits, dots, underscores and hyphens and have at most 80 characters. Versions use three numeric components with an optional prerelease suffix. Bundle required CSS and JavaScript into `html`; npm resolution, Node built-ins and native modules are unavailable. Packages may not exceed 2 MiB including JSON metadata. Other runtimes, API versions, nonempty dependency maps and requested host permissions are refused at every installation path before persistence or execution.

Publish a discovery index with `format: "dsh-web-plugin-index"`, `version: 1` and a `plugins` array. Each entry contains the package fields except `html`, plus a package `url` resolved relative to the index URL and a lowercase hexadecimal SHA-256 digest in `sha256`. Calculate that digest over the exact UTF-8 package bytes including the final newline. See the [bundled index](../public/plugin-community/index.json). Indexes are limited to 512 KiB and 100 entries. Installation recomputes compatibility and verifies the digest and exact ID and version. This checks consistency with the chosen index, not author trust.

Host indexes and packages over HTTPS with CORS enabled for consumer origins. Requests omit credentials and reject redirects; each download has a 15 second deadline. Same-origin HTTP is permitted for local development. Users can enter an index URL or import packages by URL or file. Installed inventory and the last successfully loaded source are saved in browser-local storage; download and storage failures leave the previous inventory intact. Exported packages can be imported in another browser. The bundled catalog is a first-party format example, not a populated third-party directory.
