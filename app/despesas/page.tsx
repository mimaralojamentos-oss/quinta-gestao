'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { Expense } from '@/lib/types'
import { formatCurrency, formatDate, categoryLabel } from '@/lib/utils'
import { Plus, Search, FileText, Trash2, X, SlidersHorizontal, ChevronUp, ChevronDown, ChevronsUpDown, Eye, ChevronDown as ChevronDownIcon } from 'lucide-react'
import ExpenseModal from './ExpenseModal'
import { useAuth } from '@/lib/auth-context'

interface DeleteConfirm {
  expense: any
  hasInvoice: boolean
}

type SortField = 'expense_date' | 'description' | 'category' | 'supplier' | 'amount'
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
    return { from: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`, to: fmt(today) }
  }
  if (period === 'ano') {
    return { from: `${today.getFullYear()}-01-01`, to: fmt(today) }
  }
  return null
}

export default function DespesasPage() {
  const { isAdmin } = useAuth()
  const [expenses, setExpenses] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [documents, setDocuments] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editExpense, setEditExpense] = useState<Expense | null>(null)
  const [summary, setSummary] = useState({ total: 0, cash: 0, bank: 0 })
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [sortField, setSortField] = useState<SortField>('expense_date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [togglingPayment, setTogglingPayment] = useState<string | null>(null)

  // Filtros
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterSuppliers, setFilterSuppliers] = useState<string[]>([])
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false)
  const supplierDropdownRef = useRef<HTMLDivElement>(null)
  const [filterProject, setFilterProject] = useState('all')
  const [filterPeriod, setFilterPeriod] = useState<'all' | 'hoje' | 'semana' | 'mes' | 'ano'>('all')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterAmountMin, setFilterAmountMin] = useState('')
  const [filterAmountMax, setFilterAmountMax] = useState('')

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (supplierDropdownRef.current && !supplierDropdownRef.current.contains(e.target as Node)) {
        setShowSupplierDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const { data: expensesData } = await supabase
      .from('expenses')
      .select('*, project:projects(id, name, type, location_label, space:spaces(ref))')
      .order('expense_date', { ascending: false })
    const { data: projectsData } = await supabase
      .from('projects')
      .select('id, name, type, location_label, space:spaces(ref)')
      .neq('status', 'concluido')
      .order('name')
    const { data: docsData } = await supabase
      .from('documents')
      .select('id, expense_id, file_path, original_name')
      .not('expense_id', 'is', null)

    const docsMap: Record<string, any> = {}
    for (const doc of docsData ?? []) {
      if (doc.expense_id) docsMap[doc.expense_id] = doc
    }

    setExpenses(expensesData ?? [])
    setProjects(projectsData ?? [])
    setDocuments(docsMap)
    const total = (expensesData ?? []).reduce((s, e) => s + e.amount, 0)
    const cash = (expensesData ?? []).filter(e => e.payment_method === 'dinheiro').reduce((s, e) => s + e.amount, 0)
    setSummary({ total, cash, bank: total - cash })
    setLoading(false)
  }

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronsUpDown className="w-3 h-3 ml-1 text-gray-400 inline" />
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3 ml-1 text-emerald-600 inline" /> : <ChevronDown className="w-3 h-3 ml-1 text-emerald-600 inline" />
  }

  async function handlePaymentMethodToggle(expense: any) {
    if (!isAdmin) return
    setTogglingPayment(expense.id)
    const newMethod = expense.payment_method === 'dinheiro' ? 'banco' : 'dinheiro'
    await supabase.from('expenses').update({ payment_method: newMethod }).eq('id', expense.id)
    const { data: existingCash } = await supabase.from('cash_fund_movements').select('id').eq('source_id', expense.id).single()
    if (newMethod === 'dinheiro') {
      if (existingCash) {
        await supabase.from('cash_fund_movements').update({ amount: -Math.abs(expense.amount), movement_date: expense.expense_date, description: `💸 ${expense.description}${expense.supplier ? ` — ${expense.supplier}` : ''}` }).eq('id', existingCash.id)
      } else {
        await supabase.from('cash_fund_movements').insert({ movement_date: expense.expense_date, description: `💸 ${expense.description}${expense.supplier ? ` — ${expense.supplier}` : ''}`, amount: -Math.abs(expense.amount), type: 'saida', source: 'despesa', source_id: expense.id })
      }
    } else {
      if (existingCash) await supabase.from('cash_fund_movements').delete().eq('id', existingCash.id)
    }
    setExpenses(prev => prev.map(e => e.id === expense.id ? { ...e, payment_method: newMethod } : e))
    setExpenses(prev => { const total = prev.reduce((s, e) => s + e.amount, 0); const cash = prev.filter(e => e.payment_method === 'dinheiro').reduce((s, e) => s + e.amount, 0); setSummary({ total, cash, bank: total - cash }); return prev })
    setTogglingPayment(null)
  }

  async function handleProjectChange(expenseId: string, projectId: string) {
    await supabase.from('expenses').update({ project_id: projectId || null }).eq('id', expenseId)
    setExpenses(prev => prev.map(e => {
      if (e.id !== expenseId) return e
      const project = projects.find(p => p.id === projectId) ?? null
      return { ...e, project_id: projectId || null, project }
    }))
  }

  async function viewDocument(expenseId: string) {
    const doc = documents[expenseId]
    if (!doc) return
    const { data } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  function handleDeleteClick(expense: any) {
    setDeleteConfirm({ expense, hasInvoice: !!documents[expense.id] })
  }

  async function handleDeleteConfirm(deleteInvoice: boolean) {
    if (!deleteConfirm) return
    setDeleting(true)
    const { expense } = deleteConfirm
    try {
      await supabase.from('cash_fund_movements').delete().eq('source_id', expense.id)
      if (deleteInvoice && documents[expense.id]) {
        const doc = documents[expense.id]
        await supabase.storage.from('documents').remove([doc.file_path])
        await supabase.from('documents').delete().eq('id', doc.id)
      }
      await supabase.from('expenses').delete().eq('id', expense.id)
    } catch (e: any) { console.error('Erro ao apagar:', e) }
    setDeleting(false); setDeleteConfirm(null); fetchAll()
  }

  function projectLabel(p: any) {
    if (!p) return '—'
    const typeEmoji: Record<string, string> = { construcao: '🏗️', renovacao: '🔨', arranjo: '🔧', outro: '📦' }
    const emoji = typeEmoji[p.type] ?? '📦'
    const loc = p.is_general ? 'Geral' : p.space?.ref ?? p.location_label ?? ''
    return `${emoji} ${p.name}${loc ? ` (${loc})` : ''}`
  }

  function toggleSupplier(s: string) {
    setFilterSuppliers(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  function resetFilters() {
    setSearch(''); setFilterCategory('all'); setFilterSuppliers([])
    setFilterProject('all'); setFilterPeriod('all')
    setFilterDateFrom(''); setFilterDateTo('')
    setFilterAmountMin(''); setFilterAmountMax('')
  }

  const hasActiveFilters = search || filterCategory !== 'all' || filterSuppliers.length > 0 ||
    filterProject !== 'all' || filterPeriod !== 'all' || filterDateFrom || filterDateTo || filterAmountMin || filterAmountMax

  const allSuppliers = [...new Set(expenses.map(e => e.supplier).filter(Boolean))].sort()

  const dateRange = filterPeriod !== 'all' ? getDateRange(filterPeriod) : null

  const filtered = expenses.filter(e => {
    const matchSearch = !search || e.description.toLowerCase().includes(search.toLowerCase())
    const matchCat = filterCategory === 'all' || e.category === filterCategory
    const matchSupplier = filterSuppliers.length === 0 || filterSuppliers.includes(e.supplier)
    const matchProject = filterProject === 'all' || (filterProject === 'none' && !e.project_id) || e.project_id === filterProject
    const matchDateFrom = !filterDateFrom || e.expense_date >= filterDateFrom
    const matchDateTo = !filterDateTo || e.expense_date <= filterDateTo
    const matchPeriod = !dateRange || (e.expense_date >= dateRange.from && e.expense_date <= dateRange.to)
    const matchAmountMin = !filterAmountMin || e.amount >= parseFloat(filterAmountMin)
    const matchAmountMax = !filterAmountMax || e.amount <= parseFloat(filterAmountMax)
    return matchSearch && matchCat && matchSupplier && matchProject && matchDateFrom && matchDateTo && matchPeriod && matchAmountMin && matchAmountMax
  }).sort((a, b) => {
    let valA = a[sortField] ?? ''
    let valB = b[sortField] ?? ''
    if (sortField === 'amount') { valA = Number(valA); valB = Number(valB) }
    else { valA = String(valA).toLowerCase(); valB = String(valB).toLowerCase() }
    if (valA < valB) return sortDir === 'asc' ? -1 : 1
    if (valA > valB) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  // Totais dos itens visíveis
  const filteredTotal = filtered.reduce((s, e) => s + e.amount, 0)
  const filteredCash = filtered.filter(e => e.payment_method === 'dinheiro').reduce((s, e) => s + e.amount, 0)
  const filteredBank = filtered.filter(e => e.payment_method !== 'dinheiro').reduce((s, e) => s + e.amount, 0)
  const isFiltering = !!hasActiveFilters

  const categoryColors: Record<string, string> = {
    obras: 'bg-orange-100 text-orange-700',
    edp: 'bg-yellow-100 text-yellow-700',
    pessoal: 'bg-blue-100 text-blue-700',
    contabilidade: 'bg-purple-100 text-purple-700',
    manutencao: 'bg-cyan-100 text-cyan-700',
    outros: 'bg-gray-100 text-gray-700',
  }

  const semProjeto = expenses.filter(e => !e.project_id).length
  const thClass = "table-header cursor-pointer hover:bg-gray-100 select-none"

  return (
    <AppLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Despesas</h1>
            <p className="text-sm text-gray-500 mt-1">{expenses.length} registos</p>
          </div>
          {isAdmin && (
            <button className="btn-primary" onClick={() => { setEditExpense(null); setShowModal(true) }}>
              <Plus className="w-4 h-4" /> Nova Despesa
            </button>
          )}
        </div>

        {/* Cards de resumo */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="card">
            <p className="text-sm text-gray-500 mb-1">Total de Despesas</p>
            <p className="text-xl font-bold text-gray-900">{formatCurrency(summary.total)}</p>
          </div>
          <div className="card">
            <p className="text-sm text-gray-500 mb-1">Pago em Dinheiro</p>
            <p className="text-xl font-bold text-gray-700">{formatCurrency(summary.cash)}</p>
          </div>
          <div className="card">
            <p className="text-sm text-gray-500 mb-1">Pago via Banco</p>
            <p className="text-xl font-bold text-gray-700">{formatCurrency(summary.bank)}</p>
          </div>
        </div>

        {/* Cards de totais filtrados — só aparecem quando há filtros ativos */}
        {isFiltering && (
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
              <p className="text-xs text-emerald-600 font-medium mb-0.5">✦ Total visível ({filtered.length} registos)</p>
              <p className="text-lg font-bold text-emerald-700">{formatCurrency(filteredTotal)}</p>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
              <p className="text-xs text-emerald-600 font-medium mb-0.5">✦ Dinheiro (visível)</p>
              <p className="text-lg font-bold text-emerald-700">{formatCurrency(filteredCash)}</p>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
              <p className="text-xs text-emerald-600 font-medium mb-0.5">✦ Banco (visível)</p>
              <p className="text-lg font-bold text-emerald-700">{formatCurrency(filteredBank)}</p>
            </div>
          </div>
        )}

        {semProjeto > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 mb-4 flex items-center justify-between">
            <p className="text-sm text-yellow-700">⚠ <strong>{semProjeto}</strong> despesa(s) sem projeto associado</p>
            <button onClick={() => { setFilterProject('none'); setShowFilters(true) }}
              className="text-xs text-yellow-700 hover:underline font-medium">Ver só estas</button>
          </div>
        )}

        {/* Barra de filtros */}
        <div className="flex gap-2 mb-3 flex-wrap items-center">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9 w-full" placeholder="Pesquisar na descrição..." value={search}
              onChange={e => setSearch(e.target.value)} />
          </div>

          {/* Período fixo */}
          <select className="input w-36 text-sm" value={filterPeriod} onChange={e => setFilterPeriod(e.target.value as any)}>
            <option value="all">Qualquer data</option>
            <option value="hoje">📅 Hoje</option>
            <option value="semana">📅 Esta semana</option>
            <option value="mes">📅 Este mês</option>
            <option value="ano">📅 Este ano</option>
          </select>

          {/* Categoria */}
          <select className="input w-36 text-sm" value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
            <option value="all">Categoria</option>
            <option value="obras">Obras</option>
            <option value="edp">Eletricidade</option>
            <option value="pessoal">Pessoal</option>
            <option value="contabilidade">Contabilidade</option>
            <option value="manutencao">Manutenção</option>
            <option value="outros">Outros</option>
          </select>

          {/* Fornecedor — multi-select */}
          <div className="relative w-52" ref={supplierDropdownRef}>
            <button
              onClick={() => setShowSupplierDropdown(!showSupplierDropdown)}
              className={`input w-full flex items-center justify-between text-left text-sm ${filterSuppliers.length > 0 ? 'border-emerald-400 text-emerald-700' : 'text-gray-600'}`}>
              <span className="truncate">
                {filterSuppliers.length === 0 ? 'Todos os fornecedores' : filterSuppliers.length === 1 ? filterSuppliers[0] : `${filterSuppliers.length} fornecedores`}
              </span>
              <ChevronDownIcon className="w-4 h-4 flex-shrink-0 ml-2" />
            </button>
            {showSupplierDropdown && (
              <div className="absolute z-20 top-full mt-1 w-64 bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
                <div className="p-2 border-b border-gray-100">
                  <button onClick={() => setFilterSuppliers([])} className="text-xs text-gray-500 hover:text-emerald-600 hover:underline">
                    Limpar seleção
                  </button>
                </div>
                <div className="p-2 space-y-0.5">
                  {allSuppliers.map(s => (
                    <label key={s} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer">
                      <input type="checkbox" checked={filterSuppliers.includes(s)} onChange={() => toggleSupplier(s)}
                        className="accent-emerald-600 w-3.5 h-3.5 flex-shrink-0" />
                      <span className="text-sm text-gray-700 truncate">{s}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Projeto */}
          <select className="input w-44 text-sm" value={filterProject} onChange={e => setFilterProject(e.target.value)}>
            <option value="all">Todos projetos</option>
            <option value="none">⚠ Sem projeto</option>
            {projects.map(p => <option key={p.id} value={p.id}>{projectLabel(p)}</option>)}
          </select>

          <button onClick={() => setShowFilters(v => !v)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
              showFilters || filterDateFrom || filterDateTo || filterAmountMin || filterAmountMax
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}>
            <SlidersHorizontal className="w-4 h-4" />
            Mais
          </button>

          {hasActiveFilters && (
            <button onClick={resetFilters} className="flex items-center gap-1 px-3 py-2 rounded-lg border border-red-200 text-red-600 text-sm hover:bg-red-50 transition-colors">
              <X className="w-3.5 h-3.5" /> Limpar
            </button>
          )}
        </div>

        {showFilters && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-4 grid grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Data — de</label>
              <input type="date" className="input text-sm" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Data — até</label>
              <input type="date" className="input text-sm" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Valor mínimo (€)</label>
              <input type="number" step="0.01" min="0" className="input text-sm" placeholder="0.00"
                value={filterAmountMin} onChange={e => setFilterAmountMin(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Valor máximo (€)</label>
              <input type="number" step="0.01" min="0" className="input text-sm" placeholder="9999.00"
                value={filterAmountMax} onChange={e => setFilterAmountMax(e.target.value)} />
            </div>
          </div>
        )}

        {hasActiveFilters && (
          <p className="text-sm text-gray-500 mb-3">
            A mostrar <strong>{filtered.length}</strong> de {expenses.length} despesas
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
                  <th className={thClass} onClick={() => handleSort('expense_date')}>Data <SortIcon field="expense_date" /></th>
                  <th className={thClass} onClick={() => handleSort('description')}>Descrição <SortIcon field="description" /></th>
                  <th className={thClass} onClick={() => handleSort('category')}>Categoria <SortIcon field="category" /></th>
                  <th className={thClass} onClick={() => handleSort('supplier')}>Fornecedor <SortIcon field="supplier" /></th>
                  <th className={thClass} onClick={() => handleSort('amount')}>Valor <SortIcon field="amount" /></th>
                  <th className="table-header">Pagamento</th>
                  <th className="table-header">Projeto</th>
                  <th className="table-header">Fatura</th>
                  {isAdmin && <th className="table-header"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(expense => {
                  const hasDoc = !!documents[expense.id]
                  return (
                    <tr key={expense.id} className={`hover:bg-gray-50 ${!expense.project_id ? 'bg-yellow-50/30' : ''}`}>
                      <td className="table-cell text-sm">{formatDate(expense.expense_date)}</td>
                      <td className="table-cell">
                        <p className="font-medium text-gray-800">{expense.description}</p>
                        {expense.notes && <p className="text-xs text-gray-500">{expense.notes}</p>}
                      </td>
                      <td className="table-cell">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${categoryColors[expense.category] ?? 'bg-gray-100 text-gray-700'}`}>
                          {categoryLabel(expense.category)}
                        </span>
                      </td>
                      <td className="table-cell text-sm">{expense.supplier ?? '—'}</td>
                      <td className="table-cell font-semibold text-red-600">{formatCurrency(expense.amount)}</td>
                      <td className="table-cell">
                        {isAdmin ? (
                          <button onClick={() => handlePaymentMethodToggle(expense)} disabled={togglingPayment === expense.id}
                            title={expense.payment_method === 'dinheiro' ? 'Clica para mudar para Banco' : 'Clica para mudar para Dinheiro'}
                            className={`text-xs px-2 py-1 rounded-full font-medium transition-all hover:opacity-70 cursor-pointer ${expense.payment_method === 'dinheiro' ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'} ${togglingPayment === expense.id ? 'opacity-50' : ''}`}>
                            {togglingPayment === expense.id ? '...' : expense.payment_method === 'dinheiro' ? '💵 Dinheiro' : '🏦 Banco'}
                          </button>
                        ) : (
                          <span className={`text-xs px-2 py-1 rounded-full ${expense.payment_method === 'dinheiro' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                            {expense.payment_method === 'dinheiro' ? '💵' : '🏦'}
                          </span>
                        )}
                      </td>
                      <td className="table-cell">
                        {isAdmin ? (
                          <select value={expense.project_id ?? ''} onChange={e => handleProjectChange(expense.id, e.target.value)}
                            className={`text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500 max-w-[180px] ${expense.project_id ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-yellow-200 bg-yellow-50 text-yellow-700'}`}>
                            <option value="">— Sem projeto —</option>
                            {projects.map(p => <option key={p.id} value={p.id}>{projectLabel(p)}</option>)}
                          </select>
                        ) : (
                          <span className="text-xs text-gray-600">{expense.project ? projectLabel(expense.project) : '—'}</span>
                        )}
                      </td>
                      <td className="table-cell">
                        {hasDoc ? (
                          <button onClick={() => viewDocument(expense.id)} className="flex items-center gap-1 text-xs text-emerald-600 hover:underline font-medium">
                            <Eye className="w-3.5 h-3.5" /> Ver
                          </button>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      {isAdmin && (
                        <td className="table-cell">
                          <div className="flex items-center gap-2">
                            <button onClick={() => { setEditExpense(expense); setShowModal(true) }}
                              className="text-xs text-emerald-600 hover:underline font-medium">Editar</button>
                            <button onClick={() => handleDeleteClick(expense)} className="text-gray-300 hover:text-red-500 transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={isAdmin ? 9 : 8} className="py-12 text-center text-gray-400 text-sm">
                    {hasActiveFilters ? 'Nenhuma despesa encontrada com estes filtros' : 'Nenhuma despesa encontrada'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg text-gray-900">Apagar Despesa</h2>
              <button onClick={() => setDeleteConfirm(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <p className="text-sm text-gray-600 mb-2">Tens a certeza que queres apagar a despesa:</p>
            <p className="font-medium text-gray-900 mb-1">{deleteConfirm.expense.description}</p>
            <p className="text-sm text-red-600 font-semibold mb-4">{formatCurrency(deleteConfirm.expense.amount)}</p>
            {deleteConfirm.hasInvoice ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-2">
                <p className="text-sm text-yellow-800 font-medium mb-3">📄 Esta despesa tem uma fatura associada. O que queres fazer?</p>
                <div className="flex flex-col gap-2">
                  <button onClick={() => handleDeleteConfirm(true)} disabled={deleting}
                    className="w-full py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                    {deleting ? 'A apagar...' : '🗑️ Apagar despesa e fatura'}
                  </button>
                  <button onClick={() => handleDeleteConfirm(false)} disabled={deleting}
                    className="w-full py-2.5 rounded-lg bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 disabled:opacity-50">
                    {deleting ? 'A apagar...' : '📄 Apagar só a despesa (manter fatura)'}
                  </button>
                  <button onClick={() => setDeleteConfirm(null)} className="w-full py-2.5 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50">Cancelar</button>
                </div>
              </div>
            ) : (
              <div className="flex justify-end gap-3">
                <button className="btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancelar</button>
                <button onClick={() => handleDeleteConfirm(false)} disabled={deleting}
                  className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                  {deleting ? 'A apagar...' : 'Apagar'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showModal && isAdmin && (
        <ExpenseModal expense={editExpense} onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); fetchAll() }} />
      )}
    </AppLayout>
  )
}

// https://quinta-gestao.vercel.app/despesas
