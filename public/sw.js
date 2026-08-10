/**
 * Service worker mínimo.
 *
 * Existe por duas razões:
 *   1. O Chrome no Android só oferece "Instalar aplicação" a sites que tenham
 *      um service worker com tratamento de pedidos. Sem isto, faz apenas um
 *      atalho com ícone genérico.
 *   2. Quando não há rede, mostra uma página a explicar, em vez do erro feio
 *      do navegador.
 *
 * DE PROPÓSITO NÃO GUARDA DADOS.
 * Rendas, dívidas e saldos vêm sempre da rede, sem exceção. Guardar estes
 * valores no telemóvel seria pior do que não mostrar nada — o utilizador
 * podia estar a olhar para uma dívida já paga e a tomar decisões erradas.
 * A única coisa guardada é a página de "sem ligação".
 */

const CACHE = 'quinta-offline-v1'
const PAGINA_OFFLINE = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll([PAGINA_OFFLINE]))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(
        chaves.filter((c) => c !== CACHE).map((c) => caches.delete(c))
      ))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const pedido = event.request

  // Só interessa a navegação entre páginas. Tudo o resto — dados, imagens,
  // chamadas ao Supabase — segue direto para a rede, sem passar por aqui.
  if (pedido.method !== 'GET' || pedido.mode !== 'navigate') return

  event.respondWith(
    fetch(pedido).catch(() => caches.match(PAGINA_OFFLINE))
  )
})
