'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase-client'
import { CashFundMovement } from '@/lib/types'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, TrendingUp, TrendingDown, Wallet, Trash2, Search, X, Calendar, ChevronUp, ChevronDown, ChevronsUpDown, ArrowRightLeft } from 'lucide-react'
import CashModal from './CashModal'
import TransferModal from './TransferModal'
import { useAuth } from '@/lib/auth-context'

type SourceFilter = 'all' | 'manual' | 'renda' | 'despesa' | 'documento' | 'transferencia_banco'
type SortField = 'movement_date' | 'description' | 'type' | 'source' | 'amount' | 'notes'
type SortDir = 'asc' | 'desc'

export default function CaixaPage() {
  const supabase = createClient()
  const { isAdmin, isCoAdmin } = useAuth()
  const [movements, setMovements] = useState<CashFundMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)

  // Saldo numa data específica
  const [saldoData, setSaldoData] = useState('')
  const [saldoNaData, setSaldoNaData] = useState<number | null>(null)

  // filtros
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [search, setSearch] = useState('')

  // ordenação
  const [sortField, setSortField] = useState<SortField>('movement_date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const today = new Date()
  const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr)

  useEffect(() => { fetchData() }, [])

  const cashStartDate = process.env.NEXT_PUBLIC_CASH_FUND_START_DATE ?? null

  async function fetchData() {
    setLoading(true)
    let query = supabase
      .from('cash_fund_movements')
      .select('*')
      .order('movement_date', { ascending: false })
    if (cashStartDate) query = query.gte('movement_date', cashStartDate)
    const { data } = await query
    setMovements(data ?? [])
    setLoading(false)
  }

  function calcularSaldoNaData(data: string) {
    if (!data) { setSaldoNaData(null); return }
    const saldo = movements
      .filter(m => m.movement_date <= data)
      .reduce((s, m) => s + m.amount, 0)
    setSaldoNaData(saldo)
  }

  async function handleDelete(id: string, source: string) {
    if (source !== 'manual') {
      alert('Este movimento foi gerado automaticamente e não pode ser apagado aqui. Apaga o pagamento/despesa original.')
      return
    }
    if (!confirm('Tens a certeza que queres apagar este movimento?')) return
    await supabase.from('cash_fund_movements').delete().eq('id', id)
    fetchData()
  }

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronsUpDown className="w-3 h-3 ml-1 text-gray-400 inline" />
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 ml-1 text-emerald-600 inline" />
      : <ChevronDown className="w-3 h-3 ml-1 text-emerald-600 inline" />
  }

  const monthOptions = useMemo(() => {
    const months = new Set(movements.map(m => m.movement_date?.slice(0, 7)).filter(Boolean))
    months.add(currentMonthStr)
    return Array.from(months)
      .sort((a, b) => b.localeCompare(a))
      .map(val => {
        const [y, m] = val.split('-').map(Number)
        const d = new Date(y, m - 1, 1)
        const label = d.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' })
        return { val, label: label.charAt(0).toUpperCase() + label.slice(1) }
      })
  }, [movements])

  const filtered = useMemo(() => {
    const list = movements.filter(m => {
      if (sourceFilter !== 'all' && (m as any).source !== sourceFilter) return false
      if (search && !m.description?.toLowerCase().includes(search.toLowerCase())) return false
      if (selectedMonth !== 'all' && m.movement_date?.slice(0, 7) !== selectedMonth) return false
      return true
    })

    return [...list].sort((a, b) => {
      let valA: any, valB: any
      if (sortField === 'movement_date') { valA = a.movement_date ?? ''; valB = b.movement_date ?? '' }
      else if (sortField === 'description') { valA = a.description ?? ''; valB = b.description ?? '' }
      else if (sortField === 'type') { valA = a.type ?? ''; valB = b.type ?? '' }
      else if (sortField === 'source') { valA = (a as any).source ?? ''; valB = (b as any).source ?? '' }
      else if (sortField === 'amount') { valA = a.amount; valB = b.amount }
      else if (sortField === 'notes') { valA = a.notes ?? ''; valB = b.notes ?? '' }
      if (valA < valB) return sortDir === 'asc' ? -1 : 1
      if (valA > valB) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [movements, sourceFilter, search, selectedMonth, sortField, sortDir])

  // Saldo total real (sempre sobre todos os movimentos)
  const balance = movements.reduce((s, m) => s + m.amount, 0)

  // Transferências já retiradas da caixa mas ainda não vistas no extrato
  const pendingTransfers = movements.filter(m => (m as any).transfer_status === 'pendente')

  // Entradas/Saídas do período selecionado
  const periodMovements = selectedMonth === 'all'
    ? movements
    : movements.filter(m => m.movement_date?.slice(0, 7) === selectedMonth)
  const entries = periodMovements.filter(m => m.amount > 0).reduce((s, m) => s + m.amount, 0)
  const exits = periodMovements.filter(m => m.amount < 0).reduce((s, m) => s + m.amount, 0)

  const sourceLabel = (source: string) => {
    if (source === 'renda') return '🏠 Renda'
    if (source === 'despesa') return '💸 Despesa'
    if (source === 'documento') return '📄 Documento'
    if (source === 'transferencia_banco') return '🏦 Transferência'
    return '✋ Manual'
  }

  const SOURCE_FILTERS = [
    { key: 'all', label: 'Todas' },
    { key: 'manual', label: '✋ Manual' },
    { key: 'renda', label: '🏠 Renda' },
    { key: 'despesa', label: '💸 Despesa' },
    { key: 'documento', label: '📄 Documento' },
    { key: 'transferencia_banco', label: '🏦 Transferência' },
  ]

  const thClass = 'px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-700 whitespace-nowrap'

  return (
    <AppLayout>
      <div className="p-4 md:p-8">

        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Fundo de Maneio</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Controlo de saldo em dinheiro
              {cashStartDate && <span className="ml-2 text-amber-600 font-medium">· desde {new Date(cashStartDate + 'T00:00:00').toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' })}</span>}
            </p>
          </div>
          {(isAdmin || isCoAdmin) && (
            <div className="flex items-center gap-2">
              <button className="btn-secondary" onClick={() => setShowTransfer(true)}>
                <ArrowRightLeft className="w-4 h-4" /> Transferir para o banco
              </button>
              <button className="btn-primary" onClick={() => setShowModal(true)}>
                <Plus className="w-4 h-4" /> Novo Movimento
              </button>
            </div>
          )}
        </div>

        {/* Transferências à espera de aparecer no extrato bancário */}
        {pendingTransfers.length > 0 && (
          <div className="mb-4 border border-amber-200 bg-amber-50 rounded-lg px-4 py-3">
            <p className="text-sm font-medium text-amber-800 flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4" />
              {pendingTransfers.length} transferência{pendingTransfers.length > 1 ? 's' : ''} a aguardar confirmação no banco
              <span className="font-bold">({formatCurrency(Math.abs(pendingTransfers.reduce((s, m) => s + m.amount, 0)))})</span>
            </p>
            <div className="mt-2 space-y-1">
              {pendingTransfers.map(m => (
                <p key={m.id} className="text-xs text-amber-700">
                  {formatDate(m.movement_date)} · {m.description} · {formatCurrency(Math.abs(m.amount))}
                </p>
              ))}
            </div>
            <p className="text-xs text-amber-600 mt-2">
              Confirmam-se sozinhas quando importares o extrato bancário com a entrada correspondente.
            </p>
          </div>
        )}

        {/* KPIs — compactos */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 flex items-center gap-2 border-l-4 border-l-emerald-500">
            <Wallet className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500">Saldo Atual</p>
              <p className={`text-base font-bold leading-tight ${balance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {formatCurrency(balance)}
              </p>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500">Entradas {selectedMonth !== 'all' ? '(mês)' : ''}</p>
              <p className="text-base font-bold leading-tight text-emerald-600">{formatCurrency(entries)}</p>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-red-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500">Saídas {selectedMonth !== 'all' ? '(mês)' : ''}</p>
              <p className="text-base font-bold leading-tight text-red-600">{formatCurrency(Math.abs(exits))}</p>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 flex items-center gap-2 border-l-4 border-l-blue-400">
            <Calendar className="w-4 h-4 text-blue-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-500 mb-0.5">Saldo numa data</p>
              <input
                type="date"
                className="input text-xs py-0.5 h-6 w-full mb-0.5"
                value={saldoData}
                onChange={e => { setSaldoData(e.target.value); calcularSaldoNaData(e.target.value) }}
              />
              {saldoNaData !== null && (
                <p className={`text-sm font-bold ${saldoNaData >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                  {formatCurrency(saldoNaData)}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* filtros */}
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 mb-4 space-y-2">
          {/* Linha 1: Período + Origem */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-500">Período:</span>
              <select
                style={{ width: '200px', minWidth: '200px', flexShrink: 0, border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.25rem 0.75rem', fontSize: '0.875rem', outline: 'none', height: '2rem', backgroundColor: 'white' }}
                value={selectedMonth}
                onChange={e => setSelectedMonth(e.target.value)}
              >
                <option value="all">📅 Todo o histórico</option>
                {monthOptions.map(o => (
                  <option key={o.val} value={o.val}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="w-px h-5 bg-gray-200" />
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-semibold text-gray-500">Origem:</span>
              {SOURCE_FILTERS.map(f => (
                <button key={f.key} onClick={() => setSourceFilter(f.key as SourceFilter)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${sourceFilter === f.key ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Linha 2: Pesquisa */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input type="text" placeholder="Pesquisar descrição..." value={search}
                onChange={e => setSearch(e.target.value)}
                className="input pl-8 pr-8 text-sm py-1 h-8 w-full" />
              {search && (
                <button onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {(sourceFilter !== 'all' || selectedMonth !== currentMonthStr || search) && (
              <button onClick={() => { setSourceFilter('all'); setSelectedMonth(currentMonthStr); setSearch('') }}
                className="text-xs text-red-500 hover:text-red-700 font-medium">
                Limpar filtros
              </button>
            )}
            <span className="text-xs text-gray-400 ml-auto">{filtered.length} movimento(s)</span>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className={thClass} style={{ width: '100px' }} onClick={() => handleSort('movement_date')}>
                    Data <SortIcon field="movement_date" />
                  </th>
                  <th className={thClass} onClick={() => handleSort('description')}>
                    Descrição <SortIcon field="description" />
                  </th>
                  <th className={thClass} style={{ width: '110px' }} onClick={() => handleSort('type')}>
                    Tipo <SortIcon field="type" />
                  </th>
                  <th className={thClass} style={{ width: '110px' }} onClick={() => handleSort('source')}>
                    Origem <SortIcon field="source" />
                  </th>
                  <th className={thClass} style={{ width: '100px' }} onClick={() => handleSort('amount')}>
                    Valor <SortIcon field="amount" />
                  </th>
                  <th className={thClass} style={{ width: '200px' }} onClick={() => handleSort('notes')}>
                    Notas <SortIcon field="notes" />
                  </th>
                  {(isAdmin || isCoAdmin) && <th className="px-3 py-2" style={{ width: '40px' }} />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-sm text-gray-600 whitespace-nowrap">{formatDate(m.movement_date)}</td>
                    <td className="px-3 py-2 font-medium text-gray-800">{m.description}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        m.type === 'entrada' ? 'bg-emerald-100 text-emerald-700' :
                        m.type === 'saida' ? 'bg-red-100 text-red-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {m.type === 'entrada' ? '↑ Entrada' : m.type === 'saida' ? '↓ Saída' : '↔ Transf.'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">{sourceLabel((m as any).source ?? 'manual')}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`font-semibold text-sm ${m.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {m.amount >= 0 ? '+' : ''}{formatCurrency(m.amount)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">{m.notes ?? '—'}</td>
                    {(isAdmin || isCoAdmin) && (
                      <td className="px-3 py-2">
                        <button onClick={() => handleDelete(m.id, (m as any).source ?? 'manual')}
                          className="text-gray-300 hover:text-red-500 transition-colors" title="Apagar">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={(isAdmin || isCoAdmin) ? 7 : 6} className="py-12 text-center text-gray-400 text-sm">Sem movimentos encontrados</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (isAdmin || isCoAdmin) && (
        <CashModal
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); fetchData() }}
        />
      )}

      {showTransfer && (isAdmin || isCoAdmin) && (
        <TransferModal
          currentBalance={balance}
          onClose={() => setShowTransfer(false)}
          onSaved={() => { setShowTransfer(false); fetchData() }}
        />
      )}
    </AppLayout>
  )
}
