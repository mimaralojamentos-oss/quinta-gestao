'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, getMonthLabel, getCurrentMonth } from '@/lib/utils'
import { Plus, ChevronLeft, ChevronRight, CheckCircle, Clock, Banknote, Building, AlertTriangle } from 'lucide-react'
import PaymentModal from './PaymentModal'
import { useAuth } from '@/lib/auth-context'

interface LeaseWithDetails {
  id: string
  monthly_rent: number
  space: { ref: string; type: string }
  tenant: { id: string; name: string; phone: string }
  payments_this_month: {
    id: string
    amount: number
    payment_method: string
    payment_date: string
    tipo: string
    notes: string
  }[]
  balance: number
  total_debt: number
}

const tipoLabels: Record<string, string> = {
  renda: '🏠 Renda',
  caucao: '🔒 Caução',
  extra: '➕ Extra',
  luz: '⚡ Luz',
}

export default function PagamentosPage() {
  const { isAdmin } = useAuth()
  const [leases, setLeases] = useState<LeaseWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [currentMonth, setCurrentMonth] = useState(getCurrentMonth())
  const [showModal, setShowModal] = useState(false)
  const [selectedLease, setSelectedLease] = useState<LeaseWithDetails | null>(null)
  const [summary, setSummary] = useState({ expected: 0, received: 0, pending: 0, inCash: 0, inBank: 0, totalDebt: 0 })

  useEffect(() => { fetchData() }, [currentMonth])

  async function fetchData() {
    setLoading(true)
    const nextMonth = getNextMonth(currentMonth)
    const mayStart = '2026-05-01'
    const today = new Date(); today.setDate(1)
    const todayStr = today.toISOString().slice(0, 10)

    const { data: leasesData } = await supabase
      .from('leases')
      .select('*, space:spaces(*), tenant:tenants(*)')
      .eq('status', 'ativo')

    const { data: paymentsData } = await supabase
      .from('rent_payments')
      .select('*')
      .gte('reference_month', currentMonth)
      .lt('reference_month', nextMonth)

    // Todos os pagamentos para calcular dívidas acumuladas
    const { data: allPayments } = await supabase
      .from('rent_payments')
      .select('lease_id, amount, payment_date, reference_month, tipo')

    // Dívidas manuais
    const { data: debtsData } = await supabase
      .from('debts')
      .select('id, tenant_id, original_amount')

    const { data: debtPaymentsData } = await supabase
      .from('debt_payments')
      .select('debt_id, amount')

    // Cobranças de eletricidade por pagar
    const { data: elecCharges } = await supabase
      .from('electricity_charges')
      .select('lease_id, amount')
      .eq('paid', false)

    const mapped: LeaseWithDetails[] = (leasesData ?? []).map(l => {
      const paymentsThisMonth = (paymentsData ?? []).filter(p => p.lease_id === l.id)
      const totalPaid = paymentsThisMonth.filter(p => p.tipo === 'renda' || !p.tipo).reduce((s, p) => s + p.amount, 0)

      // Calcular dívida acumulada de rendas
      let rentDebt = 0
      if (l.start_date) {
        const contractStart = new Date(l.start_date); contractStart.setDate(1)
        const start = new Date(Math.max(contractStart.getTime(), new Date(mayStart).getTime()))
        const cursor = new Date(start)
        while (cursor <= today) {
          const monthStr = cursor.toISOString().slice(0, 7)
          const hasPayment = (allPayments ?? []).some(p =>
            p.lease_id === l.id &&
            p.reference_month?.slice(0, 7) === monthStr &&
            p.payment_date &&
            (p.tipo === 'renda' || !p.tipo)
          )
          if (!hasPayment) rentDebt += l.monthly_rent
          cursor.setMonth(cursor.getMonth() + 1)
        }
      }

      // Dívidas manuais
      const tenantDebts = (debtsData ?? []).filter(d => d.tenant_id === l.tenant?.id)
      const manualDebt = tenantDebts.reduce((sum, d) => {
        const paid = (debtPaymentsData ?? []).filter(p => p.debt_id === d.id).reduce((s, p) => s + p.amount, 0)
        return sum + Math.max(0, d.original_amount - paid)
      }, 0)

      // Eletricidade por pagar
      const elecDebt = (elecCharges ?? []).filter(c => c.lease_id === l.id).reduce((s, c) => s + c.amount, 0)

      const total_debt = rentDebt + manualDebt + elecDebt

      return {
        id: l.id,
        monthly_rent: l.monthly_rent,
        space: l.space,
        tenant: l.tenant,
        payments_this_month: paymentsThisMonth,
        balance: totalPaid - l.monthly_rent,
        total_debt,
      }
    })

    mapped.sort((a, b) => {
      const aPaid = a.payments_this_month.length > 0
      const bPaid = b.payments_this_month.length > 0
      if (aPaid !== bPaid) return aPaid ? 1 : -1
      return a.space?.ref?.localeCompare(b.space?.ref ?? '') ?? 0
    })

    setLeases(mapped)

    const expected = mapped.reduce((s, l) => s + l.monthly_rent, 0)
    const rentaPayments = (paymentsData ?? []).filter(p => p.tipo === 'renda' || !p.tipo)
    const received = rentaPayments.reduce((s, p) => s + p.amount, 0)
    const inCash = rentaPayments.filter(p => p.payment_method === 'dinheiro').reduce((s, p) => s + p.amount, 0)
    const inBank = rentaPayments.filter(p => p.payment_method !== 'dinheiro').reduce((s, p) => s + p.amount, 0)
    const totalDebt = mapped.reduce((s, l) => s + l.total_debt, 0)
    setSummary({ expected, received, pending: expected - received, inCash, inBank, totalDebt })

    setLoading(false)
  }

  function changeMonth(delta: number) {
    const d = new Date(currentMonth)
    d.setMonth(d.getMonth() + delta)
    setCurrentMonth(d.toISOString().slice(0, 10))
  }

  return (
    <AppLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Rendas & Pagamentos</h1>
          </div>
          <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-4 py-2">
            <button onClick={() => changeMonth(-1)} className="text-gray-500 hover:text-gray-700">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-medium text-gray-800 min-w-[160px] text-center">{getMonthLabel(currentMonth)}</span>
            <button onClick={() => changeMonth(1)} className="text-gray-500 hover:text-gray-700">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-6 gap-4 mb-6">
          <div className="card text-center py-4">
            <p className="text-xs text-gray-500 mb-1">Esperado</p>
            <p className="text-lg font-bold text-gray-900">{formatCurrency(summary.expected)}</p>
          </div>
          <div className="card text-center py-4">
            <p className="text-xs text-gray-500 mb-1">Recebido</p>
            <p className="text-lg font-bold text-emerald-600">{formatCurrency(summary.received)}</p>
          </div>
          <div className="card text-center py-4">
            <p className="text-xs text-gray-500 mb-1">Pendente mês</p>
            <p className={`text-lg font-bold ${summary.pending > 0 ? 'text-red-600' : 'text-gray-400'}`}>
              {formatCurrency(summary.pending)}
            </p>
          </div>
          <div className="card text-center py-4 border-l-4 border-l-red-400">
            <div className="flex items-center justify-center gap-1 mb-1">
              <AlertTriangle className="w-3 h-3 text-red-500" />
              <p className="text-xs text-gray-500">Total em Dívida</p>
            </div>
            <p className={`text-lg font-bold ${summary.totalDebt > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
              {formatCurrency(summary.totalDebt)}
            </p>
          </div>
          <div className="card text-center py-4">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Banknote className="w-3 h-3 text-gray-500" />
              <p className="text-xs text-gray-500">Em Dinheiro</p>
            </div>
            <p className="text-lg font-bold text-gray-700">{formatCurrency(summary.inCash)}</p>
          </div>
          <div className="card text-center py-4">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Building className="w-3 h-3 text-gray-500" />
              <p className="text-xs text-gray-500">Via Banco</p>
            </div>
            <p className="text-lg font-bold text-gray-700">{formatCurrency(summary.inBank)}</p>
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
                  <th className="table-header">Espaço</th>
                  <th className="table-header">Inquilino</th>
                  <th className="table-header">Renda</th>
                  <th className="table-header">Estado</th>
                  <th className="table-header">Pago</th>
                  <th className="table-header">Método</th>
                  <th className="table-header">Saldo mês</th>
                  <th className="table-header">Total dívida</th>
                  {isAdmin && <th className="table-header"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {leases.map(lease => {
                  const paid = lease.payments_this_month.reduce((s, p) => s + p.amount, 0)
                  const isPaid = paid >= lease.monthly_rent
                  const isPartial = paid > 0 && !isPaid
                  return (
                    <tr key={lease.id} className="hover:bg-gray-50 transition-colors">
                      <td className="table-cell font-semibold text-gray-900">{lease.space?.ref}</td>
                      <td className="table-cell">
                        <div>
                          <p className="font-medium text-gray-800">{lease.tenant?.name}</p>
                          {lease.tenant?.phone && <p className="text-xs text-gray-500">{lease.tenant.phone}</p>}
                        </div>
                      </td>
                      <td className="table-cell font-medium">{formatCurrency(lease.monthly_rent)}</td>
                      <td className="table-cell">
                        {isPaid ? (
                          <span className="badge-verde flex items-center gap-1 w-fit">
                            <CheckCircle className="w-3 h-3" /> Pago
                          </span>
                        ) : isPartial ? (
                          <span className="badge-amarelo flex items-center gap-1 w-fit">
                            <Clock className="w-3 h-3" /> Parcial
                          </span>
                        ) : (
                          <span className="badge-vermelho flex items-center gap-1 w-fit">
                            <Clock className="w-3 h-3" /> Pendente
                          </span>
                        )}
                      </td>
                      <td className="table-cell">{paid > 0 ? formatCurrency(paid) : '—'}</td>
                      <td className="table-cell">
                        {lease.payments_this_month.length > 0 ? (
                          <div className="space-y-0.5">
                            {lease.payments_this_month.map(p => (
                              <div key={p.id} className="flex items-center gap-1 flex-wrap">
                                <span className={`text-xs px-2 py-0.5 rounded-full ${p.payment_method === 'dinheiro' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                                  {p.payment_method === 'dinheiro' ? '💵' : '🏦'}
                                </span>
                                <span className={`text-xs px-2 py-0.5 rounded-full ${
                                  p.tipo === 'caucao' ? 'bg-blue-100 text-blue-700' :
                                  p.tipo === 'extra' ? 'bg-orange-100 text-orange-700' :
                                  p.tipo === 'luz' ? 'bg-yellow-100 text-yellow-700' :
                                  'bg-gray-100 text-gray-600'
                                }`}>
                                  {tipoLabels[p.tipo] ?? '🏠 Renda'}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : '—'}
                      </td>
                      <td className="table-cell">
                        <span className={`font-medium text-sm ${lease.balance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {lease.balance >= 0 ? '+' : ''}{formatCurrency(lease.balance)}
                        </span>
                      </td>
                      <td className="table-cell">
                        {lease.total_debt > 0 ? (
                          <span className="text-sm font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                            {formatCurrency(lease.total_debt)}
                          </span>
                        ) : (
                          <span className="text-xs text-emerald-600 font-medium">✓</span>
                        )}
                      </td>
                      {isAdmin && (
                        <td className="table-cell">
                          <button
                            onClick={() => { setSelectedLease(lease); setShowModal(true) }}
                            className="btn-primary text-xs py-1.5 px-3">
                            <Plus className="w-3 h-3" /> Registar
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && selectedLease && isAdmin && (
        <PaymentModal
          lease={selectedLease}
          currentMonth={currentMonth}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); fetchData() }}
        />
      )}
    </AppLayout>
  )
}

function getNextMonth(dateString: string): string {
  const d = new Date(dateString)
  d.setMonth(d.getMonth() + 1)
  return d.toISOString().slice(0, 10)
}

// https://quinta-gestao.vercel.app/pagamentos
