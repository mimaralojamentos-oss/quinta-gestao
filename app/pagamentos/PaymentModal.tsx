'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate, getMonthLabel } from '@/lib/utils'
import { buildRentPaymentPlan, applyRentPaymentPlan, type DestinoPagamento, type RentPaymentPlan } from '@/lib/rentPaymentPlan'
import DestinoPagamentoPicker from '@/components/DestinoPagamentoPicker'
import { X, Pencil, Trash2, AlertTriangle } from 'lucide-react'
import { logAccess } from '@/lib/logAccess'
import { buildAppliedAdvanceMap } from '@/lib/advanceCredit'
import { getMonthlyRentStatus } from '@/lib/rentShortfall'
import { PAYMENT_TYPES, PAYMENT_TYPE_LABELS } from '@/lib/paymentTypes'
import { getDebtRemaining } from '@/lib/debts'

interface Props {
  lease: any
  currentMonth: string
  onClose: () => void
  onSaved: () => void
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
  // Distribuição deste pagamento em concreto — calculada pelo motor único
  // (lib/rentPaymentPlan.ts), à medida que o valor é escrito.
  const [plan, setPlan] = useState<RentPaymentPlan | null>(null)
  const [planLoading, setPlanLoading] = useState(false)
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
    const items: DebtItem[] = []

    // Todos os pagamentos de renda deste contrato
    const { data: allPayments } = await supabase
      .from('rent_payments')
      .select('*')
      .eq('lease_id', lease.id)

    // Rendas em falta — mesmo cálculo mês a mês usado no resto da app
    // (lib/rentShortfall.ts), para esta lista bater sempre certo com a
    // conta corrente do inquilino.
    if (lease.monthly_rent && lease.tenant?.id) {
      const { data: rentHistoryData } = await supabase
        .from('lease_rent_history').select('lease_id, effective_date, monthly_rent').eq('lease_id', lease.id)
      const appliedAdvances = buildAppliedAdvanceMap(allPayments ?? [])
      const meses = getMonthlyRentStatus({ lease, payments: allPayments ?? [], rentHistory: rentHistoryData, appliedAdvances })

      for (const m of meses) {
        const owed = parseFloat(Math.max(0, m.rentForMonth - m.totalPaidThisMonth - m.advanceThisMonth).toFixed(2))
        if (owed < 0.01) continue
        items.push({
          id: `renda-${m.monthStr}`,
          type: 'renda',
          label: `Renda ${m.monthStr}`,
          originalAmount: m.rentForMonth,
          remainingAmount: owed,
          referenceMonth: m.monthStr,
        })
      }
    }

