'use client'

import AppLayout from '@/components/layout/AppLayout'
import { Suspense, useEffect, useState, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Expense } from '@/lib/types'
import { formatCurrency, formatDate, categoryLabel, matchesSearch, openStorageDocument, deleteExpenseSafely, getMonthLabel } from '@/lib/utils'
import { Plus, Search, Trash2, X, SlidersHorizontal, Eye, ChevronDown as ChevronDownIcon, Copy, CopyPlus } from 'lucide-react'
import ExpenseModal from './ExpenseModal'
import CopiarDespesasModal from './CopiarDespesasModal'
import { useAuth } from '@/lib/auth-context'
import { logAccess } from '@/lib/logAccess'
import SortIcon from '@/components/SortIcon'
import { useSort } from '@/lib/useSort'

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
  if (period === 'semana') { const from = new Date(today); from.setDate(today.getDate() - 7); return { from: fmt(from), to: fmt(today) } }
  if (period === 'mes') return { from: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`, to: fmt(today) }
  if (period === 'ano') return { from: `${today.getFullYear()}-01-01`, to: fmt(today) }
  return null
}

export default function DespesasPage() {
  return (
    <Suspense fallback={<DespesasFallback />}>
      <DespesasContent />
    </Suspense>
  )
}

function DespesasFallback() {
  return (
    <AppLayout>
      <div className="p-8 flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
      </div>
    </AppLayout>
  )
}

function DespesasContent() {
  const { isAdmin, isCoAdmin } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [expenses, setExpenses] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [documents, setDocuments] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editExpense, setEditExpense] = useState<Expense | null>(null)
  // Despesa a duplicar para o mês seguinte (abre o ExpenseModal pré-preenchido)
  const [duplicateExpense, setDuplicateExpense] = useState<Expense | null>(null)
  const [showCopiarModal, setShowCopiarModal] = useState(false)
  const [summary, setSummary] = useState({ total: 0, cash: 0, bank: 0 })
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showMoreFilters, setShowMoreFilters] = useState(false)
  const { sortField, sortDir, handleSort } = useSort<SortField>('expense_date', 'desc')
  const [togglingPayment, setTogglingPayment] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterSuppliers, setFilterSuppliers] = useState<string[]>([])
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false)
  const supplierDropdownRef = useRef<HTMLDivElement>(null)
  const [filterProject, setFilterProject] = useState('all')
  const [filterPayment, setFilterPayment] = useState<'all' | 'dinheiro' | 'banco'>('all')
  const [filterPeriod, setFilterPeriod] = useState<'all' | 'hoje' | 'semana' | 'mes' | 'ano'>('all')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterAmountMin, setFilterAmountMin] = useState('')
  const [filterAmountMax, setFilterAmountMax] = useState('')
  const [filterExpenseId, setFilterExpenseId] = useState<string | null>(() => searchParams.get('expense_id'))

  const today = new Date()
  const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const [selectedPeriod, setSelectedPeriod] = useState<string>(() =>
    searchParams.get('expense_id') ? 'all' : currentMonthStr
  )

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (supplierDropdownRef.current && !supplierDropdownRef.current.contains(e.target as Node)) setShowSupplierDropdown(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => { fetchAll() }, [])

  useEffect(() => {
    if (!filterExpenseId || loading) return
    setTimeout(() => {
      const el = document.getElementById(`expense-${filterExpenseId}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 300)
  }, [filterExpenseId, loading])

  async function fetchAll() {
    setLoading(true)
    // Fetch expenses sem join FK (evita falha quando FK não existe no Supabase)
    const { data: expensesRaw } = await supabase.from('expenses').select('*').order('expense_date', { ascending: false })
    const { data: projectsRaw } = await supabase.from('projects').select('id, name, type, status, location_label, space:spaces(ref)').order('name')
    const { data: docsData } = await supabase.from('documents').select('id, expense_id, file_path, original_name').not('expense_id', 'is', null)
    // Mapear projetos aos expenses manualmente
    const projectsMap: Record<string, any> = {}
    for (const p of projectsRaw ?? []) { projectsMap[p.id] = p }
    const expensesData = (expensesRaw ?? []).map((e: any) => ({
      ...e,
      project: e.project_id ? (projectsMap[e.project_id] ?? null) : null,
    }))
    const projectsData = (projectsRaw ?? []).filter((p: any) => p.status !== 'concluido')
    const docsMap: Record<string, any> = {}
    for (const doc of docsData ?? []) { if (doc.expense_id) docsMap[doc.expense_id] = doc }
    setExpenses(expensesData)
    setProjects(projectsData)
    setDocuments(docsMap)
    const total = expensesData.reduce((s: number, e: any) => s + e.amount, 0)
    const cash = expensesData.filter((e: any) => e.payment_method === 'dinheiro').reduce((s: number, e: any) => s + e.amount, 0)
    setSummary({ total, cash, bank: total - cash })
    setLoading(false)
  }

  async function handlePaymentMethodToggle(expense: any) {
    if (!(isAdmin || isCoAdmin)) return
    setTogglingPayment(expense.id)
    const newMethod = expense.payment_method === 'dinheiro' ? 'banco' : 'dinheiro'
    await supabase.from('expenses').update({ payment_method: newMethod }).eq('id', expense.id)
    const { data: existingCash } = await supabase.from('cash_fund_movements').select('id').eq('source_id', expense.id).single()
    if (newMethod === 'dinheiro') {
      if (existingCash) { await supabase.from('cash_fund_movements').update({ amount: -Math.abs(expense.amount), movement_date: expense.expense_date, description: `💸 ${expense.description}${expense.supplier ? ` — ${expense.supplier}` : ''}` }).eq('id', existingCash.id) }
      else { await supabase.from('cash_fund_movements').insert({ movement_date: expense.expense_date, description: `💸 ${expense.description}${expense.supplier ? ` — ${expense.supplier}` : ''}`, amount: -Math.abs(expense.amount), type: 'saida', source: 'despesa', source_id: expense.id }) }
    } else { if (existingCash) await supabase.from('cash_fund_movements').delete().eq('id', existingCash.id) }
    await logAccess({ action: 'editar', page: '/despesas', details: `Alterou método de pagamento da despesa "${expense.description}" para ${newMethod === 'dinheiro' ? 'Dinheiro' : 'Banco'}` })
    setExpenses(prev => prev.map(e => e.id === expense.id ? { ...e, payment_method: newMethod } : e))
    setExpenses(prev => { const total = prev.reduce((s, e) => s + e.amount, 0); const cash = prev.filter(e => e.payment_method === 'dinheiro').reduce((s, e) => s + e.amount, 0); setSummary({ total, cash, bank: total - cash }); return prev })
    setTogglingPayment(null)
  }

  async function handleProjectChange(expenseId: string, projectId: string) {
    await supabase.from('expenses').update({ project_id: projectId || null }).eq('id', expenseId)
    const expense = expenses.find(e => e.id === expenseId)
    const project = projects.find(p => p.id === projectId)
    await logAccess({ action: 'editar', page: '/despesas', details: projectId ? `Associou despesa "${expense?.description}" ao projeto "${project?.name}"` : `Removeu projeto da despesa "${expense?.description}"` })
    setExpenses(prev => prev.map(e => { if (e.id !== expenseId) return e; const project = projects.find(p => p.id === projectId) ?? null; return { ...e, project_id: projectId || null, project } }))
  }

  async function viewDocument(expenseId: string) {
    const doc = documents[expenseId]; if (!doc) return
    await openStorageDocument(supabase, doc.file_path)
  }

  function handleDeleteClick(expense: any) { setDeleteConfirm({ expense, hasInvoice: !!documents[expense.id] }) }

  async function handleDeleteConfirm(deleteInvoice: boolean) {
    if (!deleteConfirm) return
    setDeleting(true)
    const { expense } = deleteConfirm
    try {
      if (deleteInvoice && documents[expense.id]) { const doc = documents[expense.id]; await supabase.storage.from('documents').remove([doc.file_path]); await supabase.from('documents').delete().eq('id', doc.id) }
      const erro = await deleteExpenseSafely(supabase, expense.id)
      if (erro) throw new Error(erro)
      await logAccess({ action: 'apagar', page: '/despesas', details: `Apagou despesa "${expense.description}" (${formatCurrency(expense.amount)})` })
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

  function toggleSupplier(s: string) { setFilterSuppliers(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]) }

  function clearExpenseFilter() {
    setFilterExpenseId(null)
    router.replace('/despesas')
  }

  function resetFilters() {
    setSearch(''); setFilterCategory('all'); setFilterSuppliers([])
    setFilterProject('all'); setFilterPeriod('all'); setFilterPayment('all')
    setFilterDateFrom(''); setFilterDateTo('')
    setFilterAmountMin(''); setFilterAmountMax('')
    clearExpenseFilter()
    setSelectedPeriod(currentMonthStr)
  }

  const hasActiveFilters = search || filterCategory !== 'all' || filterSuppliers.length > 0 ||
    filterProject !== 'all' || filterPeriod !== 'all' || filterPayment !== 'all' ||
    filterDateFrom || filterDateTo || filterAmountMin || filterAmountMax || filterExpenseId

  const allSuppliers = [...new Set(expenses.map(e => e.supplier).filter(Boolean))].sort()
  const dateRange = filterPeriod !== 'all' ? getDateRange(filterPeriod) : null

  const filtered = expenses.filter(e => {
    const matchSearch = !search || matchesSearch(e.description, search) || (e.supplier && matchesSearch(e.supplier, search))
    const matchCat = filterCategory === 'all' || e.category === filterCategory
    const matchSupplier = filterSuppliers.length === 0 || filterSuppliers.includes(e.supplier)
    const matchProject = filterProject === 'all' || (filterProject === 'none' && !e.project_id) || e.project_id === filterProject
    // 'banco' apanha tudo o que não é dinheiro, incluindo registos antigos
    // sem método definido — senão desapareciam dos dois filtros.
    const matchPayment = filterPayment === 'all'
      || (filterPayment === 'dinheiro' ? e.payment_method === 'dinheiro' : e.payment_method !== 'dinheiro')
    const matchDateFrom = !filterDateFrom || e.expense_date >= filterDateFrom
    const matchDateTo = !filterDateTo || e.expense_date <= filterDateTo
    const matchPeriod = !dateRange || (e.expense_date >= dateRange.from && e.expense_date <= dateRange.to)
    const matchAmountMin = !filterAmountMin || e.amount >= parseFloat(filterAmountMin)
    const matchAmountMax = !filterAmountMax || e.amount <= parseFloat(filterAmountMax)
    const matchExpenseId = !filterExpenseId || e.id === filterExpenseId
    const matchSelectedPeriod = selectedPeriod === 'all' || e.expense_date?.slice(0, 7) === selectedPeriod
    return matchSearch && matchCat && matchSupplier && matchProject && matchPayment && matchDateFrom && matchDateTo && matchPeriod && matchAmountMin && matchAmountMax && matchExpenseId && matchSelectedPeriod
  }).sort((a, b) => {
    let valA = a[sortField] ?? '', valB = b[sortField] ?? ''
    if (sortField === 'amount') { valA = Number(valA); valB = Number(valB) }
    else { valA = String(valA).toLowerCase(); valB = String(valB).toLowerCase() }
    if (valA < valB) return sortDir === 'asc' ? -1 : 1
    if (valA > valB) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  const filteredTotal = filtered.reduce((s, e) => s + e.amount, 0)
  const filteredCash = filtered.filter(e => e.payment_method === 'dinheiro').reduce((s, e) => s + e.amount, 0)
  const filteredBank = filtered.filter(e => e.payment_method !== 'dinheiro').reduce((s, e) => s + e.amount, 0)

  const categoryColors: Record<string, string> = {
    obras: 'bg-orange-100 text-orange-700', edp: 'bg-yellow-100 text-yellow-700',
    pessoal: 'bg-blue-100 text-blue-700', contabilidade: 'bg-purple-100 text-purple-700',
    manutencao: 'bg-cyan-100 text-cyan-700', outros: 'bg-gray-100 text-gray-700',
  }

  const monthOptions = (() => {
    const opts: { val: string; label: string }[] = []
    const d = new Date()
    for (let i = 0; i < 24; i++) {
      const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      opts.push({ val, label: getMonthLabel(val) })
      d.setMonth(d.getMonth() - 1)
    }
    return opts
  })()

  const periodExpenses = selectedPeriod === 'all'
    ? expenses
    : expenses.filter(e => e.expense_date?.slice(0, 7) === selectedPeriod)

  const periodTotal = periodExpenses.reduce((s, e) => s + e.amount, 0)
  const periodCash = periodExpenses.filter(e => e.payment_method === 'dinheiro').reduce((s, e) => s + e.amount, 0)
  const periodBank = periodExpenses.filter(e => e.payment_method !== 'dinheiro').reduce((s, e) => s + e.amount, 0)

  const semProjeto = expenses.filter(e => !e.project_id).length
  const expenseFilterMatch = filterExpenseId ? expenses.find(e => e.id === filterExpenseId) : null
  const thClass = "table-header cursor-pointer hover:bg-gray-100 select-none"

  return (
    <AppLayout>
      <div className="p-4 md:p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Despesas</h1>
          </div>
          {(isAdmin || isCoAdmin) && (
            <div className="flex items-center gap-2">
              <button className="btn-secondary" onClick={() => setShowCopiarModal(true)}>
                <Copy className="w-4 h-4" /> Copiar de outro mês
              </button>
              <button className="btn-primary" onClick={() => { setEditExpense(null); setDuplicateExpense(null); setShowModal(true) }}>
                <Plus className="w-4 h-4" /> Nova Despesa
              </button>
            </div>
          )}
        </div>

        {filterExpenseId && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 mb-3 flex items-center justify-between">
            <p className="text-sm text-blue-700">
              🔎 A mostrar despesa vinda de Documentos{expenseFilterMatch ? `: ${expenseFilterMatch.description}` : ''}
            </p>
            <button onClick={clearExpenseFilter} className="text-xs text-blue-700 hover:underline font-medium">Ver todas as despesas</button>
          </div>
        )}

        {/* Seletor de período */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 font-medium">Período:</span>
            <select
              className="input text-sm w-56"
              value={selectedPeriod}
              onChange={e => setSelectedPeriod(e.target.value)}
            >
              <option value="all">📅 Todos os registos</option>
              {monthOptions.map(o => (
                <option key={o.val} value={o.val}>{o.label}</option>
              ))}
            </select>
          </div>
          <p className="text-sm text-gray-400">
            {selectedPeriod === 'all' ? `${expenses.length} registos` : `${periodExpenses.length} despesa(s)`}
          </p>
        </div>

        {/* Cards resumo do período selecionado */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <div className="bg-white rounded-lg border border-gray-100 px-4 py-2.5">
            <p className="text-xs text-gray-500">Total de Despesas</p>
            <p className="text-lg font-bold text-gray-900">{formatCurrency(periodTotal)}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-100 px-4 py-2.5">
            <p className="text-xs text-gray-500">Pago em Dinheiro</p>
            <p className="text-lg font-bold text-gray-700">{formatCurrency(periodCash)}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-100 px-4 py-2.5">
            <p className="text-xs text-gray-500">Pago via Banco</p>
            <p className="text-lg font-bold text-gray-700">{formatCurrency(periodBank)}</p>
          </div>
        </div>

        {/* Cards filtrados — só aparecem com filtros */}
        {hasActiveFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5">
              <p className="text-xs text-emerald-600 font-medium">✦ Visível ({filtered.length})</p>
              <p className="text-lg font-bold text-emerald-700">{formatCurrency(filteredTotal)}</p>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5">
              <p className="text-xs text-emerald-600 font-medium">✦ Dinheiro (visível)</p>
              <p className="text-lg font-bold text-emerald-700">{formatCurrency(filteredCash)}</p>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5">
              <p className="text-xs text-emerald-600 font-medium">✦ Banco (visível)</p>
              <p className="text-lg font-bold text-emerald-700">{formatCurrency(filteredBank)}</p>
            </div>
          </div>
        )}

        {semProjeto > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 mb-3 flex items-center justify-between">
            <p className="text-sm text-yellow-700">⚠ <strong>{semProjeto}</strong> despesa(s) sem projeto associado</p>
            <button onClick={() => { setFilterProject('none') }} className="text-xs text-yellow-700 hover:underline font-medium">Ver só estas</button>
          </div>
        )}

        {/* Filtros — linha 1 */}
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-3 mb-3">
          <div className="grid grid-cols-5 gap-2 mb-2">
            {/* Pesquisa */}
            <div className="relative col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input className="input pl-8 w-full text-sm" placeholder="Pesquisar na descrição..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            {/* Período */}
            <select className="input text-sm" value={filterPeriod} onChange={e => setFilterPeriod(e.target.value as any)}>
              <option value="all">📅 Qualquer data</option>
              <option value="hoje">📅 Hoje</option>
              <option value="semana">📅 Esta semana</option>
              <option value="mes">📅 Este mês</option>
              <option value="ano">📅 Este ano</option>
            </select>
            {/* Categoria */}
            <select className="input text-sm" value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
              <option value="all">Categoria</option>
              <option value="obras">🏗️ Obras</option>
              <option value="edp">⚡ Eletricidade</option>
              <option value="pessoal">👤 Pessoal</option>
              <option value="contabilidade">📊 Contabilidade</option>
              <option value="manutencao">🔧 Manutenção</option>
              <option value="outros">📦 Outros</option>
            </select>
            {/* Projeto */}
            <select className="input text-sm" value={filterProject} onChange={e => setFilterProject(e.target.value)}>
              <option value="all">Todos projetos</option>
              <option value="none">⚠ Sem projeto</option>
              {projects.map(p => <option key={p.id} value={p.id}>{projectLabel(p)}</option>)}
            </select>
          </div>

          {/* Filtros — linha 2 */}
          <div className="grid grid-cols-6 gap-2 items-center">
            {/* Fornecedor multi-select */}
            <div className="relative col-span-2" ref={supplierDropdownRef}>
              <button onClick={() => setShowSupplierDropdown(!showSupplierDropdown)}
                className={`input w-full flex items-center justify-between text-left text-sm ${filterSuppliers.length > 0 ? 'border-emerald-400 text-emerald-700' : 'text-gray-600'}`}>
                <span className="truncate">
                  {filterSuppliers.length === 0 ? 'Todos os fornecedores' : filterSuppliers.length === 1 ? filterSuppliers[0] : `${filterSuppliers.length} fornecedores`}
                </span>
                <ChevronDownIcon className="w-4 h-4 flex-shrink-0 ml-2" />
              </button>
              {showSupplierDropdown && (
                <div className="absolute z-20 top-full mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
                  <div className="p-2 border-b border-gray-100">
                    <button onClick={() => setFilterSuppliers([])} className="text-xs text-gray-500 hover:text-emerald-600 hover:underline">Limpar seleção</button>
                  </div>
                  <div className="p-2 space-y-0.5">
                    {allSuppliers.map(s => (
                      <label key={s} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer">
                        <input type="checkbox" checked={filterSuppliers.includes(s)} onChange={() => toggleSupplier(s)} className="accent-emerald-600 w-3.5 h-3.5 flex-shrink-0" />
                        <span className="text-sm text-gray-700 truncate">{s}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Método de pagamento */}
            <select
              className={`input text-sm ${filterPayment !== 'all' ? 'border-emerald-400 text-emerald-700' : 'text-gray-600'}`}
              value={filterPayment}
              onChange={e => setFilterPayment(e.target.value as 'all' | 'dinheiro' | 'banco')}>
              <option value="all">Todos os pagamentos</option>
              <option value="dinheiro">💵 Dinheiro</option>
              <option value="banco">🏦 Banco</option>
            </select>

            {/* Mais filtros (datas e valores) */}
            <button onClick={() => setShowMoreFilters(v => !v)}
              className={`input text-sm flex items-center gap-2 justify-center ${showMoreFilters || filterDateFrom || filterDateTo || filterAmountMin || filterAmountMax ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'text-gray-600'}`}>
              <SlidersHorizontal className="w-3.5 h-3.5" /> Datas & Valores
            </button>

            {/* Contador e limpar */}
            <div className="col-span-2 flex items-center justify-between">
              {hasActiveFilters ? (
                <>
                  <span className="text-xs text-gray-500">{filtered.length} de {expenses.length} despesas</span>
                  <button onClick={resetFilters} className="flex items-center gap-1 text-xs text-red-500 hover:underline">
                    <X className="w-3 h-3" /> Limpar filtros
                  </button>
                </>
              ) : (
                <span className="text-xs text-gray-400">Sem filtros ativos</span>
              )}
            </div>
          </div>

          {/* Filtros expandidos */}
          {showMoreFilters && (
            <div className="mt-2 pt-2 border-t border-gray-100 grid grid-cols-4 gap-2">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Data de</label>
                <input type="date" className="input text-sm" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Data até</label>
                <input type="date" className="input text-sm" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Valor mín. (€)</label>
                <input type="number" step="0.01" className="input text-sm" placeholder="0.00" value={filterAmountMin} onChange={e => setFilterAmountMin(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Valor máx. (€)</label>
                <input type="number" step="0.01" className="input text-sm" placeholder="9999.00" value={filterAmountMax} onChange={e => setFilterAmountMax(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" /></div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className={thClass} onClick={() => handleSort('expense_date')}>Data <SortIcon field="expense_date" sortField={sortField} sortDir={sortDir} variant="chevron" /></th>
                  <th className={thClass} onClick={() => handleSort('description')}>Descrição <SortIcon field="description" sortField={sortField} sortDir={sortDir} variant="chevron" /></th>
                  <th className={thClass} onClick={() => handleSort('category')}>Categoria <SortIcon field="category" sortField={sortField} sortDir={sortDir} variant="chevron" /></th>
                  <th className={thClass} onClick={() => handleSort('supplier')}>Fornecedor <SortIcon field="supplier" sortField={sortField} sortDir={sortDir} variant="chevron" /></th>
                  <th className={thClass} onClick={() => handleSort('amount')}>Valor <SortIcon field="amount" sortField={sortField} sortDir={sortDir} variant="chevron" /></th>
                  <th className="table-header">Pagamento</th>
                  <th className="table-header">Projeto</th>
                  <th className="table-header">Fatura</th>
                  {(isAdmin || isCoAdmin) && <th className="table-header"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(expense => {
                  const hasDoc = !!documents[expense.id]
                  return (
                    <tr key={expense.id} id={`expense-${expense.id}`} className={`hover:bg-gray-50 transition-colors ${filterExpenseId === expense.id ? 'ring-2 ring-inset ring-blue-400 bg-blue-50' : !expense.project_id ? 'bg-yellow-50/30' : ''}`}>
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
                        {(isAdmin || isCoAdmin) ? (
                          <button onClick={() => handlePaymentMethodToggle(expense)} disabled={togglingPayment === expense.id}
                            className={`text-xs px-2 py-1 rounded-full font-medium transition-all hover:opacity-70 cursor-pointer ${expense.payment_method === 'dinheiro' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'} ${togglingPayment === expense.id ? 'opacity-50' : ''}`}>
                            {togglingPayment === expense.id ? '...' : expense.payment_method === 'dinheiro' ? '💵 Dinheiro' : '🏦 Banco'}
                          </button>
                        ) : (
                          <span className={`text-xs px-2 py-1 rounded-full ${expense.payment_method === 'dinheiro' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                            {expense.payment_method === 'dinheiro' ? '💵' : '🏦'}
                          </span>
                        )}
                      </td>
                      <td className="table-cell">
                        {(isAdmin || isCoAdmin) ? (
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
                      {(isAdmin || isCoAdmin) && (
                        <td className="table-cell">
                          <div className="flex items-center gap-2">
                            <button onClick={() => { setEditExpense(expense); setDuplicateExpense(null); setShowModal(true) }} className="text-xs text-emerald-600 hover:underline font-medium">Editar</button>
                            <button onClick={() => { setEditExpense(null); setDuplicateExpense(expense); setShowModal(true) }}
                              className="text-gray-300 hover:text-emerald-600 transition-colors" title="Duplicar para o mês seguinte">
                              <CopyPlus className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleDeleteClick(expense)} className="text-gray-300 hover:text-red-500 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={(isAdmin || isCoAdmin) ? 9 : 8} className="py-12 text-center text-gray-400 text-sm">
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
                  <button onClick={() => handleDeleteConfirm(true)} disabled={deleting} className="w-full py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">{deleting ? 'A apagar...' : '🗑️ Apagar despesa e fatura'}</button>
                  <button onClick={() => handleDeleteConfirm(false)} disabled={deleting} className="w-full py-2.5 rounded-lg bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 disabled:opacity-50">{deleting ? 'A apagar...' : '📄 Apagar só a despesa (manter fatura)'}</button>
                  <button onClick={() => setDeleteConfirm(null)} className="w-full py-2.5 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50">Cancelar</button>
                </div>
              </div>
            ) : (
              <div className="flex justify-end gap-3">
                <button className="btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancelar</button>
                <button onClick={() => handleDeleteConfirm(false)} disabled={deleting} className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">{deleting ? 'A apagar...' : 'Apagar'}</button>
              </div>
            )}
          </div>
        </div>
      )}

      {showModal && (isAdmin || isCoAdmin) && (
        <ExpenseModal
          expense={editExpense}
          duplicateFrom={duplicateExpense}
          onClose={() => { setShowModal(false); setDuplicateExpense(null) }}
          onSaved={() => { setShowModal(false); setDuplicateExpense(null); fetchAll() }}
        />
      )}

      {showCopiarModal && (isAdmin || isCoAdmin) && (
        <CopiarDespesasModal
          defaultTarget={selectedPeriod}
          onClose={() => setShowCopiarModal(false)}
          onCopied={() => { setShowCopiarModal(false); fetchAll() }}
        />
      )}
    </AppLayout>
  )
}

// https://quinta-gestao.vercel.app/despesas
