'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Expense } from '@/lib/types'
import { formatCurrency, formatDate, categoryLabel } from '@/lib/utils'
import { Plus, Search, FileText } from 'lucide-react'
import ExpenseModal from './ExpenseModal'
import { useAuth } from '@/lib/auth-context'

export default function DespesasPage() {
  const { isAdmin } = useAuth()
  const [expenses, setExpenses] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [filterProject, setFilterProject] = useState('all')
  const [showModal, setShowModal] = useState(false)
  const [editExpense, setEditExpense] = useState<Expense | null>(null)
  const [summary, setSummary] = useState({ total: 0, cash: 0, bank: 0 })

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

  async function handleProjectChange(expenseId: string, projectId: string) {
    await supabase
      .from('expenses')
      .update({ project_id: projectId || null })
      .eq('id', expenseId)
    // Atualizar localmente sem reload
    setExpenses(prev => prev.map(e => {
      if (e.id !== expenseId) return e
      const project = projects.find(p => p.id === projectId) ?? null
      return { ...e, project_id: projectId || null, project }
    }))
  }

  async function downloadInvoice(expense: any) {
    if (!expense.invoice_file_path) return
    const { data } = await supabase.storage.from('documents').createSignedUrl(expense.invoice_file_path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  function projectLabel(p: any) {
    if (!p) return '—'
    const typeEmoji: Record<string, string> = {
      construcao: '🏗️', renovacao: '🔨', arranjo: '🔧', outro: '📦',
    }
    const emoji = typeEmoji[p.type] ?? '📦'
    const loc = p.is_general ? 'Geral' : p.space?.ref ?? p.location_label ?? ''
    return `${emoji} ${p.name}${loc ? ` (${loc})` : ''}`
  }

  const filtered = expenses.filter(e => {
    const matchSearch = e.description.toLowerCase().includes(search.toLowerCase()) ||
      e.supplier?.toLowerCase().includes(search.toLowerCase())
    const matchCat = filterCategory === 'all' || e.category === filterCategory
    const matchType = filterType === 'all' || e.type === filterType
    const matchProject = filterProject === 'all' ||
      (filterProject === 'none' && !e.project_id) ||
      e.project_id === filterProject
    return matchSearch && matchCat && matchType && matchProject
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

        {/* Alerta despesas sem projeto */}
        {semProjeto > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 mb-4 flex items-center justify-between">
            <p className="text-sm text-yellow-700">
              ⚠ <strong>{semProjeto}</strong> despesa(s) sem projeto associado
            </p>
            <button
              onClick={() => setFilterProject('none')}
              className="text-xs text-yellow-700 hover:underline font-medium"
            >
              Ver só estas
            </button>
          </div>
        )}

        <div className="flex gap-3 mb-6 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9" placeholder="Pesquisar..." value={search}
              onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="input w-44" value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
            <option value="all">Todas as categorias</option>
            <option value="obras">Obras</option>
            <option value="edp">Eletricidade (EDP)</option>
            <option value="pessoal">Pessoal</option>
            <option value="contabilidade">Contabilidade</option>
            <option value="manutencao">Manutenção</option>
            <option value="outros">Outros</option>
          </select>
          <select className="input w-36" value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="all">Todos os tipos</option>
            <option value="recorrente">Recorrente</option>
            <option value="pontual">Pontual</option>
          </select>
          <select className="input w-52" value={filterProject} onChange={e => setFilterProject(e.target.value)}>
            <option value="all">Todos os projetos</option>
            <option value="none">⚠ Sem projeto</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{projectLabel(p)}</option>
            ))}
          </select>
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
                  <th className="table-header">Categoria</th>
                  <th className="table-header">Fornecedor</th>
                  <th className="table-header">Valor</th>
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
                      <span className={`text-xs px-2 py-1 rounded-full ${expense.payment_method === 'dinheiro' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                        {expense.payment_method === 'dinheiro' ? '💵' : '🏦'}
                      </span>
                    </td>
                    <td className="table-cell">
                      {isAdmin ? (
                        <select
                          value={expense.project_id ?? ''}
                          onChange={e => handleProjectChange(expense.id, e.target.value)}
                          className={`text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500 max-w-[180px] ${
                            expense.project_id
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-yellow-200 bg-yellow-50 text-yellow-700'
                          }`}
                        >
                          <option value="">— Sem projeto —</option>
                          {projects.map(p => (
                            <option key={p.id} value={p.id}>{projectLabel(p)}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-gray-600">
                          {expense.project ? projectLabel(expense.project) : '—'}
                        </span>
                      )}
                    </td>
                    <td className="table-cell">
                      {expense.invoice_file_path ? (
                        <button onClick={() => downloadInvoice(expense)}
                          className="flex items-center gap-1 text-xs text-emerald-600 hover:underline">
                          <FileText className="w-3 h-3" /> Ver
                        </button>
                      ) : '—'}
                    </td>
                    {isAdmin && (
                      <td className="table-cell">
                        <button onClick={() => { setEditExpense(expense); setShowModal(true) }}
                          className="text-xs text-emerald-600 hover:underline font-medium">Editar</button>
                      </td>
                    )}
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={isAdmin ? 9 : 8} className="py-12 text-center text-gray-400 text-sm">Nenhuma despesa encontrada</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
