'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Space, Lease } from '@/lib/types'
import { formatCurrency, spaceTypeLabel } from '@/lib/utils'
import { Plus, Search, Building2, Home, Warehouse } from 'lucide-react'
import SpaceModal from './SpaceModal'

interface SpaceWithLease extends Space {
  activeLeases?: Lease[]
}

export default function EspacosPage() {
  const [spaces, setSpaces] = useState<SpaceWithLease[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'arrendado' | 'disponivel'>('all')
  const [filterType, setFilterType] = useState<'all' | 'pavilhao' | 'habitacao' | 'casa'>('all')
  const [showModal, setShowModal] = useState(false)
  const [editSpace, setEditSpace] = useState<Space | null>(null)

  useEffect(() => { fetchSpaces() }, [])

  async function fetchSpaces() {
    setLoading(true)
    const { data: spacesData } = await supabase
      .from('spaces')
      .select('*')
      .order('ref')

    const { data: leasesData } = await supabase
      .from('leases')
      .select('*, tenant:tenants(*)')
      .eq('status', 'ativo')

    const spacesWithLeases = (spacesData ?? []).map(s => ({
      ...s,
      activeLeases: (leasesData ?? []).filter(l => l.space_id === s.id)
    }))

    setSpaces(spacesWithLeases)
    setLoading(false)
  }

  const filtered = spaces.filter(s => {
    const matchSearch = s.ref.toLowerCase().includes(search.toLowerCase()) ||
      s.activeLeases?.some(l => (l as any).tenant?.name?.toLowerCase().includes(search.toLowerCase()))
    const matchStatus = filterStatus === 'all' || s.status === filterStatus
    const matchType = filterType === 'all' || s.type === filterType
    return matchSearch && matchStatus && matchType
  })

  const TypeIcon = ({ type }: { type: string }) => {
    if (type === 'habitacao') return <Home className="w-4 h-4" />
    if (type === 'pavilhao') return <Warehouse className="w-4 h-4" />
    return <Building2 className="w-4 h-4" />
  }

  return (
    <AppLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Espaços</h1>
            <p className="text-sm text-gray-500 mt-1">{spaces.length} espaços registados</p>
          </div>
          <button className="btn-primary" onClick={() => { setEditSpace(null); setShowModal(true) }}>
            <Plus className="w-4 h-4" />
            Novo Espaço
          </button>
        </div>

        <div className="flex gap-3 mb-6">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              className="input pl-9"
              placeholder="Pesquisar por ref ou inquilino..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select className="input w-40" value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)}>
            <option value="all">Todos os estados</option>
            <option value="arrendado">Arrendado</option>
            <option value="disponivel">Disponível</option>
          </select>
          <select className="input w-40" value={filterType} onChange={e => setFilterType(e.target.value as any)}>
            <option value="all">Todos os tipos</option>
            <option value="pavilhao">Pavilhões</option>
            <option value="habitacao">Habitações</option>
            <option value="casa">Casas</option>
          </select>
        </div>

        <div className="flex gap-3 mb-6">
          <span className="badge-verde">{spaces.filter(s => s.status === 'arrendado').length} arrendados</span>
          <span className="badge-cinza">{spaces.filter(s => s.status === 'disponivel').length} disponíveis</span>
          <span className="badge-cinza">{spaces.filter(s => s.type === 'pavilhao').length} pavilhões</span>
          <span className="badge-cinza">{spaces.filter(s => s.type === 'habitacao').length} habitações</span>
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
                  <th className="table-header">Ref.</th>
                  <th className="table-header">Tipo</th>
                  <th className="table-header">Estado</th>
                  <th className="table-header">Inquilino</th>
                  <th className="table-header">Renda Mensal</th>
                  <th className="table-header">Condição</th>
                  <th className="table-header">Notas</th>
                  <th className="table-header"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(space => {
                  const lease = space.activeLeases?.[0]
                  const tenant = (lease as any)?.tenant
                  return (
                    <tr key={space.id} className="hover:bg-gray-50 transition-colors">
                      <td className="table-cell">
                        <span className="font-semibold text-gray-900">{space.ref}</span>
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center gap-1.5 text-gray-600">
                          <TypeIcon type={space.type} />
                          <span>{spaceTypeLabel(space.type)}</span>
                        </div>
                      </td>
                      <td className="table-cell">
                        <span className={space.status === 'arrendado' ? 'badge-verde' : 'badge-cinza'}>
                          {space.status === 'arrendado' ? 'Arrendado' : 'Disponível'}
                        </span>
                      </td>
                      <td className="table-cell">
                        {tenant ? (
                          <div>
                            <p className="font-medium text-gray-800">{tenant.name}</p>
                            {tenant.phone && <p className="text-xs text-gray-500">{tenant.phone}</p>}
                          </div>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="table-cell font-medium">
                        {lease ? formatCurrency(lease.monthly_rent) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="table-cell">
                        {space.condition ? <span className="text-sm">{space.condition}</span> : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="table-cell max-w-[200px]">
                        {space.notes ? <span className="text-xs text-gray-500 truncate block">{space.notes}</span> : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="table-cell">
                        <button
                          onClick={() => { setEditSpace(space); setShowModal(true) }}
                          className="text-xs text-emerald-600 hover:underline font-medium"
                        >
                          Editar
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-gray-400 text-sm">
                      Nenhum espaço encontrado
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <SpaceModal
          space={editSpace}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); fetchSpaces() }}
        />
      )}
    </AppLayout>
  )
}
