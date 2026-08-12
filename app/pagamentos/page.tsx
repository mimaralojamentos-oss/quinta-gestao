'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, getMonthLabel, getCurrentMonth, matchesSearch } from '@/lib/utils'
import { Plus, ChevronLeft, ChevronRight, CheckCircle, Clock, Search, SlidersHorizontal, X, ArrowUpDown, ArrowUp, ArrowDown, ChevronDown } from 'lucide-react'
import PaymentModal from './PaymentModal'
import AdvancePaymentModal from './AdvancePaymentModal'
import { useAuth } from '@/lib/auth-context'

interface LeaseWithDetails {
  id: string
  monthly_rent: number
  space: { ref: string; type: string }
  tenant: { id: string; name: string; phone: string }
  payments_this_month: {
    id: string
    amount: number
    payment_method: string
    payment_date: string
    tipo: string
    notes: string
  }[]
  balance: number
  total_debt: number
}

const tipoLabels: Record<string, string> = {
  renda: '🏠 Renda',
  caucao: '🔒 Caução',
  extra: '➕ Extra',
  luz: '⚡ Luz',
  adiantamento: '💰 Adiantamento',
}

type SortField = 'space' | 'tenant' | 'rent' | 'state' | 'balance' | 'debt' | null
type SortDir = 'asc' | 'desc'

function getDateRange(period: string): { from: string; to: string } | null {
  const today = new Date()
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  if (period === 'hoje') return { from: fmt(today), to: fmt(today) }
  if (period === 'semana') {
    const from = new Date(today); from.setDate(today.getDate() - 7)
    return { from: fmt(from), to: fmt(today) }
  }
  if (period === 'mes') {
    const from = new Date(today); from.setDate(today.getDate() - 30)
    return { from: fmt(from), to: fmt(today) }
  }
  if (period === 'ano') {
    return { from: `${today.getFullYear()}-01-01`, to: fmt(today) }
  }
  return null
}

