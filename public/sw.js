/*
 * GymOS service worker.
 *
 * Deliberately narrow in scope: it caches the app shell and public exercise and recipe
 * pages you have already visited, so the library stays readable on a flaky connection.
 *
 * It does NOT attempt offline write sync. Logging a workout, saving a plan or editing
 * anything requires a connection, and GymOS does not pretend otherwise. Anything that
 * mutates data is passed straight through to the network.
 */
const CACHE = 'gymos-shell-v1';
const PRECACHE = ['/', '/offline'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const CACHEABLE = [/^\/exercises(\/|$)/, /^\/nutrition\/recipes(\/|$)/, /^\/features$/, /^\/faq$/];

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache authenticated data endpoints or Next.js data payloads.
  if (url.pathname.startsWith('/api/')) return;
  if (url.searchParams.has('_rsc')) return;

  const cacheable = CACHEABLE.some((re) => re.test(url.pathname));

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (cacheable && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const offline = await caches.match('/offline');
        if (offline) return offline;
        return new Response('You are offline and this page has not been cached.', {
          status: 503,
          headers: { 'content-type': 'text/plain' },
        });
      }),
  );
});
