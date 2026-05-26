'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Tenant } from '@/lib/types'
import { X, User, Home, FileText } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'

interface Props {
  tenant: Tenant | null
  onClose: () => void
  onSaved: () => void
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
  const [loadingPayments, setLoadingPayments] = useState(false)

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

    // Buscar contratos do inquilino
    const { data: leases } = await supabase
      .from('leases')
      .select('id, space:spaces(ref), monthly_rent')
      .eq('tenant_id', tenant.id)

    if (!leases || leases.length === 0) {
      setPayments([])
      setLoadingPayments(false)
      return
    }

    const leaseIds = leases.map(l => l.id)

    // Buscar pagamentos
    const { data: pays } = await supabase
      .from('rent_payments')
      .select('*')
      .in('lease_id', leaseIds)
      .order('reference_month', { ascending: false })

    // Enriquecer com info do contrato
    const enriched = (pays ?? []).map(p => ({
      ...p,
      lease: leases.find(l => l.id === p.lease_id)
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
      // Desassociar
      await supabase
        .from('spaces')
        .update({ tenant_id: null, status: 'disponivel' })
        .eq('id', spaceId)
      setAssignedSpaces(prev => prev.filter(id => id !== spaceId))
    } else {
      // Associar
      await supabase
        .from('spaces')
        .update({ tenant_id: tenant.id, status: 'arrendado' })
        .eq('id', spaceId)
      setAssignedSpaces(prev => [...prev, spaceId])
    }
    setSavingSpaces(false)
    await fetchSpaces()
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

        {/* Tabs — só mostrar se estiver a editar */}
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

        {/* Conteúdo com scroll */}
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
              {savingSpaces && (
                <p className="text-xs text-emerald-600 mb-3">A guardar...</p>
              )}
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
              <div className="grid grid-cols-3 gap-3 mb-5">
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
                  <p className="text-xs text-gray-500 mb-1">Nº pagamentos</p>
                  <p className="font-semibold text-gray-900">{payments.length}</p>
                </div>
              </div>

              {/* Lista */}
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
                          {p.reference_month} — {p.lease?.space?.ref ?? '—'}
                        </p>
                        {p.payment_date && (
                          <p className="text-xs text-gray-500">Pago em {formatDate(p.payment_date)}</p>
                        )}
                        {!p.payment_date && (
                          <p className="text-xs text-red-500 font-medium">⚠ Por pagar</p>
                        )}
                      </div>
                      <span className={`font-semibold text-sm ${p.payment_date ? 'text-gray-900' : 'text-red-600'}`}>
                        {formatCurrency(p.amount)}
                      </span>
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
        {tab === 'espacos' && (
          <div className="flex justify-end mt-6 pt-4 border-t border-gray-100">
            <button className="btn-secondary" onClick={onClose}>Fechar</button>
          </div>
        )}
        {tab === 'conta' && (
          <div className="flex justify-end mt-6 pt-4 border-t border-gray-100">
            <button className="btn-secondary" onClick={onClose}>Fechar</button>
          </div>
        )}
      </div>
    </div>
  )
}
