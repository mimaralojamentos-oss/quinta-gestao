'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, formatDate, formatMonthShort, openStorageDocument, normalizeText } from '@/lib/utils'
import { waterMeterReadingExists } from '@/lib/waterMeterReadings'
import { Plus, Droplet, Trash2, X, ChevronDown, ChevronRight, BarChart2, Eye, Search, Upload, Loader2, CheckCircle } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useFileDrop } from '@/lib/useFileDrop'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

const supabase = createClient()

interface WaterMeter {
  id: string
  name: string
  contract_number: string
  meter_number: string | null
  location: string | null
  active: boolean
}

interface WaterMeterReading {
  id: string
  meter_id: string
  reading_date: string
  reading_value: number
  invoice_amount: number | null
  invoice_number: string | null
  notes: string | null
}

interface Document {
  id: string
  file_path: string
  original_name: string | null
  doc_number: string | null
  doc_date: string | null
  amount: number | null
}

type FilterType = 'all' | 'year' | 'semester' | 'trimester' | 'custom'

const METER_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

/**
 * Contadores Gerais de água — espelha /eletricidade/quadros.
 *
 * Extração por IA (upload de fatura) em "Novo Contador" e "+ Leitura",
 * via /api/extract-water-meter — espelha o padrão de /api/extract-edp-meter
 * da luz, mas devolve os dois grupos de campos (identificação do contador
 * + leitura/valor desta fatura) numa só chamada, já que uma fatura de água
 * traz tudo isto junto. A associação ao documento já carregado em
 * Documentos (tipo 'fatura_agua') continua a ser manual, tal como em
 * /eletricidade/quadros.
 */
