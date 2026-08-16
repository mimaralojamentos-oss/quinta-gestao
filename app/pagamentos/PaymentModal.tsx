'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate, getMonthLabel } from '@/lib/utils'
import { buildRentPaymentPlan, applyRentPaymentPlan, type DestinoPagamento } from '@/lib/rentPaymentPlan'
import DestinoPagamentoPicker from '@/components/DestinoPagamentoPicker'
import { X, Pencil, Trash2, AlertTriangle } from 'lucide-react'
import { logAccess } from '@/lib/logAccess'
import { consumeAdvances } from '@/lib/advanceCredit'

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
  adiantamento: { label: '💰 Adiantamento', color: 'bg-purple-600 text-white border-purple-600' },
}

const tipoLabels: Record<string, string> = {
  renda: '🏠 Renda',
  caucao: '🔒 Caução',
  extra: '➕ Extra',
  luz: '⚡ Luz',
  adiantamento: '💰 Adiantamento',
}

interface DebtItem {
  id: string
  type: 'renda' | 'manual' | 'eletricidade'
  label: string
  originalAmount: number
  remainingAmount: number
  referenceMonth?: string
  chargeId?: string
  debtId?: string
  creditApplied?: number  // crédito de adiantamento já descontado
}

export default function PaymentModal({ lease, currentMonth, onClose, onSaved }: Props) {
  const [mode, setMode] = useState<'debts' | 'new'>('debts')
  const [editingPayment, setEditingPayment] = useState<any | null>(null)
  const [debtItems, setDebtItems] = useState<DebtItem[]>([])
  // Para onde vai o valor recebido (igual ao banco e à ficha do inquilino)
  const [destinoPagamento, setDestinoPagamento] = useState<DestinoPagamento>('auto')
  const [singleAmount, setSingleAmount] = useState('')
  const [singleDate, setSingleDate] = useState(new Date().toISOString().slice(0, 10))
  const [singleMethod, setSingleMethod] = useState('dinheiro')
  const [loadingDebts, setLoadingDebts] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    amount: String(lease.monthly_rent),
    payment_date: new Date().toISOString().slice(0, 10),
    payment_method: 'dinheiro',
    tipo: 'renda',
    notes: '',
  })


  async function fetchDebts() {
    setLoadingDebts(true)
    const mayStart = new Date('2026-05-01')
    const today = new Date(); today.setDate(1)
    const items: DebtItem[] = []

    // Todos os pagamentos de renda deste contrato
    const { data: allPayments } = await supabase
      .from('rent_payments')
      .select('*')
      .eq('lease_id', lease.id)

    // Rendas em falta
    if (lease.monthly_rent && lease.tenant?.id) {
      const contractStart = new Date(lease.start_date ?? '2026-05-01')
      contractStart.setDate(1)
      const start = contractStart > mayStart ? contractStart : mayStart
      const cursor = new Date(start)
      while (cursor <= today) {
        const monthStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
        const hasPayment = (allPayments ?? []).some(p =>
          p.reference_month?.slice(0, 7) === monthStr &&
          p.payment_date &&
          (p.tipo === 'renda' || !p.tipo)
        )
        if (!hasPayment) {
          items.push({
            id: `renda-${monthStr}`,
            type: 'renda',
            label: `Renda ${monthStr}`,
            originalAmount: lease.monthly_rent,
            remainingAmount: lease.monthly_rent,
            referenceMonth: monthStr,
          })
        }
        cursor.setMonth(cursor.getMonth() + 1)
      }
    }

    // Dívidas manuais
    const { data: debtsData } = await supabase
      .from('debts')
      .select('*, payments:debt_payments(*)')
      .eq('tenant_id', lease.tenant?.id)
    for (const d of debtsData ?? []) {
      const paid = (d.payments ?? []).reduce((s: number, p: any) => s + p.amount, 0)
      const remaining = Math.max(0, d.original_amount - paid)
      if (remaining > 0) {
        items.push({
          id: `manual-${d.id}`,
          type: 'manual',
          label: d.description,
          originalAmount: d.original_amount,
          remainingAmount: remaining,
          debtId: d.id,
        })
      }
    }

    // Cobranças de eletricidade por pagar
    const { data: elecCharges } = await supabase
      .from('electricity_charges')
      .select('*')
      .eq('lease_id', lease.id)
      .eq('paid', false)
    for (const c of elecCharges ?? []) {
      const alreadyPaid = c.amount_paid ?? 0
      const remaining = parseFloat((c.amount - alreadyPaid).toFixed(2))
      if (remaining <= 0) continue
      items.push({
        id: `elec-${c.id}`,
        type: 'eletricidade',
        label: `Eletricidade ${c.charge_date?.slice(0, 7) ?? ''}`,
        originalAmount: c.amount,
        remainingAmount: remaining,
        chargeId: c.id,
      })
    }

    // Buscar adiantamentos disponíveis (crédito não usado)
    const { data: advData } = await supabase
      .from('rent_payments')
      .select('id, amount')
      .eq('lease_id', lease.id)
      .eq('tipo', 'adiantamento')
      .or('used.is.null,used.eq.false')
      .order('payment_date', { ascending: true })

    // Aplicar crédito às rendas (mais antigas primeiro)
    let creditLeft = (advData ?? []).reduce((s: number, a: any) => s + a.amount, 0)
    const adjustedItems = items.map(item => {
      if (item.type !== 'renda' || creditLeft <= 0) return item
      const credit = parseFloat(Math.min(creditLeft, item.remainingAmount).toFixed(2))
      creditLeft = parseFloat((creditLeft - credit).toFixed(2))
      return { ...item, remainingAmount: parseFloat((item.remainingAmount - credit).toFixed(2)), creditApplied: credit }
    })

    setDebtItems(adjustedItems)
    setLoadingDebts(false)
  }

  /**
   * Distribui o valor recebido. `destino` limita o que pode ser tocado —
   * por omissão segue a ordem habitual: renda, luz, dívidas.
   */
  function computeAllocation(total: number, destino: DestinoPagamento = 'auto') {
    let remaining = total
    const result: { item: DebtItem; paying: number }[] = []

    const podeRenda = destino === 'auto' || destino === 'renda'
    const podeLuz = destino === 'auto' || destino === 'luz'
    const podeDividas = destino === 'auto' || destino === 'dividas'

    const rendas = !podeRenda ? [] : [...debtItems].filter(d => d.type === 'renda' && d.remainingAmount > 0)
      .sort((a, b) => (a.referenceMonth ?? '').localeCompare(b.referenceMonth ?? ''))
    const elec = !podeLuz ? [] : [...debtItems].filter(d => d.type === 'eletricidade' && d.remainingAmount > 0)
      .sort((a, b) => (a.referenceMonth ?? '').localeCompare(b.referenceMonth ?? ''))
    const manual = !podeDividas ? [] : [...debtItems].filter(d => d.type === 'manual' && d.remainingAmount > 0)

    for (const item of rendas) {
      if (remaining <= 0) break
      const paying = parseFloat(Math.min(remaining, item.remainingAmount).toFixed(2))
      result.push({ item, paying })
      remaining = parseFloat((remaining - paying).toFixed(2))
    }
    for (const item of elec) {
      if (remaining <= 0) break
      const paying = parseFloat(Math.min(remaining, item.remainingAmount).toFixed(2))
      result.push({ item, paying })
      remaining = parseFloat((remaining - paying).toFixed(2))
    }
    for (const item of manual) {
      if (remaining <= 0) break
      const paying = parseFloat(Math.min(remaining, item.remainingAmount).toFixed(2))
      result.push({ item, paying })
      remaining = parseFloat((remaining - paying).toFixed(2))
    }

    return { allocation: result, leftover: parseFloat(remaining.toFixed(2)) }
  }

  async function handleSaveDebts() {
    const total = parseFloat(singleAmount)
    if (!total || total <= 0) { setError('Introduz o valor recebido'); return }
    setSaving(true); setError('')

    const { allocation, leftover } = computeAllocation(total, destinoPagamento)

    for (const { item, paying } of allocation) {
      const { type, referenceMonth, debtId, chargeId } = item

      if (type === 'renda') {
        const { data: newPayment } = await supabase.from('rent_payments').insert({
          lease_id: lease.id,
          reference_month: (referenceMonth ?? '') + '-01',
          payment_date: singleDate,
          amount: paying,
          payment_method: singleMethod,
          tipo: 'renda',
          notes: paying < item.remainingAmount ? 'Pagamento parcial' : null,
        }).select().single()
        if (singleMethod === 'dinheiro' && newPayment) {
          await supabase.from('cash_fund_movements').insert({
            movement_date: singleDate,
            description: `🏠 Renda ${referenceMonth} — ${lease.space?.ref} (${lease.tenant?.name})`,
            amount: paying, type: 'entrada', source: 'renda', source_id: newPayment.id,
          })
        }
        await logAccess({ action: 'criar', page: '/pagamentos', details: `Registou pagamento de ${item.label} (${formatCurrency(paying)}) de ${lease.tenant?.name} (${lease.space?.ref})` })

      } else if (type === 'manual' && debtId) {
        await supabase.from('debt_payments').insert({
          debt_id: debtId, payment_date: singleDate, amount: paying, payment_method: singleMethod, notes: null,
        })
        if (singleMethod === 'dinheiro') {
          await supabase.from('cash_fund_movements').insert({
            movement_date: singleDate,
            description: `⚠️ ${item.label} — ${lease.tenant?.name}`,
            amount: paying, type: 'entrada', source: 'divida', source_id: debtId,
          })
        }
        await logAccess({ action: 'criar', page: '/pagamentos', details: `Registou pagamento de "${item.label}" (${formatCurrency(paying)}) de ${lease.tenant?.name}` })

      } else if (type === 'eletricidade' && chargeId) {
        const isPaidFull = paying >= item.remainingAmount
        if (isPaidFull) {
          await supabase.from('electricity_charges').update({
            paid: true, payment_date: singleDate, payment_method: singleMethod,
            amount_paid: item.originalAmount,
          }).eq('id', chargeId)
        } else {
          // Pagamento parcial — acumula amount_paid sem marcar como pago
          const newAmountPaid = parseFloat(((item.originalAmount - item.remainingAmount) + paying).toFixed(2))
          await supabase.from('electricity_charges').update({
            amount_paid: newAmountPaid,
          }).eq('id', chargeId)
        }
        if (singleMethod === 'dinheiro') {
          await supabase.from('cash_fund_movements').insert({
            movement_date: singleDate,
            description: `⚡ ${item.label}${!isPaidFull ? ' (parcial)' : ''} — ${lease.space?.ref} (${lease.tenant?.name})`,
            amount: paying, type: 'entrada', source: 'eletricidade', source_id: chargeId,
          })
        }
        await logAccess({ action: 'criar', page: '/pagamentos', details: `Registou pagamento${!isPaidFull ? ' parcial' : ''} de ${item.label} (${formatCurrency(paying)}) de ${lease.tenant?.name} (${lease.space?.ref})` })
      }
    }

    // Excedente → adiantamento
    if (leftover > 0.01) {
      const { data: advPayment } = await supabase.from('rent_payments').insert({
        lease_id: lease.id,
        reference_month: singleDate.slice(0, 7) + '-01',
        payment_date: singleDate,
        amount: leftover,
        payment_method: singleMethod,
        tipo: 'adiantamento',
        notes: 'Excedente (adiantamento)',
      }).select().single()
      if (singleMethod === 'dinheiro' && advPayment) {
        await supabase.from('cash_fund_movements').insert({
          movement_date: singleDate,
          description: `💰 Adiantamento — ${lease.space?.ref} (${lease.tenant?.name})`,
          amount: leftover, type: 'entrada', source: 'renda', source_id: advPayment.id,
        })
      }
    }

    // Aplicar o crédito do inquilino às rendas.
    // Antes criava-se uma renda "fantasma" com a nota "Crédito de adiantamento
    // aplicado" e o adiantamento ficava apenas marcado como usado, sem se saber
    // onde tinha sido gasto. Agora cada adiantamento assina o mês que pagou.
    for (const item of debtItems) {
      const credit = item.creditApplied ?? 0
      if (credit <= 0 || item.type !== 'renda') continue
      const { error: advError } = await consumeAdvances(supabase, {
        leaseId: lease.id,
        amountNeeded: credit,
        target: { type: 'renda', leaseId: lease.id, month: item.referenceMonth ?? '' },
      })
      if (advError) {
        alert(`Erro ao aplicar o adiantamento: ${advError}`)
        setSaving(false)
        return
      }
    }

    setSaving(false)
    onSaved()
  }

  function handleStartEdit(p: any) {
    setEditingPayment(p)
    setForm({
      amount: String(p.amount),
      payment_date: p.payment_date ?? new Date().toISOString().slice(0, 10),
      payment_method: p.payment_method ?? 'dinheiro',
      tipo: p.tipo ?? 'renda',
      notes: p.notes ?? '',
    })
    setMode('new')
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

  async function handleDelete(p: any) {
    if (!confirm('Tens a certeza que queres apagar este pagamento?')) return
    await supabase.from('cash_fund_movements').delete().eq('source_id', p.id)
    await supabase.from('rent_payments').delete().eq('id', p.id)
    await logAccess({ action: 'apagar', page: '/pagamentos', details: `Apagou pagamento de ${tipoLabels[p.tipo] ?? p.tipo} (${formatCurrency(p.amount)}) de ${lease.tenant?.name} (${lease.space?.ref})` })
    onSaved()
  }

  async function handleSaveNew() {
    if (!form.amount || !form.payment_date) { setError('Valor e data são obrigatórios'); return }
    setSaving(true); setError('')

    if (editingPayment) {
      const { error: err } = await supabase.from('rent_payments').update({
        payment_date: form.payment_date,
        amount: parseFloat(form.amount),
        payment_method: form.payment_method,
        tipo: form.tipo,
        notes: form.notes || null,
      }).eq('id', editingPayment.id)
      if (err) { setError(err.message); setSaving(false); return }

      const existingCash = await supabase.from('cash_fund_movements').select('id').eq('source_id', editingPayment.id).single()
      if (form.payment_method === 'dinheiro') {
        if (existingCash.data) {
          await supabase.from('cash_fund_movements').update({
            amount: parseFloat(form.amount),
            movement_date: form.payment_date,
            description: `${tipoLabels[form.tipo] ?? 'Renda'} — ${lease.space?.ref} (${lease.tenant?.name})`,
          }).eq('id', existingCash.data.id)
        } else {
          await supabase.from('cash_fund_movements').insert({
            movement_date: form.payment_date,
            description: `${tipoLabels[form.tipo] ?? 'Renda'} — ${lease.space?.ref} (${lease.tenant?.name})`,
            amount: parseFloat(form.amount),
            type: 'entrada',
            source: 'renda',
            source_id: editingPayment.id,
          })
        }
      } else {
        if (existingCash.data) await supabase.from('cash_fund_movements').delete().eq('id', existingCash.data.id)
      }

      await logAccess({ action: 'editar', page: '/pagamentos', details: `Editou pagamento de ${tipoLabels[form.tipo] ?? form.tipo} (${formatCurrency(parseFloat(form.amount))}) de ${lease.tenant?.name} (${lease.space?.ref})` })
    } else if (form.tipo === 'renda') {
      const amount = parseFloat(form.amount)
      const plan = await buildRentPaymentPlan(supabase, {
        leaseId: lease.id,
        tenantId: lease.tenant?.id,
        monthlyRent: lease.monthly_rent,
        amount,
        referenceMonth: currentMonth,
      })

      if (!window.confirm(`${plan.summary}\n\nConfirmar registo deste pagamento?`)) {
        setSaving(false)
        return
      }

      const result = await applyRentPaymentPlan(supabase, plan, {
        leaseId: lease.id,
        tenantId: lease.tenant?.id,
        referenceMonth: currentMonth,
        paymentDate: form.payment_date,
        paymentMethod: form.payment_method,
        notes: form.notes,
      })

      if (form.payment_method === 'dinheiro') {
        if (result.rendaPayment) {
          await supabase.from('cash_fund_movements').insert({
            movement_date: form.payment_date,
            description: `🏠 Renda ${getMonthLabel(currentMonth)} — ${lease.space?.ref} (${lease.tenant?.name})`,
            amount: plan.rendaAmount,
            type: 'entrada',
            source: 'renda',
            source_id: result.rendaPayment.id,
          })
        }
        for (const charge of plan.electricityCharges) {
          await supabase.from('cash_fund_movements').insert({
            movement_date: form.payment_date,
            description: `⚡ Eletricidade ${charge.chargeDate?.slice(0, 7) ?? ''}${charge.isPartial ? ' (parcial)' : ''} — ${lease.space?.ref} (${lease.tenant?.name})`,
            amount: charge.amount,
            type: 'entrada',
            source: 'eletricidade',
            source_id: charge.id,
          })
        }
        for (const dp of plan.debtPayments) {
          await supabase.from('cash_fund_movements').insert({
            movement_date: form.payment_date,
            description: `⚠️ ${dp.description} — ${lease.tenant?.name}`,
            amount: dp.amount,
            type: 'entrada',
            source: 'divida',
            source_id: dp.debtId,
          })
        }
        if (result.adiantamentoPayment) {
          await supabase.from('cash_fund_movements').insert({
            movement_date: form.payment_date,
            description: `💰 Adiantamento — ${lease.space?.ref} (${lease.tenant?.name})`,
            amount: plan.adiantamento,
            type: 'entrada',
            source: 'renda',
            source_id: result.adiantamentoPayment.id,
          })
        }
      }

      await logAccess({ action: 'criar', page: '/pagamentos', details: `Registou pagamento de renda (${formatCurrency(amount)}) de ${lease.tenant?.name} (${lease.space?.ref}) — ${getMonthLabel(currentMonth)}` })
    } else {
      const { data: newPayment, error: err } = await supabase.from('rent_payments').insert({
        lease_id: lease.id,
        reference_month: currentMonth,
        payment_date: form.payment_date,
        amount: parseFloat(form.amount),
        payment_method: form.payment_method,
        tipo: form.tipo,
        notes: form.notes || null,
      }).select().single()
      if (err) { setError(err.message); setSaving(false); return }
      if (form.payment_method === 'dinheiro' && newPayment) {
        await supabase.from('cash_fund_movements').insert({
          movement_date: form.payment_date,
          description: `${tipoLabels[form.tipo] ?? 'Renda'} — ${lease.space?.ref} (${lease.tenant?.name})`,
          amount: parseFloat(form.amount),
          type: 'entrada',
          source: 'renda',
          source_id: newPayment.id,
        })
      }

      await logAccess({ action: 'criar', page: '/pagamentos', details: `Registou pagamento de ${tipoLabels[form.tipo] ?? form.tipo} (${formatCurrency(parseFloat(form.amount))}) de ${lease.tenant?.name} (${lease.space?.ref})` })
    }

    setSaving(false)
    onSaved()
  }

  useEffect(() => { fetchDebts() }, [])

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-lg text-gray-900">Registar Pagamento</h2>
            <p className="text-sm text-gray-500">{lease.tenant?.name} · {lease.space?.ref} · {getMonthLabel(currentMonth)}</p>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1">
          <button onClick={() => setMode('debts')}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${mode === 'debts' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
            ⚠️ Dívidas pendentes
            {debtItems.length > 0 && <span className="ml-1.5 bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">{debtItems.length}</span>}
          </button>
          <button onClick={() => setMode('new')}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${mode === 'new' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
            ➕ Novo registo
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">

          {/* TAB: Dívidas pendentes */}
          {mode === 'debts' && (
            <div>
              {loadingDebts ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-600" />
                </div>
              ) : debtItems.length === 0 ? (
                <div className="text-center py-10 text-gray-400">
                  <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                  <p className="text-sm">Sem dívidas pendentes! ✓</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Lista de dívidas — apenas informação */}
                  <div className="space-y-2">
                    {debtItems.map(item => (
                      <div key={item.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 border border-gray-100">
                        <div>
                          <p className="text-sm font-medium text-gray-800">{item.label}</p>
                          {(item.creditApplied ?? 0) > 0 && (
                            <p className="text-xs text-purple-600">💰 {formatCurrency(item.creditApplied!)} de crédito será aplicado</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-red-600">{formatCurrency(item.remainingAmount)}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            item.type === 'renda' ? 'bg-emerald-100 text-emerald-700'
                            : item.type === 'manual' ? 'bg-red-100 text-red-700'
                            : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {item.type === 'renda' ? '🏠 Renda' : item.type === 'manual' ? '⚠️ Dívida' : '⚡ Luz'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Formulário único */}
                  <div className="border border-blue-200 bg-blue-50 rounded-xl p-4 space-y-3">
                    <h3 className="text-sm font-semibold text-blue-800">💰 Registar Recebimento</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">Data</label>
                        <input type="date" className="input text-sm w-full" value={singleDate}
                          onChange={e => setSingleDate(e.target.value)} />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">Valor recebido (€)</label>
                        <input type="number" step="0.01" min="0" className="input text-sm w-full"
                          placeholder="0.00" value={singleAmount}
                          onChange={e => setSingleAmount(e.target.value)} />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Método</label>
                      <div className="grid grid-cols-2 gap-2">
                        {['dinheiro', 'banco'].map(m => (
                          <button key={m} type="button" onClick={() => setSingleMethod(m)}
                            className={`py-2 rounded-lg border text-xs font-medium transition-colors ${singleMethod === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                            {m === 'dinheiro' ? '💵 Dinheiro' : '🏦 Banco'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <DestinoPagamentoPicker valor={destinoPagamento} onChange={setDestinoPagamento} />

                  {/* Preview distribuição */}
                  {parseFloat(singleAmount) > 0 && (() => {
                    const { allocation, leftover } = computeAllocation(parseFloat(singleAmount), destinoPagamento)
                    return (
                      <div className="border border-blue-200 rounded-lg overflow-hidden">
                        <div className="bg-blue-100 px-3 py-2 text-xs font-semibold text-blue-800">
                          Distribuição{destinoPagamento !== 'auto' ? '' : ' automática'}
                        </div>
                        <div className="divide-y divide-blue-50">
                          {allocation.map((a, i) => {
                            const icon = a.item.type === 'eletricidade' ? '⚡' : a.item.type === 'manual' ? '📋' : '🏠'
                            const isPartial = a.paying < a.item.remainingAmount
                            return (
                              <div key={i} className="flex justify-between items-center px-3 py-2">
                                <span className="text-xs text-gray-700">
                                  {icon} {a.item.label}
                                  {isPartial && <span className="text-orange-500 ml-1">(parcial)</span>}
                                </span>
                                <span className="text-xs font-semibold">{formatCurrency(a.paying)}</span>
                              </div>
                            )
                          })}
                          {leftover > 0.01 && (
                            <div className="flex justify-between items-center px-3 py-2 bg-purple-50">
                              <span className="text-xs text-purple-700">💰 Excedente → adiantamento</span>
                              <span className="text-xs font-semibold text-purple-700">{formatCurrency(leftover)}</span>
                            </div>
                          )}
                          <div className="flex justify-between items-center px-3 py-2 bg-gray-50 border-t border-gray-200">
                            <span className="text-xs font-bold text-gray-700">Total</span>
                            <span className="text-xs font-bold">{formatCurrency(parseFloat(singleAmount))}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
          )}

          {/* TAB: Novo registo */}
          {mode === 'new' && (
            <div>
              {/* Pagamentos já registados */}
              {lease.payments_this_month?.length > 0 && (
                <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs font-medium text-gray-500 mb-2">Pagamentos registados este mês:</p>
                  {lease.payments_this_month.map((p: any) => (
                    <div key={p.id} className={`flex justify-between items-center text-sm py-1.5 px-2 rounded-lg mb-1 ${editingPayment?.id === p.id ? 'bg-emerald-50 border border-emerald-200' : 'hover:bg-gray-100'}`}>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-700">{formatDate(p.payment_date)}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">{tipoLabels[p.tipo] ?? p.tipo}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${p.payment_method === 'dinheiro' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                          {p.payment_method === 'dinheiro' ? '💵' : '🏦'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-emerald-600">{formatCurrency(p.amount)}</span>
                        <button onClick={() => handleStartEdit(p)} className="text-gray-400 hover:text-blue-500"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => handleDelete(p)} className="text-gray-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

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
                      <button key={key} onClick={() => setForm(f => ({ ...f, tipo: key }))}
                        className={`py-2 rounded-lg border text-sm font-medium transition-colors ${form.tipo === key ? cfg.color : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
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
                      <button key={method} onClick={() => setForm(f => ({ ...f, payment_method: method }))}
                        className={`py-2.5 rounded-lg border text-sm font-medium transition-colors ${form.payment_method === method ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                        {method === 'dinheiro' ? '💵 Dinheiro' : '🏦 Banco/Transferência'}
                      </button>
                    ))}
                  </div>
                  {form.payment_method === 'dinheiro' && (
                    <p className="text-xs text-emerald-600 mt-1.5">✓ Este valor será registado automaticamente no Fundo de Maneio</p>
                  )}
                </div>
                <div>
                  <label className="label">Notas</label>
                  <input className="input" placeholder="ex: pago em mão ao Miguel" value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
                {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
          <button className="btn-secondary" onClick={editingPayment ? handleCancelEdit : onClose}>
            {editingPayment ? 'Cancelar edição' : 'Cancelar'}
          </button>
          {mode === 'debts' ? (
            <button className="btn-primary" onClick={handleSaveDebts} disabled={saving || !singleAmount || parseFloat(singleAmount) <= 0}>
              {saving ? 'A guardar...' : `Guardar ${parseFloat(singleAmount) > 0 ? formatCurrency(parseFloat(singleAmount)) : ''}`}
            </button>
          ) : (
            <button className="btn-primary" onClick={handleSaveNew} disabled={saving}>
              {saving ? 'A guardar...' : editingPayment ? 'Guardar alterações' : 'Guardar Pagamento'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// https://quinta-gestao.vercel.app/pagamentos
