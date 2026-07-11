'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { Tenant, Lease } from '@/lib/types'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, Search, FileText, Phone, Mail, X, AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, Trash2 } from 'lucide-react'
import TenantModal from './TenantModal'
import LeaseModal from './LeaseModal'
import { useAuth } from '@/lib/auth-context'
import EmailModal from '@/components/EmailModal'
import { logAccess } from '@/lib/logAccess'
import Link from 'next/link'

interface TenantWithLease extends Tenant {
  leases?: (Lease & { space?: any })[]
  spaces?: { ref: string; type: string }[]
  debt?: number
}

interface Debt {
  id: string
  tenant_id: string
  description: string
  original_amount: number
  reference_date: string
  created_at: string
  payments?: DebtPayment[]
}

interface DebtPayment {
  id: string
  debt_id: string
  payment_date: string
  amount: number
  payment_method: string
  notes: string | null
}

type SortField = 'name' | 'spaces' | 'rent' | 'debt' | 'contract' | null
type SortDir = 'asc' | 'desc'

export default function InquilinosPage() {
  const { isAdmin, isCoAdmin } = useAuth()
  const [tenants, setTenants] = useState<TenantWithLease[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterSpaces, setFilterSpaces] = useState<string[]>([])
  const [showSpaceDropdown, setShowSpaceDropdown] = useState(false)
  const spaceDropdownRef = useRef<HTMLDivElement>(null)
  const [filterSpaceType, setFilterSpaceType] = useState<'all' | 'pavilhao' | 'habitacao' | 'loja'>('all')
  const [filterDebt, setFilterDebt] = useState<'all' | 'com_divida' | 'sem_divida'>('all')
  const [filterContract, setFilterContract] = useState<'all' | '30dias' | '60dias' | '90dias' | '180dias' | 'expirado'>('all')
  const [sortField, setSortField] = useState<SortField>('spaces')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [showTenantModal, setShowTenantModal] = useState(false)
  const [showLeaseModal, setShowLeaseModal] = useState(false)
  const [editTenant, setEditTenant] = useState<Tenant | null>(null)
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null)
  const [allSpaceRefs, setAllSpaceRefs] = useState<string[]>([])
  const [openTab, setOpenTab] = useState<'dados' | 'espacos' | 'conta'>('dados')

  // Modal de dívidas
  const [debtTenant, setDebtTenant] = useState<TenantWithLease | null>(null)
  const [debts, setDebts] = useState<Debt[]>([])
  const [loadingDebts, setLoadingDebts] = useState(false)
  const [emailTenant, setEmailTenant] = useState<TenantWithLease | null>(null)
  const [showNewDebt, setShowNewDebt] = useState(false)
  const [showNewPayment, setShowNewPayment] = useState<string | null>(null)
  const [savingDebt, setSavingDebt] = useState(false)
  const [newDebt, setNewDebt] = useState({ description: '', original_amount: '', reference_date: new Date().toISOString().slice(0, 10) })
  const [newPayment, setNewPayment] = useState({ payment_date: new Date().toISOString().slice(0, 10), amount: '', payment_method: 'dinheiro', notes: '' })

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (spaceDropdownRef.current && !spaceDropdownRef.current.contains(e.target as Node)) {
        setShowSpaceDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => { fetchTenants() }, [])

  async function fetchTenants() {
    setLoading(true)
    const { data: tenantsData } = await supabase.from('tenants').select('*').order('name')
    const { data: leasesData } = await supabase.from('leases').select('*, space:spaces(*)')
    const { data: spacesData } = await supabase.from('spaces').select('ref, type, tenant_id').not('tenant_id', 'is', null)
    const { data: paymentsData } = await supabase.from('rent_payments').select('amount, lease_id, payment_date, reference_month, tipo, used')
    const { data: debtsData } = await supabase.from('debts').select('id, tenant_id, original_amount')
    const { data: debtPaymentsData } = await supabase.from('debt_payments').select('debt_id, amount')

    // Cobranças de eletricidade por pagar
    const { data: elecChargesData } = await supabase
      .from('electricity_charges')
      .select('lease_id, amount')
      .eq('paid', false)

    const mayStart = new Date('2026-05-01')
    const today = new Date()
    today.setDate(1)
    const refs = [...new Set((spacesData ?? []).map(s => s.ref))].sort()
    setAllSpaceRefs(refs)

    const tenantsWithData = (tenantsData ?? []).map(t => {
      const leases = (leasesData ?? []).filter(l => l.tenant_id === t.id)
      const spaces = (spacesData ?? []).filter(s => s.tenant_id === t.id)
      const leaseIds = leases.map(l => l.id)

      const explicitDebt = (paymentsData ?? [])
        .filter(p => leaseIds.includes(p.lease_id) && !p.payment_date)
        .reduce((sum, p) => sum + (p.amount ?? 0), 0)

      let missingDebt = 0
      for (const lease of leases.filter(l => l.status === 'ativo')) {
        if (!lease.start_date) continue
        const contractStart = new Date(lease.start_date)
        contractStart.setDate(1)
        const start = contractStart > mayStart ? contractStart : mayStart
        const cursor = new Date(start)
        while (cursor <= today) {
          const monthStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
          const hasPayment = (paymentsData ?? []).some(p =>
            p.lease_id === lease.id &&
            p.reference_month?.slice(0, 7) === monthStr &&
            (p.tipo === 'renda' || !p.tipo)
          )
          if (!hasPayment) missingDebt += lease.monthly_rent
          cursor.setMonth(cursor.getMonth() + 1)
        }
      }

      // Dívidas manuais pendentes
      const tenantDebts = (debtsData ?? []).filter(d => d.tenant_id === t.id)
      const manualDebt = tenantDebts.reduce((sum, d) => {
        const paid = (debtPaymentsData ?? [])
          .filter(p => p.debt_id === d.id)
          .reduce((s, p) => s + p.amount, 0)
        return sum + Math.max(0, d.original_amount - paid)
      }, 0)

      // Cobranças de eletricidade por pagar
      const elecDebt = (elecChargesData ?? [])
        .filter(c => leaseIds.includes(c.lease_id))
        .reduce((sum, c) => sum + (c.amount ?? 0), 0)

      // Adiantamentos disponíveis (crédito do inquilino)
      const totalAdvance = (paymentsData ?? [])
        .filter(p => leaseIds.includes(p.lease_id) && p.tipo === 'adiantamento' && !p.used)
        .reduce((sum, p) => sum + (p.amount ?? 0), 0)

      return { ...t, leases, spaces, debt: explicitDebt + missingDebt + manualDebt + elecDebt - totalAdvance }
    })
    setTenants(tenantsWithData)
    setLoading(false)
  }

  async function fetchDebts(tenantId: string) {
    setLoadingDebts(true)
    const { data: debtsData } = await supabase.from('debts').select('*').eq('tenant_id', tenantId).order('reference_date', { ascending: false })
    const allDebts: Debt[] = []
    for (const d of debtsData ?? []) {
      const { data: payments } = await supabase.from('debt_payments').select('*').eq('debt_id', d.id).order('payment_date')
      allDebts.push({ ...d, payments: payments ?? [] })
    }
    setDebts(allDebts)
    setLoadingDebts(false)
  }

  async function handleDeleteTenant(tenant: TenantWithLease) {
    const hasLease = tenant.leases && tenant.leases.length > 0
    if (hasLease) {
      alert('Não é possível apagar este inquilino porque tem um espaço/contrato associado.')
      return
    }
    if (!confirm(`Tens a certeza que queres apagar o inquilino "${tenant.name}"?\n\nEsta ação é irreversível.`)) return
    const { error } = await supabase.from('tenants').delete().eq('id', tenant.id)
    if (error) { alert('Erro ao apagar inquilino: ' + error.message); return }
    fetchTenants()
  }

  function openDebtModal(tenant: TenantWithLease) {
    setDebtTenant(tenant)
    setShowNewDebt(false)
    setShowNewPayment(null)
    setNewDebt({ description: '', original_amount: '', reference_date: new Date().toISOString().slice(0, 10) })
    fetchDebts(tenant.id)
  }

  async function saveDebt() {
    if (!debtTenant || !newDebt.description || !newDebt.original_amount) return
    setSavingDebt(true)
    await supabase.from('debts').insert({
      tenant_id: debtTenant.id,
      description: newDebt.description,
      original_amount: parseFloat(newDebt.original_amount),
      reference_date: newDebt.reference_date,
    })
    await logAccess({ action: 'criar', page: '/inquilinos', details: `Criou dívida "${newDebt.description}" (${formatCurrency(parseFloat(newDebt.original_amount))}) para ${debtTenant.name}` })
    setSavingDebt(false)
    setShowNewDebt(false)
    setNewDebt({ description: '', original_amount: '', reference_date: new Date().toISOString().slice(0, 10) })
    fetchDebts(debtTenant.id)
    fetchTenants()
  }

  async function savePayment() {
    if (!showNewPayment || !newPayment.amount) return
    setSavingDebt(true)
    await supabase.from('debt_payments').insert({
      debt_id: showNewPayment,
      payment_date: newPayment.payment_date,
      amount: parseFloat(newPayment.amount),
      payment_method: newPayment.payment_method,
      notes: newPayment.notes || null,
    })
    await logAccess({ action: 'criar', page: '/inquilinos', details: `Registou pagamento de dívida (${formatCurrency(parseFloat(newPayment.amount))}) para ${debtTenant?.name}` })
    setSavingDebt(false)
    setShowNewPayment(null)
    setNewPayment({ payment_date: new Date().toISOString().slice(0, 10), amount: '', payment_method: 'dinheiro', notes: '' })
    if (debtTenant) fetchDebts(debtTenant.id)
    fetchTenants()
  }

  async function deleteDebt(id: string) {
    if (!confirm('Apagar esta dívida e todos os seus pagamentos?')) return
    const debt = debts.find(d => d.id === id)
    await supabase.from('debt_payments').delete().eq('debt_id', id)
    await supabase.from('debts').delete().eq('id', id)
    await logAccess({ action: 'apagar', page: '/inquilinos', details: `Apagou dívida "${debt?.description ?? ''}" de ${debtTenant?.name}` })
    if (debtTenant) fetchDebts(debtTenant.id)
    fetchTenants()
  }

  async function deletePayment(id: string) {
    if (!confirm('Apagar este pagamento?')) return
    await supabase.from('debt_payments').delete().eq('id', id)
    await logAccess({ action: 'apagar', page: '/inquilinos', details: `Apagou pagamento de dívida de ${debtTenant?.name}` })
    if (debtTenant) fetchDebts(debtTenant.id)
    fetchTenants()
  }

  function getRemainingDebt(debt: Debt): number {
    const paid = (debt.payments ?? []).reduce((s, p) => s + p.amount, 0)
    return Math.max(0, debt.original_amount - paid)
  }

  function getTotalRemainingDebts(): number {
    return debts.reduce((s, d) => s + getRemainingDebt(d), 0)
  }

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-gray-300 ml-1 inline" />
    return sortDir === 'asc'
      ? <ArrowUp className="w-3 h-3 text-emerald-600 ml-1 inline" />
      : <ArrowDown className="w-3 h-3 text-emerald-600 ml-1 inline" />
  }

  function toggleSpace(ref: string) {
    setFilterSpaces(prev => prev.includes(ref) ? prev.filter(r => r !== ref) : [...prev, ref])
  }

  const today = new Date()

  const filtered = tenants.filter(t => {
    const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.phone?.includes(search) || t.email?.toLowerCase().includes(search.toLowerCase())
    const matchSpace = filterSpaces.length === 0 ||
      t.spaces?.some(s => filterSpaces.includes(s.ref)) ||
      t.leases?.some(l => l.status === 'ativo' && filterSpaces.includes(l.space?.ref))
    const matchSpaceType = filterSpaceType === 'all' || t.spaces?.some(s => s.type === filterSpaceType) || t.leases?.some(l => l.status === 'ativo' && l.space?.type === filterSpaceType)
    const debt = t.debt ?? 0
    let matchDebt = true
    if (filterDebt === 'com_divida') matchDebt = debt > 0
    else if (filterDebt === 'sem_divida') matchDebt = debt <= 0
    const activeLease = t.leases?.find(l => l.status === 'ativo')
    let matchContract = true
    if (filterContract !== 'all' && activeLease?.end_date) {
      const endDate = new Date(activeLease.end_date)
      const diffDays = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
      if (filterContract === 'expirado') matchContract = diffDays < 0
      else if (filterContract === '30dias') matchContract = diffDays >= 0 && diffDays <= 30
      else if (filterContract === '60dias') matchContract = diffDays >= 0 && diffDays <= 60
      else if (filterContract === '90dias') matchContract = diffDays >= 0 && diffDays <= 90
      else if (filterContract === '180dias') matchContract = diffDays >= 0 && diffDays <= 180
    } else if (filterContract !== 'all' && !activeLease?.end_date) {
      matchContract = false
    }
    return matchSearch && matchSpace && matchSpaceType && matchDebt && matchContract
  }).sort((a, b) => {
    if (!sortField) return 0
    const dir = sortDir === 'asc' ? 1 : -1
    if (sortField === 'name') return dir * a.name.localeCompare(b.name)
    if (sortField === 'spaces') {
      const aRef = a.spaces?.[0]?.ref ?? ''
      const bRef = b.spaces?.[0]?.ref ?? ''
      // Sem espaço → sempre no final, independentemente da direção
      if (!aRef && !bRef) return 0
      if (!aRef) return 1
      if (!bRef) return -1
      return dir * aRef.localeCompare(bRef, 'pt', { numeric: true })
    }
    if (sortField === 'rent') {
      const aRent = a.leases?.find(l => l.status === 'ativo')?.monthly_rent ?? 0
      const bRent = b.leases?.find(l => l.status === 'ativo')?.monthly_rent ?? 0
      return dir * (aRent - bRent)
    }
    if (sortField === 'debt') return dir * ((a.debt ?? 0) - (b.debt ?? 0))
    if (sortField === 'contract') {
      const aEnd = a.leases?.find(l => l.status === 'ativo')?.end_date ?? ''
      const bEnd = b.leases?.find(l => l.status === 'ativo')?.end_date ?? ''
      return dir * aEnd.localeCompare(bEnd)
    }
    return 0
  })

  const hasFilters = search || filterSpaces.length > 0 || filterSpaceType !== 'all' || filterDebt !== 'all' || filterContract !== 'all'

  return (
    <AppLayout>
      <div className="p-4 md:p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Inquilinos</h1>
            <p className="text-sm text-gray-500 mt-1">{tenants.length} inquilinos registados</p>
          </div>
          {(isAdmin || isCoAdmin) && (
            <button className="btn-primary" onClick={() => { setEditTenant(null); setShowTenantModal(true) }}>
              <Plus className="w-4 h-4" /> Novo Inquilino
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <div className="relative col-span-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9 w-full" placeholder="Nome, telefone, email..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="relative" ref={spaceDropdownRef}>
            <button
              onClick={() => setShowSpaceDropdown(!showSpaceDropdown)}
              className={`input w-full flex items-center justify-between text-left ${filterSpaces.length > 0 ? 'border-emerald-400 text-emerald-700' : 'text-gray-600'}`}>
              <span className="truncate">
                {filterSpaces.length === 0 ? 'Todos os espaços' : filterSpaces.length === 1 ? filterSpaces[0] : `${filterSpaces.length} espaços selecionados`}
              </span>
              <ChevronDown className="w-4 h-4 flex-shrink-0 ml-2" />
            </button>
            {showSpaceDropdown && (
              <div className="absolute z-20 top-full mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
                <div className="p-2 border-b border-gray-100">
                  <button onClick={() => setFilterSpaces([])} className="text-xs text-gray-500 hover:text-emerald-600 hover:underline">
                    Limpar seleção
                  </button>
                </div>
                <div className="p-1">
                  {[...allSpaceRefs].sort((a, b) => a.localeCompare(b, 'pt', { numeric: true })).map(ref => (
                    <label key={ref} className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer">
                      <input type="checkbox" checked={filterSpaces.includes(ref)} onChange={() => toggleSpace(ref)} className="accent-emerald-600 w-3.5 h-3.5" />
                      <span className="text-sm text-gray-700">{ref}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <select className="input" value={filterSpaceType} onChange={e => setFilterSpaceType(e.target.value as any)}>
            <option value="all">Todos os tipos</option>
            <option value="pavilhao">🏭 Pavilhões</option>
            <option value="habitacao">🏠 Habitações</option>
            <option value="loja">🛍️ Lojas</option>
          </select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <select className="input" value={filterDebt} onChange={e => setFilterDebt(e.target.value as any)}>
            <option value="all">Todos (dívida)</option>
            <option value="com_divida">⚠ Com dívida</option>
            <option value="sem_divida">✓ Sem dívida</option>
          </select>
          <select className="input" value={filterContract} onChange={e => setFilterContract(e.target.value as any)}>
            <option value="all">Todos (contrato)</option>
            <option value="expirado">⛔ Contrato expirado</option>
            <option value="30dias">🔴 Expira em 30 dias</option>
            <option value="60dias">🟠 Expira em 60 dias</option>
            <option value="90dias">🟡 Expira em 90 dias</option>
            <option value="180dias">🟢 Expira em 180 dias</option>
          </select>
        </div>

        {hasFilters && (
          <p className="text-sm text-gray-500 mb-3">
            {filtered.length} resultado(s)
            <button onClick={() => { setSearch(''); setFilterSpaces([]); setFilterSpaceType('all'); setFilterDebt('all'); setFilterContract('all') }}
              className="ml-2 text-xs text-emerald-600 hover:underline">Limpar filtros</button>
          </p>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full hidden lg:table">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="table-header cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('name')}>
                    Inquilino <SortIcon field="name" />
                  </th>
                  <th className="table-header">Contacto</th>
                  <th className="table-header">NIF</th>
                  <th className="table-header cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('spaces')}>
                    Espaço(s) <SortIcon field="spaces" />
                  </th>
                  <th className="table-header cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('rent')}>
                    Renda <SortIcon field="rent" />
                  </th>
                  <th className="table-header cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('debt')}>
                    Dívida <SortIcon field="debt" />
                  </th>
                  <th className="table-header cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('contract')}>
                    Contrato <SortIcon field="contract" />
                  </th>
                  <th className="table-header">Notas</th>
                  {(isAdmin || isCoAdmin) && <th className="table-header"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(tenant => {
                  const activeLease = tenant.leases?.find(l => l.status === 'ativo')
                  const hasDebt = (tenant.debt ?? 0) > 0
                  let contractAlert = null
                  if (activeLease?.end_date) {
                    const endDate = new Date(activeLease.end_date)
                    const diffDays = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
                    if (diffDays < 0) contractAlert = { label: '⛔ Expirado', color: 'text-red-600' }
                    else if (diffDays <= 30) contractAlert = { label: `🔴 ${diffDays}d`, color: 'text-red-600' }
                    else if (diffDays <= 60) contractAlert = { label: `🟠 ${diffDays}d`, color: 'text-orange-600' }
                    else if (diffDays <= 90) contractAlert = { label: `🟡 ${diffDays}d`, color: 'text-yellow-600' }
                    else if (diffDays <= 180) contractAlert = { label: `🟢 ${diffDays}d`, color: 'text-green-600' }
                  }
                  return (
                    <tr key={tenant.id} className="hover:bg-gray-50 transition-colors">
                      <td className="table-cell">
                        <Link href={`/inquilinos/${tenant.id}`}
                          className="font-medium text-emerald-600 hover:underline cursor-pointer">
                          {tenant.name}
                        </Link>
                      </td>
                      <td className="table-cell">
                        <div className="space-y-0.5">
                          {tenant.phone && <div className="flex items-center gap-1.5 text-xs text-gray-600"><Phone className="w-3 h-3" />{tenant.phone}</div>}
                          {tenant.email && <div className="flex items-center gap-1.5 text-xs text-gray-600"><Mail className="w-3 h-3" />{tenant.email}</div>}
                        </div>
                      </td>
                      <td className="table-cell text-sm">{tenant.nif ?? '—'}</td>
                      <td className="table-cell">
                        <div className="flex flex-wrap gap-1">
                          {tenant.spaces && tenant.spaces.length > 0
                            ? tenant.spaces.map(s => <span key={s.ref} className="badge-verde">{s.ref}</span>)
                            : tenant.leases?.filter(l => l.status === 'ativo').map(l => <span key={l.id} className="badge-verde">{l.space?.ref}</span>)
                          }
                          {(!tenant.spaces || tenant.spaces.length === 0) && !activeLease && <span className="text-gray-400 text-sm">—</span>}
                        </div>
                      </td>
                      <td className="table-cell font-medium">
                        {activeLease ? formatCurrency(activeLease.monthly_rent) : '—'}
                      </td>
                      <td className="table-cell">
                        {hasDebt ? (
                          <button
                            onClick={() => { setEditTenant(tenant); setOpenTab('conta'); setShowTenantModal(true) }}
                            className="inline-flex items-center gap-1 text-sm font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full hover:bg-red-100 transition-colors cursor-pointer">
                            {formatCurrency(tenant.debt!)}
                          </button>
                        ) : (tenant.debt ?? 0) < 0 ? (
                          <button
                            onClick={() => { setEditTenant(tenant); setOpenTab('conta'); setShowTenantModal(true) }}
                            className="inline-flex items-center gap-1 text-sm font-semibold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full hover:bg-purple-100 transition-colors cursor-pointer">
                            💰 +{formatCurrency(Math.abs(tenant.debt!))}
                          </button>
                        ) : (
                          <button
                            onClick={() => { setEditTenant(tenant); setOpenTab('conta'); setShowTenantModal(true) }}
                            className="inline-flex items-center text-sm text-emerald-600 font-medium hover:underline cursor-pointer">
                            ✓ Sem dívida
                          </button>
                        )}
                      </td>
                      <td className="table-cell text-sm">
                        {activeLease?.start_date ? (
                          <div>
                            <p className="text-xs">Início: {formatDate(activeLease.start_date)}</p>
                            {activeLease.end_date && (
                              <p className={`text-xs font-medium ${contractAlert?.color ?? 'text-gray-500'}`}>
                                Fim: {formatDate(activeLease.end_date)}
                                {contractAlert && <span className="ml-1">{contractAlert.label}</span>}
                              </p>
                            )}
                            {activeLease.contract_file_path && (
                              <a href="#" className="text-xs text-emerald-600 flex items-center gap-1 mt-0.5">
                                <FileText className="w-3 h-3" /> Ver contrato
                              </a>
                            )}
                          </div>
                        ) : '—'}
                      </td>
                      <td className="table-cell max-w-[180px]">
                        <span className="text-xs text-gray-500 truncate block">{tenant.notes ?? '—'}</span>
                      </td>
                      {(isAdmin || isCoAdmin) && (
                        <td className="table-cell">
                          <div className="flex gap-2">
                            <button onClick={() => { setEditTenant(tenant); setOpenTab('dados'); setShowTenantModal(true) }}
                              className="text-xs text-emerald-600 hover:underline font-medium">Editar</button>
                            <button onClick={() => { setSelectedTenant(tenant); setShowLeaseModal(true) }}
                              className="text-xs text-blue-600 hover:underline font-medium">Contrato</button>
                            <button onClick={() => openDebtModal(tenant)}
                              className="text-xs text-red-500 hover:underline font-medium">Dívidas</button>
                            <button onClick={() => setEmailTenant(tenant)}
                              className="text-xs text-purple-600 hover:underline font-medium" title="Enviar e-mail">
                              <Mail className="w-3.5 h-3.5 inline" />
                            </button>
                            <button onClick={() => handleDeleteTenant(tenant)}
                              className="text-xs text-gray-400 hover:text-red-500 font-medium" title="Apagar inquilino">
                              <Trash2 className="w-3.5 h-3.5 inline" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={(isAdmin || isCoAdmin) ? 9 : 8} className="py-12 text-center text-gray-400 text-sm">
                      Nenhum inquilino encontrado
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {/* Vista mobile — cards */}
            <div className="lg:hidden divide-y divide-gray-100">
              {filtered.map(tenant => {
                const activeLease = tenant.leases?.find(l => l.status === 'ativo')
                const hasDebt = (tenant.debt ?? 0) > 0
                return (
                  <div key={tenant.id} className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <Link href={`/inquilinos/${tenant.id}`} className="font-semibold text-emerald-600 hover:underline text-base">
                          {tenant.name}
                        </Link>
                        {tenant.phone && (
                          <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-0.5">
                            <Phone className="w-3 h-3" />{tenant.phone}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1 justify-end">
                        {tenant.spaces && tenant.spaces.length > 0
                          ? tenant.spaces.map(s => <span key={s.ref} className="badge-verde">{s.ref}</span>)
                          : tenant.leases?.filter(l => l.status === 'ativo').map(l => <span key={l.id} className="badge-verde">{l.space?.ref}</span>)
                        }
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        {activeLease && (
                          <p className="text-sm text-gray-600">Renda: <span className="font-medium">{formatCurrency(activeLease.monthly_rent)}</span></p>
                        )}
                        {hasDebt ? (
                          <button onClick={() => { setEditTenant(tenant); setOpenTab('conta'); setShowTenantModal(true) }}
                            className="text-sm font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full mt-1">
                            Dívida: {formatCurrency(tenant.debt!)}
                          </button>
                        ) : (
                          <p className="text-xs text-emerald-600 mt-1">✓ Sem dívida</p>
                        )}
                      </div>
                      {(isAdmin || isCoAdmin) && (
                        <div className="flex gap-3">
                          <button onClick={() => { setEditTenant(tenant); setOpenTab('dados'); setShowTenantModal(true) }}
                            className="text-xs text-emerald-600 font-medium hover:underline">Editar</button>
                          <button onClick={() => { setSelectedTenant(tenant); setShowLeaseModal(true) }}
                            className="text-xs text-blue-600 font-medium hover:underline">Contrato</button>
                          <button onClick={() => openDebtModal(tenant)}
                            className="text-xs text-red-500 font-medium hover:underline">Dívidas</button>
                          <button onClick={() => handleDeleteTenant(tenant)}
                            className="text-xs text-gray-400 hover:text-red-500 font-medium" title="Apagar">
                            <Trash2 className="w-3.5 h-3.5 inline" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
              {filtered.length === 0 && (
                <div className="py-12 text-center text-gray-400 text-sm">Nenhum inquilino encontrado</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal Dívidas */}
      {debtTenant && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold text-lg text-gray-900">Dívidas — {debtTenant.name}</h2>
                {!loadingDebts && (
                  <p className={`text-sm font-medium mt-0.5 ${getTotalRemainingDebts() > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    Total em dívida: {formatCurrency(getTotalRemainingDebts())}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => setShowNewDebt(true)}
                  className="flex items-center gap-2 bg-red-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-red-700">
                  <Plus className="w-4 h-4" /> Nova Dívida
                </button>
                <button onClick={() => setDebtTenant(null)}><X className="w-5 h-5 text-gray-400" /></button>
              </div>
            </div>

            {showNewDebt && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <h3 className="text-sm font-semibold text-red-800 mb-3">Nova Dívida</h3>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs font-medium text-gray-600 block mb-1">Descrição *</label>
                    <input className="input text-sm w-full" placeholder="ex: Renda Jan 2025, Luz 2025..."
                      value={newDebt.description} onChange={e => setNewDebt(f => ({ ...f, description: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1">Valor (€) *</label>
                    <input type="number" step="0.01" className="input text-sm w-full" placeholder="ex: 500"
                      value={newDebt.original_amount} onChange={e => setNewDebt(f => ({ ...f, original_amount: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1">Data de referência</label>
                    <input type="date" className="input text-sm w-full"
                      value={newDebt.reference_date} onChange={e => setNewDebt(f => ({ ...f, reference_date: e.target.value }))} />
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => setShowNewDebt(false)} className="btn-secondary text-sm">Cancelar</button>
                  <button onClick={saveDebt} disabled={savingDebt || !newDebt.description || !newDebt.original_amount}
                    className="btn-primary text-sm disabled:opacity-50">
                    {savingDebt ? 'A guardar...' : 'Guardar Dívida'}
                  </button>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
              {loadingDebts ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-red-600" />
                </div>
              ) : debts.length === 0 ? (
                <div className="text-center py-10 text-gray-400">
                  <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                  <p className="text-sm">Sem dívidas registadas</p>
                </div>
              ) : (
                debts.map(debt => {
                  const remaining = getRemainingDebt(debt)
                  const paid = (debt.payments ?? []).reduce((s, p) => s + p.amount, 0)
                  const isSettled = remaining === 0
                  return (
                    <div key={debt.id} className={`border rounded-xl p-4 ${isSettled ? 'border-emerald-200 bg-emerald-50' : 'border-red-100 bg-white'}`}>
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-medium text-gray-900 text-sm">{debt.description}</p>
                          <p className="text-xs text-gray-500">{formatDate(debt.reference_date)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-gray-500">Valor original: {formatCurrency(debt.original_amount)}</p>
                          {paid > 0 && <p className="text-xs text-emerald-600">Pago: {formatCurrency(paid)}</p>}
                          <p className={`text-sm font-bold ${isSettled ? 'text-emerald-600' : 'text-red-600'}`}>
                            {isSettled ? '✓ Liquidada' : `Em dívida: ${formatCurrency(remaining)}`}
                          </p>
                        </div>
                      </div>
                      {(debt.payments ?? []).length > 0 && (
                        <div className="mt-2 space-y-1 border-t border-gray-100 pt-2">
                          {debt.payments!.map(p => (
                            <div key={p.id} className="flex items-center justify-between text-xs text-gray-600">
                              <span>{formatDate(p.payment_date)} — {p.payment_method}</span>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-emerald-600">+{formatCurrency(p.amount)}</span>
                                <button onClick={() => deletePayment(p.id)} className="text-gray-300 hover:text-red-400">✕</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2 mt-3">
                        {!isSettled && (
                          <button onClick={() => { setShowNewPayment(debt.id); setNewPayment({ payment_date: new Date().toISOString().slice(0, 10), amount: String(remaining), payment_method: 'dinheiro', notes: '' }) }}
                            className="text-xs text-emerald-600 hover:underline font-medium">
                            + Registar pagamento
                          </button>
                        )}
                        <button onClick={() => deleteDebt(debt.id)} className="text-xs text-red-400 hover:underline font-medium">
                          Apagar dívida
                        </button>
                      </div>
                      {showNewPayment === debt.id && (
                        <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                          <h4 className="text-xs font-semibold text-emerald-800 mb-2">Registar Pagamento</h4>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="text-xs text-gray-600 block mb-1">Data</label>
                              <input type="date" className="input text-xs w-full"
                                value={newPayment.payment_date} onChange={e => setNewPayment(f => ({ ...f, payment_date: e.target.value }))} />
                            </div>
                            <div>
                              <label className="text-xs text-gray-600 block mb-1">Valor (€)</label>
                              <input type="number" step="0.01" className="input text-xs w-full"
                                value={newPayment.amount} onChange={e => setNewPayment(f => ({ ...f, amount: e.target.value }))} />
                            </div>
                            <div>
                              <label className="text-xs text-gray-600 block mb-1">Método</label>
                              <select className="input text-xs w-full" value={newPayment.payment_method} onChange={e => setNewPayment(f => ({ ...f, payment_method: e.target.value }))}>
                                <option value="dinheiro">Dinheiro</option>
                                <option value="transferencia">Transferência</option>
                                <option value="banco">Banco</option>
                              </select>
                            </div>
                          </div>
                          <div className="flex gap-2 mt-2">
                            <button onClick={() => setShowNewPayment(null)} className="text-xs text-gray-500 hover:underline">Cancelar</button>
                            <button onClick={savePayment} disabled={savingDebt || !newPayment.amount}
                              className="text-xs bg-emerald-600 text-white px-3 py-1 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                              {savingDebt ? 'A guardar...' : 'Guardar'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {showTenantModal && (isAdmin || isCoAdmin) && (
        <TenantModal tenant={editTenant} onClose={() => { setShowTenantModal(false); setOpenTab('dados') }}
          onSaved={() => { setShowTenantModal(false); fetchTenants(); setOpenTab('dados') }}
          initialTab={openTab} />
      )}

      {showLeaseModal && selectedTenant && (isAdmin || isCoAdmin) && (
        <LeaseModal tenant={selectedTenant} onClose={() => setShowLeaseModal(false)}
          onSaved={() => { setShowLeaseModal(false); fetchTenants() }} />
      )}

      {emailTenant && (
        <EmailModal
          tenantName={emailTenant.name}
          tenantEmail={emailTenant.email}
          spaceRef={emailTenant.spaces?.[0]?.ref ?? emailTenant.leases?.find((l: any) => l.status === 'ativo')?.space?.ref}
          onClose={() => setEmailTenant(null)}
        />
      )}

    </AppLayout>
  )
}

// https://quinta-gestao.vercel.app/inquilinos
