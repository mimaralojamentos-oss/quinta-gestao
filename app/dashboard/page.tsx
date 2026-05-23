'use client'

export const dynamic = 'force-dynamic'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, getMonthLabel, getCurrentMonth } from '@/lib/utils'
import {
  Building2, Users, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Clock, Wallet
} from 'lucide-react'
import Link from 'next/link'

interface DashboardStats {
  totalSpaces: number
  occupiedSpaces: number
  totalTenantsActive: number
  monthlyRentExpected: number
  monthlyRentReceived: number
  pendingRents: number
  cashFundBalance: number
  recentAlerts: Alert[]
}

interface Alert {
  id: string
  type: 'late_rent' | 'expiring_contract'
  message: string
  tenant_name: string
  space_ref: string
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    totalSpaces: 0,
    occupiedSpaces: 0,
    totalTenantsActive: 0,
    monthlyRentExpected: 0,
    monthlyRentReceived: 0,
    pendingRents: 0,
    cashFundBalance: 0,
    recentAlerts: [],
  })
  const [loading, setLoading] = useState(true)
  const currentMonth = getCurrentMonth()
  const supabase = createClient()

  useEffect(() => {
    async function fetchStats() {
      try {
        // Spaces
        const { data: spaces } = await supabase.from('spaces').select('*')
        const totalSpaces = spaces?.length ?? 0
        const occupiedSpaces = spaces?.filter(s => s.status === 'arrendado').length ?? 0

        // Active leases
        const { data: leases } = await supabase
          .from('leases')
          .select('*, space:spaces(*), tenant:tenants(*)')
          .eq('status', 'ativo')

        const totalTenantsActive = leases?.length ?? 0
        const monthlyRentExpected = leases?.reduce((sum, l) => sum + (l.monthly_rent ?? 0), 0) ?? 0

        // Payments this month
        const { data: payments } = await supabase
          .from('rent_payments')
          .select('*')
          .gte('reference_month', currentMonth)
          .lt('reference_month', getNextMonth(currentMonth))

        const monthlyRentReceived = payments?.reduce((sum, p) => sum + (p.amount ?? 0), 0) ?? 0

        // Leases with no payment this month
        const paidLeaseIds = new Set(payments?.map(p => p.lease_id) ?? [])
        const pendingRents = leases?.filter(l => !paidLeaseIds.has(l.id)).length ?? 0

        // Cash fund balance
        const { data: cashMovements } = await supabase
          .from('cash_fund_movements')
          .select('amount')
        const cashFundBalance = cashMovements?.reduce((sum, m) => sum + (m.amount ?? 0), 0) ?? 0

        // Build alerts
        const alerts: Alert[] = []

        // Unpaid rents (leases with no payment this month)
        leases?.filter(l => !paidLeaseIds.has(l.id)).slice(0, 5).forEach(l => {
          alerts.push({
            id: `rent-${l.id}`,
            type: 'late_rent',
            message: `Renda de ${getMonthLabel(currentMonth)} por receber`,
            tenant_name: l.tenant?.name ?? '—',
            space_ref: l.space?.ref ?? '—',
          })
        })

        // Contracts expiring in next 60 days
        const sixtyDaysFromNow = new Date()
        sixtyDaysFromNow.setDate(sixtyDaysFromNow.getDate() + 60)
        leases?.filter(l => l.end_date && new Date(l.end_date) <= sixtyDaysFromNow).forEach(l => {
          alerts.push({
            id: `contract-${l.id}`,
            type: 'expiring_contract',
            message: `Contrato termina em ${new Date(l.end_date!).toLocaleDateString('pt-PT')}`,
            tenant_name: l.tenant?.name ?? '—',
            space_ref: l.space?.ref ?? '—',
          })
        })

        setStats({
          totalSpaces,
          occupiedSpaces,
          totalTenantsActive,
          monthlyRentExpected,
          monthlyRentReceived,
          pendingRents,
          cashFundBalance,
          recentAlerts: alerts.slice(0, 8),
        })
      } catch (error) {
        console.error(error)
      } finally {
        setLoading(false)
      }
    }
    fetchStats()
  }, [])

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
        </div>
      </AppLayout>
    )
  }

  const occupancyRate = stats.totalSpaces > 0
    ? Math.round((stats.occupiedSpaces / stats.totalSpaces) * 100)
    : 0

  const collectionRate = stats.monthlyRentExpected > 0
    ? Math.round((stats.monthlyRentReceived / stats.monthlyRentExpected) * 100)
    : 0

  return (
    <AppLayout>
      <div className="p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">{getMonthLabel(currentMonth)}</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-4 gap-5 mb-8">
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-500">Espaços Ocupados</p>
              <div className="w-9 h-9 bg-emerald-50 rounded-lg flex items-center justify-center">
                <Building2 className="w-4 h-4 text-emerald-600" />
              </div>
            </div>
            <p className="text-2xl font-bold text-gray-900">{stats.occupiedSpaces}<span className="text-lg text-gray-400">/{stats.totalSpaces}</span></p>
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
            <p className="text-xs text-gray-500 mt-1">de {formatCurrency(stats.monthlyRentExpected)} esperados ({collectionRate}%)</p>
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

        {/* Two-column layout */}
        <div className="grid grid-cols-2 gap-6">
          {/* Pending rents */}
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
                {stats.recentAlerts
                  .filter(a => a.type === 'late_rent')
                  .slice(0, 6)
                  .map(alert => (
                    <div key={alert.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                      <div className="w-8 h-8 bg-red-50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Clock className="w-4 h-4 text-red-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-800">{alert.tenant_name}</p>
                        <p className="text-xs text-gray-500">{alert.space_ref} · {alert.message}</p>
                      </div>
                    </div>
                  ))}
              </div>
            )}
            <Link href="/pagamentos" className="mt-4 text-xs text-emerald-600 hover:underline font-medium block">
              Ver todos os pagamentos →
            </Link>
          </div>

          {/* Alerts */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">Alertas</h2>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-yellow-100 text-yellow-700">
                {stats.recentAlerts.length} alertas
              </span>
            </div>
            {stats.recentAlerts.length === 0 ? (
              <div className="flex items-center gap-2 text-emerald-600 text-sm py-4">
                <CheckCircle className="w-5 h-5" />
                Sem alertas ativos
              </div>
            ) : (
              <div className="space-y-2">
                {stats.recentAlerts.map(alert => (
                  <div key={alert.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${alert.type === 'late_rent' ? 'bg-red-50' : 'bg-yellow-50'}`}>
                      <AlertTriangle className={`w-4 h-4 ${alert.type === 'late_rent' ? 'text-red-500' : 'text-yellow-500'}`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-800">{alert.tenant_name}</p>
                      <p className="text-xs text-gray-500">{alert.space_ref} · {alert.message}</p>
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

function getNextMonth(dateString: string): string {
  const d = new Date(dateString)
  d.setMonth(d.getMonth() + 1)
  return d.toISOString().slice(0, 10)
}
