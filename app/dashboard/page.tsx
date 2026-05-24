'use client'

export const dynamic = 'force-dynamic'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, getMonthLabel, getCurrentMonth } from '@/lib/utils'
import { Building2, Users, TrendingUp, AlertTriangle, CheckCircle, Clock, Wallet } from 'lucide-react'
import Link from 'next/link'

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalSpaces: 0, occupiedSpaces: 0, totalTenantsActive: 0,
    monthlyRentExpected: 0, monthlyRentReceived: 0, pendingRents: 0,
    cashFundBalance: 0, pendingLeases: [] as any[], alerts: [] as any[],
  })
  const [loading, setLoading] = useState(true)
  const currentMonth = getCurrentMonth()

  useEffect(() => {
    fetchStats()
  }, [])

  async function fetchStats() {
    try {
      const supabase = createClient()
      const nextMonth = new Date(currentMonth)
      nextMonth.setMonth(nextMonth.getMonth() + 1)
      const nextMonthStr = nextMonth.toISOString().slice(0, 10)

      const [spacesRes, leasesRes, paymentsRes, cashRes] = await Promise.all([
        supabase.from('spaces').select('id, status'),
        supabase.from('leases').select('id, monthly_rent, space:spaces(ref), tenant:tenants(name, phone)').eq('status', 'ativo'),
        supabase.from('rent_payments').select('lease_id, amount, tipo').gte('reference_month', currentMonth).lt('reference_month', nextMonthStr),
        supabase.from('cash_fund_movements').select('amount'),
      ])

      const spaces = spacesRes.data ?? []
      const leases = leasesRes.data ?? []
      const payments = paymentsRes.data ?? []
      const cash = cashRes.data ?? []

      const paidLeaseIds = new Set(
        payments.filter(p => p.tipo === 'renda' || !p.tipo).map(p => p.lease_id)
      )
      const rentPayments = payments.filter(p => p.tipo === 'renda' || !p.tipo)

      const pendingLeases = leases.filter(l => !paidLeaseIds.has(l.id))

      setStats({
        totalSpaces: spaces.length,
        occupiedSpaces: spaces.filter(s => s.status === 'arrendado').length,
        totalTenantsActive: leases.length,
        monthlyRentExpected: leases.reduce((s, l) => s + (l.monthly_rent ?? 0), 0),
        monthlyRentReceived: rentPayments.reduce((s, p) => s + (p.amount ?? 0), 0),
        pendingRents: pendingLeases.length,
        cashFundBalance: cash.reduce((s, m) => s + (m.amount ?? 0), 0),
        pendingLeases: pendingLeases.slice(0, 5),
        alerts: pendingLeases.slice(0, 5),
      })
    } catch (e) {
      console.error('Dashboard error:', e)
    } finally {
      setLoading(false)
    }
  }

  const occupancyRate = stats.totalSpaces > 0
    ? Math.round((stats.occupiedSpaces / stats.totalSpaces) * 100) : 0
  const collectionRate = stats.monthlyRentExpected > 0
    ? Math.round((stats.monthlyRentReceived / stats.monthlyRentExpected) * 100) : 0

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">{getMonthLabel(currentMonth)}</p>
        </div>

        <div className="grid grid-cols-4 gap-5 mb-8">
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-500">Espaços Ocupados</p>
              <div className="w-9 h-9 bg-emerald-50 rounded-lg flex items-center justify-center">
                <Building2 className="w-4 h-4 text-emerald-600" />
              </div>
            </div>
            <p className="text-2xl font-bold text-gray-900">
              {stats.occupiedSpaces}<span className="text-lg text-gray-400">/{stats.totalSpaces}</span>
            </p>
            <p className="text-xs text-emerald-600 mt-1 font-medium">{occupancyRate}% de ocupação</p>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-500">Inquilinos Ativos</p>
              <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center">
                <Users className="w-4 h-4 text-blue-600" />
              </div>
            </div>
            <p className="text-2xl font-bold text-gray-900">{stats.totalTenantsActive}</p>
            <p className="text-xs text-blue-600 mt-1 font-medium">contratos ativos</p>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-500">Rendas Recebidas</p>
              <div className="w-9 h-9 bg-emerald-50 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
              </div>
            </div>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(stats.monthlyRentReceived)}</p>
            <p className="text-xs text-gray-500 mt-1">
              de {formatCurrency(stats.monthlyRentExpected)} ({collectionRate}%)
            </p>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-500">Fundo de Caixa</p>
              <div className="w-9 h-9 bg-purple-50 rounded-lg flex items-center justify-center">
                <Wallet className="w-4 h-4 text-purple-600" />
              </div>
            </div>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(stats.cashFundBalance)}</p>
            <p className="text-xs text-gray-500 mt-1">saldo atual</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">Rendas Pendentes</h2>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${stats.pendingRents > 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {stats.pendingRents} pendentes
              </span>
            </div>
            {stats.pendingRents === 0 ? (
              <div className="flex items-center gap-2 text-emerald-600 text-sm py-4">
                <CheckCircle className="w-5 h-5" />
                Todas as rendas deste mês recebidas!
              </div>
            ) : (
              <div className="space-y-2">
                {stats.pendingLeases.map((lease: any) => (
                  <div key={lease.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                    <div className="w-8 h-8 bg-red-50 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Clock className="w-4 h-4 text-red-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-800">{lease.tenant?.name}</p>
                      <p className="text-xs text-gray-500">{lease.space?.ref} · Renda de {getMonthLabel(currentMonth)} por receber</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Link href="/pagamentos" className="mt-4 text-xs text-emerald-600 hover:underline font-medium block">
              Ver todos os pagamentos →
            </Link>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">Alertas</h2>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${stats.pendingRents > 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {stats.pendingRents} alertas
              </span>
            </div>
            {stats.pendingRents === 0 ? (
              <div className="flex items-center gap-2 text-emerald-600 text-sm py-4">
                <CheckCircle className="w-5 h-5" />
                Sem alertas ativos
              </div>
            ) : (
              <div className="space-y-2">
                {stats.alerts.map((lease: any) => (
                  <div key={lease.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                    <div className="w-8 h-8 bg-yellow-50 rounded-lg flex items-center justify-center flex-shrink-0">
                      <AlertTriangle className="w-4 h-4 text-yellow-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-800">{lease.tenant?.name}</p>
                      <p className="text-xs text-gray-500">{lease.space?.ref} · Renda em atraso</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Link href="/alertas" className="mt-4 text-xs text-emerald-600 hover:underline font-medium block">
              Ver todos os alertas →
            </Link>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
