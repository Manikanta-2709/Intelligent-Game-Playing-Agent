/* ============================================================
   BOARD GAMES HUB — SERVICE WORKER
   Progressive Web App (PWA) support with offline functionality
   ============================================================ */

const CACHE_NAME = 'board-games-hub-v1';
const STATIC_CACHE = 'static-v1';
const DYNAMIC_CACHE = 'dynamic-v1';

// Static assets to cache
const STATIC_ASSETS = [
  '/',
  '/static/css/styles.css',
  '/static/js/app.js',
  '/static/js/auth.js',
  '/static/js/features.js',
  '/static/js/enhanced-features.js',
  '/static/manifest.json',
  '/play',
  '/login',
  '/register'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('Static assets cached');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('Failed to cache static assets:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== STATIC_CACHE && name !== DYNAMIC_CACHE)
            .map((name) => {
              console.log('Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('Service worker activated');
        return self.clients.claim();
      })
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip cross-origin requests except for chess piece images
  if (url.origin !== location.origin && !url.hostname.includes('chesscomfiles.com')) {
    return;
  }

  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          // Return cached version
          return cachedResponse;
        }

        // Fetch from network
        return fetch(request)
          .then((networkResponse) => {
            // Don't cache if not a valid response
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }

            // Clone the response
            const responseToCache = networkResponse.clone();

            // Cache dynamic content
            if (url.pathname.startsWith('/static/')) {
              caches.open(STATIC_CACHE)
                .then((cache) => cache.put(request, responseToCache));
            } else {
              caches.open(DYNAMIC_CACHE)
                .then((cache) => cache.put(request, responseToCache));
            }

            return networkResponse;
          })
          .catch(() => {
            // Return offline page for navigation requests
            if (request.mode === 'navigate') {
              return caches.match('/play');
            }
            // Return placeholder for images
            if (request.destination === 'image') {
              return new Response(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="50" x="50" text-anchor="middle" font-size="40">🎮</text></svg>',
                { headers: { 'Content-Type': 'image/svg+xml' } }
              );
            }
          });
      })
  );
});

// Background sync for offline moves
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-moves') {
    event.waitUntil(syncMoves());
  }
});

async function syncMoves() {
  // Get pending moves from IndexedDB
  const db = await openDB();
  const pendingMoves = await db.getAll('pendingMoves');

  for (const move of pendingMoves) {
    try {
      await fetch(move.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(move.data)
      });
      await db.delete('pendingMoves', move.id);
    } catch (error) {
      console.error('Failed to sync move:', error);
    }
  }
}

// IndexedDB setup for offline storage
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('BoardGamesHub', 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('pendingMoves')) {
        db.createObjectStore('pendingMoves', { keyPath: 'id', autoIncrement: true });
      }
    };
  });
}

// Push notifications
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  
  const options = {
    body: data.body || 'You have a new game challenge!',
    icon: '/static/images/icon-192.png',
    badge: '/static/images/icon-72.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/play'
    },
    actions: [
      { action: 'accept', title: 'Accept Challenge' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Board Games Hub', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'accept') {
    event.waitUntil(
      clients.openWindow(event.notification.data.url || '/play')
    );
  }
});

// Message handler for skip waiting
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});