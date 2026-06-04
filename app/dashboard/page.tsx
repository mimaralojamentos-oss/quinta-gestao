'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, getMonthLabel, getCurrentMonth } from '@/lib/utils'
import { Building2, Users, AlertTriangle, CheckCircle, Clock, HardHat, Zap } from 'lucide-react'
import Link from 'next/link'

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalSpaces: 0, occupiedSpaces: 0, totalTenantsActive: 0,
    pendingRents: 0, activeProjects: 0,
    pendingLeases: [] as any[], alerts: [] as any[],
    meters: [] as any[],
  })
  const [loading, setLoading] = useState(true)
  const currentMonth = getCurrentMonth()

  useEffect(() => { fetchStats() }, [])

  async function fetchStats() {
    try {
      const supabase = createClient()
      const nextMonth = new Date(currentMonth)
      nextMonth.setMonth(nextMonth.getMonth() + 1)
      const nextMonthStr = nextMonth.toISOString().slice(0, 10)

      const [spacesRes, leasesRes, paymentsRes, projectsRes, metersRes, edpExpensesRes] = await Promise.all([
        supabase.from('spaces').select('id, status'),
        supabase.from('leases').select('id, monthly_rent, space:spaces(ref), tenant:tenants(name, phone)').eq('status', 'ativo'),
        supabase.from('rent_payments').select('lease_id, amount, tipo').gte('reference_month', currentMonth).lt('reference_month', nextMonthStr),
        supabase.from('projects').select('id, status').eq('status', 'em_curso'),
        supabase.from('meters').select('id, name, contract_number').eq('active', true).order('name'),
        supabase.from('expenses')
          .select('id, expense_date, amount, description, supplier')
          .or('supplier.ilike.%EDP%,description.ilike.%EDP%')
          .order('expense_date', { ascending: false })
          .limit(100),
      ])

      const spaces = spacesRes.data ?? []
      const leases = leasesRes.data ?? []
      const payments = paymentsRes.data ?? []
      const projects = projectsRes.data ?? []
      const metersData = metersRes.data ?? []
      const edpExpenses = edpExpensesRes.data ?? []

      // Para cada quadro, encontrar a última fatura EDP correspondente
      const meters = metersData.map(meter => {
        // Palavras-chave para identificar este quadro nas despesas
        // Extrair partes do nome para fazer match (ex: "9002", "9005", "Monte Trigo")
        const keywords = [
          meter.contract_number,
          meter.name,
          // Extrair número do quadro se existir (ex: "9002" de "Quadro 9002 - Tia")
          ...meter.name.match(/\d{4,}/g) ?? [],
          // Primeiras palavras do nome (ex: "Monte Trigo")
          ...meter.name.split(' ').filter((w: string) => w.length > 3),
        ].filter(Boolean).map((k: string) => k.toLowerCase())

        const lastExpense = edpExpenses.find(e => {
          const haystack = `${e.description ?? ''} ${e.supplier ?? ''}`.toLowerCase()
          return keywords.some(kw => haystack.includes(kw))
        })

        return {
          ...meter,
          lastExpenseDate: lastExpense?.expense_date ?? null,
          lastExpenseAmount: lastExpense?.amount ?? null,
        }
      })

      const paidLeaseIds = new Set(
        payments.filter(p => p.tipo === 'renda' || !p.tipo).map(p => p.lease_id)
      )
      const pendingLeases = leases.filter(l => !paidLeaseIds.has(l.id))

      setStats({
        totalSpaces: spaces.length,
        occupiedSpaces: spaces.filter(s => s.status === 'arrendado').length,
        totalTenantsActive: leases.length,
        pendingRents: pendingLeases.length,
        activeProjects: projects.length,
        pendingLeases,
        alerts: pendingLeases,
        meters,
      })
    } catch (e) {
      console.error('Dashboard error:', e)
    } finally {
      setLoading(false)
    }
  }

  const occupancyRate = stats.totalSpaces > 0
    ? Math.round((stats.occupiedSpaces / stats.totalSpaces) * 100) : 0

  function formatExpenseDate(dateStr: string) {
    const d = new Date(dateStr)
    return d.toLocaleDateString('pt-PT', { month: 'short', year: 'numeric' })
  }

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
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">{getMonthLabel(currentMonth)}</p>
        </div>

        {/* Cards compactos do topo */}
        <div className="grid grid-cols-4 gap-3 mb-6">

          {/* Espaços */}
          <div className="bg-white border border-gray-100 rounded-lg shadow-sm px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <Building2 className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-gray-400">Espaços Ocupados</p>
              <p className="text-base font-bold text-gray-900">
                {stats.occupiedSpaces}<span className="text-sm text-gray-400">/{stats.totalSpaces}</span>
              </p>
              <p className="text-xs text-emerald-600 font-medium">{occupancyRate}% ocupação</p>
            </div>
          </div>

          {/* Inquilinos */}
          <div className="bg-white border border-gray-100 rounded-lg shadow-sm px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <Users className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-gray-400">Inquilinos Ativos</p>
              <p className="text-base font-bold text-gray-900">{stats.totalTenantsActive}</p>
              <p className="text-xs text-blue-600 font-medium">contratos ativos</p>
            </div>
          </div>

          {/* Projetos */}
          <div className="bg-white border border-gray-100 rounded-lg shadow-sm px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 bg-orange-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <HardHat className="w-4 h-4 text-orange-500" />
            </div>
            <div>
              <p className="text-xs text-gray-400">Projetos Ativos</p>
              <p className="text-base font-bold text-gray-900">{stats.activeProjects}</p>
              <p className="text-xs text-orange-500 font-medium">em curso</p>
            </div>
          </div>

          {/* Quadros EDP */}
          <div className="bg-white border border-gray-100 rounded-lg shadow-sm px-4 py-3 flex items-start gap-3">
            <div className="w-8 h-8 bg-yellow-50 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
              <Zap className="w-4 h-4 text-yellow-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-400 mb-1.5">Quadros EDP</p>
              {stats.meters.length === 0 ? (
                <p className="text-xs text-gray-400">Sem quadros</p>
              ) : (
                <div className="space-y-1.5">
                  {stats.meters.map(meter => (
                    <div key={meter.id} className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-gray-700 truncate">{meter.name}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {meter.lastExpenseDate ? (
                          <>
                            <span className="text-xs text-gray-400">{formatExpenseDate(meter.lastExpenseDate)}</span>
                            <span className="text-xs font-semibold text-gray-700">· {formatCurrency(meter.lastExpenseAmount)}</span>
                          </>
                        ) : (
                          <span className="text-xs text-gray-300">sem fatura</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Corpo: Rendas Pendentes + Alertas */}
        <div className="grid grid-cols-2 gap-6">

          {/* Rendas Pendentes */}
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
              <div className="space-y-1">
                {stats.pendingLeases.map((lease: any) => (
                  <div key={lease.id} className="flex items-center gap-3 py-1.5 border-b border-gray-50 last:border-0">
                    <div className="w-7 h-7 bg-red-50 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Clock className="w-3.5 h-3.5 text-red-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-800">{lease.tenant?.name}</p>
                      <p className="text-xs text-gray-500">{lease.space?.ref} · Renda de {getMonthLabel(currentMonth)} por receber</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Link prefetch={false} href="/pagamentos" className="mt-3 text-xs text-emerald-600 hover:underline font-medium block">
              Ver todos os pagamentos →
            </Link>
          </div>

          {/* Alertas */}
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
              <div className="space-y-1">
                {stats.alerts.map((lease: any) => (
                  <div key={lease.id} className="flex items-center gap-3 py-1.5 border-b border-gray-50 last:border-0">
                    <div className="w-7 h-7 bg-yellow-50 rounded-lg flex items-center justify-center flex-shrink-0">
                      <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-800">{lease.tenant?.name}</p>
                      <p className="text-xs text-gray-500">{lease.space?.ref} · Renda em atraso</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Link prefetch={false} href="/alertas" className="mt-3 text-xs text-emerald-600 hover:underline font-medium block">
              Ver todos os alertas →
            </Link>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
