'use client'
import { createContext, useContext, useEffect, useState } from 'react'
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

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
      }

      if (mounted) setLoading(false)
    }

    getUser()

    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return

      // Só reagir a SIGNED_OUT — ignorar TOKEN_REFRESHED, INITIAL_SESSION, etc.
      if (event === 'SIGNED_OUT') {
        setUser(null)
        setProfile(null)
        setLoading(false)
        return
      }

      // Ignorar todos os outros eventos (TOKEN_REFRESHED, USER_UPDATED, etc.)
      // O utilizador já foi carregado no getUser() acima
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  async function signOut() {
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
