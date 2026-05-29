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
const INACTIVITY_TIMEOUT = 60 * 60 * 1000 // 1 hora

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const inactivityTimer = useRef<NodeJS.Timeout | null>(null)

  function resetInactivityTimer() {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    inactivityTimer.current = setTimeout(async () => {
      await supabaseClient.auth.signOut()
      sessionStorage.clear()
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
      }
    })

    // Logout ao fechar a janela/tab
    const handleBeforeUnload = () => {
      supabaseClient.auth.signOut()
      sessionStorage.clear()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    // Resetar timer com qualquer atividade
    const activityEvents = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click']
    const handleActivity = () => {
      if (inactivityTimer.current) resetInactivityTimer()
    }
    activityEvents.forEach(event => window.addEventListener(event, handleActivity))

    return () => {
      mounted = false
      subscription.unsubscribe()
      clearInactivityTimer()
      window.removeEventListener('beforeunload', handleBeforeUnload)
      activityEvents.forEach(event => window.removeEventListener(event, handleActivity))
    }
  }, [])

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
    sessionStorage.clear()
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
