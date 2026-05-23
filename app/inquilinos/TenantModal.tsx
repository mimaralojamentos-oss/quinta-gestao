'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Tenant } from '@/lib/types'
import { X } from 'lucide-react'

interface Props {
  tenant: Tenant | null
  onClose: () => void
  onSaved: () => void
}

export default function TenantModal({ tenant, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    name: tenant?.name ?? '',
    phone: tenant?.phone ?? '',
    email: tenant?.email ?? '',
    nif: tenant?.nif ?? '',
    notes: tenant?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!form.name.trim()) { setError('O nome é obrigatório'); return }
    setSaving(true); setError('')

    const payload = {
      name: form.name.trim(),
      phone: form.phone || null,
      email: form.email || null,
      nif: form.nif || null,
      notes: form.notes || null,
    }

    let err
    if (tenant) {
      ;({ error: err } = await supabase.from('tenants').update(payload).eq('id', tenant.id))
    } else {
      ;({ error: err } = await supabase.from('tenants').insert(payload))
    }

    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-lg text-gray-900">{tenant ? 'Editar Inquilino' : 'Novo Inquilino'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">Nome completo *</label>
            <input className="input" placeholder="Nome do inquilino" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Telefone</label>
              <input className="input" placeholder="9XX XXX XXX" value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <label className="label">NIF</label>
              <input className="input" placeholder="XXX XXX XXX" value={form.nif}
                onChange={e => setForm(f => ({ ...f, nif: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" placeholder="email@exemplo.com" value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <label className="label">Notas</label>
            <textarea className="input" rows={3} placeholder="Observações..." value={form.notes}
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
