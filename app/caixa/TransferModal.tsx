'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency } from '@/lib/utils'
import { X, ArrowRight, Wallet, Building, Loader2 } from 'lucide-react'

interface Bank {
  id: string
  name: string
  holder_name: string | null
}

interface Props {
  currentBalance: number
  onClose: () => void
  onSaved: () => void
}

/**
 * Transferência do Fundo de Maneio para uma conta bancária.
 *
 * A saída da caixa é registada imediatamente (o saldo desce logo), mas fica
 * marcada como 'pendente'. Quando o extrato do banco for importado, a entrada
 * correspondente confirma a transferência e liga as duas pontas — evitando
 * que o mesmo dinheiro seja contado duas vezes.
 */
export default function TransferModal({ currentBalance, onClose, onSaved }: Props) {
  const supabase = createClient()
  const [banks, setBanks] = useState<Bank[]>([])
  const [loadingBanks, setLoadingBanks] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    movement_date: new Date().toISOString().slice(0, 10),
    amount: '',
    bank_id: '',
    notes: '',
  })

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('banks').select('id, name, holder_name').order('name')
      setBanks(data ?? [])
      if (data && data.length === 1) setForm(f => ({ ...f, bank_id: data[0].id }))
      setLoadingBanks(false)
    }
    load()
  }, [])

  const amountNumber = parseFloat(String(form.amount).replace(',', '.'))
  const amountValid = !isNaN(amountNumber) && amountNumber > 0
  const exceedsBalance = amountValid && amountNumber > currentBalance
  const balanceAfter = amountValid ? currentBalance - amountNumber : currentBalance

  async function handleSave() {
    if (!amountValid) { setError('Indica um valor superior a zero.'); return }
    if (!form.bank_id) { setError('Escolhe o banco de destino.'); return }
    if (exceedsBalance && !confirm(
      `O valor (${formatCurrency(amountNumber)}) é superior ao saldo do fundo de maneio (${formatCurrency(currentBalance)}).\n\nQueres registar na mesma?`
    )) return

    setSaving(true); setError('')

    const bank = banks.find(b => b.id === form.bank_id)

    const { error: err } = await supabase.from('cash_fund_movements').insert({
      movement_date: form.movement_date,
      description: `Transferência para ${bank?.name ?? 'banco'}`,
      amount: -Math.abs(amountNumber),
      type: 'transferencia',
      source: 'transferencia_banco',
      bank_id: form.bank_id,
      transfer_status: 'pendente',
      notes: form.notes || 'A aguardar confirmação no extrato bancário',
    })

    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-lg text-gray-900">Transferir para o Banco</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        {/* Origem → destino */}
        <div className="flex items-center gap-3 mb-5 p-3 bg-gray-50 rounded-lg">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500 flex items-center gap-1"><Wallet className="w-3 h-3" /> Fundo de Maneio</p>
            <p className="text-sm font-semibold text-gray-900">{formatCurrency(currentBalance)}</p>
          </div>
          <ArrowRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <div className="flex-1 min-w-0 text-right">
            <p className="text-xs text-gray-500 flex items-center gap-1 justify-end"><Building className="w-3 h-3" /> Banco</p>
            <p className="text-sm font-semibold text-gray-900 truncate">
              {banks.find(b => b.id === form.bank_id)?.name ?? '—'}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">Banco de destino *</label>
            {loadingBanks ? (
              <p className="text-sm text-gray-400 py-2">A carregar bancos...</p>
            ) : banks.length === 0 ? (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                Não há bancos registados. Cria um primeiro em Financeiro → Bancos.
              </p>
            ) : (
              <select className="input" value={form.bank_id}
                onChange={e => setForm(f => ({ ...f, bank_id: e.target.value }))}>
                <option value="">— Escolher —</option>
                {banks.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name}{b.holder_name ? ` (${b.holder_name})` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Valor (€) *</label>
              <input className="input" type="number" step="0.01" min="0" placeholder="0,00"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <label className="label">Data</label>
              <input className="input" type="date" value={form.movement_date}
                onChange={e => setForm(f => ({ ...f, movement_date: e.target.value }))} />
            </div>
          </div>

          {amountValid && (
            <p className={`text-xs px-3 py-2 rounded-lg ${
              exceedsBalance ? 'text-amber-800 bg-amber-50' : 'text-gray-600 bg-gray-50'
            }`}>
              {exceedsBalance
                ? `⚠️ Valor superior ao saldo em caixa. O fundo de maneio ficaria em ${formatCurrency(balanceAfter)}.`
                : `Saldo do fundo de maneio depois da transferência: ${formatCurrency(balanceAfter)}`}
            </p>
          )}

          <div>
            <label className="label">Notas</label>
            <textarea className="input" rows={2} placeholder="ex: Depósito das rendas de Julho"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>

          <p className="text-xs text-gray-500 bg-blue-50 px-3 py-2 rounded-lg">
            ℹ️ A saída do fundo de maneio é registada já. A entrada no banco fica <strong>a aguardar confirmação</strong> até importares o extrato — aí a app liga as duas automaticamente.
          </p>

          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving || banks.length === 0}>
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> A registar...</> : 'Registar transferência'}
          </button>
        </div>
      </div>
    </div>
  )
}
