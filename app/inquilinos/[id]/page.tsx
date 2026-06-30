'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Save, Plus, Trash2, Phone, Mail, User, Home, FileText, Zap } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { logAccess } from '@/lib/logAccess'

interface Tenant {
  id: string
  name: string
  phone: string | null
  email: string | null
  nif: string | null
  notes: string | null
}

interface TenantContact {
  id?: string
  tenant_id?: string
  name: string
  phone: string
  email: string
  relationship: string
  sort_order?: number
}

interface Debt {
  id: string
  description: string
  original_amount: number
  reference_date: string
  payments?: { id: string; amount: number; payment_date: string; payment_method: string }[]
}

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { isAdmin, isCoAdmin } = useAuth()

  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState(false)

  // Formulário inquilino
  const [form, setForm] = useState({
    name: '', phone: '', email: '', nif: '', notes: ''
  })

  // Contactos adicionais
  const [contacts, setContacts] = useState<TenantContact[]>([])
  const [savingContacts, setSavingContacts] = useState(false)

  // Dados adicionais
  const [spaces, setSpaces] = useState<any[]>([])
  const [leases, setLeases] = useState<any[]>([])
  const [debts, setDebts] = useState<Debt[]>([])
  const [payments, setPayments] = useState<any[]>([])

  useEffect(() => { if (id) fetchAll() }, [id])

  async function fetchAll() {
    setLoading(true)

    // Inquilino
    const { data: t } = await supabase.from('tenants').select('*').eq('id', id).single()
    if (t) {
      setTenant(t)
      setForm({ name: t.name, phone: t.phone ?? '', email: t.email ?? '', nif: t.nif ?? '', notes: t.notes ?? '' })
    }

    // Contactos adicionais
    const { data: c } = await supabase.from('tenant_contacts').select('*').eq('tenant_id', id).order('sort_order')
    setContacts(c ?? [])

    // Espaços
    const { data: s } = await supabase.from('spaces').select('id, ref, type').eq('tenant_id', id)
    setSpaces(s ?? [])

    // Contratos
    const { data: l } = await supabase.from('leases').select('*, space:spaces(ref)').eq('tenant_id', id).order('start_date', { ascending: false })
    setLeases(l ?? [])

    // Dívidas manuais
    const { data: d } = await supabase.from('debts').select('*').eq('tenant_id', id).order('reference_date', { ascending: false })
    const debtsWithPayments: Debt[] = []
    for (const debt of d ?? []) {
      const { data: dp } = await supabase.from('debt_payments').select('*').eq('debt_id', debt.id)
      debtsWithPayments.push({ ...debt, payments: dp ?? [] })
    }
    setDebts(debtsWithPayments)

    // Pagamentos recentes (rent_payments + electricity_charges pagas)
    const leaseIds = (l ?? []).map((x: any) => x.id)
    if (leaseIds.length > 0) {
      const { data: rp } = await supabase
        .from('rent_payments')
        .select('*, lease:leases(space:spaces(ref))')
        .in('lease_id', leaseIds)
        .order('reference_month', { ascending: false })
        .limit(24)

      const { data: ec } = await supabase
        .from('electricity_charges')
        .select('*, lease:leases(space:spaces(ref))')
        .eq('paid', true)
        .in('lease_id', leaseIds)
        .order('reference_month', { ascending: false })
        .limit(24)

      const ecNorm = (ec ?? []).map((e: any) => ({ ...e, tipo: 'luz' }))
      const combined = [...(rp ?? []), ...ecNorm].sort((a, b) =>
        (b.reference_month ?? '').localeCompare(a.reference_month ?? '')
      )
      setPayments(combined)
    }

    setLoading(false)
  }

  async function saveTenant() {
    if (!form.name.trim()) return
    setSaving(true)
    await supabase.from('tenants').update({
      name: form.name.trim(),
      phone: form.phone || null,
      email: form.email || null,
      nif: form.nif || null,
      notes: form.notes || null,
    }).eq('id', id)
    await logAccess({ action: 'editar', page: `/inquilinos/${id}`, details: `Editou dados do inquilino "${form.name.trim()}"` })
    setSaving(false)
    setSavedMsg(true)
    setTimeout(() => setSavedMsg(false), 3000)
  }

  async function saveContacts() {
    setSavingContacts(true)
    // Apagar todos os contactos existentes e recriar
    await supabase.from('tenant_contacts').delete().eq('tenant_id', id)
    const toInsert = contacts
      .filter(c => c.name.trim())
      .map((c, i) => ({
        tenant_id: id,
        name: c.name.trim(),
        phone: c.phone || null,
        email: c.email || null,
        relationship: c.relationship || null,
        sort_order: i,
      }))
    if (toInsert.length > 0) {
      await supabase.from('tenant_contacts').insert(toInsert)
    }
    await logAccess({ action: 'editar', page: `/inquilinos/${id}`, details: `Atualizou contactos adicionais de "${tenant?.name}"` })
    setSavingContacts(false)
    setSavedMsg(true)
    setTimeout(() => setSavedMsg(false), 3000)
    fetchAll()
  }

  function addContact() {
    if (contacts.length >= 5) return
    setContacts(prev => [...prev, { name: '', phone: '', email: '', relationship: '' }])
  }

  function removeContact(index: number) {
    setContacts(prev => prev.filter((_, i) => i !== index))
  }

  function updateContact(index: number, field: keyof TenantContact, value: string) {
    setContacts(prev => prev.map((c, i) => i === index ? { ...c, [field]: value } : c))
  }

  function getRemainingDebt(debt: Debt): number {
    const paid = (debt.payments ?? []).reduce((s, p) => s + p.amount, 0)
    return Math.max(0, debt.original_amount - paid)
  }

  const totalManualDebt = debts.reduce((s, d) => s + getRemainingDebt(d), 0)
  const activeLease = leases.find(l => l.status === 'ativo')

  if (loading) {
    return (
      <AppLayout>
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
        </div>
      </AppLayout>
    )
  }

  if (!tenant) {
    return (
      <AppLayout>
        <div className="p-8 text-center text-gray-400">Inquilino não encontrado</div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="p-4 md:p-8 max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push('/inquilinos')}
              className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
              <ArrowLeft className="w-4 h-4 text-gray-600" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{tenant.name}</h1>
              <p className="text-sm text-gray-500 mt-0.5">Ficha do inquilino</p>
            </div>
          </div>
          {savedMsg && <span className="text-sm text-emerald-600 font-medium">✓ Guardado com sucesso!</span>}
        </div>

        {/* Resumo rápido */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="card">
            <p className="text-xs text-gray-500 mb-1">Espaço(s)</p>
            <div className="flex flex-wrap gap-1">
              {spaces.length > 0 ? spaces.map(s => (
                <span key={s.id} className="text-sm font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">{s.ref}</span>
              )) : <span className="text-sm text-gray-400">—</span>}
            </div>
          </div>
          <div className="card">
            <p className="text-xs text-gray-500 mb-1">Renda mensal</p>
            <p className="text-lg font-bold text-gray-900">{activeLease ? formatCurrency(activeLease.monthly_rent) : '—'}</p>
          </div>
          <div className="card">
            <p className="text-xs text-gray-500 mb-1">Dívida manual</p>
            <p className={`text-lg font-bold ${totalManualDebt > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
              {totalManualDebt > 0 ? formatCurrency(totalManualDebt) : '✓ Sem dívida'}
            </p>
          </div>
          <div className="card">
            <p className="text-xs text-gray-500 mb-1">Contrato até</p>
            <p className="text-sm font-semibold text-gray-700">{activeLease?.end_date ? formatDate(activeLease.end_date) : '—'}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Dados do Inquilino */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-5">
              <User className="w-4 h-4 text-emerald-600" />
              <h2 className="font-semibold text-gray-900">Dados Pessoais</h2>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Nome completo *</label>
                <input className="input w-full" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  disabled={!(isAdmin || isCoAdmin)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Telefone</label>
                  <input className="input w-full" value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    disabled={!(isAdmin || isCoAdmin)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">NIF</label>
                  <input className="input w-full" value={form.nif}
                    onChange={e => setForm(f => ({ ...f, nif: e.target.value }))}
                    disabled={!(isAdmin || isCoAdmin)} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Email</label>
                <input className="input w-full" type="email" value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  disabled={!(isAdmin || isCoAdmin)} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Notas</label>
                <textarea className="input w-full" rows={3} value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  disabled={!(isAdmin || isCoAdmin)} />
              </div>
            </div>
            {(isAdmin || isCoAdmin) && (
              <button onClick={saveTenant} disabled={saving}
                className="mt-4 w-full flex items-center justify-center gap-2 bg-emerald-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                <Save className="w-4 h-4" />
                {saving ? 'A guardar...' : 'Guardar dados'}
              </button>
            )}
          </div>

          {/* Contactos Adicionais */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-blue-600" />
                <h2 className="font-semibold text-gray-900">Contactos Adicionais</h2>
              </div>
              {(isAdmin || isCoAdmin) && contacts.length < 5 && (
                <button onClick={addContact}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:underline font-medium">
                  <Plus className="w-3.5 h-3.5" /> Adicionar
                </button>
              )}
            </div>

            {contacts.length === 0 ? (
              <div className="text-center py-6 text-gray-400">
                <Phone className="w-8 h-8 mx-auto mb-2 text-gray-200" />
                <p className="text-sm">Sem contactos adicionais</p>
                {(isAdmin || isCoAdmin) && (
                  <button onClick={addContact} className="mt-2 text-xs text-blue-600 hover:underline">
                    + Adicionar contacto
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {contacts.map((contact, i) => (
                  <div key={i} className="border border-gray-100 rounded-lg p-3 relative">
                    {(isAdmin || isCoAdmin) && (
                      <button onClick={() => removeContact(i)}
                        className="absolute top-2 right-2 text-gray-300 hover:text-red-400">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <div className="grid grid-cols-2 gap-2 pr-6">
                      <div>
                        <label className="text-xs text-gray-500 block mb-0.5">Nome *</label>
                        <input className="input text-sm w-full" value={contact.name}
                          onChange={e => updateContact(i, 'name', e.target.value)}
                          disabled={!(isAdmin || isCoAdmin)} placeholder="Nome" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 block mb-0.5">Relação</label>
                        <input className="input text-sm w-full" value={contact.relationship}
                          onChange={e => updateContact(i, 'relationship', e.target.value)}
                          disabled={!(isAdmin || isCoAdmin)} placeholder="ex: Cônjuge, Filho..." />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 block mb-0.5">Telefone</label>
                        <input className="input text-sm w-full" value={contact.phone}
                          onChange={e => updateContact(i, 'phone', e.target.value)}
                          disabled={!(isAdmin || isCoAdmin)} placeholder="9XX XXX XXX" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 block mb-0.5">Email</label>
                        <input className="input text-sm w-full" value={contact.email}
                          onChange={e => updateContact(i, 'email', e.target.value)}
                          disabled={!(isAdmin || isCoAdmin)} placeholder="email@exemplo.com" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {(isAdmin || isCoAdmin) && contacts.length > 0 && (
              <button onClick={saveContacts} disabled={savingContacts}
                className="mt-4 w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                <Save className="w-4 h-4" />
                {savingContacts ? 'A guardar...' : 'Guardar contactos'}
              </button>
            )}
          </div>

          {/* Dívidas Manuais */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-5">
              <FileText className="w-4 h-4 text-red-500" />
              <h2 className="font-semibold text-gray-900">Dívidas Manuais</h2>
            </div>
            {debts.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Sem dívidas registadas</p>
            ) : (
              <div className="space-y-3">
                {debts.map(debt => {
                  const remaining = getRemainingDebt(debt)
                  const paid = (debt.payments ?? []).reduce((s, p) => s + p.amount, 0)
                  const isSettled = remaining === 0
                  return (
                    <div key={debt.id} className={`border rounded-lg p-3 ${isSettled ? 'border-emerald-200 bg-emerald-50' : 'border-red-100'}`}>
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-sm font-medium text-gray-800">{debt.description}</p>
                          <p className="text-xs text-gray-400">{formatDate(debt.reference_date)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-gray-400">Original: {formatCurrency(debt.original_amount)}</p>
                          {paid > 0 && <p className="text-xs text-emerald-600">Pago: {formatCurrency(paid)}</p>}
                          <p className={`text-sm font-bold ${isSettled ? 'text-emerald-600' : 'text-red-600'}`}>
                            {isSettled ? '✓ Liquidada' : formatCurrency(remaining)}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
                <div className={`text-right text-sm font-semibold pt-2 border-t ${totalManualDebt > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  Total em dívida: {formatCurrency(totalManualDebt)}
                </div>
              </div>
            )}
          </div>

          {/* Pagamentos Recentes */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-5">
              <Home className="w-4 h-4 text-gray-500" />
              <h2 className="font-semibold text-gray-900">Últimos Pagamentos</h2>
            </div>
            {payments.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Sem pagamentos registados</p>
            ) : (
              <div className="space-y-2">
                {payments.slice(0, 12).map((p, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                    <div>
                      <p className="text-sm text-gray-700">
                        {p.reference_month?.slice(0, 7)} — {p.lease?.space?.ref ?? '—'}
                        {p.tipo === 'luz'
                          ? <span clas
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </AppLayout>
  )
}

// https://quinta-gestao.vercel.app/inquilinos/[id]
