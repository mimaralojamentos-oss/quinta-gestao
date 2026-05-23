'use client'

export const dynamic = 'force-dynamic'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/lib/auth-context'
import { formatDate } from '@/lib/utils'
import { Plus, ShieldCheck, Eye, X, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface Profile {
  id: string
  name: string
  role: 'admin' | 'viewer'
  created_at: string
}

export default function UtilizadoresPage() {
  const { isAdmin, loading: authLoading } = useAuth()
  const router = useRouter()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    if (!authLoading && !isAdmin) router.push('/dashboard')
  }, [isAdmin, authLoading])

  useEffect(() => { fetchUsers() }, [])

  async function fetchUsers() {
    setLoading(true)
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    setProfiles(data ?? [])
    setLoading(false)
  }

  async function changeRole(id: string, role: 'admin' | 'viewer') {
    await supabase.from('profiles').update({ role }).eq('id', id)
    fetchUsers()
  }

  if (authLoading) return null

  return (
    <AppLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Utilizadores</h1>
            <p className="text-sm text-gray-500 mt-1">{profiles.length} utilizadores registados</p>
          </div>
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            <Plus className="w-4 h-4" />
            Criar Utilizador
          </button>
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <ShieldCheck cla
