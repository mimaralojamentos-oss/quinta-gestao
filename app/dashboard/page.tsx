'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, getMonthLabel, getCurrentMonth, formatDate } from '@/lib/utils'
import { Building2, Users, AlertTriangle, CheckCircle, Clock, HardHat, Zap, Bell, NotebookPen } from 'lucide-react'
import Link from 'next/link'

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalSpaces: 0, occupiedSpaces: 0, totalTenantsActive: 0,
    pendingRents: 0, activeProjects: 0,
    pendingLeases: [] as any[], alerts: [] as any[],
    meters: [] as any[],
  })
  const [manualAlerts, setManualAlerts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const currentMonth = getCurrentMonth()

  async function fetchManualAlerts() {
    const supabase = createClient()
    const todayStr = new Date().toISOString().slice(0, 10)
    const { data } = await supabase
      .from('notes')
      .select('*, space:spaces(ref), tenant:tenants(name)')
      .eq('has_reminder', true)
      .eq('dismissed', false)
      .is('reminder_seen_at', null)
      .lte('reminder_date', todayStr)
      .order('reminder_date', { ascending: true })
    setManualAlerts(data ?? [])
  }

  async function handleMarkSeen(id: string) {
    const supabase = createClient()
    await supabase.from('notes').update({
      reminder_seen_at: new Date().toISOString(),
    }).eq('id', id)
    fetchManualAlerts()
  }

  async function fetchStats() {
    try {
      const supabase = createClient()
      const nextMonth = new Date(currentMonth)
      nextMonth.setMonth(nextMonth.getMonth() + 1)
      const nextMonthStr = nextMonth.toISOString().slice(0, 10)

      const [spacesRes, leasesRes, paymentsRes, projectsRes, metersRes, meterReadingsRes] = await Promise.all([
        supabase.from('spaces').select('id, status'),
        supabase.from('leases').select('id, monthly_rent, space:spaces(ref), tenant:tenants(name, phone)').eq('status', 'ativo'),
        supabase.from('rent_payments').select('lease_id, amount, tipo').gte('reference_month', currentMonth).lt('reference_month', nextMonthStr),
        supabase.from('projects').select('id, status').eq('status', 'em_curso'),
        supabase.from('meters').select('id, name, contract_number').eq('active', true).order('name'),
        supabase.from('meter_readings').select('meter_id, reading_date, invoice_amount').order('reading_date', { ascending: false }),
      ])

      const spaces = spacesRes.data ?? []
      const leases = leasesRes.data ?? []
      const payments = paymentsRes.data ?? []
      const projects = projectsRes.data ?? []
      const metersData = metersRes.data ?? []
      const allMeterReadings = meterReadingsRes.data ?? []

      const meters = metersData.map(meter => {
        const lastReading = allMeterReadings.find(r => r.meter_id === meter.id)
        return { ...meter, lastReadingDate: lastReading?.reading_date ?? null, lastReadingAmount: lastReading?.invoice_amount ?? null }
      })

      // Um pagamento parcial não liquida o mês: continua pendente enquanto
      // o total recebido for inferior à renda.
      const paidByLease = new Map<string, number>()
      for (const p of payments.filter(p => p.tipo === 'renda' || !p.tipo)) {
        paidByLease.set(p.lease_id, (paidByLease.get(p.lease_id) ?? 0) + (p.amount ?? 0))
      }
      const pendingLeases = leases.filter(l =>
        l.monthly_rent > 0 && (paidByLease.get(l.id) ?? 0) < l.monthly_rent - 0.01
      )

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

  useEffect(() => { fetchStats(); fetchManualAlerts() }, [])

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
        </div>
      </AppLayout>
    )
  }

  const NOTE_TYPE_LABELS: Record<string, string> = {
    chamada: '📞 Chamada',
    geral: '🏡 Geral',
    lembrete: '⏰ Lembrete',
    outro: '📝 Outro',
  }

  return (
    <AppLayout>
      <div className="p-4 md:p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">{getMonthLabel(currentMonth)}</p>
        </div>

        {/* Cards compactos do topo */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
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

          <div className="bg-white border border-gray-100 rounded-lg shadow-sm px-4 py-3 flex items-start gap-3">
            <div className="w-8 h-8 bg-yellow-50 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
              <Zap className="w-4 h-4 text-yellow-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-400 mb-1.5">Quadros EDP</p>
              {stats.meters.length === 0 ? (
                <p className="text-xs text-gray-400">Sem quadros</p>
              ) : (
                <div className="space-y-1">
                  {stats.meters.map(meter => (
                    <div key={meter.id} className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-gray-700 truncate">{meter.name}</span>
                      <div className="text-right flex-shrink-0">
                        {meter.lastReadingDate ? (
                          <span className="text-xs text-gray-400">{formatCurrency(meter.lastReadingAmount ?? 0)}</span>
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

        {/* Lembretes Manuais — só aparece se houver pendentes */}
        {manualAlerts.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <NotebookPen className="w-5 h-5 text-purple-600" />
                <h2 className="font-semibold text-gray-900">Lembretes Manuais</h2>
                <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                  {manualAlerts.length} pendente(s)
                </span>
              </div>
              <Link href="/notas" prefetch={false} className="text-xs text-emerald-600 hover:underline font-medium">
                Ver todas as notas →
              </Link>
            </div>
            <div className="space-y-2">
              {manualAlerts.map(note => {
                const isOverdue = note.reminder_date < new Date().toISOString().slice(0, 10)
                return (
                  <div key={note.id}
                    className={`rounded-xl border p-3 flex items-center gap-3 ${isOverdue ? 'bg-red-50 border-red-100' : 'bg-purple-50 border-purple-100'}`}>
                    <div className={`w-8 h-8 rounded-lg bg-white flex items-center justify-center flex-shrink-0 ${isOverdue ? 'text-red-500' : 'text-purple-500'}`}>
                      <Bell className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${isOverdue ? 'bg-red-100 text-red-700' : 'bg-purple-100 text-purple-700'}`}>
                          {isOverdue ? '⚠️ Em atraso' : '🔔 Hoje'}
                        </span>
                        <span className="text-xs text-gray-500">{NOTE_TYPE_LABELS[note.type] ?? note.type}</span>
                        {note.space?.ref && <span className="text-xs text-gray-400">{note.space.ref}{note.tenant?.name ? ` — ${note.tenant.name}` : ''}</span>}
                      </div>
                      <p className="text-sm font-medium text-gray-800 truncate">{note.title}</p>
                      <p className="text-xs text-gray-400">{formatDate(note.reminder_date)} às {note.reminder_time?.slice(0, 5)}</p>
                    </div>
                    <button onClick={() => handleMarkSeen(note.id)}
                      className="flex items-center gap-1 text-xs bg-white border border-gray-200 text-gray-600 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200 px-2 py-1.5 rounded-lg transition-colors flex-shrink-0">
                      <CheckCircle className="w-3.5 h-3.5" /> Visto
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Corpo: Rendas Pendentes + Alertas */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
