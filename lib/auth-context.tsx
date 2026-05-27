'use client'
import { createContext, useContext, useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase-client'
import type { User } from '@supabase/supabase-js'

interface Profile {
  id: string
  name: string
  role: 'admin' | 'viewer'
}

interface AuthContextType {
  user: User | null
  profile: Profile | null
  isAdmin: boolean
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  isAdmin: false,
  loading: true,
  signOut: async () => {},
})

const supabaseClient = createClient()
const INACTIVITY_TIMEOUT = 60 * 60 * 1000 // 1 hora em milissegundos

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const inactivityTimer = useRef<NodeJS.Timeout | null>(null)

  // Logout automático por inatividade
  function resetInactivityTimer() {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    inactivityTimer.current = setTimeout(async () => {
      await supabaseClient.auth.signOut()
      window.location.href = '/login'
    }, INACTIVITY_TIMEOUT)
  }

  function clearInactivityTimer() {
    if (inactivityTimer.current) {
      clearTimeout(inactivityTimer.current)
      inactivityTimer.current = null
    }
  }

  useEffect(() => {
    let mounted = true

    async function getUser() {
      const { data: { user } } = await supabaseClient.auth.getUser()
      if (!mounted) return
      setUser(user)
      if (user) {
        const { data } = await supabaseClient
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single()
        if (mounted) setProfile(data)
        // Iniciar timer de inatividade quando há utilizador
        resetInactivityTimer()
      }
      if (mounted) setLoading(false)
    }

    getUser()

    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return
      if (event === 'SIGNED_OUT') {
        setUser(null)
        setProfile(null)
        setLoading(false)
        clearInactivityTimer()
        return
      }
    })

    // Eventos de atividade do utilizador — resetar o timer
    const activityEvents = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click']
    const handleActivity = () => {
      if (user) resetInactivityTimer()
    }
    activityEvents.forEach(event => window.addEventListener(event, handleActivity))

    // Logout ao fechar a janela/tab
    const handleBeforeUnload = () => {
      supabaseClient.auth.signOut()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      mounted = false
      subscription.unsubscribe()
      clearInactivityTimer()
      activityEvents.forEach(event => window.removeEventListener(event, handleActivity))
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  // Atualizar o timer quando o user muda
  useEffect(() => {
    if (user) {
      resetInactivityTimer()
    } else {
      clearInactivityTimer()
    }
  }, [user])

  async function signOut() {
    clearInactivityTimer()
    await supabaseClient.auth.signOut()
    window.location.href = '/login'
  }

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      isAdmin: profile?.role === 'admin',
      loading,
      signOut
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
