'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, Zap, Trash2, X, ChevronDown, ChevronRight, Upload, Loader2, RefreshCw, CheckCircle, AlertCircle, BarChart2, Eye, Search } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

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

interface Document {
  id: string
  file_path: string
  original_name: string | null
  doc_number: string | null
  doc_date: string | null
  amount: number | null
}

interface UploadResult {
  fileName: string
  status: 'pending' | 'processing' | 'success' | 'error' | 'duplicate'
  meterName?: string
  error?: string
}

type FilterType = 'all' | 'year' | 'semester' | 'trimester' | 'custom'

const METER_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6']

export default function QuadrosPage() {
  const { isAdmin, isCoAdmin, profile } = useAuth()
  const canEdit = isAdmin || isCoAdmin || profile?.role === 'electrician'
  const [meters, setMeters] = useState<Meter[]>([])
  const [readings, setReadings] = useState<Record<string, MeterReading[]>>({})
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [showModal, setShowModal] = useState(false)
  const [showReadingModal, setShowReadingModal] = useState<string | null>(null)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [showChart, setShowChart] = useState(false)
  const [editMeter, setEditMeter] = useState<Meter | null>(null)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importDone, setImportDone] = useState(false)
  const [importResults, setImportResults] = useState<UploadResult[]>([])
  const [uploadFiles, setUploadFiles] = useState<File[]>([])
  const [meterForm, setMeterForm] = useState({ name: '', contract_number: '', cpe: '', location: '' })
  const [readingForm, setReadingForm] = useState({
    reading_date: new Date().toISOString().slice(0, 10),
    reading_value: '',
    invoice_amount: '',
    invoice_number: '',
    notes: ''
  })

  const [associateReading, setAssociateReading] = useState<MeterReading | null>(null)
  const [associateSearch, setAssociateSearch] = useState('')

  const [filterType, setFilterType] = useState<FilterType>('all')
  const [filterYear, setFilterYear] = useState('2026')
  const [filterSemester, setFilterSemester] = useState('1')
  const [filterTrimester, setFilterTrimester] = useState('1')
  const [filterStart, setFilterStart] = useState('2026-01-01')
  const [filterEnd, setFilterEnd] = useState(new Date().toISOString().slice(0, 10))
  const [chartData, setChartData] = useState<Record<string, any>[]>([])

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

    const { data: docs } = await supabase
      .from('documents')
      .select('id, file_path, original_name, doc_number, doc_date, amount')
      .eq('tipo', 'fatura_luz')
      .eq('status', 'ativo')
      .order('doc_date', { ascending: false })
    setDocuments(docs ?? [])

    setLoading(false)
  }

  function findDocument(reading: MeterReading): Document | null {
    if (!reading.invoice_number) return null
    return documents.find(d =>
      d.doc_number && d.doc_number.trim() === reading.invoice_number!.trim()
    ) ?? null
  }

  async function openDocument(doc: Document) {
    const { data } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const filteredDocs = documents.filter(d => {
    if (!associateSearch) return true
    const s = associateSearch.toLowerCase()
    return (
      (d.original_name ?? '').toLowerCase().includes(s) ||
      (d.doc_number ?? '').toLowerCase().includes(s)
    )
  })

  // Recarrega os dados do gráfico sempre que as leituras, quadros ou filtros mudam
  // (fetchAll() atualiza readings/meters após apagar, adicionar ou editar)
  useEffect(() => {
    loadChartData()
  }, [readings, meters, filterType, filterYear, filterSemester, filterTrimester, filterStart, filterEnd])

  function loadChartData() {
    // Para 'all', usar a leitura mais antiga disponível
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
      const point: Record<string, any> = {
        month: new Date(month + '-01').toLocaleDateString('pt-PT', { month: 'short', year: '2-digit' })
      }
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
      await supabase.from('meters').update({
        name: meterForm.name, contract_number: meterForm.contract_number,
        cpe: meterForm.cpe || null, location: meterForm.location || null,
      }).eq('id', editMeter.id)
    } else {
      await supabase.from('meters').insert({
        name: meterForm.name, contract_number: meterForm.contract_number,
        cpe: meterForm.cpe || null, location: meterForm.location || null,
      })
    }
    setSaving(false); setShowModal(false); setEditMeter(null); fetchAll()
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

  async function handleUploadPDF() {
    if (uploadFiles.length === 0) return
    setImporting(true); setImportDone(false)
    const results: UploadResult[] = uploadFiles.map(f => ({ fileName: f.name, status: 'pending' }))
    setImportResults(results)
    for (let i = 0; i < uploadFiles.length; i++) {
      const file = uploadFiles[i]
      setImportResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'processing' } : r))
      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('tipo', 'fatura_luz')
        const res = await fetch('/api/process-document', { method: 'POST', body: formData })
        const data = await res.json()
        if (data.duplicate) {
          setImportResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'duplicate' } : r))
        } else if (data.error) {
          setImportResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'error', error: data.error } : r))
        } else {
          const meterName = data.meterReadingCreated ? 'Leitura criada' : 'Sem quadro correspondente'
          setImportResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'success', meterName } : r))
        }
      } catch (e: any) {
        setImportResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'error', error: e.message } : r))
      }
    }
    setImporting(false); setImportDone(true); fetchAll()
  }

  async function handleImportExisting() {
    setImporting(true); setImportDone(false)
    setImportResults([{ fileName: 'A pesquisar faturas EDP nos documentos...', status: 'processing' }])
    const { data: docs } = await supabase.from('documents').select('*').eq('tipo', 'fatura_luz').eq('status', 'ativo')
    if (!docs || docs.length === 0) {
      setImportResults([{ fileName: 'Nenhuma fatura EDP encontrada nos documentos', status: 'error' }])
      setImporting(false); setImportDone(true); return
    }
    const results: UploadResult[] = []
    for (const doc of docs) {
      if (!doc.doc_date) { results.push({ fileName: doc.original_name ?? doc.file_path, status: 'error', error: 'Sem data' }); continue }
      const { data: allMeters } = await supabase.from('meters').select('id, name, contract_number')
      let matchedMeter = null
      if (allMeters && doc.items_summary) {
        for (const m of allMeters) {
          if (doc.items_summary.includes(m.contract_number) || (doc.original_name && doc.original_name.includes(m.name.replace('Quadro ', '')))) {
            matchedMeter = m; break
          }
        }
      }
      if (!matchedMeter && allMeters && doc.original_name) {
        for (const m of allMeters) {
          if (doc.original_name.includes(m.name.replace('Quadro ', ''))) { matchedMeter = m; break }
        }
      }
      if (!matchedMeter) { results.push({ fileName: doc.original_name ?? doc.file_path, status: 'error', error: 'Quadro não identificado' }); continue }
      const { data: existingReading } = await supabase.from('meter_readings').select('id').eq('meter_id', matchedMeter.id).eq('reading_date', doc.doc_date).single()
      if (existingReading) { results.push({ fileName: doc.original_name ?? doc.file_path, status: 'duplicate', meterName: matchedMeter.name }); continue }
      await supabase.from('meter_readings').insert({
        meter_id: matchedMeter.id, reading_date: doc.doc_date, reading_value: 0,
        invoice_amount: doc.amount ?? null, invoice_number: doc.doc_number ?? null,
        notes: `Importado de documento existente: ${doc.original_name ?? ''}`,
      })
      results.push({ fileName: doc.original_name ?? doc.file_path, status: 'success', meterName: matchedMeter.name })
    }
    setImportResults(results); setImporting(false); setImportDone(true); fetchAll()
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

  function closeUploadModal() {
    setShowUploadModal(false); setUploadFiles([]); setImportResults([]); setImportDone(false)
  }

  const totalFaturas = Object.values(readings).flat().reduce((s, r) => s + (r.invoice_amount ?? 0), 0)
  const years = ['2025', '2026', '2027', '2028']

  return (
    <AppLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Quadros da Quinta</h1>
            <p className="text-sm text-gray-500 mt-1">{meters.length} quadros registados</p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setShowChart(!showChart)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${showChart ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              <BarChart2 className="w-4 h-4" /> Gráfico
            </button>
            {canEdit && (
              <>
                <button className="btn-secondary" onClick={() => { setShowImportModal(true); setImportResults([]); setImportDone(false) }}>
                  <RefreshCw className="w-4 h-4" /> Importar existentes
                </button>
                <button className="btn-secondary" onClick={() => { setShowUploadModal(true); setImportResults([]); setImportDone(false) }}>
                  <Upload className="w-4 h-4" /> Upload fatura EDP
                </button>
                <button className="btn-primary" onClick={() => { setEditMeter(null); setMeterForm({ name: '', contract_number: '', cpe: '', location: '' }); setShowModal(true) }}>
                  <Plus className="w-4 h-4" /> Novo Quadro
                </button>
              </>
            )}
          </div>
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

        {/* Painel do Gráfico */}
        {showChart && (
          <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-6 mb-6">
            <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-emerald-600" />
              Consumo por Quadro — Valor Fatura (€)
            </h2>
            <div className="flex flex-wrap items-center gap-3 mb-5">
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
                {[{ value: 'all', label: 'Tudo' }, { value: 'year', label: 'Ano' }, { value: 'semester', label: 'Semestre' }, { value: 'trimester', label: 'Trimestre' }, { value: 'custom', label: 'Datas' }].map(opt => (
                  <button key={opt.value} onClick={() => setFilterType(opt.value as FilterType)}
                    className={`px-3 py-1.5 font-medium transition-colors ${filterType === opt.value ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
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
                      {canEdit && (
                        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                          <button onClick={() => openEdit(meter)} className="text-xs text-emerald-600 hover:underline font-medium">Editar</button>
                          <button onClick={() => { setShowReadingModal(meter.id); setReadingForm({ reading_date: new Date().toISOString().slice(0, 10), reading_value: '', invoice_amount: '', invoice_number: '', notes: '' }) }}
                            className="text-xs text-blue-600 hover:underline font-medium">+ Leitura manual</button>
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
                                  <td className="py-2 text-sm font-semibold text-red-600">{r.invoice_amount ? formatCurrency(r.invoice_amount) : '—'}</td>
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
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:border-emerald-300 hover:bg-emerald-50 transition-colors cursor-pointer"
                    onClick={() => openDocument(doc)}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{doc.original_name ?? doc.file_path}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        {doc.doc_number && <span className="text-xs text-gray-500 font-mono">{doc.doc_number}</span>}
                        {doc.doc_date && <span className="text-xs text-gray-400">{formatDate(doc.doc_date)}</span>}
                        {doc.amount && <span className="text-xs font-medium text-red-600">{formatCurrency(doc.amount)}</span>}
                      </div>
                    </div>
                    <button className="flex items-center gap-1 text-xs text-emerald-600 font-medium ml-3 flex-shrink-0">
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

      {/* Modal Upload PDF */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-lg text-gray-900">Upload Fatura EDP</h2>
              <button onClick={closeUploadModal}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            {!importing && !importDone && (
              <div className="space-y-4">
                <p className="text-sm text-gray-500">Carrega faturas EDP — os dados são extraídos automaticamente com IA e a leitura é associada ao quadro correto.</p>
                <label className="flex flex-col items-center gap-3 border-2 border-dashed border-gray-200 rounded-xl p-6 cursor-pointer hover:border-emerald-400 transition-colors">
                  <Upload className="w-8 h-8 text-gray-300" />
                  <div className="text-center">
                    <p className="font-medium text-gray-700 text-sm">
                      {uploadFiles.length > 0 ? `${uploadFiles.length} ficheiro(s) selecionado(s)` : 'Clica para selecionar faturas EDP (PDF)'}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">✨ OCR automático — extrai leituras e valores</p>
                  </div>
                  <input type="file" accept=".pdf" multiple className="hidden"
                    onChange={e => setUploadFiles(Array.from(e.target.files ?? []))} />
                </label>
              </div>
            )}
            {(importing || importDone) && (
              <div className="space-y-2">
                {!importDone && <p className="text-sm text-gray-600 mb-3">A processar faturas com IA...</p>}
                {importDone && <p className="text-sm font-medium text-gray-700 mb-3">Processamento concluído!</p>}
                {importResults.map((r, i) => (
                  <div key={i} className={`flex items-center gap-3 p-3 rounded-lg ${r.status === 'success' ? 'bg-emerald-50' : r.status === 'error' ? 'bg-red-50' : r.status === 'duplicate' ? 'bg-yellow-50' : r.status === 'processing' ? 'bg-blue-50' : 'bg-gray-50'}`}>
                    {r.status === 'success' && <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />}
                    {r.status === 'error' && <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />}
                    {r.status === 'duplicate' && <AlertCircle className="w-4 h-4 text-yellow-600 flex-shrink-0" />}
                    {r.status === 'processing' && <Loader2 className="w-4 h-4 animate-spin text-blue-600 flex-shrink-0" />}
                    {r.status === 'pending' && <div className="w-4 h-4 rounded-full border-2 border-gray-300 flex-shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">{r.fileName}</p>
                      {r.status === 'success' && <p className="text-xs text-emerald-600">{r.meterName}</p>}
                      {r.status === 'duplicate' && <p className="text-xs text-yellow-700">Já carregado anteriormente</p>}
                      {r.error && <p className="text-xs text-red-600">{r.error}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-3 mt-6">
              <button className="btn-secondary" onClick={closeUploadModal}>{importDone ? 'Fechar' : 'Cancelar'}</button>
              {!importing && !importDone && (
                <button className="btn-primary" onClick={handleUploadPDF} disabled={uploadFiles.length === 0}>
                  <Upload className="w-4 h-4" /> Processar {uploadFiles.length > 0 ? `${uploadFiles.length} fatura(s)` : ''}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Importar Existentes */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-lg text-gray-900">Importar faturas EDP existentes</h2>
              <button onClick={() => { setShowImportModal(false); setImportResults([]); setImportDone(false) }}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            {!importing && !importDone && (
              <div>
                <p className="text-sm text-gray-600 mb-4">Vai pesquisar todos os documentos do tipo <strong>Fatura da Luz</strong> já carregados na app e criar as leituras nos quadros correspondentes automaticamente.</p>
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm text-blue-700">
                  ℹ️ Documentos já importados serão ignorados automaticamente.
                </div>
              </div>
            )}
            {(importing || importDone) && (
              <div className="space-y-2">
                {!importDone && <p className="text-sm text-gray-600 mb-3">A importar...</p>}
                {importDone && <p className="text-sm font-medium text-gray-700 mb-3">Importação concluída!</p>}
                {importResults.map((r, i) => (
                  <div key={i} className={`flex items-center gap-3 p-3 rounded-lg ${r.status === 'success' ? 'bg-emerald-50' : r.status === 'error' ? 'bg-red-50' : r.status === 'duplicate' ? 'bg-yellow-50' : 'bg-blue-50'}`}>
                    {r.status === 'success' && <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />}
                    {r.status === 'error' && <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />}
                    {r.status === 'duplicate' && <AlertCircle className="w-4 h-4 text-yellow-600 flex-shrink-0" />}
                    {r.status === 'processing' && <Loader2 className="w-4 h-4 animate-spin text-blue-600 flex-shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">{r.fileName}</p>
                      {r.meterName && <p className="text-xs text-emerald-600">{r.meterName}</p>}
                      {r.error && <p className="text-xs text-red-600">{r.error}</p>}
                      {r.status === 'duplicate' && <p className="text-xs text-yellow-700">Já importado</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-3 mt-6">
              <button className="btn-secondary" onClick={() => { setShowImportModal(false); setImportResults([]); setImportDone(false) }}>
                {importDone ? 'Fechar' : 'Cancelar'}
              </button>
              {!importing && !importDone && (
                <button className="btn-primary" onClick={handleImportExisting}>
                  <RefreshCw className="w-4 h-4" /> Importar agora
                </button>
              )}
            </div>
          </div>
        </div>
      )}

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

      {/* Modal Leitura Manual */}
      {showReadingModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-lg text-gray-900">Nova Leitura Manual</h2>
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
                  <label className="label">Valor contador (kWh)</label>
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

// https://quinta-gestao.vercel.app/eletricidade/quadros
