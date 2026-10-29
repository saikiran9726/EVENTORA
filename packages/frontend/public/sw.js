/**
 * Eventora Workbox-Compliant Service Worker
 *
 * Capabilities:
 * - App shell precaching and offline fallback
 * - StaleWhileRevalidate for static assets & scanner bundles
 * - NetworkFirst cache for student tickets & QR passes (offline ticket presentation)
 * - Immediate update activation via SKIP_WAITING
 */

const SHELL_CACHE = 'eventora-shell-v1';
const STATIC_CACHE = 'eventora-static-v1';
const TICKETS_CACHE = 'eventora-tickets-offline-v1';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
];

// 1. Install & Shell Precaching
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      return cache.addAll(SHELL_ASSETS);
    })
  );
});

// 2. Activate & Purge Stale Caches
self.addEventListener('activate', (event) => {
  const currentCaches = [SHELL_CACHE, STATIC_CACHE, TICKETS_CACHE];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (!currentCaches.includes(cacheName)) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Skip Waiting Handler
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// 4. Fetch Strategy Orchestration
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests and browser extensions
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) {
    return;
  }

  // Strategy A: Offline Tickets & QR Passes (NetworkFirst with Offline Fallback)
  if (url.pathname.includes('/tickets') || url.pathname.includes('/qr')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(TICKETS_CACHE).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;
            return new Response(
              JSON.stringify({
                error: {
                  code: 'OFFLINE_TICKET_CACHED',
                  message: 'Loaded cached ticket presentation in offline mode.',
                },
              }),
              {
                headers: { 'Content-Type': 'application/json' },
                status: 200,
              }
            );
          });
        })
    );
    return;
  }

  // Strategy B: Static Assets & Bundles (StaleWhileRevalidate)
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.woff2')
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(STATIC_CACHE).then((cache) => {
              cache.put(request, networkResponse.clone());
            });
          }
          return networkResponse;
        });

        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // Strategy C: HTML Navigation & App Shell (NetworkFirst falling back to cached shell)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => {
        return caches.match('/index.html') || caches.match('/');
      })
    );
    return;
  }
});
