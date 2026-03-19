const CACHE_NAME = 'cafe-na-rota-v21';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './assets/logo.png'
];

// Instalação: Cacheia os arquivos essenciais
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Ativação: Limpa caches antigos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Promessa de timeout: se a rede demorar mais de 5s, rejeita e usa cache
function fetchWithTimeout(request, timeoutMs = 5000) {
  return Promise.race([
    fetch(request.clone()),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Network timeout')), timeoutMs)
    )
  ]);
}

// Estratégia: Network First com Timeout de 5s
// - Se a rede responder em < 5s: usa a rede (dados frescos)
// - Se a rede demorar + de 5s ou falhar: usa o cache imediatamente
self.addEventListener('fetch', (event) => {
  // Apenas intercepta requisições do próprio app (HTML, CSS, JS, imagens)
  // Não intercepta chamadas de API (Supabase) para não atrasar os dados
  const url = new URL(event.request.url);
  if (url.hostname.includes('supabase.co') || url.origin !== self.location.origin) {
    return; // Deixa o Supabase e CDNs externos passarem direto
  }

  event.respondWith(
    fetchWithTimeout(event.request, 5000)
      .then(response => {
        // Atualiza o cache com a resposta mais recente
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        return response;
      })
      .catch(() => {
        // Timeout ou sem rede: serve o cache
        return caches.match(event.request);
      })
  );
});