export default function ContadoresAguaPage() {
  const { isAdmin, isCoAdmin, profile } = useAuth()
  const canEdit = isAdmin || isCoAdmin || profile?.role === 'electrician'
  const [meters, setMeters] = useState<WaterMeter[]>([])
  const [readings, setReadings] = useState<Record<string, WaterMeterReading[]>>({})
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [showModal, setShowModal] = useState(false)
  const [showReadingModal, setShowReadingModal] = useState<string | null>(null)
  const [showChart, setShowChart] = useState(false)
  const [editMeter, setEditMeter] = useState<WaterMeter | null>(null)
  const [saving, setSaving] = useState(false)
  const [meterForm, setMeterForm] = useState({ name: '', contract_number: '', meter_number: '', location: '' })
  const [readingForm, setReadingForm] = useState({
    reading_date: new Date().toISOString().slice(0, 10),
    reading_value: '',
    invoice_amount: '',
    invoice_number: '',
    notes: ''
  })

  // ── Extração por IA a partir de uma fatura de água ──
  const [extractingMeter, setExtractingMeter] = useState(false)
  const [meterExtractDone, setMeterExtractDone] = useState(false)
  const [meterExtractError, setMeterExtractError] = useState('')
  const [meterExtractInfo, setMeterExtractInfo] = useState('')

  function resetMeterExtraction() {
    setExtractingMeter(false)
    setMeterExtractDone(false)
    setMeterExtractError('')
    setMeterExtractInfo('')
  }

  async function extractMeterFromPdf(file: File) {
    setExtractingMeter(true)
    setMeterExtractError('')
    setMeterExtractDone(false)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/extract-water-meter', { method: 'POST', body: fd })
      const json = await res.json()

      if (!res.ok || json.error) {
        setMeterExtractError(json.error ?? 'Não foi possível ler a fatura')
        return
      }

      // Já existe um contador com este contrato/nº — avisa em vez de criar um duplicado
      if (json.existingMeter) {
        setMeterExtractError(`Esta fatura pertence ao contador "${json.existingMeter.name}", que já está registado. Não é preciso criar outro.`)
        return
      }

      const d = json.data
      setMeterForm(f => ({
        name: d.suggested_name || f.name,
        contract_number: d.contract_number || f.contract_number,
        meter_number: d.meter_number || f.meter_number,
        location: d.location || f.location,
      }))
      setMeterExtractInfo(d.holder_name ?? '')
      setMeterExtractDone(true)
    } catch {
      setMeterExtractError('Erro ao processar a fatura. Tenta novamente.')
    } finally {
      setExtractingMeter(false)
    }
  }

  const meterPdfDrop = useFileDrop({
    accept: ['.pdf'],
    onFiles: dropped => { if (dropped[0]) extractMeterFromPdf(dropped[0]) },
    disabled: extractingMeter,
  })

  // ── O mesmo endpoint, mas para preencher "+ Leitura" (data, leitura,
  // valor e nº da fatura) em vez dos campos de identificação do contador. ──
  const [extractingReading, setExtractingReading] = useState(false)
  const [readingExtractDone, setReadingExtractDone] = useState(false)
  const [readingExtractError, setReadingExtractError] = useState('')
  const [readingExtractInfo, setReadingExtractInfo] = useState('')

  function resetReadingExtraction() {
    setExtractingReading(false)
    setReadingExtractDone(false)
    setReadingExtractError('')
    setReadingExtractInfo('')
  }

  async function extractReadingFromPdf(file: File) {
    setExtractingReading(true)
    setReadingExtractError('')
    setReadingExtractDone(false)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/extract-water-meter', { method: 'POST', body: fd })
      const json = await res.json()

      if (!res.ok || json.error) {
        setReadingExtractError(json.error ?? 'Não foi possível ler a fatura')
        return
      }

      const d = json.data
      setReadingForm(f => ({
        reading_date: d.period_end || f.reading_date,
        reading_value: d.reading_value != null ? String(d.reading_value) : f.reading_value,
        invoice_amount: d.total_amount != null ? String(d.total_amount) : f.invoice_amount,
        invoice_number: d.invoice_number || f.invoice_number,
        notes: f.notes,
      }))
      setReadingExtractInfo([
        d.period_start && d.period_end ? `Período ${formatDate(d.period_start)} a ${formatDate(d.period_end)}` : null,
        d.reading_estimated === true ? 'leitura estimada' : d.reading_estimated === false ? 'leitura real' : null,
      ].filter(Boolean).join(' · '))
      setReadingExtractDone(true)
    } catch {
      setReadingExtractError('Erro ao processar a fatura. Tenta novamente.')
    } finally {
      setExtractingReading(false)
    }
  }

  const readingPdfDrop = useFileDrop({
    accept: ['.pdf'],
    onFiles: dropped => { if (dropped[0]) extractReadingFromPdf(dropped[0]) },
    disabled: extractingReading,
  })

  const [filterType, setFilterType] = useState<FilterType>('all')
  const [filterYear, setFilterYear] = useState('2026')
  const [filterSemester, setFilterSemester] = useState('1')
  const [filterTrimester, setFilterTrimester] = useState('1')
  const [filterStart, setFilterStart] = useState('2026-01-01')
  const [filterEnd, setFilterEnd] = useState(new Date().toISOString().slice(0, 10))
  const [chartData, setChartData] = useState<Record<string, any>[]>([])

  const [documents, setDocuments] = useState<Document[]>([])
  const [associateReading, setAssociateReading] = useState<WaterMeterReading | null>(null)
  const [associateSearch, setAssociateSearch] = useState('')

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const { data: metersData } = await supabase.from('water_meters').select('*').eq('active', true).order('name')
    setMeters(metersData ?? [])
    const allReadings: Record<string, WaterMeterReading[]> = {}
    for (const m of metersData ?? []) {
      const { data } = await supabase
        .from('water_meter_readings').select('*').eq('meter_id', m.id)
        .order('reading_date', { ascending: false })
      allReadings[m.id] = data ?? []
    }
    setReadings(allReadings)

    const { data: docs } = await supabase
      .from('documents')
      .select('id, file_path, original_name, doc_number, doc_date, amount')
      .eq('tipo', 'fatura_agua')
      .eq('status', 'ativo')
      .order('doc_date', { ascending: false })
    setDocuments(docs ?? [])

    setLoading(false)
  }

  function findDocument(reading: WaterMeterReading): Document | null {
    if (!reading.invoice_number) return null
    return documents.find(d =>
      d.doc_number && d.doc_number.trim() === reading.invoice_number!.trim()
    ) ?? null
  }

  async function openDocument(doc: Document) {
    await openStorageDocument(supabase, doc.file_path)
  }

  const filteredDocs = documents.filter(d => {
    if (!associateSearch) return true
    const s = normalizeText(associateSearch)
    return (
      normalizeText(d.original_name).includes(s) ||
      normalizeText(d.doc_number).includes(s)
    )
  })

  // Recarrega os dados do gráfico sempre que as leituras, contadores ou filtros mudam.
  useEffect(() => {
    loadChartData()
  }, [readings, meters, filterType, filterYear, filterSemester, filterTrimester, filterStart, filterEnd])

  function loadChartData() {
    const allReadingDates = Object.values(readings).flat().map(r => r.reading_date).sort()
    const oldestDate = allReadingDates[0] ?? '2026-01-01'

    let startDate = new Date(oldestDate)
    let endDate = new Date()

    if (filterType === 'year') {
      startDate = new Date(`${filterYear}-01-01`)
      endDate = new Date(`${filterYear}-12-31`)
    } else if (filterType === 'semester') {
      const y = parseInt(filterYear)
      if (filterSemester === '1') { startDate = new Date(`${y}-01-01`); endDate = new Date(`${y}-06-30`) }
      else { startDate = new Date(`${y}-07-01`); endDate = new Date(`${y}-12-31`) }
    } else if (filterType === 'trimester') {
      const y = parseInt(filterYear)
      const quarters: Record<string, [string, string]> = {
        '1': [`${y}-01-01`, `${y}-03-31`], '2': [`${y}-04-01`, `${y}-06-30`],
        '3': [`${y}-07-01`, `${y}-09-30`], '4': [`${y}-10-01`, `${y}-12-31`],
      }
      startDate = new Date(quarters[filterTrimester][0]); endDate = new Date(quarters[filterTrimester][1])
    } else if (filterType === 'custom') {
      startDate = new Date(filterStart); endDate = new Date(filterEnd)
    }

    const months: string[] = []
    const cur = new Date(startDate.getFullYear(), startDate.getMonth(), 1)
    const end = new Date(endDate.getFullYear(), endDate.getMonth(), 1)
    while (cur <= end) {
      months.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`)
      cur.setMonth(cur.getMonth() + 1)
    }

    const data = months.map(month => {
      const point: Record<string, any> = { month: formatMonthShort(month) }
      for (const meter of meters) {
        const meterReadings = readings[meter.id] ?? []
        const monthReadings = meterReadings.filter(r => r.reading_date.slice(0, 7) === month)
        const total = monthReadings.reduce((s, r) => s + (r.invoice_amount ?? 0), 0)
        point[meter.name] = monthReadings.length > 0 ? total : null
      }
      return point
    })

    setChartData(data)
  }

  async function saveMeter() {
    if (!meterForm.name || !meterForm.contract_number) return
    setSaving(true)
    if (editMeter) {
      await supabase.from('water_meters').update({
        name: meterForm.name, contract_number: meterForm.contract_number,
        meter_number: meterForm.meter_number || null, location: meterForm.location || null,
      }).eq('id', editMeter.id)
    } else {
      await supabase.from('water_meters').insert({
        name: meterForm.name, contract_number: meterForm.contract_number,
        meter_number: meterForm.meter_number || null, location: meterForm.location || null,
      })
    }
    setSaving(false); setShowModal(false); setEditMeter(null); fetchAll()
  }

  async function saveReading() {
    if (!showReadingModal || !readingForm.reading_date || !readingForm.reading_value) return
    const jaExiste = await waterMeterReadingExists(supabase, showReadingModal, readingForm.reading_date, readingForm.invoice_number || null)
    if (jaExiste && !confirm('Já existe uma leitura para este contador nesta data (ou com este nº de fatura). Registar mesmo assim?')) return
    setSaving(true)
    await supabase.from('water_meter_readings').insert({
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
    await supabase.from('water_meter_readings').delete().eq('id', id)
    fetchAll()
  }

  function openEdit(meter: WaterMeter) {
    setEditMeter(meter)
    setMeterForm({ name: meter.name, contract_number: meter.contract_number, meter_number: meter.meter_number ?? '', location: meter.location ?? '' })
    resetMeterExtraction()
    setShowModal(true)
  }

  function toggleExpanded(id: string) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const totalFaturas = Object.values(readings).flat().reduce((s, r) => s + (r.invoice_amount ?? 0), 0)
  const years = ['2025', '2026', '2027', '2028']

  return (
    <AppLayout>
      <div className="p-4 md:p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Contadores Gerais de Água</h1>
            <p className="text-sm text-gray-500 mt-1">{meters.length} contadores registados</p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setShowChart(!showChart)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${showChart ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              <BarChart2 className="w-4 h-4" /> Gráfico
            </button>
            {canEdit && (
              <button className="btn-primary" onClick={() => { setEditMeter(null); setMeterForm({ name: '', contract_number: '', meter_number: '', location: '' }); resetMeterExtraction(); setShowModal(true) }}>
                <Plus className="w-4 h-4" /> Novo Contador
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div className="card">
            <p className="text-sm text-gray-500 mb-1">Total Contadores</p>
            <p className="text-xl font-bold text-gray-900">{meters.length}</p>
          </div>
          <div className="card">
            <p className="text-sm text-gray-500 mb-1">Total Faturas de Água</p>
            <p className="text-xl font-bold text-blue-600">{formatCurrency(totalFaturas)}</p>
          </div>
        </div>

        {/* Painel do Gráfico */}
        {showChart && (
          <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-6 mb-6">
            <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-blue-600" />
              Consumo por Contador — Valor Fatura (€)
            </h2>
            <div className="flex flex-wrap items-center gap-3 mb-5">
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
                {[{ value: 'all', label: 'Tudo' }, { value: 'year', label: 'Ano' }, { value: 'semester', label: 'Semestre' }, { value: 'trimester', label: 'Trimestre' }, { value: 'custom', label: 'Datas' }].map(opt => (
                  <button key={opt.value} onClick={() => setFilterType(opt.value as FilterType)}
                    className={`px-3 py-1.5 font-medium transition-colors ${filterType === opt.value ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
              {(filterType === 'year' || filterType === 'semester' || filterType === 'trimester') && (
                <select value={filterYear} onChange={e => setFilterYear(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700">
                  {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              )}
              {filterType === 'semester' && (
                <select value={filterSemester} onChange={e => setFilterSemester(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700">
                  <option value="1">1º Semestre (Jan–Jun)</option>
                  <option value="2">2º Semestre (Jul–Dez)</option>
                </select>
              )}
              {filterType === 'trimester' && (
                <select value={filterTrimester} onChange={e => setFilterTrimester(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700">
                  <option value="1">1º Trimestre (Jan–Mar)</option>
                  <option value="2">2º Trimestre (Abr–Jun)</option>
                  <option value="3">3º Trimestre (Jul–Set)</option>
                  <option value="4">4º Trimestre (Out–Dez)</option>
                </select>
              )}
              {filterType === 'custom' && (
                <div className="flex items-center gap-2">
                  <input type="date" value={filterStart} onChange={e => setFilterStart(e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700" />
                  <span className="text-gray-400 text-sm">até</span>
                  <input type="date" value={filterEnd} onChange={e => setFilterEnd(e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700" />
                </div>
              )}
            </div>
            {chartData.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Sem dados para o período selecionado</p>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#6b7280' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} tickFormatter={v => `${v}€`} />
                  <Tooltip formatter={(value: any, name: string) => [formatCurrency(value), name]}
                    contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '12px' }} />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  {meters.map((meter, i) => (
                    <Line key={meter.id} type="monotone" dataKey={meter.name}
                      stroke={METER_COLORS[i % METER_COLORS.length]} strokeWidth={2}
                      dot={{ r: 4 }} activeDot={{ r: 6 }} connectNulls={true} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
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
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Droplet className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">{meter.name}</p>
                        <p className="text-xs text-gray-500 font-mono">Contrato: {meter.contract_number}</p>
                        {meter.meter_number && <p className="text-xs text-gray-400 font-mono">Nº Contador: {meter.meter_number}</p>}
                        {meter.location && <p className="text-xs text-gray-400">{meter.location}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-xs text-gray-500">Última leitura</p>
                        <p className="text-sm font-medium text-gray-700">{lastReading ? formatDate(lastReading.reading_date) : '—'}</p>
                        {lastReading?.reading_value != null && <p className="text-xs text-gray-400">{lastReading.reading_value} m³</p>}
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">Total faturas</p>
                        <p className="text-sm font-semibold text-blue-600">{formatCurrency(totalMeter)}</p>
                      </div>
                      {canEdit && (
                        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                          <button onClick={() => openEdit(meter)} className="text-xs text-blue-600 hover:underline font-medium">Editar</button>
                          <button onClick={() => { setShowReadingModal(meter.id); setReadingForm({ reading_date: new Date().toISOString().slice(0, 10), reading_value: '', invoice_amount: '', invoice_number: '', notes: '' }); resetReadingExtraction() }}
                            className="text-xs text-emerald-600 hover:underline font-medium">+ Leitura</button>
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
                              <th className="text-left py-2">Leitura (m³)</th>
                              <th className="text-left py-2">Nº Fatura</th>
                              <th className="text-left py-2">Valor Fatura</th>
                              <th className="text-left py-2">Documento</th>
                              <th className="text-left py-2">Notas</th>
                              {canEdit && <th className="py-2"></th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {meterReadings.map(r => {
                              const doc = findDocument(r)
                              return (
                              <tr key={r.id} className="hover:bg-gray-50">
                                <td className="py-2 text-sm">{formatDate(r.reading_date)}</td>
                                <td className="py-2 text-sm font-mono">{r.reading_value || '—'}</td>
                                <td className="py-2 text-sm text-gray-500">{r.invoice_number ?? '—'}</td>
                                <td className="py-2 text-sm font-semibold text-blue-600">{r.invoice_amount ? formatCurrency(r.invoice_amount) : '—'}</td>
                                <td className="py-2">
                                  {doc ? (
                                    <button onClick={() => openDocument(doc)}
                                      className="flex items-center gap-1 text-xs text-emerald-600 hover:underline font-medium">
                                      <Eye className="w-3.5 h-3.5" /> Ver fatura
                                    </button>
                                  ) : (
                                    <button onClick={() => { setAssociateReading(r); setAssociateSearch('') }}
                                      className="flex items-center gap-1 text-xs text-blue-500 hover:underline font-medium">
                                      <Search className="w-3.5 h-3.5" /> Associar
                                    </button>
                                  )}
                                </td>
                                <td className="py-2 text-sm text-gray-400 max-w-xs truncate">{r.notes ?? '—'}</td>
                                {canEdit && (
                                  <td className="py-2">
                                    <button onClick={() => deleteReading(r.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </td>
                                )}
                              </tr>
                              )
                            })}
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

      {/* Modal Associar Documento */}
      {associateReading && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold text-lg text-gray-900">Associar Documento</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Leitura de {formatDate(associateReading.reading_date)}
                  {associateReading.invoice_number && ` — Nº ${associateReading.invoice_number}`}
                </p>
              </div>
              <button onClick={() => setAssociateReading(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input className="input pl-9 w-full" placeholder="Pesquisar por nome ou nº fatura..."
                value={associateSearch} onChange={e => setAssociateSearch(e.target.value)} autoFocus />
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
              {filteredDocs.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">Nenhum documento encontrado</p>
              ) : (
                filteredDocs.map(doc => (
                  <div key={doc.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:border-blue-300 hover:bg-blue-50 transition-colors cursor-pointer"
                    onClick={() => openDocument(doc)}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{doc.original_name ?? doc.file_path}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        {doc.doc_number && <span className="text-xs text-gray-500 font-mono">{doc.doc_number}</span>}
                        {doc.doc_date && <span className="text-xs text-gray-400">{formatDate(doc.doc_date)}</span>}
                        {doc.amount && <span className="text-xs font-medium text-blue-600">{formatCurrency(doc.amount)}</span>}
                      </div>
                    </div>
                    <button className="flex items-center gap-1 text-xs text-blue-600 font-medium ml-3 flex-shrink-0">
                      <Eye className="w-3.5 h-3.5" /> Abrir
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-end mt-4 pt-4 border-t border-gray-100">
              <button className="btn-secondary" onClick={() => setAssociateReading(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Contador */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-lg text-gray-900">{editMeter ? 'Editar Contador' : 'Novo Contador'}</h2>
              <button onClick={() => setShowModal(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            {!editMeter && (
              <div className="mb-5">
                <label
                  {...meterPdfDrop.dropProps}
                  className={`flex items-center gap-3 border-2 border-dashed rounded-lg p-4 cursor-pointer transition-colors ${
                    meterPdfDrop.isDragging ? 'border-blue-500 bg-blue-100' :
                    extractingMeter ? 'border-blue-300 bg-blue-50' :
                    meterExtractDone ? 'border-blue-400 bg-blue-50' :
                    'border-blue-300 bg-blue-50 hover:bg-blue-100'
                  }`}>
                  {extractingMeter ? <Loader2 className="w-5 h-5 text-blue-500 animate-spin flex-shrink-0" />
                    : meterExtractDone ? <CheckCircle className="w-5 h-5 text-blue-600 flex-shrink-0" />
                    : <Upload className="w-5 h-5 text-blue-600 flex-shrink-0" />}
                  <div className="min-w-0">
                    {extractingMeter ? (
                      <p className="text-sm font-medium text-blue-600">A ler fatura com IA...</p>
                    ) : meterPdfDrop.isDragging ? (
                      <p className="text-sm font-medium text-blue-700">Larga aqui a fatura</p>
                    ) : meterExtractDone ? (
                      <>
                        <p className="text-sm font-medium text-blue-700">✓ Campos preenchidos — confirma antes de guardar</p>
                        {meterExtractInfo && <p className="text-xs text-blue-600 truncate">{meterExtractInfo}</p>}
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-blue-700">Criar a partir de uma fatura de água</p>
                        <p className="text-xs text-blue-600">Arrasta para aqui ou clica — a IA preenche os campos abaixo</p>
                      </>
                    )}
                  </div>
                  <input type="file" accept=".pdf" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) extractMeterFromPdf(f); e.target.value = '' }} />
                </label>
                {meterExtractError && <p className="text-xs text-red-600 mt-1">{meterExtractError}</p>}
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label className="label">Nome *</label>
                <input className="input" placeholder="ex: Contador Geral Quinta" value={meterForm.name}
                  onChange={e => setMeterForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="label">Nº Contrato *</label>
                <input className="input" placeholder="ex: 1234567890" value={meterForm.contract_number}
                  onChange={e => setMeterForm(f => ({ ...f, contract_number: e.target.value }))} />
              </div>
              <div>
                <label className="label">Nº do Contador</label>
                <input className="input" placeholder="ex: 00123456" value={meterForm.meter_number}
                  onChange={e => setMeterForm(f => ({ ...f, meter_number: e.target.value }))} />
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

      {/* Modal Leitura Manual */}
      {showReadingModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-lg text-gray-900">Nova Leitura</h2>
              <button onClick={() => setShowReadingModal(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="mb-5">
              <label
                {...readingPdfDrop.dropProps}
                className={`flex items-center gap-3 border-2 border-dashed rounded-lg p-4 cursor-pointer transition-colors ${
                  readingPdfDrop.isDragging ? 'border-blue-500 bg-blue-100' :
                  extractingReading ? 'border-blue-300 bg-blue-50' :
                  readingExtractDone ? 'border-blue-400 bg-blue-50' :
                  'border-blue-300 bg-blue-50 hover:bg-blue-100'
                }`}>
                {extractingReading ? <Loader2 className="w-5 h-5 text-blue-500 animate-spin flex-shrink-0" />
                  : readingExtractDone ? <CheckCircle className="w-5 h-5 text-blue-600 flex-shrink-0" />
                  : <Upload className="w-5 h-5 text-blue-600 flex-shrink-0" />}
                <div className="min-w-0">
                  {extractingReading ? (
                    <p className="text-sm font-medium text-blue-600">A ler fatura com IA...</p>
                  ) : readingPdfDrop.isDragging ? (
                    <p className="text-sm font-medium text-blue-700">Larga aqui a fatura</p>
                  ) : readingExtractDone ? (
                    <>
                      <p className="text-sm font-medium text-blue-700">✓ Campos preenchidos — confirma antes de guardar</p>
                      {readingExtractInfo && <p className="text-xs text-blue-600 truncate">{readingExtractInfo}</p>}
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-blue-700">Preencher a partir de uma fatura de água</p>
                      <p className="text-xs text-blue-600">Arrasta para aqui ou clica — a IA preenche os campos abaixo</p>
                    </>
                  )}
                </div>
                <input type="file" accept=".pdf" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) extractReadingFromPdf(f); e.target.value = '' }} />
              </label>
              {readingExtractError && <p className="text-xs text-red-600 mt-1">{readingExtractError}</p>}
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Data *</label>
                  <input type="date" className="input" value={readingForm.reading_date}
                    onChange={e => setReadingForm(f => ({ ...f, reading_date: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Valor contador (m³)</label>
                  <input type="number" step="0.01" className="input" placeholder="ex: 1581"
                    value={readingForm.reading_value}
                    onChange={e => setReadingForm(f => ({ ...f, reading_value: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Nº Fatura</label>
                  <input className="input" placeholder="ex: FT2026..." value={readingForm.invoice_number}
                    onChange={e => setReadingForm(f => ({ ...f, invoice_number: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Valor Fatura (€)</label>
                  <input type="number" step="0.01" className="input" placeholder="ex: 93.64"
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
