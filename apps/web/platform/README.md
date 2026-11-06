# Deploying DSH Web

English | [中文](README.zh.md)

Build and publish the static site. The build sets the visible name, so client bundles and the image must be built with `DSH_CLIENT_TITLE` in the environment.

```sh
export DSH_CLIENT_TITLE='DSH Web'
pnpm exec tsdown --config-loader native --env.DSH_BUILD_FACE client
pnpm --filter @deepseek-ai/dsh-web-frontend run build:site
rsync -a --delete apps/web/dist-site/ /www/daum/dsh-web-site/
```

The host must serve `sw.js` and `index.html` with `Cache-Control: no-cache`, because a stale service worker pins an old version. Serve files as stored, without rewrite rules: a missing file has to be a 404. `vfs-image.tar.gz` must keep its `Content-Length` and must not be compressed again.

The live site is `dsh.daum.pw`, a block in `/etc/caddy/Caddyfile`.
