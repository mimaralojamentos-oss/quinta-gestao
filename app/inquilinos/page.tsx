'use client'

export const dynamic = 'force-dynamic'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Tenant, Lease } from '@/lib/types'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, Search, FileText, Phone, Mail } from 'lucide-react'
import TenantModal from './TenantModal'
import LeaseModal from './LeaseModal'

interface TenantWithLease extends Tenant {
  leases?: (Lease & { space?: any })[]
}

export default function InquilinosPage() {
  const [tenants, setTenants] = useState<TenantWithLease[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showTenantModal, setShowTenantModal] = useState(false)
  const [showLeaseModal, setShowLeaseModal] = useState(false)
  const [editTenant, setEditTenant] = useState<Tenant | null>(null)
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null)

  useEffect(() => { fetchTenants() }, [])

  async function fetchTenants() {
    setLoading(true)
    const { data: tenantsData } = await supabase.from('tenants').select('*').order('name')
    const { data: leasesData } = await supabase
      .from('leases')
      .select('*, space:spaces(*)')

    const tenantsWithLeases = (tenantsData ?? []).map(t => ({
      ...t,
      leases: (leasesData ?? []).filter(l => l.tenant_id === t.id)
    }))

    setTenants(tenantsWithLeases)
    setLoading(false)
  }

  const filtered = tenants.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.phone?.includes(search) ||
    t.email?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <AppLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Inquilinos</h1>
            <p className="text-sm text-gray-500 mt-1">{tenants.length} inquilinos registados</p>
          </div>
          <button className="btn-primary" onClick={() => { setEditTenant(null); setShowTenantModal(true) }}>
            <Plus className="w-4 h-4" />
            Novo Inquilino
          </button>
        </div>

        <div className="relative max-w-xs mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input className="input pl-9" placeholder="Pesquisar inquilino..." value={search}
            onChange={e => setSearch(e.target.value)} />
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
                  <th className="table-header">Inquilino</th>
                  <th className="table-header">Contacto</th>
                  <th className="table-header">NIF</th>
                  <th className="table-header">Espaço(s)</th>
                  <th className="table-header">Renda</th>
                  <th className="table-header">Contrato</th>
                  <th className="table-header">Notas</th>
                  <th className="table-header"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(tenant => {
                  const activeLease = tenant.leases?.find(l => l.status === 'ativo')
                  return (
                    <tr key={tenant.id} className="hover:bg-gray-50 transition-colors">
                      <td className="table-cell">
                        <p className="font-medium text-gray-900">{tenant.name}</p>
                      </td>
                      <td className="table-cell">
                        <div className="space-y-0.5">
                          {tenant.phone && (
                            <div className="flex items-center gap-1.5 text-xs text-gray-600">
                              <Phone className="w-3 h-3" />
                              {tenant.phone}
                            </div>
                          )}
                          {tenant.email && (
                            <div className="flex items-center gap-1.5 text-xs text-gray-600">
                              <Mail className="w-3 h-3" />
                              {tenant.email}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="table-cell text-sm">{tenant.nif ?? '—'}</td>
                      <td className="table-cell">
                        {tenant.leases?.filter(l => l.status === 'ativo').map(l => (
                          <span key={l.id} className="badge-verde mr-1">{l.space?.ref}</span>
                        ))}
                        {!activeLease && <span className="text-gray-400 text-sm">—</span>}
                      </td>
                      <td className="table-cell font-medium">
                        {activeLease ? formatCurrency(activeLease.monthly_rent) : '—'}
                      </td>
                      <td className="table-cell text-sm">
                        {activeLease?.start_date ? (
                          <div>
                            <p className="text-xs">Início: {formatDate(activeLease.start_date)}</p>
                            {activeLease.end_date && (
                              <p className="text-xs text-orange-600">Fim: {formatDate(activeLease.end_date)}</p>
                            )}
                            {activeLease.contract_file_path && (
                              <a href={`#`} className="text-xs text-emerald-600 flex items-center gap-1 mt-0.5">
                                <FileText className="w-3 h-3" /> Ver contrato
                              </a>
                            )}
                          </div>
                        ) : '—'}
                      </td>
                      <td className="table-cell max-w-[180px]">
                        <span className="text-xs text-gray-500 truncate block">{tenant.notes ?? '—'}</span>
                      </td>
                      <td className="table-cell">
                        <div className="flex gap-2">
                          <button onClick={() => { setEditTenant(tenant); setShowTenantModal(true) }}
                            className="text-xs text-emerald-600 hover:underline font-medium">Editar</button>
                          <button onClick={() => { setSelectedTenant(tenant); setShowLeaseModal(true) }}
                            className="text-xs text-blue-600 hover:underline font-medium">Contrato</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-gray-400 text-sm">
                      Nenhum inquilino encontrado
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showTenantModal && (
        <TenantModal
          tenant={editTenant}
          onClose={() => setShowTenantModal(false)}
          onSaved={() => { setShowTenantModal(false); fetchTenants() }}
        />
      )}

      {showLeaseModal && selectedTenant && (
        <LeaseModal
          tenant={selectedTenant}
          onClose={() => setShowLeaseModal(false)}
          onSaved={() => { setShowLeaseModal(false); fetchTenants() }}
        />
      )}
    </AppLayout>
  )
}
