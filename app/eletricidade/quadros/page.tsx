'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, Zap, FileText, Trash2, X, ChevronDown, ChevronRight } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

interface Meter {
  id: string
  name: string
  contract_number: string
  cpe: string | null
  location: string | null
  active: boolean
}

interface MeterReading {
  id: string
  meter_id: string
  reading_date: string
  reading_value: number
  invoice_amount: number | null
  invoice_number: string | null
  notes: string | null
}

export default function QuadrosPage() {
  const { isAdmin } = useAuth()
  const [meters, setMeters] = useState<Meter[]>([])
  const [readings, setReadings] = useState<Record<string, MeterReading[]>>({})
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [showModal, setShowModal] = useState(false)
  const [showReadingModal, setShowReadingModal] = useState<string | null>(null)
  const [editMeter, setEditMeter] = useState<Meter | null>(null)
  const [saving, setSaving] = useState(false)
  const [meterForm, setMeterForm] = useState({ name: '', contract_number: '', cpe: '', location: '' })
  const [readingForm, setReadingForm] = useState({ reading_date: new Date().toISOString().slice(0, 10), reading_value: '', invoice_amount: '', invoice_number: '', notes: '' })
  const supabase = createClient()

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const { data: metersData } = await supabase.from('meters').select('*').eq('active', true).order('name')
    setMeters(metersData ?? [])

    const allReadings: Record<string, MeterReading[]> = {}
    for (const m of metersData ?? []) {
      const { data } = await supabase
        .from('meter_readings').select('*').eq('meter_id', m.id)
        .order('reading_date', { ascending: false })
      allReadings[m.id] = data ?? []
    }
    setReadings(allReadings)
    setLoading(false)
  }

  async function saveMeter() {
    if (!meterForm.name || !meterForm.contract_number) return
    setSaving(true)
    if (editMeter) {
      await supabase.from('meters').update({
        name: meterForm.name,
        contract_number: meterForm.contract_number,
        cpe: meterForm.cpe || null,
        location: meterForm.location || null,
      }).eq('id', editMeter.id)
    } else {
      await supabase.from('meters').insert({
        name: meterForm.name,
        contract_number: meterForm.contract_number,
        cpe: meterForm.cpe || null,
        location: meterForm.location || null,
      })
    }
    setSaving(false)
    setShowModal(false)
    setEditMeter(null)
    fetchAll()
  }

  async function saveReading() {
    if (!showReadingModal || !readingForm.reading_date || !readingForm.reading_value) return
    setSaving(true)
    await supabase.from('meter_readings').insert({
      meter_id: showReadingModal,
      reading_date: readingForm.reading_date,
      reading_value: parseFloat(readingForm.reading_value),
      invoice_amount: readingForm.invoice_amount ? parseFloat(readingForm.invoice_amount) : null,
      invoice_number: readingForm.invoice_number || null,
      notes: readingForm.notes || null,
    })
    setSaving(false)
    setShowReadingModal(null)
    setReadingForm({ reading_date: new Date().toISOString().slice(0, 10), reading_value: '', invoice_amount: '', invoice_number: '', notes: '' })
    fetchAll()
  }

  async function deleteReading(id: string) {
    if (!confirm('Apagar esta leitura?')) return
    await supabase.from('meter_readings').delete().eq('id', id)
    fetchAll()
  }

  function openEdit(meter: Meter) {
    setEditMeter(meter)
    setMeterForm({ name: meter.name, contract_number: meter.contract_number, cpe: meter.cpe ?? '', location: meter.location ?? '' })
    setShowModal(true)
  }

  function toggleExpanded(id: string) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const totalFaturas = Object.values(readings).flat().reduce((s, r) => s + (r.invoice_amount ?? 0), 0)

  return (
    <AppLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Quadros da Quinta</h1>
            <p className="text-sm text-gray-500 mt-1">{meters.length} quadros registados</p>
          </div>
          {isAdmin && (
            <button className="btn-primary" onClick={() => { setEditMeter(null); setMeterForm({ name: '', contract_number: '', cpe: '', location: '' }); setShowModal(true) }}>
              <Plus className="w-4 h-4" /> Novo Quadro
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="card">
            <p className="text-sm text-gray-500 mb-1">Total Quadros</p>
            <p className="text-xl font-bold text-gray-900">{meters.length}</p>
          </div>
          <div className="card">
            <p className="text-sm text-gray-500 mb-1">Total Faturas EDP</p>
            <p className="text-xl font-bold text-red-600">{formatCurrency(totalFaturas)}</p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
          </div>
        ) : (
          <div className="space-y-4">
            {meters.map(meter => {
              const meterReadings = readings[meter.id] ?? []
              const isOpen = expanded[meter.id]
              const lastReading = meterReadings[0]
              const totalMeter = meterReadings.reduce((s, r) => s + (r.invoice_amount ?? 0), 0)

              return (
                <div key={meter.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="p-5 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => toggleExpanded(meter.id)}>
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Zap className="w-5 h-5 text-yellow-600" />
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">{meter.name}</p>
                        <p className="text-xs text-gray-500 font-mono">Contrato: {meter.contract_number}</p>
                        {meter.cpe && <p className="text-xs text-gray-400 font-mono">CPE: {meter.cpe}</p>}
                        {meter.location && <p className="text-xs text-gray-400">{meter.location}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-xs text-gray-500">Última leitura</p>
                        <p className="text-sm font-medium text-gray-700">{lastReading ? formatDate(lastReading.reading_date) : '—'}</p>
                        {lastReading?.reading_value != null && <p className="text-xs text-gray-400">{lastReading.reading_value} kWh</p>}
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">Total faturas</p>
                        <p className="text-sm font-semibold text-red-600">{formatCurrency(totalMeter)}</p>
                      </div>
                      {isAdmin && (
                        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                          <button onClick={() => openEdit(meter)} className="text-xs text-emerald-600 hover:underline font-medium">Editar</button>
                          <button onClick={() => { setShowReadingModal(meter.id); setReadingForm({ reading_date: new Date().toISOString().slice(0, 10), reading_value: '', invoice_amount: '', invoice_number: '', notes: '' }) }}
                            className="text-xs text-blue-600 hover:underline font-medium">+ Leitura</button>
                        </div>
                      )}
                      {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t border-gray-100 px-5 pb-4">
                      {meterReadings.length === 0 ? (
                        <p className="text-sm text-gray-400 py-4 text-center">Sem leituras registadas</p>
                      ) : (
                        <table className="w-full mt-3">
                          <thead>
                            <tr className="text-xs text-gray-500 border-b border-gray-100">
                              <th className="text-left py-2">Data</th>
                              <th className="text-left py-2">Leitura (kWh)</th>
                              <th className="text-left py-2">Nº Fatura</th>
                              <th className="text-left py-2">Valor Fatura</th>
                              <th className="text-left py-2">Notas</th>
                              {isAdmin && <th className="py-2"></th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {meterReadings.map(r => (
                              <tr key={r.id} className="hover:bg-gray-50">
                                <td className="py-2 text-sm">{formatDate(r.reading_date)}</td>
                                <td className="py-2 text-sm font-mono">{r.reading_value}</td>
                                <td className="py-2 text-sm text-gray-500">{r.invoice_number ?? '—'}</td>
                                <td className="py-2 text-sm font-semibold text-red-600">{r.invoice_amount ? formatCurrency(r.invoice_amount) : '—'}</td>
                                <td className="py-2 text-sm text-gray-400 max-w-xs truncate">{r.notes ?? '—'}</td>
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

      {/* Modal Quadro */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-lg text-gray-900">{editMeter ? 'Editar Quadro' : 'Novo Quadro'}</h2>
              <button onClick={() => setShowModal(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="label">Nome *</label>
                <input className="input" placeholder="ex: Quadro 9002" value={meterForm.name}
                  onChange={e => setMeterForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="label">Nº Contrato EDP *</label>
                <input className="input" placeholder="ex: 160807307528" value={meterForm.contract_number}
                  onChange={e => setMeterForm(f => ({ ...f, contract_number: e.target.value }))} />
              </div>
              <div>
                <label className="label">CPE</label>
                <input className="input" placeholder="ex: PT0002000003480097WQ" value={meterForm.cpe}
                  onChange={e => setMeterForm(f => ({ ...f, cpe: e.target.value }))} />
              </div>
              <div>
                <label className="label">Localização</label>
                <input className="input" placeholder="ex: Quinta Bela Vista" value={meterForm.location}
                  onChange={e => setMeterForm(f => ({ ...f, location: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button className="btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn-primary" onClick={saveMeter} disabled={saving}>
                {saving ? 'A guardar...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Leitura */}
      {showReadingModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-lg text-gray-900">Nova Leitura</h2>
              <button onClick={() => setShowReadingModal(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Data *</label>
                  <input type="date" className="input" value={readingForm.reading_date}
                    onChange={e => setReadingForm(f => ({ ...f, reading_date: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Valor contador (kWh) *</label>
                  <input type="number" step="0.01" className="input" placeholder="ex: 8581"
                    value={readingForm.reading_value}
                    onChange={e => setReadingForm(f => ({ ...f, reading_value: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Nº Fatura EDP</label>
                  <input className="input" placeholder="ex: FT2026..." value={readingForm.invoice_number}
                    onChange={e => setReadingForm(f => ({ ...f, invoice_number: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Valor Fatura (€)</label>
                  <input type="number" step="0.01" className="input" placeholder="ex: 993.64"
                    value={readingForm.invoice_amount}
                    onChange={e => setReadingForm(f => ({ ...f, invoice_amount: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="label">Notas</label>
                <textarea className="input" rows={2} value={readingForm.notes}
                  onChange={e => setReadingForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button className="btn-secondary" onClick={() => setShowReadingModal(null)}>Cancelar</button>
              <button className="btn-primary" onClick={saveReading} disabled={saving}>
                {saving ? 'A guardar...' : 'Guardar Leitura'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
