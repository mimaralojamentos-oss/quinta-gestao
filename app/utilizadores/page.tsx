'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/lib/auth-context'
import { formatDate } from '@/lib/utils'
import { Plus, ShieldCheck, Eye, Trash2, X, Loader2, Pencil } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface Profile {
  id: string
  name: string
  role: 'admin' | 'viewer'
  created_at: string
}

export default function UtilizadoresPage() {
  const { isAdmin, loading: authLoading, user } = useAuth()
  const router = useRouter()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editProfile, setEditProfile] = useState<Profile | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
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

  async function deleteUser(id: string, name: string) {
    if (!confirm(`Tem a certeza que quer apagar o utilizador "${name}"? Esta ação não pode ser desfeita.`)) return
    setDeleting(id)
    await supabase.from('profiles').delete().eq('id', id)
    await fetchUsers()
    setDeleting(null)
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
          <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
            <Plus className="w-4 h-4" />
            Criar Utilizador
          </button>
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-blue-800">Níveis de acesso</p>
              <p className="text-sm text-blue-600 mt-1">
                <strong>Administrador</strong> — acesso total · <strong>Visualizador</strong> — apenas leitura
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
                  <th className="table-header">Criado em</th>
                  <th className="table-header">Nível de Acesso</th>
                  <th className="table-header"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {profiles.map(profile => {
                  const isCurrentUser = profile.id === user?.id
                  return (
                    <tr key={profile.id} className={`hover:bg-gray-50 ${isCurrentUser ? 'bg-emerald-50/40' : ''}`}>
                      <td className="table-cell">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0">
                            <span className="text-sm font-bold text-emerald-700">
                              {profile.name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-gray-800">{profile.name}</p>
                              {isCurrentUser && (
                                <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">Você</span>
                              )}
                            </div>
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
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => setEditProfile(profile)}
                            className="flex items-center gap-1 text-xs text-emerald-600 hover:underline font-medium"
                          >
                            <Pencil className="w-3 h-3" /> Editar
                          </button>
                          {!isCurrentUser && (
                            <button
                              onClick={() => deleteUser(profile.id, profile.name)}
                              disabled={deleting === profile.id}
                              className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-medium"
                            >
                              {deleting === profile.id
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <Trash2 className="w-3 h-3" />}
                              Apagar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreateModal && (
        <CreateUserModal
          onClose={() => setShowCreateModal(false)}
          onSaved={() => { setShowCreateModal(false); fetchUsers() }}
        />
      )}

      {editProfile && (
        <EditUserModal
          profile={editProfile}
          isCurrentUser={editProfile.id === user?.id}
          onClose={() => setEditProfile(null)}
          onSaved={() => { setEditProfile(null); fetchUsers() }}
        />
      )}
    </AppLayout>
  )
}

function CreateUserModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'viewer' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate() {
    if (!form.email || !form.name || !form.password) { setError('Todos os campos são obrigatórios'); return }
    if (form.password.length < 6) { setError('A password deve ter pelo menos 6 caracteres'); return }
    setSaving(true); setError('')
    const res = await fetch('/api/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    setSaving(false)
    if (data.error) { setError(data.error); return }
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
            <input className="input" placeholder="ex: João Silva" value={form.name}
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

function EditUserModal({ profile, isCurrentUser, onClose, onSaved }: {
  profile: Profile
  isCurrentUser: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    name: profile.name,
    role: profile.role,
    password: '',
    confirmPassword: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  async function handleSave() {
    if (!form.name.trim()) { setError('O nome é obrigatório'); return }
    if (form.password && form.password.length < 6) { setError('A password deve ter pelo menos 6 caracteres'); return }
    if (form.password && form.password !== form.confirmPassword) { setError('As passwords não coincidem'); return }
    setSaving(true); setError('')

    const { error: profileErr } = await supabase
      .from('profiles')
      .update({ name: form.name.trim(), role: form.role })
      .eq('id', profile.id)

    if (profileErr) { setError(profileErr.message); setSaving(false); return }

    if (form.password) {
      const res = await fetch('/api/update-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: profile.id, password: form.password }),
      })
      const data = await res.json()
      if (data.error) { setError(data.error); setSaving(false); return }
    }

    setSaving(false)
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-lg text-gray-900">Editar Utilizador</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="label">Nome *</label>
            <input className="input" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className="label">Nível de Acesso</label>
            {isCurrentUser ? (
              <p className="text-sm text-gray-400 mt-1">Não pode alterar o seu próprio nível de acesso</p>
            ) : (
              <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as any }))}>
                <option value="viewer">👁 Visualizador (só leitura)</option>
                <option value="admin">🔑 Administrador (acesso total)</option>
              </select>
            )}
          </div>
          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Alterar Password</p>
            <div className="space-y-3">
              <div>
                <label className="label">Nova Password</label>
                <input className="input" type="password" placeholder="Deixa em branco para não alterar" value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
              </div>
              {form.password && (
                <div>
                  <label className="label">Confirmar Password</label>
                  <input className="input" type="password" placeholder="Repete a nova password" value={form.confirmPassword}
                    onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))} />
                </div>
              )}
            </div>
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> A guardar...</> : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
