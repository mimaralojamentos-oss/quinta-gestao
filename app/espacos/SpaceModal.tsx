'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Space } from '@/lib/types'
import { X } from 'lucide-react'

interface Tenant {
  id: string
  name: string
}

interface Props {
  space: Space | null
  onClose: () => void
  onSaved: () => void
}

export default function SpaceModal({ space, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    ref: space?.ref ?? '',
    type: space?.type ?? 'pavilhao',
    status: space?.status ?? 'disponivel',
    condition: space?.condition ?? '',
    notes: space?.notes ?? '',
    tenant_id: (space as any)?.tenant_id ?? '',
  })
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function fetchTenants() {
      const { data } = await supabase
        .from('tenants')
        .select('id, name')
        .order('name')
      setTenants(data ?? [])
    }
    fetchTenants()
  }, [])

  async function handleSave() {
    if (!form.ref.trim()) { setError('A referência é obrigatória'); return }
    setSaving(true)
    setError('')
    const payload = {
      ref: form.ref.trim().toUpperCase(),
      type: form.type,
      status: form.status,
      condition: form.condition || null,
      notes: form.notes || null,
      tenant_id: form.tenant_id || null,
    }
    let err
    if (space) {
      ;({ error: err } = await supabase.from('spaces').update(payload).eq('id', space.id))
    } else {
      ;({ error: err } = await supabase.from('spaces').insert(payload))
    }
    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-lg text-gray-900">{space ? 'Editar Espaço' : 'Novo Espaço'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Referência *</label>
              <input className="input" placeholder="ex: P01, H33" value={form.ref}
                onChange={e => setForm(f => ({ ...f, ref: e.target.value }))} />
            </div>
            <div>
              <label className="label">Tipo *</label>
              <select className="input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as any }))}>
                <option value="pavilhao">Pavilhão</option>
                <option value="habitacao">Habitação</option>
                <option value="casa">Casa</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Estado</label>
              <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as any }))}>
                <option value="disponivel">Disponível</option>
                <option value="arrendado">Arrendado</option>
              </select>
            </div>
            <div>
              <label className="label">Inquilino associado</label>
              <select className="input" value={form.tenant_id} onChange={e => setForm(f => ({ ...f, tenant_id: e.target.value }))}>
                <option value="">— Sem inquilino —</option>
                {tenants.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Condição do espaço</label>
            <input className="input" placeholder="ex: ótimo estado, precisa de obras..." value={form.condition}
              onChange={e => setForm(f => ({ ...f, condition: e.target.value }))} />
          </div>
          <div>
            <label className="label">Notas</label>
            <textarea className="input" rows={3} placeholder="Observações gerais..." value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'A guardar...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
