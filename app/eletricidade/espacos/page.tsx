'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, Zap, Trash2, X, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

const PRICE_PER_KWH = 0.18
const VAT = 0.23
const PRICE_WITH_VAT = PRICE_PER_KWH * (1 + VAT) // 0.2214€/kWh
const MIN_CHARGE = 5 // mínimo para cobrar

interface Space {
  id: string
  ref: string
  type: string
  has_own_meter: boolean
  tenant_id: string | null
  tenant?: { name: string } | null
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
  const { isAdmin } = useAuth()
  const [spaces, setSpaces] = useState<Space[]>([])
  const [readings, setReadings] = useState<Record<string, Reading[]>>({})
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [readingModal, setReadingModal] = useState<ReadingModal | null>(null)
  const [saving, setSaving] = useState(false)
  const [readingForm, setReadingForm] = useState({
    reading_date: new Date().toISOString().slice(0, 10),
    reading_value: '',
    notes: '',
  })
  const supabase = createClient()

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)

    const { data: spacesData } = await supabase
      .from('spaces')
      .select('id, ref, type, has_own_meter, tenant_id, tenant:tenants(name)')
      .eq('has_own_meter', false)
      .order('ref')

    setSpaces((spacesData ?? []) as Space[])

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

  function calcAmount(kwh: number, prevAccumulated = 0): number {
    return kwh * PRICE_WITH_VAT + prevAccumulated
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

  function getAccumulatedAmount(spaceId: string): number {
    const spaceReadings = readings[spaceId] ?? []
    let total = 0
    for (const r of spaceReadings) {
      if (r.accumulated && !r.charged) {
        total += r.amount_calculated ?? 0
      } else if (r.charged) {
        break
      }
    }
    return total
  }

  async function saveReading(charge: boolean) {
    if (!readingModal || !readingForm.reading_value) return
    setSaving(true)

    const { space, lastReading } = readingModal
    const newValue = parseFloat(readingForm.reading_value)
    const prevValue = lastReading?.reading_value ?? null
    const kwhConsumed = prevValue != null ? newValue - prevValue : null
    const accumulated = getAccumulatedAmount(space.id)
    const amountCalc = kwhConsumed != null ? calcAmount(kwhConsumed, accumulated) : null
    const shouldCharge = charge && amountCalc != null && amountCalc >= MIN_CHARGE

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

    // Se cobrado, criar cobrança ao inquilino
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
          amount: parseFloat(amountCalc.toFixed(2)),
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

  // Espaços sem inquilino
  const semInquilino = spaces.filter(s => !s.tenant_id).length
  const totalCobrado = Object.values(readings).flat()
    .filter(r => r.charged)
    .reduce((s, r) => s + (r.amount_calculated ?? 0), 0)

  return (
    <AppLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Quadros dos Espaços</h1>
            <p className="text-sm text-gray-500 mt-1">{spaces.length} espaços com contador partilhado</p>
          </div>
        </div>

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
            <p className="text-xl font-bold text-yellow-600">
              {formatCurrency(spaces.reduce((s, sp) => s + getAccumulatedAmount(sp.id), 0))}
            </p>
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
              const tenantName = Array.isArray(space.tenant) ? space.tenant[0]?.name : (space.tenant as any)?.name

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
                          <p className="text-xs text-yellow-600 font-medium">⏳ Acumulado</p>
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
                      {isAdmin && (
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
                              {isAdmin && <th className="py-2"></th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {spaceReadings.map(r => (
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
                                {isAdmin && (
                                  <td className="py-2">
                                    <button onClick={() => deleteReading(r.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
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

            {/* Info última leitura */}
            {readingModal.lastReading && (
              <div className="bg-gray-50 rounded-lg p-3 mb-4 text-sm">
                <p className="text-gray-500 text-xs mb-1">Última leitura</p>
                <p className="font-medium text-gray-800">{readingModal.lastReading.reading_value} kWh — {formatDate(readingModal.lastReading.reading_date)}</p>
              </div>
            )}

            {/* Acumulado */}
            {getAccumulatedAmount(readingModal.space.id) > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                <p className="text-xs text-yellow-700 font-medium">
                  ⏳ Valor acumulado de leituras anteriores: {formatCurrency(getAccumulatedAmount(readingModal.space.id))}
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

              {/* Preview do cálculo */}
              {readingForm.reading_value && readingModal.lastReading && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
                  <p className="text-xs font-medium text-blue-700 mb-1">Pré-visualização do cálculo:</p>
                  {(() => {
                    const kwh = parseFloat(readingForm.reading_value) - readingModal.lastReading!.reading_value
                    const accumulated = getAccumulatedAmount(readingModal.space.id)
                    const total = kwh * PRICE_WITH_VAT + accumulated
                    return (
                      <div className="text-xs text-blue-700 space-y-0.5">
                        <p>{kwh.toFixed(1)} kWh × {formatCurrency(PRICE_WITH_VAT)} = {formatCurrency(kwh * PRICE_WITH_VAT)}</p>
                        {accumulated > 0 && <p>+ Acumulado: {formatCurrency(accumulated)}</p>}
                        <p className="font-semibold text-blue-800 text-sm mt-1">Total: {formatCurrency(total)}</p>
                        {total < MIN_CHARGE && (
                          <p className="text-yellow-700 font-medium mt-1">⚠ Valor abaixo de {formatCurrency(MIN_CHARGE)} — recomenda-se acumular</p>
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

            {/* Botões de ação */}
            <div className="mt-6 space-y-2">
              {readingModal.space.tenant_id ? (
                <>
                  <button
                    onClick={() => saveReading(true)}
                    disabled={saving || !readingForm.reading_value}
                    className="w-full py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                    {saving ? 'A guardar...' : '✓ Cobrar ao inquilino'}
                  </button>
                  <button
                    onClick={() => saveReading(false)}
                    disabled={saving || !readingForm.reading_value}
                    className="w-full py-2.5 rounded-lg bg-yellow-500 text-white text-sm font-medium hover:bg-yellow-600 disabled:opacity-50">
                    {saving ? 'A guardar...' : '⏳ Acumular para próxima leitura'}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => saveReading(false)}
                  disabled={saving || !readingForm.reading_value}
                  className="w-full py-2.5 rounded-lg bg-gray-600 text-white text-sm font-medium hover:bg-gray-700 disabled:opacity-50">
                  {saving ? 'A guardar...' : '💾 Guardar leitura (sem inquilino)'}
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
    </AppLayout>
  )
}
