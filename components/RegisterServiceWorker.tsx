'use client'

import { useEffect } from 'react'

/**
 * Liga o service worker (public/sw.js).
 *
 * É o que faz o Chrome no Android passar a oferecer "Instalar aplicação"
 * em vez de um simples atalho. Não mostra nada no ecrã.
 */
export default function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return

    // Sem await nem bloqueios: se falhar, a aplicação funciona na mesma,
    // apenas não fica instalável.
    navigator.serviceWorker.register('/sw.js').catch((e) => {
      console.warn('[sw] não foi possível registar:', e)
    })
  }, [])

  return null
}
