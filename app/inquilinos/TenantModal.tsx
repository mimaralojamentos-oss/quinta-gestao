'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Tenant } from '@/lib/types'
import { X, User, Home, FileText, Plus, Trash2 } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'

interface Props {
  tenant: Tenant | null
  onClose: () => void
  onSaved: () => void
}

const tipoConfig = {
  renda:  { label: '🏠 Renda' },
  caucao: { label: '🔒 Caução' },
  extra:  { label: '➕ Extra' },
  luz:    { label: '⚡ Luz' },
}

export default function TenantModal({ tenant, onClose, onSaved }: Props) {
  const [tab, setTab] = useState<'dados' | 'espacos' | 'conta'>('dados')
  const [form, setForm] = useState({
    name: tenant?.name ?? '',
    phone: tenant?.phone ?? '',
    email: tenant?.email ?? '',
    nif: tenant?.nif ?? '',
    notes: tenant?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Espaços
  const [allSpaces, setAllSpaces] = useState<any[]>([])
  const [assignedSpaces, setAssignedSpaces] = useState<string[]>([])
  const [savingSpaces, setSavingSpaces] = useState(false)

  // Conta corrente
  const [payments, setPayments] = useState<any[]>([])
  const [leases, setLeases] = useState<any[]>([])
  const [loadingPayments, setLoadingPayments] = useState(false)

  // Formulário de novo pagamento
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [paymentForm, setPaymentForm] = useState({
    lease_id: '',
    reference_month: new Date().toISOString().slice(0, 7), // YYYY-MM
    amount: '',
    payment_date: new Date().toISOString().slice(0, 10),
    payment_method: 'dinheiro',
    tipo: 'renda',
    notes: '',
    is_debt: false, // se true, não preenche payment_date (fica por pagar)
  })
  const [savingPayment, setSavingPayment] = useState(false)
  const [paymentError, setPaymentError] = useState('')

  useEffect(() => {
    if (tenant) {
      fetchSpaces()
      fetchPayments()
    }
  }, [tenant])

  async function fetchSpaces() {
    const { data } = await supabase
      .from('spaces')
      .select('id, ref, status, tenant_id')
      .order('ref')
    setAllSpaces(data ?? [])
    const assigned = (data ?? [])
      .filter(s => s.tenant_id === tenant?.id)
      .map(s => s.id)
    setAssignedSpaces(assigned)
  }

  async function fetchPayments() {
    if (!tenant) return
    setLoadingPayments(true)

    const { data: leasesData } = await supabase
      .from('leases')
      .select('id, space:spaces(ref), monthly_rent, status')
      .eq('tenant_id', tenant.id)

    setLeases(leasesData ?? [])

    if (!leasesData || leasesData.length === 0) {
      setPayments([])
      setLoadingPayments(false)
      return
    }

    // Pré-preencher lease_id com o contrato ativo
    const activeLease = leasesData.find(l => l.status === 'ativo')
    if (activeLease) {
      setPaymentForm(f => ({
        ...f,
        lease_id: activeLease.id,
        amount: String(activeLease.monthly_rent),
      }))
    }

    const leaseIds = leasesData.map(l => l.id)

    const { data: pays } = await supabase
      .from('rent_payments')
      .select('*')
      .in('lease_id', leaseIds)
      .order('reference_month', { ascending: false })

    const enriched = (pays ?? []).map(p => ({
      ...p,
      lease: leasesData.find(l => l.id === p.lease_id)
    }))

    setPayments(enriched)
    setLoadingPayments(false)
  }

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

  async function handleToggleSpace(spaceId: string) {
    if (!tenant) return
    const isAssigned = assignedSpaces.includes(spaceId)
    setSavingSpaces(true)
    if (isAssigned) {
      await supabase
        .from('spaces')
        .update({ tenant_id: null, status: 'disponivel' })
        .eq('id', spaceId)
      setAssignedSpaces(prev => prev.filter(id => id !== spaceId))
    } else {
      await supabase
        .from('spaces')
        .update({ tenant_id: tenant.id, status: 'arrendado' })
        .eq('id', spaceId)
      setAssignedSpaces(prev => [...prev, spaceId])
    }
    setSavingSpaces(false)
    await fetchSpaces()
  }

  async function handleSavePayment() {
    if (!paymentForm.lease_id) { setPaymentError('Seleciona um contrato'); return }
    if (!paymentForm.amount) { setPaymentError('O valor é obrigatório'); return }
    if (!paymentForm.is_debt && !paymentForm.payment_date) { setPaymentError('A data é obrigatória'); return }

    setSavingPayment(true); setPaymentError('')

    const { error: err } = await supabase.from('rent_payments').insert({
      lease_id: paymentForm.lease_id,
      reference_month: paymentForm.reference_month + '-01',
      payment_date: paymentForm.is_debt ? null : paymentForm.payment_date,
      amount: parseFloat(paymentForm.amount),
      payment_method: paymentForm.is_debt ? null : paymentForm.payment_method,
      tipo: paymentForm.tipo,
      notes: paymentForm.notes || null,
    })

    setSavingPayment(false)
    if (err) { setPaymentError(err.message); return }

    setShowPaymentForm(false)
    await fetchPayments()
  }

  async function handleDeletePayment(id: string) {
    if (!confirm('Tens a certeza que queres apagar este pagamento?')) return
    await supabase.from('rent_payments').delete().eq('id', id)
    await fetchPayments()
  }

  const totalDebt = payments
    .filter(p => !p.payment_date)
    .reduce((sum, p) => sum + (p.amount ?? 0), 0)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg text-gray-900">
            {tenant ? tenant.name : 'Novo Inquilino'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        {tenant && (
          <div className="flex gap-1 mb-5 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setTab('dados')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors ${tab === 'dados' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <User className="w-4 h-4" /> Dados
            </button>
            <button
              onClick={() => setTab('espacos')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors ${tab === 'espacos' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <Home className="w-4 h-4" /> Espaços
            </button>
            <button
              onClick={() => setTab('conta')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors ${tab === 'conta' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <FileText className="w-4 h-4" /> Conta Corrente
              {totalDebt > 0 && (
                <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                  {formatCurrency(totalDebt)}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto">

          {/* TAB: DADOS */}
          {tab === 'dados' && (
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
          )}

          {/* TAB: ESPAÇOS */}
          {tab === 'espacos' && (
            <div>
              <p className="text-sm text-gray-500 mb-4">
                Clica num espaço para associar ou desassociar este inquilino.
              </p>
              {savingSpaces && <p className="text-xs text-emerald-600 mb-3">A guardar...</p>}
              <div className="grid grid-cols-4 gap-2">
                {allSpaces.map(space => {
                  const isAssigned = assignedSpaces.includes(space.id)
                  const isOtherTenant = space.tenant_id && space.tenant_id !== tenant?.id
                  return (
                    <button
                      key={space.id}
                      onClick={() => !isOtherTenant && handleToggleSpace(space.id)}
                      disabled={isOtherTenant || savingSpaces}
                      className={`p-3 rounded-lg border-2 text-sm font-medium transition-all ${
                        isAssigned
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : isOtherTenant
                          ? 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-emerald-300 hover:bg-emerald-50'
                      }`}
                    >
                      {space.ref}
                      {isAssigned && <span className="block text-xs mt-0.5">✓</span>}
                      {isOtherTenant && <span className="block text-xs mt-0.5 text-gray-300">ocupado</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* TAB: CONTA CORRENTE */}
          {tab === 'conta' && (
            <div>
              {/* Resumo */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500 mb-1">Total pago</p>
                  <p className="font-semibold text-gray-900">
                    {formatCurrency(payments.filter(p => p.payment_date).reduce((s, p) => s + p.amount, 0))}
                  </p>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500 mb-1">Em dívida</p>
                  <p className={`font-semibold ${totalDebt > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {totalDebt > 0 ? formatCurrency(totalDebt) : '✓ Sem dívida'}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500 mb-1">Nº registos</p>
                  <p className="font-semibold text-gray-900">{payments.length}</p>
                </div>
              </div>

              {/* Botão registar */}
              {!showPaymentForm && (
                <button
                  onClick={() => setShowPaymentForm(true)}
                  className="btn-primary w-full mb-4 justify-center"
                >
                  <Plus className="w-4 h-4" /> Registar Pagamento / Dívida
                </button>
              )}

              {/* Formulário de novo pagamento */}
              {showPaymentForm && (
                <div className="border border-emerald-200 bg-emerald-50 rounded-xl p-4 mb-4">
                  <h3 className="font-medium text-gray-800 mb-3">Novo Registo</h3>
                  <div className="space-y-3">

                    {/* Contrato */}
                    {leases.length > 1 && (
                      <div>
                        <label className="label">Contrato / Espaço</label>
                        <select className="input" value={paymentForm.lease_id}
                          onChange={e => setPaymentForm(f => ({ ...f, lease_id: e.target.value }))}>
                          <option value="">— Seleciona —</option>
                          {leases.map(l => (
                            <option key={l.id} value={l.id}>
                              {l.space?.ref} — {formatCurrency(l.monthly_rent)}/mês
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Tipo */}
                    <div>
                      <label className="label">Tipo</label>
                      <div className="grid grid-cols-4 gap-2">
                        {Object.entries(tipoConfig).map(([key, cfg]) => (
                          <button key={key}
                            onClick={() => setPaymentForm(f => ({ ...f, tipo: key }))}
                            className={`py-2 rounded-lg border text-xs font-medium transition-colors ${
                              paymentForm.tipo === key
                                ? 'bg-emerald-600 text-white border-emerald-600'
                                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                            }`}>
                            {cfg.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Mês de referência e valor */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label">Mês de referência</label>
                        <input className="input" type="month" value={paymentForm.reference_month}
                          onChange={e => setPaymentForm(f => ({ ...f, reference_month: e.target.value }))} />
                      </div>
                      <div>
                        <label className="label">Valor (€)</label>
                        <input className="input" type="number" step="0.01" value={paymentForm.amount}
                          onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))} />
                      </div>
                    </div>

                    {/* É dívida ou pagamento? */}
                    <div>
                      <label className="label">Estado</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => setPaymentForm(f => ({ ...f, is_debt: false }))}
                          className={`py-2 rounded-lg border text-sm font-medium transition-colors ${
                            !paymentForm.is_debt
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                          }`}>
                          ✓ Já foi pago
                        </button>
                        <button
                          onClick={() => setPaymentForm(f => ({ ...f, is_debt: true }))}
                          className={`py-2 rounded-lg border text-sm font-medium transition-colors ${
                            paymentForm.is_debt
                              ? 'bg-red-600 text-white border-red-600'
                              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                          }`}>
                          ⚠ Em dívida
                        </button>
                      </div>
                    </div>

                    {/* Data e método — só se for pago */}
                    {!paymentForm.is_debt && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="label">Data do pagamento</label>
                          <input className="input" type="date" value={paymentForm.payment_date}
                            onChange={e => setPaymentForm(f => ({ ...f, payment_date: e.target.value }))} />
                        </div>
                        <div>
                          <label className="label">Método</label>
                          <div className="grid grid-cols-2 gap-2">
                            {['dinheiro', 'banco'].map(m => (
                              <button key={m}
                                onClick={() => setPaymentForm(f => ({ ...f, payment_method: m }))}
                                className={`py-2 rounded-lg border text-xs font-medium transition-colors ${
                                  paymentForm.payment_method === m
                                    ? 'bg-emerald-600 text-white border-emerald-600'
                                    : 'bg-white text-gray-600 border-gray-200'
                                }`}>
                                {m === 'dinheiro' ? '💵 Dinheiro' : '🏦 Banco'}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Notas */}
                    <div>
                      <label className="label">Notas (opcional)</label>
                      <input className="input" placeholder="ex: dívida de Janeiro 2025" value={paymentForm.notes}
                        onChange={e => setPaymentForm(f => ({ ...f, notes: e.target.value }))} />
                    </div>

                    {paymentError && <p className="text-sm text-red-600 bg-red-100 px-3 py-2 rounded-lg">{paymentError}</p>}

                    <div className="flex gap-2 pt-1">
                      <button className="btn-secondary flex-1" onClick={() => setShowPaymentForm(false)}>
                        Cancelar
                      </button>
                      <button className="btn-primary flex-1 justify-center" onClick={handleSavePayment} disabled={savingPayment}>
                        {savingPayment ? 'A guardar...' : 'Guardar'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Lista de pagamentos */}
              {loadingPayments ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-600" />
                </div>
              ) : payments.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-8">Sem registos de pagamentos</p>
              ) : (
                <div className="space-y-2">
                  {payments.map(p => (
                    <div key={p.id} className={`flex items-center justify-between p-3 rounded-lg border ${p.payment_date ? 'border-gray-100 bg-white' : 'border-red-100 bg-red-50'}`}>
                      <div>
                        <p className="text-sm font-medium text-gray-800">
                          {p.reference_month?.slice(0, 7)} — {p.lease?.space?.ref ?? '—'}
                          <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                            p.tipo === 'caucao' ? 'bg-blue-100 text-blue-700' :
                            p.tipo === 'extra' ? 'bg-orange-100 text-orange-700' :
                            p.tipo === 'luz' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {tipoConfig[p.tipo as keyof typeof tipoConfig]?.label ?? '🏠 Renda'}
                          </span>
                        </p>
                        {p.payment_date
                          ? <p className="text-xs text-gray-500">Pago em {formatDate(p.payment_date)} · {p.payment_method}</p>
                          : <p className="text-xs text-red-500 font-medium">⚠ Por pagar</p>
                        }
                        {p.notes && <p className="text-xs text-gray-400 mt-0.5">{p.notes}</p>}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`font-semibold text-sm ${p.payment_date ? 'text-gray-900' : 'text-red-600'}`}>
                          {formatCurrency(p.amount)}
                        </span>
                        <button
                          onClick={() => handleDeletePayment(p.id)}
                          className="text-gray-300 hover:text-red-500 transition-colors"
                          title="Apagar"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {tab === 'dados' && (
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
            <button className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'A guardar...' : 'Guardar'}
            </button>
          </div>
        )}
        {(tab === 'espacos' || tab === 'conta') && (
          <div className="flex justify-end mt-6 pt-4 border-t border-gray-100">
            <button className="btn-secondary" onClick={onClose}>Fechar</button>
          </div>
        )}
      </div>
    </div>
  )
}