export default function PagamentosPage() {
  const { isAdmin, isCoAdmin } = useAuth()
  const [leases, setLeases] = useState<LeaseWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [currentMonth, setCurrentMonth] = useState(getCurrentMonth())
  const [showModal, setShowModal] = useState(false)
  const [showAdvanceModal, setShowAdvanceModal] = useState(false)
  const [selectedLease, setSelectedLease] = useState<LeaseWithDetails | null>(null)
  const [summary, setSummary] = useState({ expected: 0, received: 0, pending: 0, inCash: 0, inBank: 0, totalDebt: 0 })

  // Filtros
  const [showFilters, setShowFilters] = useState(false)
  const [filterTenant, setFilterTenant] = useState('')
  const [filterDescription, setFilterDescription] = useState('')
  const [filterSpaces, setFilterSpaces] = useState<string[]>([])
  const [showSpaceDropdown, setShowSpaceDropdown] = useState(false)
  const spaceDropdownRef = useRef<HTMLDivElement>(null)
  const [filterState, setFilterState] = useState<'all' | 'pago' | 'parcial' | 'pendente'>('all')
  const [filterPeriod, setFilterPeriod] = useState<'all' | 'hoje' | 'semana' | 'mes' | 'ano'>('all')
  const [filterDebtMin, setFilterDebtMin] = useState('')
  const [filterDebtMax, setFilterDebtMax] = useState('')

  // Ordenação
  const [sortField, setSortField] = useState<SortField>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [allSpaceRefs, setAllSpaceRefs] = useState<string[]>([])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (spaceDropdownRef.current && !spaceDropdownRef.current.contains(e.target as Node)) {
        setShowSpaceDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => { fetchData() }, [currentMonth])

  async function fetchData() {
    setLoading(true)
    const nextMonth = getNextMonth(currentMonth)
    const mayStart = new Date('2026-05-01')
    const today = new Date(); today.setDate(1)

    const { data: leasesData } = await supabase.from('leases').select('*, space:spaces(*), tenant:tenants(*)').eq('status', 'ativo')
    const { data: paymentsData } = await supabase.from('rent_payments').select('*').gte('reference_month', currentMonth).lt('reference_month', nextMonth)
    const { data: allPayments } = await supabase.from('rent_payments').select('lease_id, amount, payment_date, reference_month, tipo')
    const { data: debtsData } = await supabase.from('debts').select('id, tenant_id, original_amount')
    const { data: debtPaymentsData } = await supabase.from('debt_payments').select('debt_id, amount')
    const { data: elecCharges } = await supabase.from('electricity_charges').select('lease_id, amount, amount_paid').eq('paid', false)

    const refs = [...new Set((leasesData ?? []).map(l => l.space?.ref).filter(Boolean))].sort()
    setAllSpaceRefs(refs)

    const mapped: LeaseWithDetails[] = (leasesData ?? []).map(l => {
      const paymentsThisMonth = (paymentsData ?? []).filter(p => p.lease_id === l.id)
      const totalPaid = paymentsThisMonth.filter(p => p.tipo === 'renda' || !p.tipo).reduce((s, p) => s + p.amount, 0)

      let rentDebt = 0
      if (l.start_date) {
        const contractStart = new Date(l.start_date); contractStart.setDate(1)
        const start = new Date(Math.max(contractStart.getTime(), mayStart.getTime()))
        const cursor = new Date(start)
        while (cursor <= today) {
          const monthStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
          const hasPayment = (allPayments ?? []).some(p => p.lease_id === l.id && p.reference_month?.slice(0, 7) === monthStr && p.payment_date && (p.tipo === 'renda' || !p.tipo))
          if (!hasPayment) rentDebt += l.monthly_rent
          cursor.setMonth(cursor.getMonth() + 1)
        }
      }

      const tenantDebts = (debtsData ?? []).filter(d => d.tenant_id === l.tenant?.id)
      const manualDebt = tenantDebts.reduce((sum, d) => {
        const paid = (debtPaymentsData ?? []).filter(p => p.debt_id === d.id).reduce((s, p) => s + p.amount, 0)
        return sum + Math.max(0, d.original_amount - paid)
      }, 0)

      const elecDebt = (elecCharges ?? []).filter(c => c.lease_id === l.id).reduce((s, c) => s + Math.max(0, c.amount - (c.amount_paid ?? 0)), 0)

      return {
        id: l.id, monthly_rent: l.monthly_rent, space: l.space, tenant: l.tenant,
        payments_this_month: paymentsThisMonth,
        balance: totalPaid - l.monthly_rent,
        total_debt: rentDebt + manualDebt + elecDebt,
      }
    })

    setLeases(mapped)
    const expected = mapped.reduce((s, l) => s + l.monthly_rent, 0)
    const rentaPayments = (paymentsData ?? []).filter(p => p.tipo === 'renda' || !p.tipo)
    const received = rentaPayments.reduce((s, p) => s + p.amount, 0)
    const inCash = rentaPayments.filter(p => p.payment_method === 'dinheiro').reduce((s, p) => s + p.amount, 0)
    const inBank = rentaPayments.filter(p => p.payment_method !== 'dinheiro').reduce((s, p) => s + p.amount, 0)
    setSummary({ expected, received, pending: expected - received, inCash, inBank, totalDebt: mapped.reduce((s, l) => s + l.total_debt, 0) })
    setLoading(false)
  }

  function changeMonth(delta: number) {
    const d = new Date(currentMonth); d.setMonth(d.getMonth() + delta)
    setCurrentMonth(d.toISOString().slice(0, 10))
  }

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-gray-300 ml-1 inline" />
    return sortDir === 'asc' ? <ArrowUp className="w-3 h-3 text-emerald-600 ml-1 inline" /> : <ArrowDown className="w-3 h-3 text-emerald-600 ml-1 inline" />
  }

  function toggleSpace(ref: string) {
    setFilterSpaces(prev => prev.includes(ref) ? prev.filter(r => r !== ref) : [...prev, ref])
  }

  function resetFilters() {
    setFilterTenant(''); setFilterDescription(''); setFilterSpaces([])
    setFilterState('all'); setFilterPeriod('all'); setFilterDebtMin(''); setFilterDebtMax('')
  }

  const hasFilters = filterTenant || filterDescription || filterSpaces.length > 0 || filterState !== 'all' || filterPeriod !== 'all' || filterDebtMin || filterDebtMax

  const dateRange = filterPeriod !== 'all' ? getDateRange(filterPeriod) : null

  const filtered = leases.filter(l => {
    const paid = l.payments_this_month.reduce((s, p) => s + p.amount, 0)
    const isPaid = paid >= l.monthly_rent
    const isPartial = paid > 0 && !isPaid

    if (filterTenant && !matchesSearch(l.tenant?.name, filterTenant)) return false
    if (filterDescription && !matchesSearch(l.tenant?.name, filterDescription) && !matchesSearch(l.space?.ref, filterDescription)) return false
    if (filterSpaces.length > 0 && !filterSpaces.includes(l.space?.ref)) return false
    if (filterState === 'pago' && !isPaid) return false
    if (filterState === 'parcial' && !isPartial) return false
    if (filterState === 'pendente' && (isPaid || isPartial)) return false
    if (dateRange) {
      const hasPaymentInRange = l.payments_this_month.some(p => p.payment_date >= dateRange.from && p.payment_date <= dateRange.to)
      if (!hasPaymentInRange && filterPeriod !== 'all') return false
    }
    if (filterDebtMin && l.total_debt < parseFloat(filterDebtMin)) return false
    if (filterDebtMax && l.total_debt > parseFloat(filterDebtMax)) return false
    return true
  }).sort((a, b) => {
    if (!sortField) {
      const aPaid = a.payments_this_month.length > 0
      const bPaid = b.payments_this_month.length > 0
      if (aPaid !== bPaid) return aPaid ? 1 : -1
      return a.space?.ref?.localeCompare(b.space?.ref ?? '') ?? 0
    }
    const dir = sortDir === 'asc' ? 1 : -1
    if (sortField === 'space') return dir * (a.space?.ref ?? '').localeCompare(b.space?.ref ?? '')
    if (sortField === 'tenant') return dir * (a.tenant?.name ?? '').localeCompare(b.tenant?.name ?? '')
    if (sortField === 'rent') return dir * (a.monthly_rent - b.monthly_rent)
    if (sortField === 'balance') return dir * (a.balance - b.balance)
    if (sortField === 'debt') return dir * (a.total_debt - b.total_debt)
    if (sortField === 'state') {
      const getState = (l: LeaseWithDetails) => {
        const p = l.payments_this_month.reduce((s, p) => s + p.amount, 0)
        return p >= l.monthly_rent ? 0 : p > 0 ? 1 : 2
      }
      return dir * (getState(a) - getState(b))
    }
    return 0
  })

  return (
    <AppLayout>
      <div className="p-4 md:p-8">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-gray-900">Rendas & Pagamentos</h1>
          <div className="flex items-center gap-3">
            {(isAdmin || isCoAdmin) && (
              <button onClick={() => setShowAdvanceModal(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-700 transition-colors">
                <Plus className="w-4 h-4" /> Adiantamento
              </button>
            )}
            <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-3 py-1.5">
              <button onClick={() => changeMonth(-1)} className="text-gray-500 hover:text-gray-700"><ChevronLeft className="w-4 h-4" /></button>
              <span className="font-medium text-gray-800 min-w-[140px] text-center text-sm">{getMonthLabel(currentMonth)}</span>
              <button onClick={() => changeMonth(1)} className="text-gray-500 hover:text-gray-700"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        </div>

        {/* Resumo compacto */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
          {[
            { label: 'Esperado', value: formatCurrency(summary.expected), color: 'text-gray-900' },
            { label: 'Recebido', value: formatCurrency(summary.received), color: 'text-emerald-600' },
            { label: 'Pendente mês', value: formatCurrency(summary.pending), color: summary.pending > 0 ? 'text-red-600' : 'text-gray-400' },
            { label: 'Total em Dívida', value: formatCurrency(summary.totalDebt), color: summary.totalDebt > 0 ? 'text-red-600' : 'text-emerald-600', highlight: true },
            { label: '💵 Dinheiro', value: formatCurrency(summary.inCash), color: 'text-gray-700' },
            { label: '🏦 Via Banco', value: formatCurrency(summary.inBank), color: 'text-gray-700' },
          ].map((item, i) => (
            <div key={i} className={`bg-white rounded-lg border px-3 py-2.5 text-center ${(item as any).highlight ? 'border-l-4 border-l-red-400 border-gray-100' : 'border-gray-100'}`}>
              <p className="text-xs text-gray-500 mb-0.5">{item.label}</p>
              <p className={`text-base font-bold ${item.color}`}>{item.value}</p>
            </div>
          ))}
        </div>

        {/* Filtros */}
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-3 mb-4">
          <div className="flex gap-2 items-center flex-wrap">

            {/* Pesquisa inquilino */}
            <div className="relative w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input className="input pl-9 w-full text-sm" placeholder="Inquilino..."
                value={filterTenant} onChange={e => setFilterTenant(e.target.value)} />
            </div>

            {/* Pesquisa descrição */}
            <div className="relative w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input className="input pl-9 w-full text-sm" placeholder="Espaço / descrição..."
                value={filterDescription} onChange={e => setFilterDescription(e.target.value)} />
            </div>

            {/* Dropdown espaços múltiplos — mais largo */}
            <div className="relative w-56" ref={spaceDropdownRef}>
              <button
                onClick={() => setShowSpaceDropdown(!showSpaceDropdown)}
                className={`input w-full flex items-center justify-between text-left text-sm ${filterSpaces.length > 0 ? 'border-emerald-400 text-emerald-700' : 'text-gray-600'}`}>
                <span className="truncate">
                  {filterSpaces.length === 0 ? 'Todos os espaços' : filterSpaces.length === 1 ? filterSpaces[0] : `${filterSpaces.length} espaços selecionados`}
                </span>
                <ChevronDown className="w-4 h-4 flex-shrink-0 ml-2" />
              </button>
              {showSpaceDropdown && (
                <div className="absolute z-20 top-full mt-1 w-64 bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
                  <div className="p-2 border-b border-gray-100">
                    <button onClick={() => setFilterSpaces([])} className="text-xs text-gray-500 hover:text-emerald-600 hover:underline">
                      Limpar seleção
                    </button>
                  </div>
                  <div className="p-1">
                    {[...allSpaceRefs].sort((a, b) => a.localeCompare(b, 'pt', { numeric: true })).map(ref => (
                      <label key={ref} className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer">
                        <input type="checkbox" checked={filterSpaces.includes(ref)} onChange={() => toggleSpace(ref)} className="accent-emerald-600 w-3.5 h-3.5 flex-shrink-0" />
                        <span className="text-sm text-gray-700">{ref}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Estado — mais compacto */}
            <select className="input text-sm w-32" value={filterState} onChange={e => setFilterState(e.target.value as any)}>
              <option value="all">Estado</option>
              <option value="pago">✅ Pago</option>
              <option value="parcial">🟡 Parcial</option>
              <option value="pendente">🔴 Pendente</option>
            </select>

            {/* Período */}
            <select className="input text-sm w-36" value={filterPeriod} onChange={e => setFilterPeriod(e.target.value as any)}>
              <option value="all">Qualquer data</option>
              <option value="hoje">📅 Hoje</option>
              <option value="semana">📅 Última semana</option>
              <option value="mes">📅 Último mês</option>
              <option value="ano">📅 Este ano</option>
            </select>

            {/* Mais filtros */}
            <button onClick={() => setShowFilters(v => !v)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors flex-shrink-0 ${showFilters ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              <SlidersHorizontal className="w-4 h-4" />
              Dívida
            </button>

            {hasFilters && (
              <button onClick={resetFilters} className="flex items-center gap-1 text-xs text-red-500 hover:underline flex-shrink-0">
                <X className="w-3.5 h-3.5" /> Limpar
              </button>
            )}
          </div>

          {showFilters && (
            <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Dívida mínima (€)</label>
                <input type="number" step="0.01" min="0" className="input text-sm w-full" placeholder="ex: 100"
                  value={filterDebtMin} onChange={e => setFilterDebtMin(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Dívida máxima (€)</label>
                <input type="number" step="0.01" min="0" className="input text-sm w-full" placeholder="ex: 1000"
                  value={filterDebtMax} onChange={e => setFilterDebtMax(e.target.value)} />
              </div>
            </div>
          )}

          {hasFilters && (
            <p className="text-xs text-gray-500 mt-2">{filtered.length} resultado(s) de {leases.length}</p>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="table-header cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('space')}>Espaço <SortIcon field="space" /></th>
                  <th className="table-header cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('tenant')}>Inquilino <SortIcon field="tenant" /></th>
                  <th className="table-header cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('rent')}>Renda <SortIcon field="rent" /></th>
                  <th className="table-header cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('state')}>Estado <SortIcon field="state" /></th>
                  <th className="table-header">Pago</th>
                  <th className="table-header">Método</th>
                  <th className="table-header cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('balance')}>Saldo mês <SortIcon field="balance" /></th>
                  <th className="table-header cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('debt')}>Total dívida <SortIcon field="debt" /></th>
                  {(isAdmin || isCoAdmin) && <th className="table-header"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(lease => {
                  const paid = lease.payments_this_month.reduce((s, p) => s + p.amount, 0)
                  const isPaid = paid >= lease.monthly_rent
                  const isPartial = paid > 0 && !isPaid
                  return (
                    <tr key={lease.id} className="hover:bg-gray-50 transition-colors">
                      <td className="table-cell font-semibold text-gray-900">{lease.space?.ref}</td>
                      <td className="table-cell">
                        <p className="font-medium text-gray-800">{lease.tenant?.name}</p>
                        {lease.tenant?.phone && <p className="text-xs text-gray-500">{lease.tenant.phone}</p>}
                      </td>
                      <td className="table-cell font-medium">{formatCurrency(lease.monthly_rent)}</td>
                      <td className="table-cell">
                        {isPaid ? (
                          <span className="badge-verde flex items-center gap-1 w-fit"><CheckCircle className="w-3 h-3" /> Pago</span>
                        ) : isPartial ? (
                          <span className="badge-amarelo flex items-center gap-1 w-fit"><Clock className="w-3 h-3" /> Parcial</span>
                        ) : (
                          <span className="badge-vermelho flex items-center gap-1 w-fit"><Clock className="w-3 h-3" /> Pendente</span>
                        )}
                      </td>
                      <td className="table-cell">{paid > 0 ? formatCurrency(paid) : '—'}</td>
                      <td className="table-cell">
                        {lease.payments_this_month.length > 0 ? (
                          <div className="space-y-0.5">
                            {lease.payments_this_month.map(p => (
                              <div key={p.id} className="flex items-center gap-1 flex-wrap">
                                <span className={`text-xs px-2 py-0.5 rounded-full ${p.payment_method === 'dinheiro' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                                  {p.payment_method === 'dinheiro' ? '💵' : '🏦'}
                                </span>
                                <span className={`text-xs px-2 py-0.5 rounded-full ${p.tipo === 'caucao' ? 'bg-blue-100 text-blue-700' : p.tipo === 'extra' ? 'bg-orange-100 text-orange-700' : p.tipo === 'luz' ? 'bg-yellow-100 text-yellow-700' : p.tipo === 'adiantamento' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                                  {tipoLabels[p.tipo] ?? '🏠 Renda'}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : '—'}
                      </td>
                      <td className="table-cell">
                        <span className={`font-medium text-sm ${lease.balance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {lease.balance >= 0 ? '+' : ''}{formatCurrency(lease.balance)}
                        </span>
                      </td>
                      <td className="table-cell">
                        {lease.total_debt > 0 ? (
                          <span className="text-sm font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{formatCurrency(lease.total_debt)}</span>
                        ) : (
                          <span className="text-xs text-emerald-600 font-medium">✓</span>
                        )}
                      </td>
                      {(isAdmin || isCoAdmin) && (
                        <td className="table-cell">
                          <button onClick={() => { setSelectedLease(lease); setShowModal(true) }} className="btn-primary text-xs py-1.5 px-3">
                            <Plus className="w-3 h-3" /> Registar
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={(isAdmin || isCoAdmin) ? 9 : 8} className="py-12 text-center text-gray-400 text-sm">Nenhum resultado encontrado</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && selectedLease && (isAdmin || isCoAdmin) && (
        <PaymentModal lease={selectedLease} currentMonth={currentMonth}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); fetchData() }} />
      )}

      {showAdvanceModal && (isAdmin || isCoAdmin) && (
        <AdvancePaymentModal
          onClose={() => setShowAdvanceModal(false)}
          onSaved={() => { setShowAdvanceModal(false); fetchData() }} />
      )}
    </AppLayout>
  )
}

function getNextMonth(dateString: string): string {
  const d = new Date(dateString); d.setMonth(d.getMonth() + 1)
  return d.toISOString().slice(0, 10)
}

// https://quinta-gestao.vercel.app/pagamentos
