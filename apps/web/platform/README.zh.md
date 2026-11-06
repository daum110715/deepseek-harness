# 部署 DSH Web

[English](README.md) | 中文

构建并发布静态站点。站点显示的名称在构建时确定，所以构建客户端包和镜像时环境中要有 `DSH_CLIENT_TITLE`。

```sh
export DSH_CLIENT_TITLE='DSH Web'
pnpm exec tsdown --config-loader native --env.DSH_BUILD_FACE client
pnpm --filter @deepseek-ai/dsh-web-frontend run build:site
rsync -a --delete apps/web/dist-site/ /www/daum/dsh-web-site/
```

托管服务必须以 `Cache-Control: no-cache` 提供 `sw.js` 和 `index.html`，因为过期的 service worker 会把用户固定在旧版本上。文件要按原样提供，不使用重写规则：不存在的文件必须返回 404。`vfs-image.tar.gz` 必须保留 `Content-Length`，并且不能再次压缩。

线上站点是 `dsh.daum.pw`，配置位于 `/etc/caddy/Caddyfile` 的对应区块。
