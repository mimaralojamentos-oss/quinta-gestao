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
const INACTIVITY_TIMEOUT = 15 * 60 * 1000 // 15 minutos
const WARNING_BEFORE = 2 * 60 * 1000 // aviso 2 minutos antes

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [showWarning, setShowWarning] = useState(false)
  const inactivityTimer = useRef<NodeJS.Timeout | null>(null)
  const warningTimer = useRef<NodeJS.Timeout | null>(null)

  function resetInactivityTimer() {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    if (warningTimer.current) clearTimeout(warningTimer.current)
    setShowWarning(false)

    // Aviso 2 minutos antes
    warningTimer.current = setTimeout(() => {
      setShowWarning(true)
    }, INACTIVITY_TIMEOUT - WARNING_BEFORE)

    // Logout após 15 minutos
    inactivityTimer.current = setTimeout(async () => {
      setShowWarning(false)
      await supabaseClient.auth.signOut()
      sessionStorage.clear()
      window.location.href = '/login'
    }, INACTIVITY_TIMEOUT)
  }

  function clearInactivityTimer() {
    if (inactivityTimer.current) { clearTimeout(inactivityTimer.current); inactivityTimer.current = null }
    if (warningTimer.current) { clearTimeout(warningTimer.current); warningTimer.current = null }
    setShowWarning(false)
  }

  useEffect(() => {
    let mounted = true

    async function getUser() {
      const { data: { user } } = await supabaseClient.auth.getUser()
      if (!mounted) return
      setUser(user)
      if (user) {
        const { data } = await supabaseClient.from('profiles').select('*').eq('id', user.id).single()
        if (mounted) setProfile(data)
        resetInactivityTimer()
      }
      if (mounted) setLoading(false)
    }

    getUser()

    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return
      if (event === 'SIGNED_IN' && session?.user) {
        setUser(session.user)
        const { data } = await supabaseClient.from('profiles').select('*').eq('id', session.user.id).single()
        if (mounted) setProfile(data)
        resetInactivityTimer()
        setLoading(false)
      }
      if (event === 'SIGNED_OUT') {
        setUser(null)
        setProfile(null)
        setLoading(false)
        clearInactivityTimer()
      }
    })

    const activityEvents = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click']
    const handleActivity = () => {
      if (inactivityTimer.current) resetInactivityTimer()
    }
    activityEvents.forEach(event => window.addEventListener(event, handleActivity))

    return () => {
      mounted = false
      subscription.unsubscribe()
      clearInactivityTimer()
      activityEvents.forEach(event => window.removeEventListener(event, handleActivity))
    }
  }, [])

  useEffect(() => {
    if (user) { resetInactivityTimer() } else { clearInactivityTimer() }
  }, [user])

  async function signOut() {
    clearInactivityTimer()
    await supabaseClient.auth.signOut()
    sessionStorage.clear()
    window.location.href = '/login'
  }

  return (
    <AuthContext.Provider value={{
      user, profile,
      isAdmin: profile?.role === 'admin',
      loading, signOut
    }}>
      {children}

      {/* Aviso de sessão a expirar */}
      {showWarning && (
        <div className="fixed bottom-6 right-6 z-50 bg-white border border-yellow-300 rounded-xl shadow-lg p-4 max-w-sm">
          <p className="text-sm font-semibold text-yellow-700 mb-1">⚠ Sessão a expirar</p>
          <p className="text-xs text-gray-600 mb-3">A tua sessão expira em 2 minutos por inatividade.</p>
          <button
            onClick={() => resetInactivityTimer()}
            className="w-full py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors">
            Continuar sessão
          </button>
        </div>
      )}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
