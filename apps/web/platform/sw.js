// Service worker of the browser-hosted site. A new version installs beside the running one and takes
// over only when the person accepts the reload, because the running host holds a matching runtime image.
const VERSION = '__DSH_SITE_VERSION__'
const PRECACHE = __DSH_PRECACHE__
const CACHE = `dsh-site-${VERSION}`

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    await cache.addAll(PRECACHE)
    // The first install has no running version to wait for.
    if (self.registration.active === null) await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('dsh-site-') && name !== CACHE) await caches.delete(name)
    }
    await self.clients.claim()
  })())
})

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return
  event.respondWith((async () => {
    const cache = await caches.open(CACHE)
    if (request.mode === 'navigate') {
      const page = await cache.match('./index.html')
      if (page !== undefined) return page
    }
    const cached = await cache.match(request)
    if (cached !== undefined) return cached
    const response = await fetch(request)
    // Lazy grammars, fonts, and page chunks join the cache the first time they are used.
    if (response.ok) await cache.put(request, response.clone())
    return response
  })())
})
