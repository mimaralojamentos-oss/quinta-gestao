'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { X } from 'lucide-react'

interface Props {
  onClose: () => void
  onSaved: () => void
}

export default function CashModal({ onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    movement_date: new Date().toISOString().slice(0, 10),
    description: '',
    amount: '',
    type: 'entrada',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!form.description || !form.amount) { setError('Descrição e valor são obrigatórios'); return }
    setSaving(true); setError('')

    const signedAmount = form.type === 'saida'
      ? -Math.abs(parseFloat(form.amount))
      : Math.abs(parseFloat(form.amount))

    const { error: err } = await supabase.from('cash_fund_movements').insert({
      movement_date: form.movement_date,
      description: form.description,
      amount: signedAmount,
      type: form.type,
      notes: form.notes || null,
    })

    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-lg text-gray-900">Novo Movimento de Caixa</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="space-y-4">
          {/* Type selector */}
          <div>
            <label className="label">Tipo de Movimento</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'entrada', label: '↑ Entrada', color: 'emerald' },
                { value: 'saida', label: '↓ Saída', color: 'red' },
                { value: 'transferencia', label: '↔ Transferência', color: 'blue' },
              ].map(opt => (
                <button key={opt.value} onClick={() => setForm(f => ({ ...f, type: opt.value }))}
                  className={`py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                    form.type === opt.value
                      ? opt.color === 'emerald' ? 'bg-emerald-600 text-white border-emerald-600'
                        : opt.color === 'red' ? 'bg-red-600 text-white border-red-600'
                        : 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Descrição *</label>
            <input className="input" placeholder="ex: Rendas de Janeiro, Pagamento EDP..." value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Valor (€) *</label>
              <input className="input" type="number" step="0.01" min="0" value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <label className="label">Data</label>
              <input className="input" type="date" value={form.movement_date}
                onChange={e => setForm(f => ({ ...f, movement_date: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="label">Notas</label>
            <textarea className="input" rows={2} value={form.notes}
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
