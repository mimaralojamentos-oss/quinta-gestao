'use client'

import AppLayout from '@/components/layout/AppLayout'
import Link from 'next/link'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Search, FileText, Eye, FolderOpen, Trash2, X, Plus, Upload, Loader2, CheckCircle, AlertCircle, Edit2, Filter, ChevronDown, ChevronUp, ArrowUpDown, ArrowUp, ArrowDown, Zap } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { logAccess } from '@/lib/logAccess'

interface Document {
  id: string
  file_path: string
  original_name: string | null
  tipo: string
  tipo_custom: string | null
  supplier_name: string | null
  amount: number | null
  doc_date: string | null
  doc_number: string | null
  items_summary: string | null
  category: string | null
  owner: string | null
  expense_id: string | null
  ocr_done: boolean
  status: string
  created_at: string
}

interface Contrato {
  id: string
  contract_file_path: string
  start_date: string | null
  tenant: any
  space: any
}

interface DeleteConfirm {
  doc: Document
  hasExpense: boolean
}

interface Meter {
  id: string
  name: string
  contract_number: string | null
  location: string | null
}

interface UploadResult {
  fileName: string
  status: 'pending' | 'processing' | 'success' | 'error' | 'duplicate' | 'skipped'
  error?: string
  autoExpense?: boolean
  cashMovementCreated?: boolean
  duplicate?: any
  detectedTipo?: string
}

type SortField = 'tipo' | 'nome' | 'associado' | 'data' | 'valor' | 'despesa' | 'carregado' | null
type SortDir = 'asc' | 'desc'

const tipoLabels: Record<string, string> = {
  fatura: '🧾 Fatura',
  fatura_luz: '⚡ Fatura Luz',
  fatura_agua: '💧 Fatura Água',
  registo_predial: '🏠 Registo Predial',
  carta: '✉️ Carta',
  outro: '📦 Outro',
  contrato: '📄 Contrato',
  transferencia_interna: '🔄 Transferência Interna',
}

const tipoColors: Record<string, string> = {
  fatura: 'bg-orange-100 text-orange-700',
  fatura_luz: 'bg-yellow-100 text-yellow-700',
  fatura_agua: 'bg-blue-100 text-blue-700',
  registo_predial: 'bg-purple-100 text-purple-700',
  carta: 'bg-gray-100 text-gray-700',
  outro: 'bg-gray-100 text-gray-600',
  contrato: 'bg-blue-100 text-blue-700',
  transferencia_interna: 'bg-indigo-100 text-indigo-700',
}

function formatDateTime(dateStr: string): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })
}

export default function DocumentosPage() {
  const { isAdmin, isCoAdmin } = useAuth()
  const [documents, setDocuments] = useState<Document[]>([])
  const [contracts, setContracts] = useState<Contrato[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [filterTipo, setFilterTipo] = useState('all')
  const [filterDateStart, setFilterDateStart] = useState('')
  const [filterDateEnd, setFilterDateEnd] = useState('')
  const [filterValueMin, setFilterValueMin] = useState('')
  const [filterValueMax, setFilterValueMax] = useState('')
  const [filterDespesa, setFilterDespesa] = useState('all')
  const [showFilters, setShowFilters] = useState(false)

  const [sortField, setSortField] = useState<SortField>('carregado')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const [showUpload, setShowUpload] = useState(false)
  const [uploadTipo, setUploadTipo] = useState('automatico')
  const [uploadTipoCustom, setUploadTipoCustom] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadDone, setUploadDone] = useState(false)
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([])
  const [skipExpense, setSkipExpense] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [forceDuplicate, setForceDuplicate] = useState<{ file: File; index: number } | null>(null)
  const [editDoc, setEditDoc] = useState<Document | null>(null)
  const [editForm, setEditForm] = useState<any>({})
  const [saving, setSaving] = useState(false)

  const [linkDoc, setLinkDoc] = useState<Document | null>(null)
  const [meters, setMeters] = useState<Meter[]>([])
  const [selectedMeterId, setSelectedMeterId] = useState('')
  const [linkingToQuadro, setLinkingToQuadro] = useState(false)
  const [linkDone, setLinkDone] = useState<'success' | 'duplicate' | null>(null)

  const remainingFiles = useRef<{ file: File; index: number }[]>([])

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const { data: docs } = await supabase.from('documents').select('*').eq('status', 'ativo').order('created_at', { ascending: false })
    const { data: leases } = await supabase.from('leases').select('id, contract_file_path, start_date, tenant:tenants(name), space:spaces(ref)').not('contract_file_path', 'is', null)
    setDocuments(docs ?? [])
    setContracts((leases ?? []) as Contrato[])
    setLoading(false)
  }

  function getTenantName(tenant: any): string {
    if (!tenant) return '—'
    if (Array.isArray(tenant)) return tenant[0]?.name ?? '—'
    return tenant.name ?? '—'
  }

  function getSpaceRef(space: any): string {
    if (!space) return '—'
    if (Array.isArray(space)) return space[0]?.ref ?? '—'
    return space.ref ?? '—'
  }

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-gray-300 ml-1 inline" />
    return sortDir === 'asc'
      ? <ArrowUp className="w-3 h-3 text-emerald-600 ml-1 inline" />
      : <ArrowDown className="w-3 h-3 text-emerald-600 ml-1 inline" />
  }

  function openEditModal(doc: Document) {
    setEditDoc(doc)
    setEditForm({
      tipo: doc.tipo,
      tipo_custom: doc.tipo_custom ?? '',
      supplier_name: doc.supplier_name ?? '',
      amount: doc.amount != null ? String(doc.amount) : '',
      doc_date: doc.doc_date ?? '',
      doc_number: doc.doc_number ?? '',
      items_summary: doc.items_summary ?? '',
      category: doc.category ?? 'outros',
    })
  }

