'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/lib/auth-context'
import { Shield, Plus, Trash2, Eye, Zap, Key, ChevronLeft } from 'lucide-react'
import Link from 'next/link'

type Profile = {
  id: string
  email: string
  role: 'admin' | 'coadmin' | 'viewer' | 'electrician'
  created_at: string
}

export default function UtilizadoresPage() {
  const { profile } = useAuth()
  const supabase = createClient()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<'admin' | 'coadmin' | 'viewer' | 'electrician'>('viewer')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchProfiles()
  }, [])

  async function fetchProfiles() {
    const { data: profilesData } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at')

    if (!profilesData) { setLoading(false); return }

    const res = await fetch('/api/create-user', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    let emailMap: Record<string, string> = {}
    if (res.ok) {
      const data = await res.json()
      if (data.users) {
        for (const u of data.users) {
          emailMap[u.id] = u.email
        }
      }
    }

    const combined = profilesData.map(p => ({
      ...p,
      email: emailMap[p.id] || p.email || '(sem email)'
    }))

    setProfiles(combined)
    setLoading(false)
  }

  async function handleCreate() {
    setCreating(true)
    setError('')
    try {
      const res = await fetch('/api/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail, password: newPassword, role: newRole })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao criar utilizador')
      setShowCreate(false)
      setNewEmail('')
      setNewPassword('')
      setNewRole('viewer')
      fetchProfiles()
    } catch (e: any) {
      setError(e.message)
    }
    setCreating(false)
  }

  async function handleChangeRole(id: string, role: 'admin' | 'coadmin' | 'viewer' | 'electrician') {
    await supabase.from('profiles').update({ role }).eq('id', id)
    fetchProfiles()
  }

  async function handleDelete(id: string) {
    if (!confirm('Tens a certeza que queres apagar este utilizador?')) return
    await fetch('/api/create-user', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    })
    fetchProfiles()
  }

  function getRoleLabel(role: string) {
    if (role === 'admin') return 'Administrador'
    if (role === 'coadmin') return 'Co-Administrador'
    if (role === 'electrician') return 'Eletricista'
    return 'Visualizador'
  }

  function getRoleIcon(role: string) {
    if (role === 'admin') return <Shield className="w-4 h-4 text-red-500" />
    if (role === 'coadmin') return <Key className="w-4 h-4 text-orange-500" />
    if (role === 'electrician') return <Zap className="w-4 h-4 text-yellow-500" />
    return <Eye className="w-4 h-4 text-gray-400" />
  }

  function getRoleBadge(role: string) {
    if (role === 'admin') return 'bg-red-100 text-red-700'
    if (role === 'coadmin') return 'bg-orange-100 text-orange-700'
    if (role === 'electrician') return 'bg-yellow-100 text-yellow-700'
    return 'bg-gray-100 text-gray-600'
  }

  if (profile?.role !== 'admin') {
    return (
      <div className="p-8 text-center text-gray-500">
        Não tens permissão para aceder a esta página.
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" prefetch={false} className="text-gray-400 hover:text-gray-600 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Utilizadores</h1>
            <p className="text-sm text-gray-500 mt-1">Gestão de acessos ao sistema</p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          Novo Utilizador
        </button>
      </div>

      {/* Legenda de roles */}
      <div className="bg-gray-50 rounded-lg p-4 mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-red-500" />
          <div>
            <div className="font-medium text-gray-700">Administrador</div>
            <div className="text-gray-500 text-xs">Acesso total</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-orange-500" />
          <div>
            <div className="font-medium text-gray-700">Co-Administrador</div>
            <div className="text-gray-500 text-xs">Acesso total, sem gerir utilizadores</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-yellow-500" />
          <div>
            <div className="font-medium text-gray-700">Eletricista</div>
            <div className="text-gray-500 text-xs">Ver tudo + editar eletricidade</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-gray-400" />
          <div>
            <div className="font-medium text-gray-700">Visualizador</div>
            <div className="text-gray-500 text-xs">Só leitura</div>
          </div>
        </div>
      </div>

      {/* Lista de utilizadores */}
      {loading ? (
        <p className="text-gray-500">A carregar...</p>
      ) : (
        <div className="space-y-3">
          {profiles.map(p => (
            <div key={p.id} className="bg-white border rounded-lg p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {getRoleIcon(p.role)}
                <div>
                  <div className="font-medium text-gray-900">{p.email}</div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getRoleBadge(p.role)}`}>
                    {getRoleLabel(p.role)}
                  </span>
                </div>
              </div>
              {p.id !== profile?.id && (
                <div className="flex items-center gap-2">
                  <select
                    value={p.role}
                    onChange={e => handleChangeRole(p.id, e.target.value as any)}
                    className="text-sm border rounded px-2 py-1 text-gray-700"
                  >
                    <option value="viewer">Visualizador</option>
                    <option value="electrician">Eletricista</option>
                    <option value="coadmin">Co-Administrador</option>
                    <option value="admin">Administrador</option>
                  </select>
                  <button
                    onClick={() => handleDelete(p.id)}
                    className="text-red-400 hover:text-red-600 p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal criar utilizador */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-bold mb-4">Novo Utilizador</h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Email</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 mt-1 text-sm"
                  placeholder="email@exemplo.com"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 mt-1 text-sm"
                  placeholder="Mínimo 6 caracteres"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Nível de acesso</label>
                <select
                  value={newRole}
                  onChange={e => setNewRole(e.target.value as any)}
                  className="w-full border rounded-lg px-3 py-2 mt-1 text-sm"
                >
                  <option value="viewer">Visualizador — só leitura</option>
                  <option value="electrician">Eletricista — ver tudo + editar eletricidade</option>
                  <option value="coadmin">Co-Administrador — acesso total, sem gerir utilizadores</option>
                  <option value="admin">Administrador — acesso total</option>
                </select>
              </div>
              {error && <p className="text-red-500 text-sm">{error}</p>}
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => { setShowCreate(false); setError('') }}
                className="flex-1 border rounded-lg px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newEmail || !newPassword}
                className="flex-1 bg-blue-600 text-white rounded-lg px-4 py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {creating ? 'A criar...' : 'Criar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
