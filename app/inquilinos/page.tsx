'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Tenant, Lease } from '@/lib/types'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, Search, FileText, Phone, Mail } from 'lucide-react'
import TenantModal from './TenantModal'
import LeaseModal from './LeaseModal'
import { useAuth } from '@/lib/auth-context'

interface TenantWithLease extends Tenant {
  leases?: (Lease & { space?: any })[]
  spaces?: { ref: string; type: string }[]
  debt?: number
}

export default function InquilinosPage() {
  const { isAdmin } = useAuth()
  const [tenants, setTenants] = useState<TenantWithLease[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterSpace, setFilterSpace] = useState('')
  const [filterSpaceType, setFilterSpaceType] = useState<'all' | 'pavilhao' | 'habitacao' | 'loja'>('all')
  const [filterDebt, setFilterDebt] = useState<'all' | 'com_divida' | 'sem_divida'>('all')
  const [filterContract, setFilterContract] = useState<'all' | '30dias' | '60dias' | '90dias' | '180dias' | 'expirado'>('all')
  const [showTenantModal, setShowTenantModal] = useState(false)
  const [showLeaseModal, setShowLeaseModal] = useState(false)
  const [editTenant, setEditTenant] = useState<Tenant | null>(null)
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null)
  const [allSpaceRefs, setAllSpaceRefs] = useState<string[]>([])

  useEffect(() => { fetchTenants() }, [])

  async function fetchTenants() {
    setLoading(true)

    const { data: tenantsData } = await supabase
      .from('tenants')
      .select('*')
      .order('name')

    const { data: leasesData } = await supabase
      .from('leases')
      .select('*, space:spaces(*)')

    const { data: spacesData } = await supabase
      .from('spaces')
      .select('ref, type, tenant_id')
      .not('tenant_id', 'is', null)

    const { data: paymentsData } = await supabase
      .from('rent_payments')
      .select('amount, lease_id, payment_date, reference_month, tipo')

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
          const monthStr = cursor.toISOString().slice(0, 7)
          const hasPayment = (paymentsData ?? []).some(p =>
            p.lease_id === lease.id &&
            p.reference_month?.slice(0, 7) === monthStr &&
            (p.tipo === 'renda' || !p.tipo)
          )
          if (!hasPayment) missingDebt += lease.monthly_rent
          cursor.setMonth(cursor.getMonth() + 1)
        }
      }

      return { ...t, leases, spaces, debt: explicitDebt + missingDebt }
    })

    setTenants(tenantsWithData)
    setLoading(false)
  }

  const today = new Date()

  const filtered = tenants.filter(t => {
    const matchSearch = !search ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.phone?.includes(search) ||
      t.email?.toLowerCase().includes(search.toLowerCase())

    const matchSpace = !filterSpace ||
      t.spaces?.some(s => s.ref === filterSpace) ||
      t.leases?.some(l => l.status === 'ativo' && l.space?.ref === filterSpace)

    const matchSpaceType = filterSpaceType === 'all' ||
      t.spaces?.some(s => s.type === filterSpaceType) ||
      t.leases?.some(l => l.status === 'ativo' && l.space?.type === filterSpaceType)

    const debt = t.debt ?? 0
    let matchDebt = true
    if (filterDebt === 'com_divida') matchDebt = debt > 0
    else if (filterDebt === 'sem_divida') matchDebt = debt === 0

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
  })

  const hasFilters = search || filterSpace || filterSpaceType !== 'all' || filterDebt !== 'all' || filterContract !== 'all'

  return (
    <AppLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Inquilinos</h1>
            <p className="text-sm text-gray-500 mt-1">{tenants.length} inquilinos registados</p>
          </div>
          {isAdmin && (
            <button className="btn-primary" onClick={() => { setEditTenant(null); setShowTenantModal(true) }}>
              <Plus className="w-4 h-4" />
              Novo Inquilino
            </button>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="relative col-span-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9 w-full" placeholder="Nome, telefone, email..." value={search}
              onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="input" value={filterSpace} onChange={e => setFilterSpace(e.target.value)}>
            <option value="">Todos os espaços</option>
            {allSpaceRefs.map(ref => (
              <option key={ref} value={ref}>{ref}</option>
            ))}
          </select>
          <select className="input" value={filterSpaceType} onChange={e => setFilterSpaceType(e.target.value as any)}>
            <option value="all">Todos os tipos</option>
            <option value="pavilhao">🏭 Pavilhões</option>
            <option value="habitacao">🏠 Habitações</option>
            <option value="loja">🛍️ Lojas</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4">
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
            <button onClick={() => { setSearch(''); setFilterSpace(''); setFilterSpaceType('all'); setFilterDebt('all'); setFilterContract('all') }}
              className="ml-2 text-xs text-emerald-600 hover:underline">
              Limpar filtros
            </button>
          </p>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="table-header">Inquilino</th>
                  <th className="table-header">Contacto</th>
                  <th className="table-header">NIF</th>
                  <th className="table-header">Espaço(s)</th>
                  <th className="table-header">Renda</th>
                  <th className="table-header">Dívida</th>
                  <th className="table-header">Contrato</th>
                  <th className="table-header">Notas</th>
                  {isAdmin && <th className="table-header"></th>}
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
                        <p className="font-medium text-gray-900">{tenant.name}</p>
                      </td>
                      <td className="table-cell">
                        <div className="space-y-0.5">
                          {tenant.phone && (
                            <div className="flex items-center gap-1.5 text-xs text-gray-600">
                              <Phone className="w-3 h-3" />{tenant.phone}
                            </div>
                          )}
                          {tenant.email && (
                            <div className="flex items-center gap-1.5 text-xs text-gray-600">
                              <Mail className="w-3 h-3" />{tenant.email}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="table-cell text-sm">{tenant.nif ?? '—'}</td>
                      <td className="table-cell">
                        <div className="flex flex-wrap gap-1">
                          {tenant.spaces && tenant.spaces.length > 0
                            ? tenant.spaces.map(s => (
                                <span key={s.ref} className="badge-verde">{s.ref}</span>
                              ))
                            : tenant.leases?.filter(l => l.status === 'ativo').map(l => (
                                <span key={l.id} className="badge-verde">{l.space?.ref}</span>
                              ))
                          }
                          {(!tenant.spaces || tenant.spaces.length === 0) && !activeLease && (
                            <span className="text-gray-400 text-sm">—</span>
                          )}
                        </div>
                      </td>
                      <td className="table-cell font-medium">
                        {activeLease ? formatCurrency(activeLease.monthly_rent) : '—'}
                      </td>
                      <td className="table-cell">
                        {hasDebt ? (
                          <span className="inline-flex items-center gap-1 text-sm font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                            {formatCurrency(tenant.debt!)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-sm text-emerald-600 font-medium">
                            ✓ Sem dívida
                          </span>
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
                      {isAdmin && (
                        <td className="table-cell">
                          <div className="flex gap-2">
                            <button onClick={() => { setEditTenant(tenant); setShowTenantModal(true) }}
                              className="text-xs text-emerald-600 hover:underline font-medium">Editar</button>
                            <button onClick={() => { setSelectedTenant(tenant); setShowLeaseModal(true) }}
                              className="text-xs text-blue-600 hover:underline font-medium">Contrato</button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={isAdmin ? 9 : 8} className="py-12 text-center text-gray-400 text-sm">
                      Nenhum inquilino encontrado
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showTenantModal && isAdmin && (
        <TenantModal
          tenant={editTenant}
          onClose={() => setShowTenantModal(false)}
          onSaved={() => { setShowTenantModal(false); fetchTenants() }}
        />
      )}

      {showLeaseModal && selectedTenant && isAdmin && (
        <LeaseModal
          tenant={selectedTenant}
          onClose={() => setShowLeaseModal(false)}
          onSaved={() => { setShowLeaseModal(false); fetchTenants() }}
        />
      )}
    </AppLayout>
  )
}
