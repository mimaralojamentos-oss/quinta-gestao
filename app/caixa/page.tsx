'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase-client'
import { CashFundMovement } from '@/lib/types'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, TrendingUp, TrendingDown, Wallet, Trash2, Search, X, Calendar } from 'lucide-react'
import CashModal from './CashModal'
import { useAuth } from '@/lib/auth-context'

type PeriodFilter = 'all' | 'today' | 'week' | 'month' | 'year' | 'range'
type SourceFilter = 'all' | 'manual' | 'renda' | 'despesa'

export default function CaixaPage() {
  const supabase = createClient()
  const { isAdmin } = useAuth()
  const [movements, setMovements] = useState<CashFundMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)

  // Saldo numa data específica
  const [saldoData, setSaldoData] = useState('')
  const [saldoNaData, setSaldoNaData] = useState<number | null>(null)

  // filtros
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all')
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data } = await supabase
      .from('cash_fund_movements')
      .select('*')
      .order('movement_date', { ascending: false })
    setMovements(data ?? [])
    setLoading(false)
  }

  // Calcular saldo até uma data específica
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

  const filtered = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    return movements.filter(m => {
      if (sourceFilter !== 'all' && (m as any).source !== sourceFilter) return false
      if (search && !m.description?.toLowerCase().includes(search.toLowerCase())) return false

      const date = new Date(m.movement_date)
      date.setHours(0, 0, 0, 0)

      if (periodFilter === 'today') {
        if (date.getTime() !== today.getTime()) return false
      } else if (periodFilter === 'week') {
        const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7)
        if (date < weekAgo) return false
      } else if (periodFilter === 'month') {
        if (date.getMonth() !== today.getMonth() || date.getFullYear() !== today.getFullYear()) return false
      } else if (periodFilter === 'year') {
        if (date.getFullYear() !== today.getFullYear()) return false
      } else if (periodFilter === 'range') {
        if (rangeStart && date < new Date(rangeStart)) return false
        if (rangeEnd && date > new Date(rangeEnd)) return false
      }

      return true
    })
  }, [movements, sourceFilter, periodFilter, rangeStart, rangeEnd, search])

  const balance = movements.reduce((s, m) => s + m.amount, 0)
  const entries = movements.filter(m => m.amount > 0).reduce((s, m) => s + m.amount, 0)
  const exits = movements.filter(m => m.amount < 0).reduce((s, m) => s + m.amount, 0)

  const sourceLabel = (source: string) => {
    if (source === 'renda') return '🏠 Renda'
    if (source === 'despesa') return '💸 Despesa'
    return '✋ Manual'
  }

  const PERIOD_FILTERS = [
    { key: 'all', label: 'Todos' },
    { key: 'today', label: 'Hoje' },
    { key: 'week', label: 'Semana' },
    { key: 'month', label: 'Mês' },
    { key: 'year', label: 'Ano' },
    { key: 'range', label: 'Intervalo' },
  ]

  const SOURCE_FILTERS = [
    { key: 'all', label: 'Todas origens' },
    { key: 'manual', label: '✋ Manual' },
    { key: 'renda', label: '🏠 Renda' },
    { key: 'despesa', label: '💸 Despesa' },
  ]

  return (
    <AppLayout>
      <div className="p-8">

        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Fundo de Maneio</h1>
            <p className="text-sm text-gray-500 mt-0.5">Controlo de saldo em dinheiro</p>
          </div>
          {isAdmin && (
            <button className="btn-primary" onClick={() => setShowModal(true)}>
              <Plus className="w-4 h-4" /> Novo Movimento
            </button>
          )}
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-4 gap-4 mb-5">
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3 border-l-4 border-l-emerald-500">
            <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <Wallet className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500 font-medium">Saldo Atual</p>
              <p className={`text-xl font-bold ${balance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {formatCurrency(balance)}
              </p>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Total Entradas</p>
              <p className="text-xl font-bold text-emerald-600">{formatCurrency(entries)}</p>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 bg-red-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <TrendingDown className="w-4 h-4 text-red-500" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Total Saídas</p>
              <p className="text-xl font-bold text-red-600">{formatCurrency(Math.abs(exits))}</p>
            </div>
          </div>

          {/* Card saldo numa data */}
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3 border-l-4 border-l-blue-400">
            <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <Calendar className="w-4 h-4 text-blue-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-500 font-medium mb-1">Saldo numa data</p>
              <input
                type="date"
                className="input text-xs py-1 h-7 w-full mb-1"
                value={saldoData}
                onChange={e => {
                  setSaldoData(e.target.value)
                  calcularSaldoNaData(e.target.value)
                }}
              />
              {saldoNaData !== null && (
                <p className={`text-base font-bold ${saldoNaData >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                  {formatCurrency(saldoNaData)}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* filtros */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs font-semibold text-gray-500 w-16">Período:</span>
            {PERIOD_FILTERS.map(f => (
              <button key={f.key} onClick={() => setPeriodFilter(f.key as PeriodFilter)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${periodFilter === f.key ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {f.label}
              </button>
            ))}
            {periodFilter === 'range' && (
              <div className="flex items-center gap-2 ml-2">
                <input type="date" value={rangeStart} onChange={e => setRangeStart(e.target.value)}
                  className="input text-xs py-1.5 px-2 h-8" />
                <span className="text-xs text-gray-400">até</span>
                <input type="date" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)}
                  className="input text-xs py-1.5 px-2 h-8" />
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs font-semibold text-gray-500 w-16">Origem:</span>
            {SOURCE_FILTERS.map(f => (
              <button key={f.key} onClick={() => setSourceFilter(f.key as SourceFilter)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${sourceFilter === f.key ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 w-16">Pesquisa:</span>
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input type="text" placeholder="Pesquisar descrição..." value={search}
                onChange={e => setSearch(e.target.value)}
                className="input pl-8 pr-8 text-sm py-1.5 h-8 w-full" />
              {search && (
                <button onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {(sourceFilter !== 'all' || periodFilter !== 'all' || search) && (
              <button onClick={() => { setSourceFilter('all'); setPeriodFilter('all'); setSearch(''); setRangeStart(''); setRangeEnd('') }}
                className="text-xs text-red-500 hover:text-red-700 font-medium ml-2">
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
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="table-header">Data</th>
                  <th className="table-header">Descrição</th>
                  <th className="table-header">Tipo</th>
                  <th className="table-header">Origem</th>
                  <th className="table-header">Valor</th>
                  <th className="table-header">Notas</th>
                  {isAdmin && <th className="table-header"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="table-cell text-sm">{formatDate(m.movement_date)}</td>
                    <td className="table-cell font-medium text-gray-800">{m.description}</td>
                    <td className="table-cell">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                        m.type === 'entrada' ? 'bg-emerald-100 text-emerald-700' :
                        m.type === 'saida' ? 'bg-red-100 text-red-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {m.type === 'entrada' ? '↑ Entrada' : m.type === 'saida' ? '↓ Saída' : '↔ Transferência'}
                      </span>
                    </td>
                    <td className="table-cell">
                      <span className="text-xs text-gray-500">
                        {sourceLabel((m as any).source ?? 'manual')}
                      </span>
                    </td>
                    <td className="table-cell">
                      <span className={`font-semibold text-sm ${m.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {m.amount >= 0 ? '+' : ''}{formatCurrency(m.amount)}
                      </span>
                    </td>
                    <td className="table-cell text-xs text-gray-500">{m.notes ?? '—'}</td>
                    {isAdmin && (
                      <td className="table-cell">
                        <button onClick={() => handleDelete(m.id, (m as any).source ?? 'manual')}
                          className="text-gray-300 hover:text-red-500 transition-colors" title="Apagar">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={isAdmin ? 7 : 6} className="py-12 text-center text-gray-400 text-sm">Sem movimentos encontrados</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && isAdmin && (
        <CashModal
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); fetchData() }}
        />
      )}
    </AppLayout>
  )
}
