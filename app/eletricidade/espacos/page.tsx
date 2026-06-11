'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Zap, Trash2, X, ChevronDown, ChevronRight, Settings, Save, Pencil } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

interface ElectricityConfig {
  id: number
  price_per_kwh: number
  vat_rate: number
  min_charge: number
}

interface Space {
  id: string
  ref: string
  type: string
  has_own_meter: boolean
  tenant_id: string | null
  tenant: any
}

interface Reading {
  id: string
  space_id: string
  reading_date: string
  reading_value: number
  previous_value: number | null
  kwh_consumed: number | null
  amount_calculated: number | null
  charged: boolean
  accumulated: boolean
  notes: string | null
}

interface ReadingModal {
  space: Space
  lastReading: Reading | null
}

export default function QuadrosEspacosPage() {
  const { isAdmin, isCoAdmin, profile } = useAuth()
  const canEdit = isAdmin || isCoAdmin || profile?.role === 'electrician'
  const [spaces, setSpaces] = useState<Space[]>([])
  const [readings, setReadings] = useState<Record<string, Reading[]>>({})
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [readingModal, setReadingModal] = useState<ReadingModal | null>(null)
  const [editReadingModal, setEditReadingModal] = useState<Reading | null>(null)
  const [saving, setSaving] = useState(false)
  const [readingForm, setReadingForm] = useState({
    reading_date: new Date().toISOString().slice(0, 10),
    reading_value: '',
    notes: '',
  })
  const [editForm, setEditForm] = useState({
    reading_date: '',
    reading_value: '',
    notes: '',
  })
  const [editLeaseId, setEditLeaseId] = useState<string | null>(null)
  const [editAdvance, setEditAdvance] = useState(0)

  // Configurações
  const [config, setConfig] = useState<ElectricityConfig | null>(null)
  const [showConfig, setShowConfig] = useState(false)
  const [configForm, setConfigForm] = useState({
    price_per_kwh: '0.18',
    vat_rate: '23',
    min_charge: '5.00',
  })
  const [savingConfig, setSavingConfig] = useState(false)
  const [configSaved, setConfigSaved] = useState(false)

  const supabase = createClient()

  const pricePerKwh = config?.price_per_kwh ?? 0.18
  const vatRate = config?.vat_rate ?? 0.23
  const priceWithVat = pricePerKwh * (1 + vatRate)
  const minCharge = config?.min_charge ?? 5

  async function fetchConfig() {
    const { data } = await supabase.from('electricity_config').select('*').single()
    if (data) {
      setConfig(data)
      setConfigForm({
        price_per_kwh: data.price_per_kwh.toString(),
        vat_rate: (data.vat_rate * 100).toString(),
        min_charge: data.min_charge.toString(),
      })
    }
  }

  async function saveConfig() {
    if (!config) return
    setSavingConfig(true)
    await supabase.from('electricity_config').update({
      price_per_kwh: parseFloat(configForm.price_per_kwh),
      vat_rate: parseFloat(configForm.vat_rate) / 100,
      min_charge: parseFloat(configForm.min_charge),
      updated_at: new Date().toISOString(),
    }).eq('id', config.id)
    await fetchConfig()
    setSavingConfig(false)
    setConfigSaved(true)
    setTimeout(() => setConfigSaved(false), 3000)
  }

  async function fetchAll() {
    setLoading(true)
    const { data: spacesData } = await supabase
      .from('spaces')
      .select('id, ref, type, has_own_meter, tenant_id, tenant:tenants(name)')
      .eq('has_own_meter', false)
      .order('ref')

    setSpaces((spacesData ?? []) as any[])

    const allReadings: Record<string, Reading[]> = {}
    for (const s of spacesData ?? []) {
      const { data } = await supabase
        .from('electricity_readings')
        .select('*')
        .eq('space_id', s.id)
        .order('reading_date', { ascending: false })
      allReadings[s.id] = data ?? []
    }
    setReadings(allReadings)
    setLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchConfig()
    fetchAll()
  }, [])

  function getTenantName(tenant: any): string {
    if (!tenant) return ''
    if (Array.isArray(tenant)) return tenant[0]?.name ?? ''
    return tenant.name ?? ''
  }

  function getAccumulatedAmount(spaceId: string): number {
    const spaceReadings = readings[spaceId] ?? []
    let total = 0
    for (const r of [...spaceReadings].reverse()) {
      if (r.accumulated && !r.charged) {
        total += r.amount_calculated ?? 0
      } else if (r.charged) {
        total = 0
      }
    }
    return total
  }

  function openReadingModal(space: Space) {
    const spaceReadings = readings[space.id] ?? []
    const lastReading = spaceReadings[0] ?? null
    setReadingModal({ space, lastReading })
    setReadingForm({
      reading_date: new Date().toISOString().slice(0, 10),
      reading_value: '',
      notes: '',
    })
  }

  async function openEditModal(reading: Reading) {
    setEditReadingModal(reading)
    setEditForm({
      reading_date: reading.reading_date,
      reading_value: reading.reading_value.toString(),
      notes: reading.notes ?? '',
    })
    setEditLeaseId(null)
    setEditAdvance(0)

    if (!reading.charged) {
      const space = spaces.find(s => s.id === reading.space_id)
      if (space?.tenant_id) {
        const { data: lease } = await supabase
          .from('leases')
          .select('id')
          .eq('space_id', space.id)
          .eq('status', 'ativo')
          .single()
        if (lease) {
          setEditLeaseId(lease.id)
          const { data: advances } = await supabase
            .from('rent_payments')
            .select('amount')
            .eq('lease_id', lease.id)
            .eq('tipo', 'adiantamento')
            .eq('used', false)
          setEditAdvance((advances ?? []).reduce((sum, a) => sum + (a.amount ?? 0), 0))
        }
      }
    }
  }

  async function saveEditReading() {
    if (!editReadingModal || !editForm.reading_value) return
    setSaving(true)

    const newValue = parseFloat(editForm.reading_value)
    const prevValue = editReadingModal.previous_value
    const kwhConsumed = prevValue != null ? newValue - prevValue : editReadingModal.kwh_consumed
    const acc = editReadingModal.accumulated ? (editReadingModal.amount_calculated ?? 0) : 0
    const amountCalc = kwhConsumed != null ? parseFloat((kwhConsumed * priceWithVat).toFixed(2)) : editReadingModal.amount_calculated

    await supabase.from('electricity_readings').update({
      reading_date: editForm.reading_date,
      reading_value: newValue,
      kwh_consumed: kwhConsumed,
      amount_calculated: amountCalc,
      notes: editForm.notes || null,
    }).eq('id', editReadingModal.id)

    setSaving(false)
    setEditReadingModal(null)
    fetchAll()
  }

  async function handleCobrarAgora() {
    if (!editReadingModal || !editLeaseId) return
    const amountDue = editReadingModal.amount_calculated ?? 0
    if (amountDue <= 0) return

    setSaving(true)

    const { data: advances } = await supabase
      .from('rent_payments')
      .select('*')
      .eq('lease_id', editLeaseId)
      .eq('tipo', 'adiantamento')
      .eq('used', false)
      .order('payment_date', { ascending: true })

    let remaining = amountDue
    let totalApplied = 0

    for (const adv of advances ?? []) {
      if (remaining <= 0) break
      if (adv.amount <= remaining) {
        await supabase.from('rent_payments').update({ used: true }).eq('id', adv.id)
        totalApplied += adv.amount
        remaining = parseFloat((remaining - adv.amount).toFixed(2))
      } else {
        await supabase.from('rent_payments').update({ amount: remaining, used: true }).eq('id', adv.id)
        await supabase.from('rent_payments').insert({
          lease_id: adv.lease_id,
          reference_month: adv.reference_month,
          amount: parseFloat((adv.amount - remaining).toFixed(2)),
          payment_date: adv.payment_date,
          payment_method: adv.payment_method,
          tipo: 'adiantamento',
          notes: adv.notes,
          used: false,
        })
        totalApplied += remaining
        remaining = 0
      }
    }

    await supabase.from('electricity_charges').insert({
      lease_id: editLeaseId,
      charge_date: new Date().toISOString().slice(0, 10),
      reference_month: editReadingModal.reading_date.slice(0, 7) + '-01',
      units: editReadingModal.kwh_consumed,
      amount: remaining,
      paid: remaining === 0,
      payment_date: remaining === 0 ? new Date().toISOString().slice(0, 10) : null,
      notes: totalApplied > 0 ? `Adiantamento de ${formatCurrency(totalApplied)} aplicado` : null,
    })

    await supabase.from('electricity_readings').update({
      charged: true,
      accumulated: false,
    }).eq('id', editReadingModal.id)

    setSaving(false)
    setEditReadingModal(null)
    fetchAll()
  }

  async function saveReading(charge: boolean) {
    if (!readingModal || !readingForm.reading_value) return
    setSaving(true)

    const { space, lastReading } = readingModal
    const newValue = parseFloat(readingForm.reading_value)
    const prevValue = lastReading?.reading_value ?? null
    const kwhConsumed = prevValue != null ? newValue - prevValue : null
    const accumulated = getAccumulatedAmount(space.id)
    const amountCalc = kwhConsumed != null ? parseFloat((kwhConsumed * priceWithVat + accumulated).toFixed(2)) : null
    const shouldCharge = charge && amountCalc != null && amountCalc >= minCharge

    await supabase.from('electricity_readings').insert({
      space_id: space.id,
      reading_date: readingForm.reading_date,
      reading_value: newValue,
      previous_value: prevValue,
      kwh_consumed: kwhConsumed,
      amount_calculated: amountCalc,
      charged: shouldCharge,
      accumulated: !shouldCharge,
      notes: readingForm.notes || null,
    })

    if (shouldCharge && space.tenant_id && amountCalc) {
      const { data: lease } = await supabase
        .from('leases')
        .select('id')
        .eq('space_id', space.id)
        .eq('status', 'ativo')
        .single()

      if (lease) {
        await supabase.from('electricity_charges').insert({
          lease_id: lease.id,
          charge_date: readingForm.reading_date,
          reference_month: readingForm.reading_date.slice(0, 7) + '-01',
          units: kwhConsumed,
          amount: amountCalc,
          paid: false,
        })
      }
    }

    setSaving(false)
    setReadingModal(null)
    fetchAll()
  }

  function toggleExpanded(id: string) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }

  async function deleteReading(id: string) {
    if (!confirm('Apagar esta leitura?')) return
    await supabase.from('electricity_readings').delete().eq('id', id)
    fetchAll()
  }

  const semInquilino = spaces.filter(s => !s.tenant_id).length
  const totalCobrado = Object.values(readings).flat()
    .filter(r => r.charged)
    .reduce((s, r) => s + (r.amount_calculated ?? 0), 0)
  const totalAcumulado = spaces.reduce((s, sp) => s + getAccumulatedAmount(sp.id), 0)

  return (
    <AppLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Quadros dos Espaços</h1>
            <p className="text-sm text-gray-500 mt-1">{spaces.length} espaços com contador partilhado</p>
          </div>
          {canEdit && (
            <button
              onClick={() => setShowConfig(!showConfig)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${showConfig ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              <Settings className="w-4 h-4" />
              Configurações
            </button>
          )}
        </div>

        {/* Painel de Configurações */}
        {showConfig && canEdit && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-6">
            <h2 className="text-sm font-semibold text-blue-800 mb-4 flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Parâmetros de Cobrança
            </h2>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-medium text-blue-700 block mb-1">Preço por kWh (€, sem IVA)</label>
                <input type="number" step="0.001" className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm bg-white"
                  value={configForm.price_per_kwh}
                  onChange={e => setConfigForm(f => ({ ...f, price_per_kwh: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-blue-700 block mb-1">IVA (%)</label>
                <input type="number" step="1" className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm bg-white"
                  value={configForm.vat_rate}
                  onChange={e => setConfigForm(f => ({ ...f, vat_rate: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-blue-700 block mb-1">Valor mínimo para cobrar (€)</label>
                <input type="number" step="0.50" className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm bg-white"
                  value={configForm.min_charge}
                  onChange={e => setConfigForm(f => ({ ...f, min_charge: e.target.value }))} />
              </div>
            </div>
            <div className="mt-3 bg-white border border-blue-100 rounded-lg px-4 py-2 text-sm text-blue-800">
              Preço final com IVA: <strong>
                {formatCurrency(parseFloat(configForm.price_per_kwh || '0') * (1 + parseFloat(configForm.vat_rate || '0') / 100))}
              </strong> /kWh
            </div>
            <div className="flex items-center gap-3 mt-4">
              <button onClick={saveConfig} disabled={savingConfig}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                <Save className="w-4 h-4" />
                {savingConfig ? 'A guardar...' : 'Guardar configurações'}
              </button>
              {configSaved && <span className="text-sm text-emerald-600 font-medium">✓ Guardado com sucesso!</span>}
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="card">
            <p className="text-sm text-gray-500 mb-1">Espaços com contador</p>
            <p className="text-xl font-bold text-gray-900">{spaces.length}</p>
            <p className="text-xs text-gray-400 mt-1">H34 tem contador próprio (excluído)</p>
          </div>
          <div className="card">
            <p className="text-sm text-gray-500 mb-1">Total cobrado</p>
            <p className="text-xl font-bold text-emerald-600">{formatCurrency(totalCobrado)}</p>
          </div>
          <div className="card">
            <p className="text-sm text-gray-500 mb-1">Por acumular</p>
            <p className="text-xl font-bold text-yellow-600">{formatCurrency(totalAcumulado)}</p>
          </div>
        </div>

        {semInquilino > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 mb-4">
            <p className="text-sm text-yellow-700">⚠ <strong>{semInquilino}</strong> espaço(s) sem inquilino — leituras não geram cobrança</p>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
          </div>
        ) : (
          <div className="space-y-3">
            {spaces.map(space => {
              const spaceReadings = readings[space.id] ?? []
              const lastReading = spaceReadings[0]
              const isOpen = expanded[space.id]
              const accumulated = getAccumulatedAmount(space.id)
              const tenantName = getTenantName(space.tenant)

              return (
                <div key={space.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => toggleExpanded(space.id)}>
                    <div className="flex items-center gap-4">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${space.tenant_id ? 'bg-emerald-100' : 'bg-gray-100'}`}>
                        <Zap className={`w-4 h-4 ${space.tenant_id ? 'text-emerald-600' : 'text-gray-400'}`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-gray-900">{space.ref}</p>
                          <span className="text-xs text-gray-400 capitalize">{space.type}</span>
                          {!space.tenant_id && (
                            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Sem inquilino</span>
                          )}
                        </div>
                        {tenantName && <p className="text-xs text-gray-500">{tenantName}</p>}
                      </div>
                    </div>

                    <div className="flex items-center gap-6">
                      {accumulated > 0 && (
                        <div className="text-right">
                          <p className="text-xs text-yellow-600 font-medium">Acumulado</p>
                          <p className="text-sm font-semibold text-yellow-700">{formatCurrency(accumulated)}</p>
                        </div>
                      )}
                      <div className="text-right">
                        <p className="text-xs text-gray-500">Última leitura</p>
                        <p className="text-sm font-medium text-gray-700">{lastReading ? formatDate(lastReading.reading_date) : '—'}</p>
                        {lastReading?.reading_value != null && (
                          <p className="text-xs text-gray-400">{lastReading.reading_value} kWh</p>
                        )}
                      </div>
                      {canEdit && (
                        <button
                          onClick={e => { e.stopPropagation(); openReadingModal(space) }}
                          className="text-xs text-blue-600 hover:underline font-medium whitespace-nowrap">
                          + Leitura
                        </button>
                      )}
                      {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t border-gray-100 px-4 pb-4">
                      {spaceReadings.length === 0 ? (
                        <p className="text-sm text-gray-400 py-4 text-center">Sem leituras registadas</p>
                      ) : (
                        <table className="w-full mt-3">
                          <thead>
                            <tr className="text-xs text-gray-500 border-b border-gray-100">
                              <th className="text-left py-2">Data</th>
                              <th className="text-left py-2">Leitura</th>
                              <th className="text-left py-2">Anterior</th>
                              <th className="text-left py-2">kWh</th>
                              <th className="text-left py-2">Valor</th>
                              <th className="text-left py-2">Estado</th>
                              {canEdit && <th className="py-2"></th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {spaceReadings.map((r, index) => (
                              <tr key={r.id} className="hover:bg-gray-50">
                                <td className="py-2 text-sm">{formatDate(r.reading_date)}</td>
                                <td className="py-2 text-sm font-mono">{r.reading_value}</td>
                                <td className="py-2 text-sm font-mono text-gray-400">{r.previous_value ?? '—'}</td>
                                <td className="py-2 text-sm">{r.kwh_consumed != null ? `${r.kwh_consumed} kWh` : '—'}</td>
                                <td className="py-2 text-sm font-semibold">
                                  {r.amount_calculated != null ? formatCurrency(r.amount_calculated) : '—'}
                                </td>
                                <td className="py-2">
                                  {r.charged ? (
                                    <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">Cobrado</span>
                                  ) : (
                                    <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">Acumulado</span>
                                  )}
                                </td>
                                {canEdit && (
                                  <td className="py-2">
                                    <div className="flex items-center gap-2">
                                      {index === 0 && (
                                        <button onClick={() => openEditModal(r)}
                                          className="text-gray-300 hover:text-blue-500 transition-colors"
                                          title="Editar última leitura">
                                          <Pencil className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                      <button onClick={() => deleteReading(r.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal Nova Leitura */}
      {readingModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg text-gray-900">Nova Leitura — {readingModal.space.ref}</h2>
              <button onClick={() => setReadingModal(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>

            {readingModal.lastReading && (
              <div className="bg-gray-50 rounded-lg p-3 mb-4 text-sm">
                <p className="text-gray-500 text-xs mb-1">Última leitura</p>
                <p className="font-medium text-gray-800">{readingModal.lastReading.reading_value} kWh — {formatDate(readingModal.lastReading.reading_date)}</p>
              </div>
            )}

            {getAccumulatedAmount(readingModal.space.id) > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                <p className="text-xs text-yellow-700 font-medium">
                  Valor acumulado de leituras anteriores: {formatCurrency(getAccumulatedAmount(readingModal.space.id))}
                </p>
                <p className="text-xs text-yellow-600 mt-0.5">Este valor será somado ao cálculo atual</p>
              </div>
            )}

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Data *</label>
                  <input type="date" className="input" value={readingForm.reading_date}
                    onChange={e => setReadingForm(f => ({ ...f, reading_date: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Valor do contador *</label>
                  <input type="number" step="0.01" className="input" placeholder="ex: 1250"
                    value={readingForm.reading_value}
                    onChange={e => setReadingForm(f => ({ ...f, reading_value: e.target.value }))} />
                </div>
              </div>

              {readingForm.reading_value && readingModal.lastReading && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
                  <p className="text-xs font-medium text-blue-700 mb-1">Pré-visualização:</p>
                  {(() => {
                    const kwh = parseFloat(readingForm.reading_value) - readingModal.lastReading!.reading_value
                    const acc = getAccumulatedAmount(readingModal.space.id)
                    const total = parseFloat((kwh * priceWithVat + acc).toFixed(2))
                    return (
                      <div className="text-xs text-blue-700 space-y-0.5">
                        <p>{kwh.toFixed(1)} kWh × {formatCurrency(priceWithVat)}/kWh = {formatCurrency(kwh * priceWithVat)}</p>
                        {acc > 0 && <p>+ Acumulado: {formatCurrency(acc)}</p>}
                        <p className="font-semibold text-blue-800 text-sm mt-1">Total: {formatCurrency(total)}</p>
                        {total < minCharge && (
                          <p className="text-yellow-700 font-medium mt-1">⚠ Abaixo de {formatCurrency(minCharge)} — recomenda-se acumular</p>
                        )}
                      </div>
                    )
                  })()}
                </div>
              )}

              <div>
                <label className="label">Notas</label>
                <textarea className="input" rows={2} value={readingForm.notes}
                  onChange={e => setReadingForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>

            <div className="mt-6 space-y-2">
              {readingModal.space.tenant_id ? (
                <>
                  <button onClick={() => saveReading(true)} disabled={saving || !readingForm.reading_value}
                    className="w-full py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                    {saving ? 'A guardar...' : '✓ Cobrar ao inquilino'}
                  </button>
                  <button onClick={() => saveReading(false)} disabled={saving || !readingForm.reading_value}
                    className="w-full py-2.5 rounded-lg bg-yellow-500 text-white text-sm font-medium hover:bg-yellow-600 disabled:opacity-50">
                    {saving ? 'A guardar...' : 'Acumular para próxima leitura'}
                  </button>
                </>
              ) : (
                <button onClick={() => saveReading(false)} disabled={saving || !readingForm.reading_value}
                  className="w-full py-2.5 rounded-lg bg-gray-600 text-white text-sm font-medium hover:bg-gray-700 disabled:opacity-50">
                  {saving ? 'A guardar...' : 'Guardar leitura (sem inquilino)'}
                </button>
              )}
              <button onClick={() => setReadingModal(null)}
                className="w-full py-2.5 rounded-lg border border-gray-200 text-gray-600 text-sm hover:bg-gray-50">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Editar Última Leitura */}
      {editReadingModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg text-gray-900">Editar Última Leitura</h2>
              <button onClick={() => setEditReadingModal(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
              <p className="text-xs text-yellow-700 font-medium">⚠ Só é possível editar a última leitura.</p>
              <p className="text-xs text-yellow-600 mt-0.5">O valor calculado será recalculado automaticamente.</p>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Data *</label>
                  <input type="date" className="input" value={editForm.reading_date}
                    onChange={e => setEditForm(f => ({ ...f, reading_date: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Valor do contador *</label>
                  <input type="number" step="0.01" className="input"
                    value={editForm.reading_value}
                    onChange={e => setEditForm(f => ({ ...f, reading_value: e.target.value }))} />
                </div>
              </div>

              {editForm.reading_value && editReadingModal.previous_value != null && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
                  <p className="text-xs font-medium text-blue-700 mb-1">Pré-visualização:</p>
                  {(() => {
                    const kwh = parseFloat(editForm.reading_value) - editReadingModal.previous_value!
                    const total = parseFloat((kwh * priceWithVat).toFixed(2))
                    return (
                      <div className="text-xs text-blue-700 space-y-0.5">
                        <p>{kwh.toFixed(1)} kWh × {formatCurrency(priceWithVat)}/kWh = {formatCurrency(kwh * priceWithVat)}</p>
                        <p className="font-semibold text-blue-800 text-sm mt-1">Total: {formatCurrency(total)}</p>
                      </div>
                    )
                  })()}
                </div>
              )}

              <div>
                <label className="label">Notas</label>
                <textarea className="input" rows={2} value={editForm.notes}
                  onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} />
              </div>

              {!editReadingModal.charged && (editReadingModal.amount_calculated ?? 0) > 0 && editLeaseId && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                  {editAdvance > 0 ? (
                    <p className="text-xs text-emerald-700">
                      Adiantamento de {formatCurrency(Math.min(editAdvance, editReadingModal.amount_calculated ?? 0))} aplicado. Valor a cobrar: {formatCurrency(Math.max(0, (editReadingModal.amount_calculated ?? 0) - editAdvance))}
                    </p>
                  ) : (
                    <p className="text-xs text-emerald-700">
                      Valor a cobrar ao inquilino: {formatCurrency(editReadingModal.amount_calculated ?? 0)}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="mt-6 space-y-2">
              {!editReadingModal.charged && (editReadingModal.amount_calculated ?? 0) > 0 && editLeaseId && (
                <button onClick={handleCobrarAgora} disabled={saving}
                  className="w-full py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                  {saving ? 'A processar...' : '✓ Cobrar agora'}
                </button>
              )}
              <button onClick={saveEditReading} disabled={saving || !editForm.reading_value}
                className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'A guardar...' : '✓ Guardar alterações'}
              </button>
              <button onClick={() => setEditReadingModal(null)}
                className="w-full py-2.5 rounded-lg border border-gray-200 text-gray-600 text-sm hover:bg-gray-50">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

// https://quinta-gestao.vercel.app/eletricidade/espacos
