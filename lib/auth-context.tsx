'use client'
import { createContext, useContext, useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase-client'
import { logAccess } from '@/lib/logAccess'
import type { User } from '@supabase/supabase-js'

interface Profile {
  id: string
  name: string
  role: 'admin' | 'coadmin' | 'viewer' | 'electrician'
}

interface AuthContextType {
  user: User | null
  profile: Profile | null
  isAdmin: boolean
  isCoAdmin: boolean
  isElectrician: boolean
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null, profile: null, isAdmin: false, isCoAdmin: false, isElectrician: false, loading: true, signOut: async () => {},
})

const supabaseClient = createClient()
const INACTIVITY_TIMEOUT = 15 * 60 * 1000
const WARNING_BEFORE = 2 * 60 * 1000

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [showWarning, setShowWarning] = useState(false)
  const inactivityTimer = useRef<NodeJS.Timeout | null>(null)
  const warningTimer = useRef<NodeJS.Timeout | null>(null)
  const userRef = useRef<User | null>(null)

  function resetInactivityTimer() {
    if (!userRef.current) return
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    if (warningTimer.current) clearTimeout(warningTimer.current)
    setShowWarning(false)
    warningTimer.current = setTimeout(() => setShowWarning(true), INACTIVITY_TIMEOUT - WARNING_BEFORE)
    inactivityTimer.current = setTimeout(async () => {
      setShowWarning(false)
      await logAccess({ action: 'logout', page: window.location.pathname, details: 'Sessão expirada por inatividade' })
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

    supabaseClient.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return
      const u = session?.user ?? null
      userRef.current = u
      setUser(u)
      if (u) {
        const { data } = await supabaseClient.from('profiles').select('*').eq('id', u.id).single()
        if (mounted) setProfile(data)
        resetInactivityTimer()
      }
      if (mounted) setLoading(false)
    })

    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      if (event === 'SIGNED_OUT') {
        userRef.current = null
        setUser(null)
        setProfile(null)
        setLoading(false)
        clearInactivityTimer()
      }
    })

    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click']
    const handleActivity = () => resetInactivityTimer()
    activityEvents.forEach(e => window.addEventListener(e, handleActivity))

    return () => {
      mounted = false
      subscription.unsubscribe()
      clearInactivityTimer()
      activityEvents.forEach(e => window.removeEventListener(e, handleActivity))
    }
  }, [])

  async function signOut() {
    clearInactivityTimer()
    userRef.current = null
    await logAccess({ action: 'logout', page: window.location.pathname })
    await supabaseClient.auth.signOut()
    sessionStorage.clear()
    window.location.href = '/login'
  }

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      isAdmin: profile?.role === 'admin',
      isCoAdmin: profile?.role === 'coadmin',
      isElectrician: profile?.role === 'electrician',
      loading,
      signOut
    }}>
      {children}
      {showWarning && (
        <div className="fixed bottom-6 right-6 z-50 bg-white border border-yellow-300 rounded-xl shadow-lg p-4 max-w-sm">
          <p className="text-sm font-semibold text-yellow-700 mb-1">⚠ Sessão a expirar</p>
          <p className="text-xs text-gray-600 mb-3">A tua sessão expira em 2 minutos por inatividade.</p>
          <button onClick={() => resetInactivityTimer()}
            className="w-full py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors">
            Continuar sessão
          </button>
        </div>
      )}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
