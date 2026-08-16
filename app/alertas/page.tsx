'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, formatDate, getMonthLabel, getCurrentMonth } from '@/lib/utils'

function calcNextRenewal(startDate: string, endDate: string): Date {
  const start = new Date(startDate)
  const end = new Date(endDate)
  const today = new Date()
  if (end > today) return end

  const durationYears = Math.max(1, Math.round(
    (end.getFullYear() - start.getFullYear()) +
    (end.getMonth() - start.getMonth()) / 12
  ))

  let renewal = new Date(end)
  while (renewal <= today) {
    renewal = new Date(renewal)
    renewal.setFullYear(renewal.getFullYear() + durationYears)
  }
  return renewal
}
import { AlertTriangle, Clock, FileText, CheckCircle, Zap, X, Bell, NotebookPen, ArrowRightLeft } from 'lucide-react'
import Link from 'next/link'

interface AlertItem {
  id: string
  type: 'renda_em_falta' | 'contrato_a_expirar' | 'luz_pendente' | 'transferencia_pendente'
  severity: 'high' | 'medium' | 'low'
  title: string
  description: string
  spaceRef: string
  tenantName: string
  value?: number
}

export default function AlertasPage() {
  const supabase = createClient()
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [showDismissed, setShowDismissed] = useState(false)
  const [manualAlerts, setManualAlerts] = useState<any[]>([])

  async function fetchManualAlerts() {
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
    await supabase.from('notes').update({
      reminder_seen_at: new Date().toISOString(),
    }).eq('id', id)
    fetchManualAlerts()
  }

  async function fetchAlerts() {
    setLoading(true)
    const currentMonth = getCurrentMonth()
    const nextMonth = new Date(currentMonth)
    nextMonth.setMonth(nextMonth.getMonth() + 1)
    const nextMonthStr = nextMonth.toISOString().slice(0, 10)

    const { data: leases } = await supabase
      .from('leases')
      .select('*, space:spaces(*), tenant:tenants(*)')
      .eq('status', 'ativo')

    const { data: payments } = await supabase
      .from('rent_payments')
      .select('*')
      .gte('reference_month', currentMonth)
      .lt('reference_month', nextMonthStr)

    const { data: elec } = await supabase
      .from('electricity_charges')
      .select('*, lease:leases(*, space:spaces(*), tenant:tenants(*))')
      .eq('paid', false)

    const { data: cashTransfers } = await supabase
      .from('cash_fund_movements')
      .select('id, movement_date, description, amount')
      .eq('transfer_status', 'pendente')

    const { data: dismissedData } = await supabase
      .from('dismissed_alerts')
      .select('alert_key')

    const dismissedKeys = new Set((dismissedData ?? []).map(d => d.alert_key))
    setDismissed(dismissedKeys)

    const newAlerts: AlertItem[] = []
    // Um pagamento parcial não liquida o mês — o alerta mantém-se até
    // o total recebido cobrir a renda.
    const paidByLease = new Map<string, number>()
    for (const p of (payments ?? []).filter(p => p.tipo === 'renda' || !p.tipo)) {
      paidByLease.set(p.lease_id, (paidByLease.get(p.lease_id) ?? 0) + (p.amount ?? 0))
    }

    // Rendas em falta (total ou parcial)
    ;(leases ?? []).forEach(l => {
      if (l.monthly_rent <= 0) return
      const recebido = paidByLease.get(l.id) ?? 0
      const emFalta = parseFloat((l.monthly_rent - recebido).toFixed(2))
      if (emFalta < 0.01) return

      newAlerts.push({
        id: `rent-${l.id}`,
        type: 'renda_em_falta',
        severity: 'high',
        title: recebido > 0 ? 'Renda paga em parte' : 'Renda por receber',
        description: recebido > 0
          ? `Renda de ${getMonthLabel(currentMonth)}: recebidos ${formatCurrency(recebido)} de ${formatCurrency(l.monthly_rent)}`
          : `Renda de ${getMonthLabel(currentMonth)} ainda não foi registada`,
        spaceRef: l.space?.ref ?? '—',
        tenantName: l.tenant?.name ?? '—',
        value: emFalta,
      })
    })

    // Contratos a renovar (baseado na próxima data de renovação)
    const oneEightyDays = new Date()
    oneEightyDays.setDate(oneEightyDays.getDate() + 180)
    ;(leases ?? []).filter(l => l.end_date && l.start_date).forEach(l => {
      const renewal = calcNextRenewal(l.start_date, l.end_date)
      if (renewal <= oneEightyDays) {
        const daysLeft = Math.ceil((renewal.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        const isRenewed = new Date(l.end_date) < new Date()
        newAlerts.push({
          id: `contract-${l.id}`,
          type: 'contrato_a_expirar',
          severity: daysLeft <= 30 ? 'high' : daysLeft <= 90 ? 'medium' : 'low',
          title: isRenewed ? 'Contrato a renovar' : 'Contrato a expirar',
          description: `${isRenewed ? 'Próxima renovação' : 'Contrato termina'} em ${formatDate(renewal)} (em ${daysLeft} dias)`,
          spaceRef: l.space?.ref ?? '—',
          tenantName: l.tenant?.name ?? '—',
        })
      }
    })

    // Luz pendente
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

    // Transferências do fundo de maneio que saíram da caixa mas ainda não
    // apareceram no extrato bancário. Só alerta ao fim de 7 dias, para dar
    // tempo à transferência de ser processada pelo banco.
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    ;(cashTransfers ?? []).forEach(t => {
      if (new Date(t.movement_date) > sevenDaysAgo) return
      const daysWaiting = Math.floor((Date.now() - new Date(t.movement_date).getTime()) / (1000 * 60 * 60 * 24))
      newAlerts.push({
        id: `transfer-${t.id}`,
        type: 'transferencia_pendente',
        severity: daysWaiting > 30 ? 'high' : 'medium',
        title: 'Transferência por confirmar',
        description: `Saiu do fundo de maneio há ${daysWaiting} dias e ainda não apareceu no extrato bancário`,
        spaceRef: '—',
        tenantName: t.description ?? 'Transferência para banco',
        value: Math.abs(t.amount),
      })
    })

    newAlerts.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 }
      return order[a.severity] - order[b.severity]
    })

    setAlerts(newAlerts)
    setLoading(false)
  }

  async function dismissAlert(alertId: string) {
    await supabase.from('dismissed_alerts').upsert({ alert_key: alertId })
    setDismissed(prev => new Set([...prev, alertId]))
  }

  async function restoreAlert(alertId: string) {
    await supabase.from('dismissed_alerts').delete().eq('alert_key', alertId)
    setDismissed(prev => {
      const next = new Set(prev)
      next.delete(alertId)
      return next
    })
  }

  const activeAlerts = alerts.filter(a => !dismissed.has(a.id))
  const dismissedAlerts = alerts.filter(a => dismissed.has(a.id))

  const severityConfig = {
    high: { bg: 'bg-red-50 border-red-100', icon: 'text-red-500', badge: 'bg-red-100 text-red-700', label: 'Urgente' },
    medium: { bg: 'bg-yellow-50 border-yellow-100', icon: 'text-yellow-500', badge: 'bg-yellow-100 text-yellow-700', label: 'Atenção' },
    low: { bg: 'bg-blue-50 border-blue-100', icon: 'text-blue-500', badge: 'bg-blue-100 text-blue-700', label: 'Info' },
  }

  const typeIcon = (type: string) => {
    if (type === 'renda_em_falta') return <Clock className="w-5 h-5" />
    if (type === 'contrato_a_expirar') return <FileText className="w-5 h-5" />
    if (type === 'transferencia_pendente') return <ArrowRightLeft className="w-5 h-5" />
    return <Zap className="w-5 h-5" />
  }

  const NOTE_TYPE_LABELS: Record<string, string> = {
    chamada: '📞 Chamada',
    geral: '🏡 Geral',
    lembrete: '⏰ Lembrete',
    outro: '📝 Outro',
  }

  const highCount = activeAlerts.filter(a => a.severity === 'high').length
  const medCount = activeAlerts.filter(a => a.severity === 'medium').length

  useEffect(() => { fetchAlerts(); fetchManualAlerts() }, [])

  return (
    <AppLayout>
      <div className="p-4 md:p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Alertas</h1>
          <p className="text-sm text-gray-500 mt-1">{activeAlerts.length} alertas automáticos · {manualAlerts.length} lembretes manuais</p>
        </div>

        {/* Cards resumo */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="card border-l-4 border-l-red-500">
            <p className="text-sm text-gray-500">Urgentes</p>
            <p className="text-2xl font-bold text-red-600">{highCount}</p>
          </div>
          <div className="card border-l-4 border-l-yellow-500">
            <p className="text-sm text-gray-500">Atenção</p>
            <p className="text-2xl font-bold text-yellow-600">{medCount}</p>
          </div>
          <div className="card border-l-4 border-l-purple-500">
            <p className="text-sm text-gray-500">Lembretes Manuais</p>
            <p className="text-2xl font-bold text-purple-600">{manualAlerts.length}</p>
          </div>
        </div>

        {/* ===== SECÇÃO: LEMBRETES MANUAIS ===== */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <NotebookPen className="w-5 h-5 text-purple-600" />
              <h2 className="text-lg font-semibold text-gray-900">Lembretes Manuais</h2>
              {manualAlerts.length > 0 && (
                <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                  {manualAlerts.length} pendente(s)
                </span>
              )}
            </div>
            <Link href="/notas" prefetch={false}
              className="text-xs text-emerald-600 hover:underline font-medium">
              Ver todas as notas →
            </Link>
          </div>

          {manualAlerts.length === 0 ? (
            <div className="bg-gray-50 border border-gray-100 rounded-xl p-6 text-center text-gray-400">
              <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Sem lembretes manuais pendentes.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {manualAlerts.map(note => {
                const isOverdue = note.reminder_date < new Date().toISOString().slice(0, 10)
                return (
                  <div key={note.id}
                    className={`rounded-xl border p-4 flex items-start gap-4 ${isOverdue ? 'bg-red-50 border-red-100' : 'bg-purple-50 border-purple-100'}`}>
                    <div className={`w-9 h-9 rounded-lg bg-white flex items-center justify-center flex-shrink-0 ${isOverdue ? 'text-red-500' : 'text-purple-500'}`}>
                      <Bell className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isOverdue ? 'bg-red-100 text-red-700' : 'bg-purple-100 text-purple-700'}`}>
                          {isOverdue ? '⚠️ Em atraso' : '🔔 Hoje'}
                        </span>
                        <span className="text-xs bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
                          {NOTE_TYPE_LABELS[note.type] ?? note.type}
                        </span>
                        {note.space?.ref && (
                          <span className="text-xs bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
                            {note.space.ref}{note.tenant?.name ? ` — ${note.tenant.name}` : ''}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-gray-900">{note.title}</p>
                      {note.description && (
                        <p className="text-xs text-gray-500 mt-0.5">{note.description}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        Lembrete: {formatDate(note.reminder_date)} às {note.reminder_time?.slice(0, 5)}
                      </p>
                    </div>
                    <button onClick={() => handleMarkSeen(note.id)}
                      title="Marcar como visto"
                      className="flex items-center gap-1 text-xs bg-white border border-gray-200 text-gray-600 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200 px-2 py-1.5 rounded-lg transition-colors flex-shrink-0">
                      <CheckCircle className="w-3.5 h-3.5" /> Visto
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ===== SECÇÃO: ALERTAS AUTOMÁTICOS ===== */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-yellow-500" />
            <h2 className="text-lg font-semibold text-gray-900">Alertas Automáticos</h2>
            {activeAlerts.length > 0 && (
              <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">
                {activeAlerts.length} ativo(s)
              </span>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
            </div>
          ) : activeAlerts.length === 0 ? (
            <div className="card flex flex-col items-center py-12">
              <CheckCircle className="w-12 h-12 text-emerald-500 mb-3" />
              <p className="text-lg font-semibold text-gray-700">Tudo em ordem!</p>
              <p className="text-sm text-gray-500 mt-1">Não existem alertas automáticos ativos</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeAlerts.map(alert => {
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
                    <button onClick={() => dismissAlert(alert.id)} title="Dispensar alerta"
                      className="text-gray-400 hover:text-gray-600 flex-shrink-0 mt-0.5 transition-colors">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Alertas dispensados */}
          {dismissedAlerts.length > 0 && (
            <div className="mt-6">
              <button onClick={() => setShowDismissed(v => !v)}
                className="text-sm text-gray-400 hover:text-gray-600 underline">
                {showDismissed ? 'Ocultar' : `Mostrar ${dismissedAlerts.length} alerta(s) dispensado(s)`}
              </button>
              {showDismissed && (
                <div className="space-y-2 mt-3">
                  {dismissedAlerts.map(alert => (
                    <div key={alert.id} className="rounded-xl border border-gray-100 bg-gray-50 p-4 flex items-start gap-4 opacity-60">
                      <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center flex-shrink-0 text-gray-400">
                        {typeIcon(alert.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-600">{alert.title} — {alert.spaceRef}</p>
                        <p className="text-xs text-gray-500">{alert.tenantName} — {alert.description}</p>
                      </div>
                      <button onClick={() => restoreAlert(alert.id)}
                        className="text-xs text-emerald-600 hover:underline flex-shrink-0">
                        Reativar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
