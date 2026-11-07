# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## Developer preview

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

<a id="dsh-web"></a>

## DSH Web

This fork adds DSH Web, a build of the harness that runs entirely in the browser as a static site. The agent, tools, and Session logs run in a Web Worker, and model requests go straight from the browser to the DeepSeek API, so no server handles your key or your files. DSH Web is unofficial: it is built on DeepSeek Harness and is not affiliated with DeepSeek.

- **Your data stays in the browser**: Sessions, settings, and API keys persist in the origin-private file system. **Settings → General → Browser data** backs up, restores, and erases them.
- **Real folders**: in Chromium browsers, choose a folder as a workspace and the agent reads and writes it directly. Firefox and Safari work on a copy.
- **A shell with bash syntax**: loops, functions, pipes, `grep`, `sed`, `awk`, `jq`, and `git`, confined by the same permission modes. There is no `node`, `python`, or package manager.
- **A real installed app**: it installs with its own window and starts without a network, though the model still needs one. Files and text shared from other apps open as a draft in a new session, nothing is sent until you send it, and it can notify you and badge its icon when a session finishes in the background. **Settings → General → App** has install, updates, storage protection, and notifications.

```sh
pnpm install
pnpm run build:lib
pnpm --filter @deepseek-ai/dsh-web-frontend run build:site  # writes apps/web/dist-site
```

Serve `apps/web/dist-site` from any HTTPS static host. Limitations and internals are in the [runtime README](packages/experimental/webworker-runtime/README.md#known-limitations-and-deferred-work).

## Community and support

- Submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/4MrtZUhpxg">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

`pnpm run dev:web` builds, serves, and rebuilds client bundles on source edits in one terminal, and `make help` lists the matching Make targets for Web and Desktop; the guide's application commands section owns the full table.

For agents, follow [AGENTS.md](AGENTS.md).

## Citation

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## License

This fork is licensed under the GNU Affero General Public License v3.0 ([LICENSE](LICENSE)). The DeepSeek Harness code it is based on remains under the MIT License ([LICENSE-MIT](LICENSE-MIT)).

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
