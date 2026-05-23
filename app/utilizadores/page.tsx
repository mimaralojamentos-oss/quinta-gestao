'use client'

export const dynamic = 'force-dynamic'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/lib/auth-context'
import { formatDate } from '@/lib/utils'
import { Plus, ShieldCheck, Eye, Trash2, X, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface Profile {
  id: string
  name: string
  role: 'admin' | 'viewer'
  created_at: string
  email?: string
}

export default function UtilizadoresPage() {
  const { isAdmin, loading: authLoading } = useAuth()
  const router = useRouter()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.push('/dashboard')
    }
  }, [isAdmin, authLoading])

  useEffect(() => { fetchUsers() }, [])

  async function fetchUsers() {
    setLoading(true)
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at')
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
            Convidar Utilizador
          </button>
        </div>

        {/* Info box */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-blue-800">Níveis de acesso</p>
              <p className="text-sm text-blue-600 mt-1">
                <strong>Administrador</strong> — acesso total (ler e escrever em todos os módulos) · <strong>Visualizador</strong> — apenas leitura, sem poder fazer alterações
              </p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="table-header">Utilizador</th>
                  <th className="table-header">Perfil criado</th>
                  <th className="table-header">Nível de Acesso</th>
                  <th className="table-header"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {profiles.map(profile => (
                  <tr key={profile.id} className="hover:bg-gray-50">
                    <td className="table-cell">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-sm font-bold text-emerald-700">
                            {profile.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium text-gray-800">{profile.name}</p>
                          <p className="text-xs text-gray-400">{profile.id.slice(0, 8)}...</p>
                        </div>
                      </div>
                    </td>
                    <td className="table-cell text-sm text-gray-500">
                      {formatDate(profile.created_at)}
                    </td>
                    <td className="table-cell">
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                        profile.role === 'admin'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {profile.role === 'admin'
                          ? <><ShieldCheck className="w-3 h-3" /> Administrador</>
                          : <><Eye className="w-3 h-3" /> Visualizador</>
                        }
                      </span>
                    </td>
                    <td className="table-cell">
                      <select
                        value={profile.role}
                        onChange={e => changeRole(profile.id, e.target.value as 'admin' | 'viewer')}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 hover:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      >
                        <option value="admin">Tornar Administrador</option>
                        <option value="viewer">Tornar Visualizador</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <InviteModal
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); fetchUsers() }}
        />
      )}
    </AppLayout>
  )
}

function InviteModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'viewer' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  async function handleCreate() {
    if (!form.email || !form.name || !form.password) {
      setError('Todos os campos são obrigatórios')
      return
    }
    if (form.password.length < 6) {
      setError('A password deve ter pelo menos 6 caracteres')
      return
    }
    setSaving(true)
    setError('')

    const { error: err } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        data: { name: form.name, role: form.role }
      }
    })

    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-lg text-gray-900">Criar Utilizador</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">Nome *</label>
            <input className="input" placeholder="ex: miguelseverino" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className="label">Email *</label>
            <input className="input" type="email" placeholder="email@exemplo.com" value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <label className="label">Password *</label>
            <input className="input" type="password" placeholder="mínimo 6 caracteres" value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
          </div>
          <div>
            <label className="label">Nível de Acesso</label>
            <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              <option value="viewer">👁 Visualizador (só leitura)</option>
              <option value="admin">🔑 Administrador (acesso total)</option>
            </select>
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={handleCreate} disabled={saving}>
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> A criar...</> : 'Criar Utilizador'}
          </button>
        </div>
      </div>
    </div>
  )
}
