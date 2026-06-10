'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { getCurrentMonth } from '@/lib/utils'
import { X } from 'lucide-react'

interface Props {
  onClose: () => void
  onSaved: () => void
}

export default function AdvancePaymentModal({ onClose, onSaved }: Props) {
  const [leases, setLeases] = useState<any[]>([])
  const [loadingLeases, setLoadingLeases] = useState(true)
  const [leaseId, setLeaseId] = useState('')
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('dinheiro')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { fetchLeases() }, [])

  async function fetchLeases() {
    setLoadingLeases(true)
    const { data } = await supabase
      .from('leases')
      .select('id, space:spaces(ref), tenant:tenants(name)')
      .eq('status', 'ativo')
    const sorted = (data ?? []).sort((a: any, b: any) => (a.space?.ref ?? '').localeCompare(b.space?.ref ?? ''))
    setLeases(sorted)
    setLoadingLeases(false)
  }

  async function handleSave() {
    if (!leaseId) { setError('Seleciona um espaço/inquilino'); return }
    const value = parseFloat(amount)
    if (!amount || value <= 0) { setError('Indica um valor válido'); return }
    setSaving(true); setError('')

    const lease = leases.find(l => l.id === leaseId)
    const today = new Date().toISOString().slice(0, 10)

    const { data: newPayment, error: err } = await supabase.from('rent_payments').insert({
      lease_id: leaseId,
      reference_month: getCurrentMonth(),
      payment_date: today,
      amount: value,
      payment_method: paymentMethod,
      tipo: 'adiantamento',
    }).select().single()

    if (err) { setError(err.message); setSaving(false); return }

    if (paymentMethod === 'dinheiro' && newPayment) {
      await supabase.from('cash_fund_movements').insert({
        movement_date: today,
        description: `💰 Adiantamento — ${lease?.space?.ref} (${lease?.tenant?.name})`,
        amount: value,
        type: 'entrada',
        source: 'renda',
        source_id: newPayment.id,
      })
    }

    setSaving(false)
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg text-gray-900">💰 Registar Adiantamento</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">Espaço / Inquilino *</label>
            <select className="input" value={leaseId} onChange={e => setLeaseId(e.target.value)} disabled={loadingLeases}>
              <option value="">Seleciona...</option>
              {leases.map(l => (
                <option key={l.id} value={l.id}>
                  {l.space?.ref}{l.tenant?.name ? ` — ${l.tenant.name}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Valor (€) *</label>
            <input className="input" type="number" step="0.01" min="0" placeholder="0.00"
              value={amount} onChange={e => setAmount(e.target.value)} />
          </div>

          <div>
            <label className="label">Método de Pagamento</label>
            <div className="grid grid-cols-2 gap-3 mt-1">
              {['dinheiro', 'banco'].map(method => (
                <button key={method} onClick={() => setPaymentMethod(method)}
                  className={`py-2.5 rounded-lg border text-sm font-medium transition-colors ${paymentMethod === method ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                  {method === 'dinheiro' ? '💵 Dinheiro' : '🏦 Banco/Transferência'}
                </button>
              ))}
            </div>
            {paymentMethod === 'dinheiro' && (
              <p className="text-xs text-emerald-600 mt-1.5">✓ Este valor será registado automaticamente no Fundo de Maneio</p>
            )}
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'A guardar...' : 'Guardar Adiantamento'}
          </button>
        </div>
      </div>
    </div>
  )
}
