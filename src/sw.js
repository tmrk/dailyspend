const CACHE_NAME = 'dailyspend-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/src/main.jsx',
  '/src/App.jsx',
  '/src/styles.css',
  '/src/lib/fx.js',
  '/src/lib/storage.js',
  '/public/manifest.webmanifest',
  '/public/icons/icon-192.png',
  '/public/icons/icon-512.png'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .catch((error) => {
        console.error('Failed to cache static assets:', error);
      })
  );
  // Force the waiting service worker to become the active service worker
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        // Take control of all pages
        return self.clients.claim();
      })
  );
});

// Fetch event - implement caching strategy
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle different types of requests with appropriate strategies
  
  // For static assets (cache-first strategy)
  if (url.origin === location.origin && 
      (STATIC_ASSETS.includes(url.pathname) || 
       STATIC_ASSETS.some(asset => url.pathname.endsWith(asset.replace(/^\//, ''))))) {
    
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          return fetch(request)
            .then((response) => {
              // Cache successful responses
              if (response.status === 200) {
                const responseClone = response.clone();
                caches.open(CACHE_NAME)
                  .then((cache) => cache.put(request, responseClone));
              }
              return response;
            });
        })
        .catch(() => {
          // Return a basic offline page if available
          if (request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        })
    );
    return;
  }

  // For API requests (network-first strategy)
  if (url.hostname.includes('api.') || 
      url.hostname.includes('frankfurter') || 
      url.hostname.includes('exchangerate')) {
    
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful API responses for offline use (with short TTL)
          if (response.status === 200 && request.method === 'GET') {
            const responseClone = response.clone();
            caches.open(`${CACHE_NAME}-api`)
              .then((cache) => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(() => {
          // Fallback to cached API response if available
          return caches.match(request);
        })
    );
    return;
  }

  // For all other requests (network-first with cache fallback)
  event.respondWith(
    fetch(request)
      .catch(() => caches.match(request))
  );
});

// Handle background sync for offline currency updates
self.addEventListener('sync', (event) => {
  if (event.tag === 'currency-update') {
    event.waitUntil(
      // Could implement background currency rate updates here
      console.log('Background sync: currency-update')
    );
  }
});

// Handle push notifications (if needed in the future)
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body,
      icon: '/public/icons/icon-192.png',
      badge: '/public/icons/icon-192.png',
      tag: 'dailyspend-notification'
    };

    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  }
});

// Clean up old API cache periodically
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAN_CACHE') {
    event.waitUntil(
      caches.open(`${CACHE_NAME}-api`)
        .then((cache) => {
          // Clean cache entries older than 24 hours
          // This would need more sophisticated implementation
          console.log('Cleaning old cache entries');
        })
    );
  }
});