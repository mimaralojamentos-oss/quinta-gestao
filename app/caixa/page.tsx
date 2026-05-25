'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CashFundMovement } from '@/lib/types'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, TrendingUp, TrendingDown, Wallet } from 'lucide-react'
import CashModal from './CashModal'
import { useAuth } from '@/lib/auth-context'

export default function CaixaPage() {
  const { isAdmin } = useAuth()
  const [movements, setMovements] = useState<CashFundMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [balance, setBalance] = useState(0)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data } = await supabase
      .from('cash_fund_movements')
      .select('*')
      .order('movement_date', { ascending: false })
    setMovements(data ?? [])
    setBalance((data ?? []).reduce((s, m) => s + m.amount, 0))
    setLoading(false)
  }

  const entries = movements.filter(m => m.amount > 0).reduce((s, m) => s + m.amount, 0)
  const exits = movements.filter(m => m.amount < 0).reduce((s, m) => s + m.amount, 0)

  return (
    <AppLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Fundo de Caixa</h1>
            <p className="text-sm text-gray-500 mt-1">Controlo de saldo em caixa</p>
          </div>
          {isAdmin && (
            <button className="btn-primary" onClick={() => setShowModal(true)}>
              <Plus className="w-4 h-4" />
              Novo Movimento
            </button>
          )}
        </div>

        <div className="grid grid-cols-3 gap-5 mb-6">
          <div className="card border-l-4 border-l-emerald-500">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center">
                <Wallet className="w-5 h-5 text-emerald-600" />
              </div>
              <p className="text-sm text-gray-500 font-medium">Saldo em Caixa</p>
            </div>
            <p className={`text-3xl font-bold ${balance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {formatCurrency(balance)}
            </p>
          </div>
          <div className="card">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              <p className="text-sm text-gray-500">Total Entradas</p>
            </div>
            <p className="text-2xl font-bold text-emerald-600">{formatCurrency(entries)}</p>
          </div>
          <div className="card">
            <div className="flex items-center gap-2 mb-2">
              <TrendingDown className="w-4 h-4 text-red-500" />
              <p className="text-sm text-gray-500">Total Saídas</p>
            </div>
            <p className="text-2xl font-bold text-red-600">{formatCurrency(Math.abs(exits))}</p>
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
                  <th className="table-header">Valor</th>
                  <th className="table-header">Notas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {movements.map((m) => (
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
                      <span className={`font-semibold text-sm ${m.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {m.amount >= 0 ? '+' : ''}{formatCurrency(m.amount)}
                      </span>
                    </td>
                    <td className="table-cell text-xs text-gray-500">{m.notes ?? '—'}</td>
                  </tr>
                ))}
                {movements.length === 0 && (
                  <tr><td colSpan={5} className="py-12 text-center text-gray-400 text-sm">Sem movimentos registados</td></tr>
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