    // Dívidas manuais
    const { data: debtsData } = await supabase
      .from('debts')
      .select('*, payments:debt_payments(*)')
      .eq('tenant_id', lease.tenant?.id)
    for (const d of debtsData ?? []) {
      const remaining = getDebtRemaining(d)
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

  // Calcula a distribuição deste pagamento em concreto, à medida que o valor
  // é escrito — o mesmo motor único usado no banco e na ficha do inquilino.
  useEffect(() => {
    let cancelado = false

    async function calcular() {
      const total = parseFloat(singleAmount)
      if (!total || total <= 0) { setPlan(null); return }
      setPlanLoading(true)
      try {
        const resultado = await buildRentPaymentPlan(supabase, {
          leaseId: lease.id,
          tenantId: lease.tenant?.id,
          amount: total,
          destino: destinoPagamento,
          soRendaMonth: currentMonth,
        })
        if (!cancelado) setPlan(resultado)
      } finally {
        if (!cancelado) setPlanLoading(false)
      }
    }
    calcular()
    return () => { cancelado = true }
  }, [singleAmount, destinoPagamento])

  async function handleSaveDebts() {
    const total = parseFloat(singleAmount)
    if (!total || total <= 0) { setError('Introduz o valor recebido'); return }
    if (!plan) { setError('Aguarda o cálculo da distribuição'); return }
    setSaving(true); setError('')

    const result = await applyRentPaymentPlan(supabase, plan, {
      leaseId: lease.id,
      tenantId: lease.tenant?.id,
      paymentDate: singleDate,
      paymentMethod: singleMethod,
      spaceRef: lease.space?.ref,
      tenantName: lease.tenant?.name,
    })

    if (result.error) {
      setError(result.error)
      setSaving(false)
      return
    }

    await logAccess({
      action: 'criar', page: '/pagamentos',
      details: `Registou pagamento (${formatCurrency(total)}) de ${lease.tenant?.name} (${lease.space?.ref}) — ${plan.summary}`,
    })

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
    await logAccess({ action: 'apagar', page: '/pagamentos', details: `Apagou pagamento de ${PAYMENT_TYPE_LABELS[p.tipo] ?? p.tipo} (${formatCurrency(p.amount)}) de ${lease.tenant?.name} (${lease.space?.ref})` })
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
            description: `${PAYMENT_TYPE_LABELS[form.tipo] ?? 'Renda'} — ${lease.space?.ref} (${lease.tenant?.name})`,
          }).eq('id', existingCash.data.id)
        } else {
          await supabase.from('cash_fund_movements').insert({
            movement_date: form.payment_date,
            description: `${PAYMENT_TYPE_LABELS[form.tipo] ?? 'Renda'} — ${lease.space?.ref} (${lease.tenant?.name})`,
            amount: parseFloat(form.amount),
            type: 'entrada',
            source: 'renda',
            source_id: editingPayment.id,
          })
        }
      } else {
        if (existingCash.data) await supabase.from('cash_fund_movements').delete().eq('id', existingCash.data.id)
      }

      await logAccess({ action: 'editar', page: '/pagamentos', details: `Editou pagamento de ${PAYMENT_TYPE_LABELS[form.tipo] ?? form.tipo} (${formatCurrency(parseFloat(form.amount))}) de ${lease.tenant?.name} (${lease.space?.ref})` })
    } else if (form.tipo === 'renda') {
      const amount = parseFloat(form.amount)
      // 'auto': paga o(s) mês(es) mais antigo(s) em falta, não só o mês
      // selecionado no ecrã — este separador não tem escolha de destino, por
      // isso segue sempre o comportamento automático habitual.
      const plan = await buildRentPaymentPlan(supabase, {
        leaseId: lease.id,
        tenantId: lease.tenant?.id,
        amount,
      })

      if (!window.confirm(`${plan.summary}\n\nConfirmar registo deste pagamento?`)) {
        setSaving(false)
        return
      }

      const result = await applyRentPaymentPlan(supabase, plan, {
        leaseId: lease.id,
        tenantId: lease.tenant?.id,
        paymentDate: form.payment_date,
        paymentMethod: form.payment_method,
        notes: form.notes,
        spaceRef: lease.space?.ref,
        tenantName: lease.tenant?.name,
      })

      if (result.error) {
        setError(result.error)
        setSaving(false)
        return
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
          description: `${PAYMENT_TYPE_LABELS[form.tipo] ?? 'Renda'} — ${lease.space?.ref} (${lease.tenant?.name})`,
          amount: parseFloat(form.amount),
          type: 'entrada',
          source: 'renda',
          source_id: newPayment.id,
        })
      }

      await logAccess({ action: 'criar', page: '/pagamentos', details: `Registou pagamento de ${PAYMENT_TYPE_LABELS[form.tipo] ?? form.tipo} (${formatCurrency(parseFloat(form.amount))}) de ${lease.tenant?.name} (${lease.space?.ref})` })
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
                  {planLoading && (
                    <p className="text-xs text-gray-400">A calcular a distribuição...</p>
                  )}
                  {plan && !planLoading && parseFloat(singleAmount) > 0 && (
                    <div className="border border-blue-200 rounded-lg overflow-hidden">
                      <div className="bg-blue-100 px-3 py-2 text-xs font-semibold text-blue-800">
                        Distribuição{destinoPagamento !== 'auto' ? '' : ' automática'}
                      </div>
                      <div className="divide-y divide-blue-50">
                        {plan.rendaPayments.map(rp => (
                          <div key={rp.referenceMonth} className="flex justify-between items-center px-3 py-2">
                            <span className="text-xs text-gray-700">
                              🏠 Renda {getMonthLabel(rp.referenceMonth)}
                              {!rp.fullyPaid && <span className="text-orange-500 ml-1">(parcial)</span>}
                              {rp.creditApplied > 0 && (
                                <span className="block text-[11px] text-purple-600">💰 crédito {formatCurrency(rp.creditApplied)} aplicado</span>
                              )}
                            </span>
                            <span className="text-xs font-semibold">{formatCurrency(rp.amount)}</span>
                          </div>
                        ))}
                        {plan.electricityCharges.map(c => (
                          <div key={c.id} className="flex justify-between items-center px-3 py-2">
                            <span className="text-xs text-gray-700">
                              ⚡ Eletricidade {c.chargeDate?.slice(0, 7) ?? ''}
                              {c.isPartial && <span className="text-orange-500 ml-1">(parcial)</span>}
                            </span>
                            <span className="text-xs font-semibold">{formatCurrency(c.amount)}</span>
                          </div>
                        ))}
                        {plan.debtPayments.map(d => (
                          <div key={d.debtId} className="flex justify-between items-center px-3 py-2">
                            <span className="text-xs text-gray-700">
                              📋 {d.description}
                              {d.remainingAfter > 0.01 && <span className="text-orange-500 ml-1">(parcial)</span>}
                            </span>
                            <span className="text-xs font-semibold">{formatCurrency(d.amount)}</span>
                          </div>
                        ))}
                        {plan.adiantamento > 0.01 && (
                          <div className="flex justify-between items-center px-3 py-2 bg-purple-50">
                            <span className="text-xs text-purple-700">💰 Excedente → adiantamento</span>
                            <span className="text-xs font-semibold text-purple-700">{formatCurrency(plan.adiantamento)}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center px-3 py-2 bg-gray-50 border-t border-gray-200">
                          <span className="text-xs font-bold text-gray-700">Total</span>
                          <span className="text-xs font-bold">{formatCurrency(parseFloat(singleAmount))}</span>
                        </div>
                      </div>
                    </div>
                  )}
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
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">{PAYMENT_TYPE_LABELS[p.tipo] ?? p.tipo}</span>
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
                    {PAYMENT_TYPES.map(t => (
                      <button key={t.value} onClick={() => setForm(f => ({ ...f, tipo: t.value }))}
                        className={`py-2 rounded-lg border text-sm font-medium transition-colors ${form.tipo === t.value ? t.color : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                        {t.buttonLabel}
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
            <button className="btn-primary" onClick={handleSaveDebts} disabled={saving || planLoading || !plan || !singleAmount || parseFloat(singleAmount) <= 0}>
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
