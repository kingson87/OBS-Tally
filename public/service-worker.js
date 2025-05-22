// OBS Tally Service Worker
const CACHE_VERSION = '2';
const CACHE_NAME = 'obs-tally-cache-v' + CACHE_VERSION;

// Assets that should be cached for offline use
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/logo.css',
  '/manifest.json',
  '/icon.png',
  '/icon_256.png',
  '/diagnostics.html'
];

// Install handler - cache static assets
self.addEventListener('install', event => {
  // Immediately take over from old service worker
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
  );
});

// Activate handler - clean up old caches
self.addEventListener('activate', event => {
  console.log('Service Worker activated');
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('Clearing old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
});

// Fetch handler - network-first for API calls, cache-first for static assets
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // For WebSocket connections, don't interfere
  if (url.protocol === 'ws:' || url.protocol === 'wss:') {
    return;
  }
  
  // Check if this is a static asset
  const isStaticAsset = STATIC_ASSETS.some(asset => 
    url.pathname === asset || url.pathname.endsWith(asset)
  );
  
  if (isStaticAsset) {
    // Cache-first strategy for static assets
    event.respondWith(
      caches.match(event.request)
        .then(cachedResponse => {
          if (cachedResponse) {
            return cachedResponse;
          }
          
          // If not in cache, fetch from network and cache
          return fetch(event.request)
            .then(response => {
              // Clone the response as it can only be consumed once
              const responseToCache = response.clone();
              
              caches.open(CACHE_NAME)
                .then(cache => {
                  cache.put(event.request, responseToCache);
                });
                
              return response;
            })
            .catch(error => {
              console.error('Fetch failed for static asset:', error);
            });
        })
    );
  } else {
    // Network-first strategy for API and dynamic content
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Don't cache API responses or failed responses
          return response;
        })
        .catch(error => {
          console.log('Fetch failed, falling back to cache:', error);
          
          return caches.match(event.request)
            .then(cachedResponse => {
              if (cachedResponse) {
                return cachedResponse;
              }
              
              // If nothing in cache, return a simple offline message for HTML requests
              if (event.request.headers.get('accept').includes('text/html')) {
                return new Response('<html><body><h1>OBS Tally - Offline</h1><p>You are currently offline. Please check your connection.</p></body></html>', {
                  headers: { 'Content-Type': 'text/html' }
                });
              }
            });
        })
    );
  }
});
