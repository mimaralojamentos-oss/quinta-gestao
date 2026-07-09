import { createBrowserClient } from '@supabase/ssr'

// Usar sessionStorage em vez de localStorage
// Isto faz com que fechar a janela/tab faça logout automaticamente
const sessionStorageAdapter = {
  getItem: (key: string) => {
    if (typeof window === 'undefined') return null
    return window.sessionStorage.getItem(key)
  },
  setItem: (key: string, value: string) => {
    if (typeof window === 'undefined') return
    window.sessionStorage.setItem(key, value)
  },
  removeItem: (key: string) => {
    if (typeof window === 'undefined') return
    window.sessionStorage.removeItem(key)
  },
}

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        storage: sessionStorageAdapter,
        persistSession: true,
      }
    }
  )
}
