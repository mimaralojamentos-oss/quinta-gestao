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
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [showModal, setShowModal] = useState(false)
  const [editExpense, setEditExpense] = useState<Expense | null>(null)
  const [summary, setSummary] = useState({ total: 0, cash: 0, bank: 0 })

  useEffect(() => { fetchExpenses() }, [])

  async function fetchExpenses() {
    setLoading(true)
    const { data } = await supabase
      .from('expenses')
      .select('*')
      .order('expense_date', { ascending: false })
    setExpenses(data ?? [])

    const total = (data ?? []).reduce((s, e) => s + e.amount, 0)
    const cash = (data ?? []).filter(e => e.payment_method === 'dinheiro').reduce((s, e) => s + e.amount, 0)
    setSummary({ total, cash, bank: total - cash })
    setLoading(false)
  }

  async function downloadInvoice(expense: Expense) {
    if (!expense.invoice_file_path) return
    const { data } = await supabase.storage.from('documents').createSignedUrl(expense.invoice_file_path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const filtered = expenses.filter(e => {
    const matchSearch = e.description.toLowerCase().includes(search.toLowerCase()) ||
      e.supplier?.toLowerCase().includes(search.toLowerCase())
    const matchCat = filterCategory === 'all' || e.category === filterCategory
    const matchType = filterType === 'all' || e.type === filterType
    return matchSearch && matchCat && matchType
  })

  const categoryColors: Record<string, string> = {
    obras: 'bg-orange-100 text-orange-700',
    edp: 'bg-yellow-100 text-yellow-700',
    pessoal: 'bg-blue-100 text-blue-700',
    contabilidade: 'bg-purple-100 text-purple-700',
    manutencao: 'bg-cyan-100 text-cyan-700',
    outros: 'bg-gray-100 text-gray-700',
  }

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

        <div className="flex gap-3 mb-6">
          <div className="relative flex-1 max-w-xs">
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
                  <th className="table-header">Tipo</th>
                  <th className="table-header">Fornecedor</th>
                  <th className="table-header">Valor</th>
                  <th className="table-header">Pagamento</th>
                  <th className="table-header">Fatura</th>
                  {isAdmin && <th className="table-header"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(expense => (
                  <tr key={expense.id} className="hover:bg-gray-50">
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
                    <td className="table-cell">
                      <span className={expense.type === 'recorrente' ? 'badge-verde' : 'badge-cinza'}>
                        {expense.type === 'recorrente' ? 'Recorrente' : 'Pontual'}
                      </span>
                    </td>
                    <td className="table-cell text-sm">{expense.supplier ?? '—'}</td>
                    <td className="table-cell font-semibold text-red-600">{formatCurrency(expense.amount)}</td>
                    <td className="table-cell">
                      <span className={`text-xs px-2 py-1 rounded-full ${expense.payment_method === 'dinheiro' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                        {expense.payment_method === 'dinheiro' ? '💵 Dinheiro' : '🏦 Banco'}
                      </span>
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
          onSaved={() => { setShowModal(false); fetchExpenses() }}
        />
      )}
    </AppLayout>
  )
}
