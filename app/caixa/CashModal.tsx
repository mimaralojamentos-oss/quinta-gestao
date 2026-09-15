'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CashFundMovement } from '@/lib/types'
import { X } from 'lucide-react'

interface Props {
  onClose: () => void
  onSaved: () => void
  /**
   * Movimento manual a editar. Sem ele, cria um novo. Só movimentos com
   * source='manual' se editam aqui — os automáticos corrigem-se na origem,
   * a mesma regra do apagar.
   */
  movement?: CashFundMovement | null
}

export default function CashModal({ onClose, onSaved, movement }: Props) {
  const editar = !!movement
  const [form, setForm] = useState<{ movement_date: string; description: string; amount: string; type: string; notes: string }>(() =>
    movement
      ? {
          movement_date: movement.movement_date,
          description: movement.description ?? '',
          // Na base de dados a saída guarda-se negativa; aqui escreve-se sempre o valor absoluto.
          amount: String(Math.abs(Number(movement.amount))),
          type: movement.type,
          notes: movement.notes ?? '',
        }
      : {
          movement_date: new Date().toISOString().slice(0, 10),
          description: '',
          amount: '',
          type: 'entrada',
          notes: '',
        })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!form.description.trim() || !form.amount) { setError('Descrição e valor são obrigatórios'); return }
    const valor = Math.abs(parseFloat(String(form.amount).replace(',', '.')))
    if (isNaN(valor) || valor === 0) { setError('Indica um valor válido'); return }

    // O sinal vem sempre do tipo. Saída e transferência são dinheiro a SAIR da
    // caixa → negativo (a mesma regra do TransferModal e dos filtros da página).
    // Só a entrada é positiva. O utilizador escreve sempre o valor absoluto.
    const signedAmount = form.type === 'saida' || form.type === 'transferencia' ? -valor : valor

    const payload = {
      movement_date: form.movement_date,
      description: form.description.trim(),
      amount: signedAmount,
      type: form.type,
      notes: form.notes || null,
    }

    setSaving(true); setError('')

    if (movement) {
      // O filtro de origem repete a regra no próprio pedido: mesmo que o botão
      // fosse contornado, um movimento automático nunca é alterado aqui.
      const { data, error: err } = await supabase
        .from('cash_fund_movements')
        .update(payload)
        .eq('id', movement.id)
        .or('source.eq.manual,source.is.null')
        .select('id')
      setSaving(false)
      if (err) { setError(err.message); return }
      if (!data || data.length === 0) {
        setError('Não foi possível gravar: este movimento não é manual ou já não existe.')
        return
      }
    } else {
      const { error: err } = await supabase.from('cash_fund_movements').insert(payload)
      setSaving(false)
      if (err) { setError(err.message); return }
    }

    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-lg text-gray-900">{editar ? 'Editar Movimento de Caixa' : 'Novo Movimento de Caixa'}</h2>
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
            {form.type === 'transferencia' && (
              <p className="text-xs text-blue-700 mt-1.5">
                Dinheiro que sai da caixa (ex.: depósito no banco) — o saldo desce, tal como numa saída.
                Para transferências que queres conciliar com o extrato, usa &quot;Transferir para o banco&quot;.
              </p>
            )}
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
            {saving ? 'A guardar...' : editar ? 'Guardar alterações' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