async function handleSaveEdit() {
  if (!editDoc) return
  setSaving(true)
  await supabase.from('documents').update({
    tipo: editForm.tipo,
    tipo_custom: editForm.tipo_custom || null,
    supplier_name: editForm.supplier_name || null,
    amount: editForm.amount ? parseFloat(editForm.amount) : null,
    doc_date: editForm.doc_date || null,
    doc_number: editForm.doc_number || null,
    items_summary: editForm.items_summary || null,
    category: editForm.category || null,
  }).eq('id', editDoc.id)

  // Se o documento tem uma despesa associada, atualiza também a categoria da despesa
  if (editDoc.expense_id && editForm.category) {
    await supabase.from('expenses').update({
      category: editForm.category,
    }).eq('id', editDoc.expense_id)
  }

  // Transferência interna: criar movimento de saída no Fundo de Maneio se ainda não existir
  if (editForm.tipo === 'transferencia_interna' && editForm.amount && editForm.doc_date) {
    const { data: existingMovement } = await supabase.from('cash_fund_movements')
      .select('id').eq('source', 'documento').eq('source_id', editDoc.id).maybeSingle()
    if (!existingMovement) {
      await supabase.from('cash_fund_movements').insert({
        movement_date: editForm.doc_date,
        description: `Transferência para banco - ${editForm.doc_date}`,
        amount: -Math.abs(parseFloat(editForm.amount)),
        type: 'saida',
        source: 'documento',
        source_id: editDoc.id,
        notes: 'Criado automaticamente a partir de documento de transferência interna',
      })
    }
  }

  await logAccess({ action: 'editar', page: '/documentos', details: `Editou documento "${editDoc.original_name ?? editDoc.file_path}"` })

  setSaving(false)
  setEditDoc(null)
  fetchAll()
}

  async function openLinkModal(doc: Document) {
    const { data } = await supabase.from('meters').select('id, name, contract_number, location').eq('active', true).order('name')
    setMeters(data ?? [])
    setSelectedMeterId(data?.[0]?.id ?? '')
    setLinkDone(null)
    setLinkDoc(doc)
  }

  async function confirmLink() {
    if (!linkDoc || !selectedMeterId) return
    setLinkingToQuadro(true)
    const readingDate = linkDoc.doc_date
    if (!readingDate) { setLinkingToQuadro(false); return }
    const { data: existing } = await supabase.from('meter_readings').select('id')
      .eq('meter_id', selectedMeterId).eq('reading_date', readingDate).maybeSingle()
    if (existing) { setLinkDone('duplicate'); setLinkingToQuadro(false); return }
    const { error: insertErr } = await supabase.from('meter_readings').insert({
      meter_id: selectedMeterId,
      reading_date: readingDate,
      reading_value: 0,
      invoice_amount: linkDoc.amount ?? null,
      invoice_number: linkDoc.doc_number ?? null,
      notes: `Ligado manualmente: ${linkDoc.original_name ?? ''}`,
    })
    if (insertErr) { alert(`Erro ao ligar: ${insertErr.message}`); setLinkingToQuadro(false); return }
    setLinkDone('success')
    setLinkingToQuadro(false)
  }

  async function processFile(file: File, index: number, force = false) {
    setUploadResults(prev => prev.map((r, i) => i === index ? { ...r, status: 'processing' } : r))
    const formData = new FormData()
    formData.append('file', file)
    formData.append('tipo', uploadTipo)
    if (uploadTipoCustom) formData.append('tipo_custom', uploadTipoCustom)
    if (force) formData.append('force', 'true')
    if (skipExpense) formData.append('skip_expense', 'true')
    const res = await fetch('/api/process-document', { method: 'POST', body: formData })
    const data = await res.json()
    if (data.duplicate && !force) {
      setUploadResults(prev => prev.map((r, i) => i === index ? { ...r, status: 'duplicate', duplicate: data.existing } : r))
      return 'duplicate'
    }
    if (data.error) {
      setUploadResults(prev => prev.map((r, i) => i === index ? { ...r, status: 'error', error: data.error } : r))
    } else {
      setUploadResults(prev => prev.map((r, i) => i === index ? { ...r, status: 'success', autoExpense: data.autoExpense, cashMovementCreated: data.cashMovementCreated, detectedTipo: data.detectedTipo } : r))
      await logAccess({ action: 'criar', page: '/documentos', details: `Carregou documento "${file.name}"` })
    }
    return 'done'
  }

  async function handleUpload() {
    if (files.length === 0) return
    setUploading(true); setUploadDone(false)
    const results: UploadResult[] = files.map(f => ({ fileName: f.name, status: 'pending' }))
    setUploadResults(results)
    for (let i = 0; i < files.length; i++) {
      const result = await processFile(files[i], i)
      if (result === 'duplicate') {
        remainingFiles.current = files.slice(i + 1).map((f, j) => ({ file: f, index: i + 1 + j }))
        setForceDuplicate({ file: files[i], index: i })
        setUploading(false)
        return
      }
    }
    setUploading(false); setUploadDone(true)
    fetchAll()
  }

  async function handleForceDuplicate() {
    if (!forceDuplicate) return
    setForceDuplicate(null); setUploading(true)
    await processFile(forceDuplicate.file, forceDuplicate.index, true)
    await continueUpload()
  }

  async function handleSkipDuplicate() {
    if (!forceDuplicate) return
    setUploadResults(prev => prev.map((r, i) => i === forceDuplicate.index ? { ...r, status: 'skipped' } : r))
    setForceDuplicate(null); setUploading(true)
    await continueUpload()
  }

  async function continueUpload() {
    for (const { file, index } of remainingFiles.current) {
      const result = await processFile(file, index)
      if (result === 'duplicate') {
        const remaining = remainingFiles.current.filter(r => r.index > index)
        remainingFiles.current = remaining
        setForceDuplicate({ file, index })
        setUploading(false)
        return
      }
    }
    remainingFiles.current = []
    setUploading(false); setUploadDone(true)
    fetchAll()
  }

  async function openDoc(path: string) {
    const { data } = await supabase.storage.from('documents').createSignedUrl(path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function handleDeleteConfirm(deleteExpense: boolean) {
    if (!deleteConfirm) return
    setDeleting(true)
    const { doc } = deleteConfirm
    try {
      if (deleteExpense && doc.expense_id) {
        await supabase.from('cash_fund_movements').delete().eq('source_id', doc.expense_id)
        await supabase.from('expenses').delete().eq('id', doc.expense_id)
      } else if (doc.expense_id) {
        await supabase.from('expenses').update({ invoice_id: null }).eq('id', doc.expense_id)
      }
      if (doc.tipo === 'transferencia_interna') {
        await supabase.from('cash_fund_movements').delete().eq('source', 'documento').eq('source_id', doc.id)
      }
      if (doc.file_path) await supabase.storage.from('documents').remove([doc.file_path])
      await supabase.from('documents').delete().eq('id', doc.id)
      await logAccess({ action: 'apagar', page: '/documentos', details: `Apagou documento "${doc.original_name ?? doc.file_path}"${deleteExpense ? ' e despesa associada' : ''}` })
    } catch (e: any) { console.error('Erro ao apagar:', e) }
    setDeleting(false); setDeleteConfirm(null); fetchAll()
  }

  async function deleteContract(lease: Contrato) {
    if (!confirm(`Apagar o contrato de ${getTenantName(lease.tenant)}?`)) return
    if (lease.contract_file_path) await supabase.storage.from('documents').remove([lease.contract_file_path])
    await supabase.from('leases').update({ contract_file_path: null }).eq('id', lease.id)
    await logAccess({ action: 'apagar', page: '/documentos', details: `Apagou contrato de ${getTenantName(lease.tenant)}` })
    fetchAll()
  }

  function handleClose() {
    setShowUpload(false); setFiles([]); setUploadResults([])
    setUploadDone(false); setForceDuplicate(null)
    remainingFiles.current = []
  }

  function clearFilters() {
    setSearch(''); setFilterTipo('all'); setFilterDateStart('')
    setFilterDateEnd(''); setFilterValueMin(''); setFilterValueMax(''); setFilterDespesa('all')
  }

  const hasActiveFilters = !!(search || filterTipo !== 'all' || filterDateStart || filterDateEnd || filterValueMin || filterValueMax || filterDespesa !== 'all')

  const allDocs = [
    ...contracts.map(c => ({
      _tipo: 'contrato', _id: c.id,
      _nome: c.contract_file_path?.split('/').pop() ?? '—',
      _associado: `${getTenantName(c.tenant)} · ${getSpaceRef(c.space)}`,
      _data: c.start_date, _path: c.contract_file_path ?? '',
      _amount: null as number | null, _expense_id: null,
      _doc: null as Document | null, _contrato: c,
      _descricao: '', _created_at: '',
    })),
    ...documents.map(d => ({
      _tipo: d.tipo, _id: d.id,
      _nome: d.original_name ?? d.file_path.split('/').pop() ?? '—',
      _associado: d.supplier_name ?? d.items_summary ?? '—',
      _data: d.doc_date, _path: d.file_path,
      _amount: d.amount, _expense_id: d.expense_id,
      _doc: d, _contrato: null,
      _descricao: d.items_summary ?? '',
      _created_at: d.created_at,
    })),
  ]

  const filtered = allDocs.filter(d => {
    if (search) {
      const s = search.toLowerCase()
      if (!d._nome.toLowerCase().includes(s) && !d._associado.toLowerCase().includes(s) && !d._descricao.toLowerCase().includes(s)) return false
    }
    if (filterTipo !== 'all' && d._tipo !== filterTipo) return false
    if (filterDateStart && d._data && d._data < filterDateStart) return false
    if (filterDateEnd && d._data && d._data > filterDateEnd) return false
    if (filterValueMin && (d._amount == null || d._amount < parseFloat(filterValueMin))) return false
    if (filterValueMax && (d._amount == null || d._amount > parseFloat(filterValueMax))) return false
    if (filterDespesa === 'sim' && !d._expense_id) return false
    if (filterDespesa === 'nao' && d._expense_id) return false
    return true
  }).sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    if (sortField === 'tipo') return dir * a._tipo.localeCompare(b._tipo)
    if (sortField === 'nome') return dir * a._nome.localeCompare(b._nome)
    if (sortField === 'associado') return dir * a._associado.localeCompare(b._associado)
    if (sortField === 'data') {
      if (!a._data) return 1; if (!b._data) return -1
      return dir * a._data.localeCompare(b._data)
    }
    if (sortField === 'valor') return dir * ((a._amount ?? 0) - (b._amount ?? 0))
    if (sortField === 'despesa') return dir * ((a._expense_id ? 1 : 0) - (b._expense_id ? 1 : 0))
    if (sortField === 'carregado') {
      if (!a._created_at) return 1; if (!b._created_at) return -1
      return dir * a._created_at.localeCompare(b._created_at)
    }
    if (!a._created_at) return 1; if (!b._created_at) return -1
    return b._created_at.localeCompare(a._created_at)
  })

  const countByTipo = (tipo: string) => allDocs.filter(d => d._tipo === tipo).length

  const tipoCards = [
    { tipo: 'all', emoji: '📁', label: 'Todos', color: 'text-gray-600' },
    { tipo: 'contrato', emoji: '📄', label: 'Contratos', color: 'text-blue-600' },
    { tipo: 'fatura', emoji: '🧾', label: 'Faturas', color: 'text-orange-600' },
    { tipo: 'fatura_luz', emoji: '⚡', label: 'Luz', color: 'text-yellow-600' },
    { tipo: 'fatura_agua', emoji: '💧', label: 'Água', color: 'text-blue-500' },
    { tipo: 'registo_predial', emoji: '🏠', label: 'Prediais', color: 'text-purple-600' },
    { tipo: 'carta', emoji: '✉️', label: 'Cartas', color: 'text-gray-600' },
    { tipo: 'outro', emoji: '📦', label: 'Outros', color: 'text-gray-500' },
    { tipo: 'transferencia_interna', emoji: '🔄', label: 'Transferências', color: 'text-indigo-600' },
  ]

  return (
    <AppLayout>
      <div className="p-4 md:p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Documentos</h1>
            <p className="text-sm text-gray-500 mt-1">{allDocs.length} ficheiros guardados</p>
          </div>
          {(isAdmin || isCoAdmin) && (
            <button className="btn-primary" onClick={() => setShowUpload(true)}>
              <Plus className="w-4 h-4" /> Carregar Documento
            </button>
          )}
        </div>

        <div className="flex gap-2 mb-6 flex-wrap">
          {tipoCards.map(({ tipo, emoji, label, color }) => (
            <button key={tipo} onClick={() => setFilterTipo(tipo)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${filterTipo === tipo ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
              <span>{emoji}</span>
              <span>{label}</span>
              <span className={`text-xs font-bold ${filterTipo === tipo ? 'text-emerald-600' : color}`}>
                {tipo === 'all' ? allDocs.length : countByTipo(tipo)}
              </span>
            </button>
          ))}
        </div>

        <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 mb-6">
          <div className="flex gap-3 items-center">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input className="input pl-9 w-full" placeholder="Pesquisar por nome, fornecedor ou descrição..."
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors flex-shrink-0 ${showFilters || filterDateStart || filterDateEnd || filterValueMin || filterValueMax || filterDespesa !== 'all' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              <Filter className="w-4 h-4" />
              Filtros
              {showFilters ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {hasActiveFilters && (
              <button onClick={clearFilters} className="text-xs text-red-500 hover:underline whitespace-nowrap flex-shrink-0">
                Limpar tudo
              </button>
            )}
          </div>

          {showFilters && (
            <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1.5">Data do documento — de</label>
                <input type="date" className="input text-sm w-full" value={filterDateStart} onChange={e => setFilterDateStart(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1.5">Data do documento — até</label>
                <input type="date" className="input text-sm w-full" value={filterDateEnd} onChange={e => setFilterDateEnd(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1.5">Despesa associada</label>
                <select className="input text-sm w-full" value={filterDespesa} onChange={e => setFilterDespesa(e.target.value)}>
                  <option value="all">Todas</option>
                  <option value="sim">✅ Com despesa</option>
                  <option value="nao">⚠ Sem despesa</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1.5">Valor mínimo (€)</label>
                <input type="number" step="0.01" placeholder="ex: 10" className="input text-sm w-full"
                  value={filterValueMin} onChange={e => setFilterValueMin(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1.5">Valor máximo (€)</label>
                <input type="number" step="0.01" placeholder="ex: 1000" className="input text-sm w-full"
                  value={filterValueMax} onChange={e => setFilterValueMax(e.target.value)} />
              </div>
            </div>
          )}

          {hasActiveFilters && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-500">{filtered.length} resultado(s)</span>
              {search && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">"{search}"</span>}
              {filterTipo !== 'all' && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{tipoLabels[filterTipo] ?? filterTipo}</span>}
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-gray-400">
            <FolderOpen className="w-12 h-12 mb-3" />
            <p className="text-sm">Nenhum documento encontrado</p>
            {hasActiveFilters && <button onClick={clearFilters} className="mt-2 text-xs text-blue-500 hover:underline">Limpar filtros</button>}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="table-header cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('tipo')}>Tipo <SortIcon field="tipo" /></th>
                  <th className="table-header cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('nome')}>Ficheiro <SortIcon field="nome" /></th>
                  <th className="table-header cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('associado')}>Associado a <SortIcon field="associado" /></th>
                  <th className="table-header cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('data')}>Data doc. <SortIcon field="data" /></th>
                  <th className="table-header cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('carregado')}>Carregado em <SortIcon field="carregado" /></th>
                  <th className="table-header cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('valor')}>Valor <SortIcon field="valor" /></th>
                  <th className="table-header cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('despesa')}>Despesa <SortIcon field="despesa" /></th>
                  <th className="table-header"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((doc, i) => (
                  <tr key={`${doc._tipo}-${doc._id}-${i}`} className="hover:bg-gray-50 transition-colors">
                    <td className="table-cell">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${tipoColors[doc._tipo] ?? 'bg-gray-100 text-gray-700'}`}>
                        {tipoLabels[doc._tipo] ?? doc._tipo}
                      </span>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <div>
                          <span className="text-sm text-gray-700 truncate max-w-xs block">{doc._nome}</span>
                          {doc._descricao && <span className="text-xs text-gray-400 truncate max-w-xs block">{doc._descricao}</span>}
                        </div>
                      </div>
                    </td>
                    <td className="table-cell text-sm text-gray-600">{doc._associado}</td>
                    <td className="table-cell text-sm text-gray-500">{doc._data ? formatDate(doc._data) : '—'}</td>
                    <td className="table-cell">
                      {doc._created_at ? <span className="text-xs text-gray-500">{formatDateTime(doc._created_at)}</span> : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="table-cell text-sm font-medium text-red-600">{doc._amount ? formatCurrency(doc._amount) : '—'}</td>
                    <td className="table-cell">
                      {doc._expense_id ? (
                        <Link href={`/despesas?expense_id=${doc._expense_id}`}
                          className="text-xs text-emerald-600 font-medium hover:underline">
                          ✅ Sim
                        </Link>
                      ) : doc._tipo === 'contrato' ? <span className="text-xs text-gray-400">—</span>
                        : <span className="text-xs text-yellow-600">⚠ Não</span>}
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        <button onClick={() => openDoc(doc._path)}
                          className="flex items-center gap-1 text-xs text-emerald-600 hover:underline font-medium">
                          <Eye className="w-3.5 h-3.5" /> Abrir
                        </button>
                        {(isAdmin || isCoAdmin) && doc._tipo === 'fatura_luz' && doc._doc && (
                          <button onClick={() => openLinkModal(doc._doc!)} className="text-gray-400 hover:text-yellow-500 transition-colors" title="Ligar a Quadro Elétrico">
                            <Zap className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {(isAdmin || isCoAdmin) && doc._doc && (
                          <button onClick={() => openEditModal(doc._doc!)} className="text-gray-400 hover:text-blue-500 transition-colors">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {(isAdmin || isCoAdmin) && (
                          <button onClick={() => doc._contrato ? deleteContract(doc._contrato) : setDeleteConfirm({ doc: doc._doc!, hasExpense: !!doc._expense_id })}
                            className="text-gray-300 hover:text-red-500 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Editar */}
      {editDoc && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-lg text-gray-900">Editar Documento</h2>
              <button onClick={() => setEditDoc(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="label">Tipo de Documento</label>
                <select className="input" value={editForm.tipo} onChange={e => setEditForm((f: any) => ({ ...f, tipo: e.target.value }))}>
                  <option value="fatura">🧾 Fatura</option>
                  <option value="fatura_luz">⚡ Fatura da Luz</option>
                  <option value="fatura_agua">💧 Fatura da Água</option>
                  <option value="registo_predial">🏠 Registo Predial</option>
                  <option value="carta">✉️ Carta</option>
                  <option value="outro">📦 Outro</option>
                  <option value="transferencia_interna">🔄 Transferência Interna</option>
                </select>
              </div>
              {editForm.tipo === 'outro' && (
                <div>
                  <label className="label">Descrição do tipo</label>
                  <input className="input" placeholder="ex: Seguro, Licença..." value={editForm.tipo_custom}
                    onChange={e => setEditForm((f: any) => ({ ...f, tipo_custom: e.target.value }))} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Data</label>
                  <input type="date" className="input" value={editForm.doc_date}
                    onChange={e => setEditForm((f: any) => ({ ...f, doc_date: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Valor (€)</label>
                  <input type="number" step="0.01" className="input" value={editForm.amount}
                    onChange={e => setEditForm((f: any) => ({ ...f, amount: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Fornecedor</label>
                  <input className="input" value={editForm.supplier_name}
                    onChange={e => setEditForm((f: any) => ({ ...f, supplier_name: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Nº Documento</label>
                  <input className="input" value={editForm.doc_number}
                    onChange={e => setEditForm((f: any) => ({ ...f, doc_number: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="label">Categoria</label>
                <select className="input" value={editForm.category} onChange={e => setEditForm((f: any) => ({ ...f, category: e.target.value }))}>
                  <option value="administracao">Administração</option>
                  <option value="obras">Obras</option>
                  <option value="edp">Eletricidade (EDP)</option>
                  <option value="pessoal">Pessoal</option>
                  <option value="contabilidade">Contabilidade</option>
                  <option value="manutencao">Manutenção</option>
                  <option value="outros">Outros</option>
                </select>
              </div>
              <div>
                <label className="label">Resumo / Descrição</label>
                <textarea className="input" rows={3} value={editForm.items_summary}
                  onChange={e => setEditForm((f: any) => ({ ...f, items_summary: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button className="btn-secondary" onClick={() => setEditDoc(null)}>Cancelar</button>
              <button className="btn-primary" onClick={handleSaveEdit} disabled={saving}>
                {saving ? 'A guardar...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Upload */}
      {showUpload && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-lg text-gray-900">Carregar Documento</h2>
              <button onClick={handleClose}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            {!uploading && !uploadDone && !forceDuplicate && uploadResults.length === 0 && (
              <div className="space-y-4">
                <div>
                  <label className="label">Tipo de Documento *</label>
                  <select className="input" value={uploadTipo} onChange={e => setUploadTipo(e.target.value)}>
                    <option value="automatico">🤖 Automático (detetado pela IA)</option>
                    <option value="fatura">🧾 Fatura</option>
                    <option value="fatura_luz">⚡ Fatura da Luz</option>
                    <option value="fatura_agua">💧 Fatura da Água</option>
                    <option value="registo_predial">🏠 Registo Predial</option>
                    <option value="carta">✉️ Carta</option>
                    <option value="outro">📦 Outro</option>
                    <option value="transferencia_interna">🔄 Transferência Interna</option>
                  </select>
                  {uploadTipo === 'automatico' && (
                    <p className="text-xs text-blue-600 mt-1.5">✨ A IA vai identificar automaticamente se é fatura, fatura de luz, água, etc.</p>
                  )}
                </div>
                {uploadTipo === 'outro' && (
                  <div>
                    <label className="label">Descrição do tipo</label>
                    <input className="input" placeholder="ex: Seguro, Licença..." value={uploadTipoCustom}
                      onChange={e => setUploadTipoCustom(e.target.value)} />
                  </div>
                )}
                <div>
                  <label className="label">
                    Ficheiros
                    <span className="text-xs text-emerald-600 font-normal ml-2">✨ OCR automático com IA</span>
                  </label>
                  <label className="flex flex-col items-center gap-3 border-2 border-dashed border-gray-200 rounded-xl p-6 cursor-pointer hover:border-emerald-400 transition-colors">
                    <Upload className="w-8 h-8 text-gray-300" />
                    <div className="text-center">
                      <p className="font-medium text-gray-700 text-sm">
                        {files.length > 0 ? `${files.length} ficheiro(s) selecionado(s)` : 'Clica para selecionar'}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">PDF, JPG, PNG — duplicados são detetados automaticamente</p>
                    </div>
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png" multiple className="hidden"
                      onChange={e => setFiles(Array.from(e.target.files ?? []))} />
                  </label>
                  {files.length > 0 && (
                    <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                      {files.map((f, i) => (
                        <p key={i} className="text-xs text-gray-500 flex items-center gap-1">
                          <FileText className="w-3 h-3 flex-shrink-0" /> {f.name}
                        </p>
                      ))}
                    </div>
                  )}
                  {['fatura', 'fatura_luz', 'fatura_agua', 'automatico'].includes(uploadTipo) && (
                    <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
                      <input type="checkbox" checked={!skipExpense} onChange={e => setSkipExpense(!e.target.checked)} className="accent-emerald-600 w-4 h-4" />
                      <span className="text-sm text-gray-700">Criar despesa automaticamente</span>
                    </label>
                  )}
                </div>
              </div>
            )}
            {forceDuplicate && !uploading && (
              <div className="space-y-4">
                {uploadResults.filter(r => r.status !== 'pending').length > 0 && (
                  <div className="space-y-1 max-h-40 overflow-y-auto mb-2">
                    {uploadResults.map((r, i) => (
                      r.status !== 'pending' && (
                        <div key={i} className={`flex items-center gap-2 p-2 rounded-lg text-xs ${r.status === 'success' ? 'bg-emerald-50' : r.status === 'error' ? 'bg-red-50' : r.status === 'skipped' ? 'bg-gray-50' : 'bg-yellow-50'}`}>
                          {r.status === 'success' && <CheckCircle className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />}
                          {r.status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-red-600 flex-shrink-0" />}
                          {r.status === 'skipped' && <span className="text-gray-400 flex-shrink-0">—</span>}
                          {r.status === 'duplicate' && <AlertCircle className="w-3.5 h-3.5 text-yellow-600 flex-shrink-0" />}
                          <span className="truncate text-gray-700">{r.fileName}</span>
                        </div>
                      )
                    ))}
                  </div>
                )}
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 space-y-3">
                  <p className="text-sm text-yellow-800 font-medium">⚠ Este ficheiro já foi carregado anteriormente!</p>
                  <p className="text-xs text-yellow-700">Ficheiro: <strong>{forceDuplicate.file.name}</strong></p>
                  <div className="flex gap-2">
                    <button onClick={handleForceDuplicate} className="flex-1 py-2 rounded-lg bg-yellow-500 text-white text-sm font-medium hover:bg-yellow-600">
                      Sim, carregar na mesma
                    </button>
                    <button onClick={handleSkipDuplicate} className="flex-1 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50">
                      Saltar este ficheiro
                    </button>
                  </div>
                </div>
              </div>
            )}
            {(uploading || uploadDone) && !forceDuplicate && (
              <div className="space-y-2">
                {!uploadDone && <p className="text-sm text-gray-600 mb-3">A processar com IA...</p>}
                {uploadDone && <p className="text-sm font-medium text-gray-700 mb-3">Processamento concluído!</p>}
                {uploadResults.map((r, i) => (
                  <div key={i} className={`flex items-center gap-3 p-3 rounded-lg ${r.status === 'success' ? 'bg-emerald-50' : r.status === 'error' ? 'bg-red-50' : r.status === 'duplicate' ? 'bg-yellow-50' : r.status === 'skipped' ? 'bg-gray-50' : r.status === 'processing' ? 'bg-blue-50' : 'bg-gray-50'}`}>
                    {r.status === 'success' && <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />}
                    {r.status === 'error' && <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />}
                    {r.status === 'duplicate' && <AlertCircle className="w-4 h-4 text-yellow-600 flex-shrink-0" />}
                    {r.status === 'skipped' && <span className="text-gray-400 text-xs flex-shrink-0">—</span>}
                    {r.status === 'processing' && <Loader2 className="w-4 h-4 animate-spin text-blue-600 flex-shrink-0" />}
                    {r.status === 'pending' && <div className="w-4 h-4 rounded-full border-2 border-gray-300 flex-shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">{r.fileName}</p>
                      {r.status === 'success' && r.detectedTipo && uploadTipo === 'automatico' && (
                        <p className="text-xs text-blue-600">🤖 Detetado: {tipoLabels[r.detectedTipo] ?? r.detectedTipo}</p>
                      )}
                      {r.status === 'success' && r.autoExpense && <p className="text-xs text-emerald-600">✓ Despesa criada automaticamente</p>}
                      {r.status === 'success' && r.cashMovementCreated && <p className="text-xs text-emerald-600">✓ Movimento criado no Fundo de Maneio</p>}
                      {r.status === 'success' && !r.autoExpense && !r.cashMovementCreated && !r.detectedTipo && <p className="text-xs text-gray-500">✓ Documento guardado</p>}
                      {r.status === 'skipped' && <p className="text-xs text-gray-500">Saltado</p>}
                      {r.error && <p className="text-xs text-red-600">{r.error}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-3 mt-6">
              <button className="btn-secondary" onClick={handleClose}>{uploadDone ? 'Fechar' : 'Cancelar'}</button>
              {!uploadDone && !uploading && !forceDuplicate && uploadResults.length === 0 && (
                <button className="btn-primary" onClick={handleUpload} disabled={files.length === 0}>
                  <FileText className="w-4 h-4" />
                  Carregar {files.length > 0 ? `${files.length} ficheiro(s)` : ''}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal apagar */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg text-gray-900">Apagar Documento</h2>
              <button onClick={() => setDeleteConfirm(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <p className="text-sm text-gray-600 mb-2">Tens a certeza que queres apagar:</p>
            <p className="font-medium text-gray-900 mb-4">{deleteConfirm.doc.original_name ?? deleteConfirm.doc.file_path}</p>
            {deleteConfirm.hasExpense ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="text-sm text-yellow-800 font-medium mb-3">💸 Este documento tem uma despesa associada. O que queres fazer?</p>
                <div className="flex flex-col gap-2">
                  <button onClick={() => handleDeleteConfirm(true)} disabled={deleting}
                    className="w-full py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                    {deleting ? 'A apagar...' : '🗑️ Apagar documento e despesa'}
                  </button>
                  <button onClick={() => handleDeleteConfirm(false)} disabled={deleting}
                    className="w-full py-2.5 rounded-lg bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 disabled:opacity-50">
                    {deleting ? 'A apagar...' : '📄 Apagar só o documento'}
                  </button>
                  <button onClick={() => setDeleteConfirm(null)} className="w-full py-2.5 rounded-lg border border-gray-200 text-gray-600 text-sm">Cancelar</button>
                </div>
              </div>
            ) : (
              <div className="flex justify-end gap-3">
                <button className="btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancelar</button>
                <button onClick={() => handleDeleteConfirm(false)} disabled={deleting}
                  className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                  {deleting ? 'A apagar...' : 'Apagar'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Ligar Fatura ao Quadro Elétrico */}
      {linkDoc && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-lg text-gray-900">Ligar Fatura ao Quadro</h2>
              <button onClick={() => setLinkDoc(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            {!linkDone ? (
              <>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                  <p className="text-sm font-medium text-gray-800 truncate">{linkDoc.original_name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {linkDoc.doc_date ? formatDate(linkDoc.doc_date) : 'Sem data'} {linkDoc.amount ? '· ' + formatCurrency(linkDoc.amount) : ''}
                  </p>
                </div>
                {!linkDoc.doc_date && (
                  <p className="text-xs text-red-600 mb-3">Este documento nao tem data. Edita o documento primeiro.</p>
                )}
                <div className="mb-5">
                  <label className="label">Quadro Eletrico</label>
                  <select className="input" value={selectedMeterId} onChange={e => setSelectedMeterId(e.target.value)}>
                    {meters.length === 0 && <option value="">Sem quadros disponiveis</option>}
                    {meters.map(m => (
                      <option key={m.id} value={m.id}>{m.name}{m.location ? ' - ' + m.location : ''}</option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end gap-3">
                  <button className="btn-secondary" onClick={() => setLinkDoc(null)}>Cancelar</button>
                  <button className="btn-primary" onClick={confirmLink}
                    disabled={linkingToQuadro || !selectedMeterId || !linkDoc.doc_date}>
                    {linkingToQuadro ? <><Loader2 className="w-4 h-4 animate-spin inline mr-1" />A ligar...</> : <><Zap className="w-4 h-4 inline mr-1" />Ligar</>}
                  </button>
                </div>
              </>
            ) : linkDone === 'success' ? (
              <div className="text-center py-4">
                <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
                <p className="font-medium text-gray-900">Ligado com sucesso!</p>
                <p className="text-sm text-gray-500 mt-1">A leitura foi criada no Quadro Eletrico.</p>
                <button className="btn-secondary mt-4" onClick={() => setLinkDoc(null)}>Fechar</button>
              </div>
            ) : (
              <div className="text-center py-4">
                <AlertCircle className="w-10 h-10 text-yellow-500 mx-auto mb-3" />
                <p className="font-medium text-gray-900">Ja existe uma leitura nesta data</p>
                <p className="text-sm text-gray-500 mt-1">Ja ha uma leitura registada para este quadro na data da fatura.</p>
                <button className="btn-secondary mt-4" onClick={() => setLinkDoc(null)}>Fechar</button>
              </div>
            )}
          </div>
        </div>
      )}
    </AppLayout>
  )
}

// https://quinta-gestao.vercel.app/documentos
