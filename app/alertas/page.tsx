'use client'

export const dynamic = 'force-dynamic'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate, getMonthLabel, getCurrentMonth } from '@/lib/utils'
import { AlertTriangle, Clock, FileText, CheckCircle, Zap } from 'lucide-react'

interface AlertItem {
  id: string
  type: 'renda_em_falta' | 'contrato_a_expirar' | 'luz_pendente'
  severity: 'high' | 'medium' | 'low'
  title: string
  description: string
  spaceRef: string
  tenantName: string
  value?: number
}

export default function AlertasPage() {
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchAlerts() }, [])

  async function fetchAlerts() {
    setLoading(true)
    const currentMonth = getCurrentMonth()
    const nextMonth = new Date(currentMonth)
    nextMonth.setMonth(nextMonth.getMonth() + 1)
    const nextMonthStr = nextMonth.toISOString().slice(0, 10)

    // Active leases
    const { data: leases } = await supabase
      .from('leases')
      .select('*, space:spaces(*), tenant:tenants(*)')
      .eq('status', 'ativo')

    // Payments this month
    const { data: payments } = await supabase
      .from('rent_payments')
      .select('*')
      .gte('reference_month', currentMonth)
      .lt('reference_month', nextMonthStr)

    // Unpaid electricity
    const { data: elec } = await supabase
      .from('electricity_charges')
      .select('*, lease:leases(*, space:spaces(*), tenant:tenants(*))')
      .eq('paid', false)

    const newAlerts: AlertItem[] = []
    const paidLeaseIds = new Set((payments ?? []).map(p => p.lease_id))

    // Unpaid rents
    ;(leases ?? []).forEach(l => {
      if (!paidLeaseIds.has(l.id)) {
        newAlerts.push({
          id: `rent-${l.id}`,
          type: 'renda_em_falta',
          severity: 'high',
          title: 'Renda por receber',
          description: `Renda de ${getMonthLabel(currentMonth)} ainda não foi registada`,
          spaceRef: l.space?.ref ?? '—',
          tenantName: l.tenant?.name ?? '—',
          value: l.monthly_rent,
        })
      }
    })

    // Contracts expiring in 90 days
    const ninetyDays = new Date()
    ninetyDays.setDate(ninetyDays.getDate() + 90)
    ;(leases ?? []).filter(l => l.end_date).forEach(l => {
      const endDate = new Date(l.end_date)
      if (endDate <= ninetyDays) {
        const daysLeft = Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        newAlerts.push({
          id: `contract-${l.id}`,
          type: 'contrato_a_expirar',
          severity: daysLeft <= 30 ? 'high' : 'medium',
          title: 'Contrato a expirar',
          description: `Contrato termina em ${formatDate(l.end_date)} (${daysLeft > 0 ? `em ${daysLeft} dias` : 'EXPIRADO'})`,
          spaceRef: l.space?.ref ?? '—',
          tenantName: l.tenant?.name ?? '—',
        })
      }
    })

    // Unpaid electricity
    ;(elec ?? []).forEach(c => {
      newAlerts.push({
        id: `elec-${c.id}`,
        type: 'luz_pendente',
        severity: 'medium',
        title: 'Luz por pagar',
        description: `Cobrança de eletricidade de ${formatDate(c.charge_date)} não paga`,
        spaceRef: c.lease?.space?.ref ?? '—',
        tenantName: c.lease?.tenant?.name ?? '—',
        value: c.amount,
      })
    })

    // Sort by severity
    newAlerts.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 }
      return order[a.severity] - order[b.severity]
    })

    setAlerts(newAlerts)
    setLoading(false)
  }

  const severityConfig = {
    high: { bg: 'bg-red-50 border-red-100', icon: 'text-red-500', badge: 'bg-red-100 text-red-700', label: 'Urgente' },
    medium: { bg: 'bg-yellow-50 border-yellow-100', icon: 'text-yellow-500', badge: 'bg-yellow-100 text-yellow-700', label: 'Atenção' },
    low: { bg: 'bg-blue-50 border-blue-100', icon: 'text-blue-500', badge: 'bg-blue-100 text-blue-700', label: 'Info' },
  }

  const typeIcon = (type: string) => {
    if (type === 'renda_em_falta') return <Clock className="w-5 h-5" />
    if (type === 'contrato_a_expirar') return <FileText className="w-5 h-5" />
    return <Zap className="w-5 h-5" />
  }

  const highCount = alerts.filter(a => a.severity === 'high').length
  const medCount = alerts.filter(a => a.severity === 'medium').length

  return (
    <AppLayout>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Alertas</h1>
          <p className="text-sm text-gray-500 mt-1">{alerts.length} alertas ativos</p>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="card border-l-4 border-l-red-500">
            <p className="text-sm text-gray-500">Urgentes</p>
            <p className="text-2xl font-bold text-red-600">{highCount}</p>
          </div>
          <div className="card border-l-4 border-l-yellow-500">
            <p className="text-sm text-gray-500">Atenção</p>
            <p className="text-2xl font-bold text-yellow-600">{medCount}</p>
          </div>
          <div className="card border-l-4 border-l-emerald-500">
            <p className="text-sm text-gray-500">Total</p>
            <p className="text-2xl font-bold text-gray-800">{alerts.length}</p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
          </div>
        ) : alerts.length === 0 ? (
          <div className="card flex flex-col items-center py-16">
            <CheckCircle className="w-12 h-12 text-emerald-500 mb-3" />
            <p className="text-lg font-semibold text-gray-700">Tudo em ordem!</p>
            <p className="text-sm text-gray-500 mt-1">Não existem alertas ativos neste momento</p>
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map(alert => {
              const config = severityConfig[alert.severity]
              return (
                <div key={alert.id} className={`rounded-xl border p-4 ${config.bg} flex items-start gap-4`}>
                  <div className={`w-10 h-10 rounded-lg bg-white flex items-center justify-center flex-shrink-0 ${config.icon}`}>
                    {typeIcon(alert.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${config.badge}`}>
                        {config.label}
                      </span>
                      <span className="text-sm font-semibold text-gray-800">{alert.title}</span>
                      <span className="badge-cinza">{alert.spaceRef}</span>
                    </div>
                    <p className="text-sm text-gray-700">{alert.tenantName} — {alert.description}</p>
                    {alert.value && (
                      <p className="text-sm font-semibold text-gray-800 mt-1">{formatCurrency(alert.value)}</p>
                    )}
                  </div>
                  <AlertTriangle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${config.icon}`} />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
