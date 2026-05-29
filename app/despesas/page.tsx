'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Expense } from '@/lib/types'
import { formatCurrency, formatDate, categoryLabel } from '@/lib/utils'
import { Plus, Search, FileText, Trash2, X, SlidersHorizontal, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import ExpenseModal from './ExpenseModal'
import { useAuth } from '@/lib/auth-context'

interface DeleteConfirm {
  expense: any
  hasInvoice: boolean
}

type SortField = 'expense_date' | 'description' | 'category' | 'supplier' | 'amount'
type SortDir = 'asc' | 'desc'

export default function DespesasPage() {
  const { isAdmin } = useAuth()
  const [expenses, setExpenses] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
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
  const [filterSupplier, setFilterSupplier] = useState('')
  const [filterProject, setFilterProject] = useState('all')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterAmountMin, setFilterAmountMin] = useState('')
  const [filterAmountMax, setFilterAmountMax] = useState('')

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
      .order('name')
    setExpenses(expensesData ?? [])
    setProjects(projectsData ?? [])
    const total = (expensesData ?? []).reduce((s, e) => s + e.amount, 0)
    const cash = (expensesData ?? []).filter(e => e.payment_method === 'dinheiro').reduce((s, e) => s + e.amount, 0)
    setSummary({ total, cash, bank: total - cash })
    setLoading(false)
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronsUpDown className="w-3 h-3 ml-1 text-gray-400 inline" />
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 ml-1 text-emerald-600 inline" />
      : <ChevronDown className="w-3 h-3 ml-1 text-emerald-600 inline" />
  }

  async function handlePaymentMethodToggle(expense: any) {
    if (!isAdmin) return
    setTogglingPayment(expense.id)

    const newMethod = expense.payment_method === 'dinheiro' ? 'banco' : 'dinheiro'

    await supabase.from('expenses').update({ payment_method: newMethod }).eq('id', expense.id)

    // Atualizar Fundo de Maneio
    const { data: existingCash } = await supabase
      .from('cash_fund_movements').select('id').eq('source_id', expense.id).single()

    if (newMethod === 'dinheiro') {
      // Passou para dinheiro → criar movimento no Fundo de Maneio
      if (existingCash) {
        await supabase.from('cash_fund_movements').update({
          amount: -Math.abs(expense.amount),
          movement_date: expense.expense_date,
          description: `💸 ${expense.description}${expense.supplier ? ` — ${expense.supplier}` : ''}`,
        }).eq('id', existingCash.id)
      } else {
        await supabase.from('cash_fund_movements').insert({
          movement_date: expense.expense_date,
          description: `💸 ${expense.description}${expense.supplier ? ` — ${expense.supplier}` : ''}`,
          amount: -Math.abs(expense.amount),
          type: 'saida',
          source: 'despesa',
          source_id: expense.id,
        })
      }
    } else {
      // Passou para banco → remover do Fundo de Maneio
      if (existingCash) {
        await supabase.from('cash_fund_movements').delete().eq('id', existingCash.id)
      }
    }

    // Atualizar localmente
    setExpenses(prev => prev.map(e =>
      e.id === expense.id ? { ...e, payment_method: newMethod } : e
    ))
    // Recalcular summary
    setExpenses(prev => {
      const total = prev.reduce((s, e) => s + e.amount, 0)
      const cash = prev.filter(e => e.payment_method === 'dinheiro').reduce((s, e) => s + e.amount, 0)
      setSummary({ total, cash, bank: total - cash })
      return prev
    })

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

  function handleDeleteClick(expense: any) {
    setDeleteConfirm({
      expense,
      hasInvoice: !!(expense.invoice_id || expense.invoice_file_path),
    })
  }

  async function handleDeleteConfirm(deleteInvoice: boolean) {
    if (!deleteConfirm) return
    setDeleting(true)
    const { expense } = deleteConfirm
    try {
      await supabase.from('cash_fund_movements').delete().eq('source_id', expense.id)
      if (deleteInvoice && expense.invoice_id) {
        const { data: inv } = await supabase.from('invoices').select('file_path').eq('id', expense.invoice_id).single()
        if (inv?.file_path) await supabase.storage.from('invoices').remove([inv.file_path])
        await supabase.from('invoices').delete().eq('id', expense.invoice_id)
      }
      if (deleteInvoice && expense.invoice_file_path && !expense.invoice_id) {
        await supabase.storage.from('documents').remove([expense.invoice_file_path])
      }
      await supabase.from('expenses').delete().eq('id', expense.id)
    } catch (e: any) { console.error('Erro ao apagar:', e) }
    setDeleting(false)
    setDeleteConfirm(null)
    fetchAll()
  }

  async function viewInvoice(expense: any) {
    if (expense.invoice_id) {
      const { data: inv } = await supabase.from('invoices').select('file_path').eq('id', expense.invoice_id).single()
      if (inv?.file_path) {
        const { data } = supabase.storage.from('invoices').getPublicUrl(inv.file_path)
        if (data?.publicUrl) window.open(data.publicUrl, '_blank')
      }
    } else if (expense.invoice_file_path) {
      const { data } = await supabase.storage.from('documents').createSignedUrl(expense.invoice_file_path, 60)
      if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    }
  }

  function projectLabel(p: any) {
    if (!p) return '—'
    const typeEmoji: Record<string, string> = { construcao: '🏗️', renovacao: '🔨', arranjo: '🔧', outro: '📦' }
    const emoji = typeEmoji[p.type] ?? '📦'
    const loc = p.is_general ? 'Geral' : p.space?.ref ?? p.location_label ?? ''
    return `${emoji} ${p.name}${loc ? ` (${loc})` : ''}`
  }

  function resetFilters() {
    setSearch('')
    setFilterCategory('all')
    setFilterSupplier('')
    setFilterProject('all')
    setFilterDateFrom('')
    setFilterDateTo('')
    setFilterAmountMin('')
    setFilterAmountMax('')
  }

  const hasActiveFilters = search || filterCategory !== 'all' || filterSupplier ||
    filterProject !== 'all' || filterDateFrom || filterDateTo || filterAmountMin || filterAmountMax

  const allSuppliers = [...new Set(expenses.map(e => e.supplier).filter(Boolean))].sort()

  const filtered = expenses.filter(e => {
    const matchSearch = !search || e.description.toLowerCase().includes(search.toLowerCase())
    const matchCat = filterCategory === 'all' || e.category === filterCategory
    const matchSupplier = !filterSupplier || e.supplier === filterSupplier
    const matchProject = filterProject === 'all' ||
      (filterProject === 'none' && !e.project_id) ||
      e.project_id === filterProject
    const matchDateFrom = !filterDateFrom || e.expense_date >= filterDateFrom
    const matchDateTo = !filterDateTo || e.expense_date <= filterDateTo
    const matchAmountMin = !filterAmountMin || e.amount >= parseFloat(filterAmountMin)
    const matchAmountMax = !filterAmountMax || e.amount <= parseFloat(filterAmountMax)
    return matchSearch && matchCat && matchSupplier && matchProject && matchDateFrom && matchDateTo && matchAmountMin && matchAmountMax
  }).sort((a, b) => {
    let valA = a[sortField] ?? ''
    let valB = b[sortField] ?? ''
    if (sortField === 'amount') {
      valA = Number(valA); valB = Number(valB)
    } else {
      valA = String(valA).toLowerCase(); valB = String(valB).toLowerCase()
    }
    if (valA < valB) return sortDir === 'asc' ? -1 : 1
    if (valA > valB) return sortDir === 'asc' ? 1 : -1
    return 0
  })

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
              <Plus className="w-4 h-4" />
              Nova Despesa
            </button>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
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

        {semProjeto > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 mb-4 flex items-center justify-between">
            <p className="text-sm text-yellow-700">⚠ <strong>{semProjeto}</strong> despesa(s) sem projeto associado</p>
            <button onClick={() => { setFilterProject('none'); setShowFilters(true) }}
              className="text-xs text-yellow-700 hover:underline font-medium">Ver só estas</button>
          </div>
        )}

        <div className="flex gap-3 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9" placeholder="Pesquisar na descrição..." value={search}
              onChange={e => setSearch(e.target.value)} />
          </div>
          <button onClick={() => setShowFilters(v => !v)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
              hasActiveFilters ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}>
            <SlidersHorizontal className="w-4 h-4" />
            Filtros
            {hasActiveFilters && <span className="bg-white text-emerald-600 text-xs font-bold px-1.5 py-0.5 rounded-full">
              {[filterCategory !== 'all', filterSupplier, filterProject !== 'all', filterDateFrom, filterDateTo, filterAmountMin, filterAmountMax].filter(Boolean).length}
            </span>}
          </button>
          {hasActiveFilters && (
            <button onClick={resetFilters}
              className="flex items-center gap-1 px-3 py-2 rounded-lg border border-red-200 text-red-600 text-sm hover:bg-red-50 transition-colors">
              <X className="w-3.5 h-3.5" />
              Limpar filtros
            </button>
          )}
        </div>

        {showFilters && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-4 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Categoria</label>
                <select className="input text-sm" value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
                  <option value="all">Todas</option>
                  <option value="obras">Obras</option>
                  <option value="edp">Eletricidade (EDP)</option>
                  <option value="pessoal">Pessoal</option>
                  <option value="contabilidade">Contabilidade</option>
                  <option value="manutencao">Manutenção</option>
                  <option value="outros">Outros</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Fornecedor</label>
                <select className="input text-sm" value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)}>
                  <option value="">Todos</option>
                  {allSuppliers.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Projeto</label>
                <select className="input text-sm" value={filterProject} onChange={e => setFilterProject(e.target.value)}>
                  <option value="all">Todos</option>
                  <option value="none">⚠ Sem projeto</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{projectLabel(p)}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Data — de</label>
                <input type="date" className="input text-sm" value={filterDateFrom}
                  onChange={e => setFilterDateFrom(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Data — até</label>
                <input type="date" className="input text-sm" value={filterDateTo}
                  onChange={e => setFilterDateTo(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
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
                  <th className={thClass} onClick={() => handleSort('expense_date')}>
                    Data <SortIcon field="expense_date" />
                  </th>
                  <th className={thClass} onClick={() => handleSort('description')}>
                    Descrição <SortIcon field="description" />
                  </th>
                  <th className={thClass} onClick={() => handleSort('category')}>
                    Categoria <SortIcon field="category" />
                  </th>
                  <th className={thClass} onClick={() => handleSort('supplier')}>
                    Fornecedor <SortIcon field="supplier" />
                  </th>
                  <th className={thClass} onClick={() => handleSort('amount')}>
                    Valor <SortIcon field="amount" />
                  </th>
                  <th className="table-header">Pagamento</th>
                  <th className="table-header">Projeto</th>
                  <th className="table-header">Fatura</th>
                  {isAdmin && <th className="table-header"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(expense => (
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
                        <button
                          onClick={() => handlePaymentMethodToggle(expense)}
                          disabled={togglingPayment === expense.id}
                          title={expense.payment_method === 'dinheiro' ? 'Clica para mudar para Banco' : 'Clica para mudar para Dinheiro'}
                          className={`text-xs px-2 py-1 rounded-full font-medium transition-all hover:opacity-70 cursor-pointer ${
                            expense.payment_method === 'dinheiro'
                              ? 'bg-green-100 text-green-700 hover:bg-green-200'
                              : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                          } ${togglingPayment === expense.id ? 'opacity-50' : ''}`}>
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
                        <select value={expense.project_id ?? ''}
                          onChange={e => handleProjectChange(expense.id, e.target.value)}
                          className={`text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500 max-w-[180px] ${expense.project_id ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-yellow-200 bg-yellow-50 text-yellow-700'}`}>
                          <option value="">— Sem projeto —</option>
                          {projects.map(p => <option key={p.id} value={p.id}>{projectLabel(p)}</option>)}
                        </select>
                      ) : (
                        <span className="text-xs text-gray-600">{expense.project ? projectLabel(expense.project) : '—'}</span>
                      )}
                    </td>
                    <td className="table-cell">
                      {(expense.invoice_id || expense.invoice_file_path) ? (
                        <button onClick={() => viewInvoice(expense)}
                          className="flex items-center gap-1 text-xs text-emerald-600 hover:underline">
                          <FileText className="w-3 h-3" /> Ver
                        </button>
                      ) : '—'}
                    </td>
                    {isAdmin && (
                      <td className="table-cell">
                        <div className="flex items-center gap-2">
                          <button onClick={() => { setEditExpense(expense); setShowModal(true) }}
                            className="text-xs text-emerald-600 hover:underline font-medium">Editar</button>
                          <button onClick={() => handleDeleteClick(expense)}
                            className="text-gray-300 hover:text-red-500 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
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
                  <button onClick={() => setDeleteConfirm(null)}
                    className="w-full py-2.5 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50">
                    Cancelar
                  </button>
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
        <ExpenseModal
          expense={editExpense}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); fetchAll() }}
        />
      )}
    </AppLayout>
  )
}
