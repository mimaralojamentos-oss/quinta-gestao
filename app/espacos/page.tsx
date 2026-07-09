'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { Space, Lease } from '@/lib/types'
import { formatCurrency, spaceTypeLabel } from '@/lib/utils'
import { Plus, Search, Building2, Home, Warehouse, ShoppingBag, ChevronDown, X } from 'lucide-react'
import SpaceModal from './SpaceModal'
import { useAuth } from '@/lib/auth-context'

interface SpaceWithDetails extends Space {
  activeLeases?: Lease[]
  directTenant?: { id: string; name: string; phone: string | null } | null
}

export default function EspacosPage() {
  const { isAdmin, isCoAdmin } = useAuth()
  const [spaces, setSpaces] = useState<SpaceWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editSpace, setEditSpace] = useState<Space | null>(null)

  // Filtros por botões (multi-select)
  const [activeStates, setActiveStates] = useState<string[]>(['arrendado', 'disponivel'])
  const [activeTypes, setActiveTypes] = useState<string[]>(['pavilhao', 'habitacao', 'loja'])

  // Filtros avançados
  const [filterRentMin, setFilterRentMin] = useState('')
  const [filterRentMax, setFilterRentMax] = useState('')

  // Multi-select inquilinos
  const [filterTenants, setFilterTenants] = useState<string[]>([])
  const [showTenantDropdown, setShowTenantDropdown] = useState(false)
  const tenantDropdownRef = useRef<HTMLDivElement>(null)

  // Multi-select refs
  const [filterRefs, setFilterRefs] = useState<string[]>([])
  const [showRefDropdown, setShowRefDropdown] = useState(false)
  const refDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (tenantDropdownRef.current && !tenantDropdownRef.current.contains(e.target as Node)) setShowTenantDropdown(false)
      if (refDropdownRef.current && !refDropdownRef.current.contains(e.target as Node)) setShowRefDropdown(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => { fetchSpaces() }, [])

  async function fetchSpaces() {
    setLoading(true)
    const { data: spacesData } = await supabase.from('spaces').select('*').order('ref')
    const { data: leasesData } = await supabase.from('leases').select('*, tenant:tenants(*)').eq('status', 'ativo')
    const spacesWithDetails = (spacesData ?? []).map(s => ({
      ...s,
      activeLeases: (leasesData ?? []).filter(l => l.space_id === s.id)
    }))
    setSpaces(spacesWithDetails)
    setLoading(false)
  }

  function toggleState(state: string) {
    setActiveStates(prev => prev.includes(state)
      ? prev.length > 1 ? prev.filter(s => s !== state) : prev // manter pelo menos 1
      : [...prev, state])
  }

  function toggleType(type: string) {
    setActiveTypes(prev => prev.includes(type)
      ? prev.length > 1 ? prev.filter(t => t !== type) : prev
      : [...prev, type])
  }

  function toggleTenant(name: string) {
    setFilterTenants(prev => prev.includes(name) ? prev.filter(t => t !== name) : [...prev, name])
  }

  function toggleRef(ref: string) {
    setFilterRefs(prev => prev.includes(ref) ? prev.filter(r => r !== ref) : [...prev, ref])
  }

  function resetFilters() {
    setActiveStates(['arrendado', 'disponivel'])
    setActiveTypes(['pavilhao', 'habitacao', 'loja'])
    setFilterRentMin(''); setFilterRentMax('')
    setFilterTenants([]); setFilterRefs([])
  }

  // Listas para dropdowns
  const allTenants = [...new Set(spaces.map(s => {
    const lease = s.activeLeases?.[0]
    const t = s.directTenant ?? (lease as any)?.tenant
    return t?.name
  }).filter(Boolean))].sort() as string[]

  const allRefs = spaces.map(s => s.ref).sort()

  const hasFilters = filterRentMin || filterRentMax || filterTenants.length > 0 || filterRefs.length > 0

  const filtered = spaces.filter(s => {
    const lease = s.activeLeases?.[0]
    const tenant = s.directTenant ?? (lease as any)?.tenant
    const tenantName = tenant?.name ?? ''
    const rent = lease?.monthly_rent ?? 0

    if (!activeStates.includes(s.status)) return false
    if (!activeTypes.includes(s.type)) return false
    if (filterRentMin && rent < parseFloat(filterRentMin)) return false
    if (filterRentMax && rent > parseFloat(filterRentMax)) return false
    if (filterTenants.length > 0 && !filterTenants.includes(tenantName)) return false
    if (filterRefs.length > 0 && !filterRefs.includes(s.ref)) return false
    return true
  })

  const TypeIcon = ({ type }: { type: string }) => {
    if (type === 'habitacao') return <Home className="w-4 h-4" />
    if (type === 'pavilhao') return <Warehouse className="w-4 h-4" />
    if (type === 'loja') return <ShoppingBag className="w-4 h-4" />
    return <Building2 className="w-4 h-4" />
  }

  // Contadores
  const countArrendado = spaces.filter(s => s.status === 'arrendado').length
  const countDisponivel = spaces.filter(s => s.status === 'disponivel').length
  const countPavilhao = spaces.filter(s => s.type === 'pavilhao').length
  const countHabitacao = spaces.filter(s => s.type === 'habitacao').length
  const countLoja = spaces.filter(s => s.type === 'loja').length

  const btnBase = "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all cursor-pointer select-none"
  const btnActive = (color: string) => `${btnBase} ${color}`
  const btnInactive = `${btnBase} bg-white text-gray-400 border-gray-200 opacity-50`

  return (
    <AppLayout>
      <div className="p-4 md:p-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Espaços</h1>
            <p className="text-sm text-gray-500 mt-1">{spaces.length} espaços registados</p>
          </div>
          {(isAdmin || isCoAdmin) && (
            <button className="btn-primary" onClick={() => { setEditSpace(null); setShowModal(true) }}>
              <Plus className="w-4 h-4" /> Novo Espaço
            </button>
          )}
        </div>

        {/* Botões de filtro rápido */}
        <div className="flex gap-2 mb-4 flex-wrap items-center">
          {/* Estados */}
          <button onClick={() => toggleState('arrendado')}
            className={activeStates.includes('arrendado') ? btnActive('bg-emerald-100 text-emerald-700 border-emerald-300') : btnInactive}>
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            {countArrendado} arrendados
          </button>
          <button onClick={() => toggleState('disponivel')}
            className={activeStates.includes('disponivel') ? btnActive('bg-gray-100 text-gray-600 border-gray-300') : btnInactive}>
            <span className="w-2 h-2 rounded-full bg-gray-400 inline-block" />
            {countDisponivel} disponíveis
          </button>

          <span className="text-gray-200 text-lg">|</span>

          {/* Tipos */}
          <button onClick={() => toggleType('pavilhao')}
            className={activeTypes.includes('pavilhao') ? btnActive('bg-blue-100 text-blue-700 border-blue-300') : btnInactive}>
            <Warehouse className="w-3.5 h-3.5" />
            {countPavilhao} pavilhões
          </button>
          <button onClick={() => toggleType('habitacao')}
            className={activeTypes.includes('habitacao') ? btnActive('bg-purple-100 text-purple-700 border-purple-300') : btnInactive}>
            <Home className="w-3.5 h-3.5" />
            {countHabitacao} habitações
          </button>
          <button onClick={() => toggleType('loja')}
            className={activeTypes.includes('loja') ? btnActive('bg-orange-100 text-orange-700 border-orange-300') : btnInactive}>
            <ShoppingBag className="w-3.5 h-3.5" />
            {countLoja} lojas
          </button>

          {hasFilters && (
            <button onClick={resetFilters} className="flex items-center gap-1 text-xs text-red-500 hover:underline ml-2">
              <X className="w-3 h-3" /> Limpar filtros
            </button>
          )}
        </div>

        {/* Filtros avançados */}
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-3 mb-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">

            {/* Renda min/max */}
            <div>
              <label className="text-xs text-gray-500 block mb-1">Renda mín. (€)</label>
              <input type="number" step="0.01" min="0" className="input text-sm w-full" placeholder="ex: 100"
                value={filterRentMin} onChange={e => setFilterRentMin(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Renda máx. (€)</label>
              <input type="number" step="0.01" min="0" className="input text-sm w-full" placeholder="ex: 1000"
                value={filterRentMax} onChange={e => setFilterRentMax(e.target.value)} />
            </div>

            {/* Inquilino multi-select */}
            <div className="relative" ref={tenantDropdownRef}>
              <label className="text-xs text-gray-500 block mb-1">Inquilino</label>
              <button onClick={() => setShowTenantDropdown(!showTenantDropdown)}
                className={`input w-full flex items-center justify-between text-left text-sm ${filterTenants.length > 0 ? 'border-emerald-400 text-emerald-700' : 'text-gray-600'}`}>
                <span className="truncate">
                  {filterTenants.length === 0 ? 'Todos os inquilinos' : filterTenants.length === 1 ? filterTenants[0] : `${filterTenants.length} selecionados`}
                </span>
                <ChevronDown className="w-4 h-4 flex-shrink-0 ml-2" />
              </button>
              {showTenantDropdown && (
                <div className="absolute z-20 top-full mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
                  <div className="p-2 border-b border-gray-100">
                    <button onClick={() => setFilterTenants([])} className="text-xs text-gray-500 hover:text-emerald-600 hover:underline">Limpar seleção</button>
                  </div>
                  <div className="p-2 space-y-0.5">
                    {allTenants.map(name => (
                      <label key={name} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer">
                        <input type="checkbox" checked={filterTenants.includes(name)} onChange={() => toggleTenant(name)} className="accent-emerald-600 w-3.5 h-3.5 flex-shrink-0" />
                        <span className="text-sm text-gray-700 truncate">{name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Ref multi-select */}
            <div className="relative" ref={refDropdownRef}>
              <label className="text-xs text-gray-500 block mb-1">Referência</label>
              <button onClick={() => setShowRefDropdown(!showRefDropdown)}
                className={`input w-full flex items-center justify-between text-left text-sm ${filterRefs.length > 0 ? 'border-emerald-400 text-emerald-700' : 'text-gray-600'}`}>
                <span className="truncate">
                  {filterRefs.length === 0 ? 'Todas as refs.' : filterRefs.length === 1 ? filterRefs[0] : `${filterRefs.length} selecionadas`}
                </span>
                <ChevronDown className="w-4 h-4 flex-shrink-0 ml-2" />
              </button>
              {showRefDropdown && (
                <div className="absolute z-20 top-full mt-1 w-56 bg-white border border-gray-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
                  <div className="p-2 border-b border-gray-100">
                    <button onClick={() => setFilterRefs([])} className="text-xs text-gray-500 hover:text-emerald-600 hover:underline">Limpar seleção</button>
                  </div>
                  <div className="p-1">
                    {[...allRefs].sort((a, b) => a.localeCompare(b, 'pt', { numeric: true })).map(ref => (
                      <label key={ref} className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer">
                        <input type="checkbox" checked={filterRefs.includes(ref)} onChange={() => toggleRef(ref)} className="accent-emerald-600 w-3.5 h-3.5 flex-shrink-0" />
                        <span className="text-sm text-gray-700">{ref}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {hasFilters && (
            <p className="text-xs text-gray-500 mt-2">{filtered.length} resultado(s) de {spaces.length}</p>
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
                  <th className="table-header">Ref.</th>
                  <th className="table-header">Tipo</th>
                  <th className="table-header">Estado</th>
                  <th className="table-header">Inquilino</th>
                  <th className="table-header">Renda Mensal</th>
                  <th className="table-header">Condição</th>
                  <th className="table-header">Notas</th>
                  {(isAdmin || isCoAdmin) && <th className="table-header"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(space => {
                  const lease = space.activeLeases?.[0]
                  const leaseTenant = (lease as any)?.tenant
                  const tenant = space.directTenant ?? leaseTenant
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
                      {(isAdmin || isCoAdmin) && (
                        <td className="table-cell">
                          <button onClick={() => { setEditSpace(space); setShowModal(true) }}
                            className="text-xs text-emerald-600 hover:underline font-medium">
                            Editar
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={(isAdmin || isCoAdmin) ? 8 : 7} className="py-12 text-center text-gray-400 text-sm">
                      Nenhum espaço encontrado
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (isAdmin || isCoAdmin) && (
        <SpaceModal space={editSpace} onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); fetchSpaces() }} />
      )}
    </AppLayout>
  )
}

// https://quinta-gestao.vercel.app/espacos
