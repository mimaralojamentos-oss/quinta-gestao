'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate, getMonthLabel } from '@/lib/utils'
import { X, Pencil, Trash2 } from 'lucide-react'

interface Props {
  lease: any
  currentMonth: string
  onClose: () => void
  onSaved: () => void
}

const tipoConfig = {
  renda:  { label: '🏠 Renda', color: 'bg-emerald-600 text-white border-emerald-600' },
  caucao: { label: '🔒 Caução / Sinal', color: 'bg-blue-600 text-white border-blue-600' },
  extra:  { label: '➕ Extra', color: 'bg-orange-500 text-white border-orange-500' },
  luz:    { label: '⚡ Luz', color: 'bg-yellow-500 text-white border-yellow-500' },
}

const tipoLabels: Record<string, string> = {
  renda: '🏠 Renda',
  caucao: '🔒 Caução',
  extra: '➕ Extra',
  luz: '⚡ Luz',
}

export default function PaymentModal({ lease, currentMonth, onClose, onSaved }: Props) {
  const [editingPayment, setEditingPayment] = useState<any | null>(null)
  const [form, setForm] = useState({
    amount: String(lease.monthly_rent),
    payment_date: new Date().toISOString().slice(0, 10),
    payment_method: 'dinheiro',
    tipo: 'renda',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function handleStartEdit(p: any) {
    setEditingPayment(p)
    setForm({
      amount: String(p.amount),
      payment_date: p.payment_date ?? new Date().toISOString().slice(0, 10),
      payment_method: p.payment_method ?? 'dinheiro',
      tipo: p.tipo ?? 'renda',
      notes: p.notes ?? '',
    })
  }

  function handleCancelEdit() {
    setEditingPayment(null)
    setForm({
      amount: String(lease.monthly_rent),
      payment_date: new Date().toISOString().slice(0, 10),
      payment_method: 'dinheiro',
      tipo: 'renda',
      notes: '',
    })
  }

  async function handleDelete(id: string) {
    if (!confirm('Tens a certeza que queres apagar este pagamento?')) return
    await supabase.from('rent_payments').delete().eq('id', id)
    onSaved()
  }

  async function handleSave() {
    if (!form.amount || !form.payment_date) { setError('Valor e data são obrigatórios'); return }
    setSaving(true); setError('')

    if (editingPayment) {
      // Editar existente
      const { error: err } = await supabase.from('rent_payments').update({
        payment_date: form.payment_date,
        amount: parseFloat(form.amount),
        payment_method: form.payment_method,
        tipo: form.tipo,
        notes: form.notes || null,
      }).eq('id', editingPayment.id)
      setSaving(false)
      if (err) { setError(err.message); return }
    } else {
      // Novo pagamento
      const { error: err } = await supabase.from('rent_payments').insert({
        lease_id: lease.id,
        reference_month: currentMonth,
        payment_date: form.payment_date,
        amount: parseFloat(form.amount),
        payment_method: form.payment_method,
        tipo: form.tipo,
        notes: form.notes || null,
      })
      setSaving(false)
      if (err) { setError(err.message); return }
    }

    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-semibold text-lg text-gray-900">
              {editingPayment ? 'Editar Pagamento' : 'Registar Pagamento'}
            </h2>
            <p className="text-sm text-gray-500">{lease.tenant?.name} · {lease.space?.ref} · {getMonthLabel(currentMonth)}</p>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        {/* Pagamentos já registados */}
        {lease.payments_this_month?.length > 0 && (
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <p className="text-xs font-medium text-gray-500 mb-2">Pagamentos registados este mês:</p>
            {lease.payments_this_month.map((p: any) => (
              <div key={p.id} className={`flex justify-between items-center text-sm py-1.5 px-2 rounded-lg mb-1 ${editingPayment?.id === p.id ? 'bg-emerald-50 border border-emerald-200' : 'hover:bg-gray-100'}`}>
                <div className="flex items-center gap-2">
                  <span className="text-gray-700">{p.payment_date ? new Date(p.payment_date).toLocaleDateString('pt-PT') : '—'}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">
                    {tipoLabels[p.tipo] ?? p.tipo}
                  </span>
                  {p.notes && <span className="text-xs text-gray-400 truncate max-w-[80px]">{p.notes}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-emerald-600">{formatCurrency(p.amount)}</span>
                  <button onClick={() => handleStartEdit(p)} title="Editar"
                    className="text-gray-400 hover:text-blue-500 transition-colors">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(p.id)} title="Apagar"
                    className="text-gray-400 hover:text-red-500 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Formulário */}
        {editingPayment && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4 flex items-center justify-between">
            <p className="text-xs text-emerald-700 font-medium">✏️ A editar pagamento de {formatCurrency(editingPayment.amount)}</p>
            <button onClick={handleCancelEdit} className="text-xs text-gray-500 hover:underline">Cancelar edição</button>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="label">Tipo de Pagamento</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {Object.entries(tipoConfig).map(([key, cfg]) => (
                <button key={key}
                  onClick={() => setForm(f => ({ ...f, tipo: key }))}
                  className={`py-2 rounded-lg border text-sm font-medium transition-colors ${
                    form.tipo === key ? cfg.color : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}>
                  {cfg.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Valor (€) *</label>
              <input className="input" type="number" step="0.01" value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
              <p className="text-xs text-gray-500 mt-1">Renda: {formatCurrency(lease.monthly_rent)}</p>
            </div>
            <div>
              <label className="label">Data do Pagamento *</label>
              <input className="input" type="date" value={form.payment_date}
                onChange={e => setForm(f => ({ ...f, payment_date: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="label">Método de Pagamento</label>
            <div className="grid grid-cols-2 gap-3 mt-1">
              {['dinheiro', 'banco'].map(method => (
                <button key={method}
                  onClick={() => setForm(f => ({ ...f, payment_method: method }))}
                  className={`py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                    form.payment_method === method
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}>
                  {method === 'dinheiro' ? '💵 Dinheiro' : '🏦 Banco/Transferência'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Notas</label>
            <input className="input" placeholder="ex: pago em mão ao Miguel" value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button className="btn-secondary" onClick={editingPayment ? handleCancelEdit : onClose}>
            {editingPayment ? 'Cancelar edição' : 'Cancelar'}
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'A guardar...' : editingPayment ? 'Guardar alterações' : 'Guardar Pagamento'}
          </button>
        </div>
      </div>
    </div>
  )
}
