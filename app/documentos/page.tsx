'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Search, FileText, Eye, FolderOpen, Trash2, X, Plus, Upload, Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

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

interface UploadResult {
  fileName: string
  status: 'pending' | 'processing' | 'success' | 'error' | 'duplicate'
  error?: string
  autoExpense?: boolean
  duplicate?: any
}

const tipoLabels: Record<string, string> = {
  fatura: '🧾 Fatura',
  fatura_luz: '⚡ Fatura Luz',
  fatura_agua: '💧 Fatura Água',
  registo_predial: '🏠 Registo Predial',
  carta: '✉️ Carta',
  outro: '📦 Outro',
  contrato: '📄 Contrato',
}

const tipoColors: Record<string, string> = {
  fatura: 'bg-orange-100 text-orange-700',
  fatura_luz: 'bg-yellow-100 text-yellow-700',
  fatura_agua: 'bg-blue-100 text-blue-700',
  registo_predial: 'bg-purple-100 text-purple-700',
  carta: 'bg-gray-100 text-gray-700',
  outro: 'bg-gray-100 text-gray-600',
  contrato: 'bg-blue-100 text-blue-700',
}

export default function DocumentosPage() {
  const { isAdmin } = useAuth()
  const [documents, setDocuments] = useState<Document[]>([])
  const [contracts, setContracts] = useState<Contrato[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterTipo, setFilterTipo] = useState('all')
  const [showUpload, setShowUpload] = useState(false)
  const [uploadTipo, setUploadTipo] = useState('fatura')
  const [uploadTipoCustom, setUploadTipoCustom] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadDone, setUploadDone] = useState(false)
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([])
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [forceDuplicate, setForceDuplicate] = useState<{ file: File; index: number } | null>(null)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)

    const { data: docs } = await supabase
      .from('documents')
      .select('*')
      .eq('status', 'ativo')
      .order('doc_date', { ascending: false })

    const { data: leases } = await supabase
      .from('leases')
      .select('id, contract_file_path, start_date, tenant:tenants(name), space:spaces(ref)')
      .not('contract_file_path', 'is', null)

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

  async function processFile(file: File, index: number, force = false) {
    setUploadResults(prev => prev.map((r, i) => i === index ? { ...r, status: 'processing' } : r))

    const formData = new FormData()
    formData.append('file', file)
    formData.append('tipo', uploadTipo)
    if (uploadTipoCustom) formData.append('tipo_custom', uploadTipoCustom)
    if (force) formData.append('force', 'true')

    const res = await fetch('/api/process-document', { method: 'POST', body: formData })
    const data = await res.json()

    if (data.duplicate && !force) {
      setUploadResults(prev => prev.map((r, i) => i === index ? { ...r, status: 'duplicate', duplicate: data.existing } : r))
      setForceDuplicate({ file, index })
      return
    }

    if (data.error) {
      setUploadResults(prev => prev.map((r, i) => i === index ? { ...r, status: 'error', error: data.error } : r))
    } else {
      setUploadResults(prev => prev.map((r, i) => i === index ? { ...r, status: 'success', autoExpense: data.autoExpense } : r))
    }
  }

  async function handleUpload() {
    if (files.length === 0) return
    setUploading(true); setUploadDone(false)
    const results: UploadResult[] = files.map(f => ({ fileName: f.name, status: 'pending' }))
    setUploadResults(results)

    for (let i = 0; i < files.length; i++) {
      await processFile(files[i], i)
    }

    setUploading(false); setUploadDone(true)
    fetchAll()
  }

  async function handleForceDuplicate() {
    if (!forceDuplicate) return
    setForceDuplicate(null)
    setUploading(true)
    await processFile(forceDuplicate.file, forceDuplicate.index, true)
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
      if (doc.file_path) await supabase.storage.from('documents').remove([doc.file_path])
      await supabase.from('documents').delete().eq('id', doc.id)
    } catch (e: any) {
      console.error('Erro ao apagar:', e)
    }

    setDeleting(false)
    setDeleteConfirm(null)
    fetchAll()
  }

  async function deleteContract(lease: Contrato) {
    if (!confirm(`Apagar o contrato de ${getTenantName(lease.tenant)}?`)) return
    if (lease.contract_file_path) {
      await supabase.storage.from('documents').remove([lease.contract_file_path])
    }
    await supabase.from('leases').update({ contract_file_path: null }).eq('id', lease.id)
    fetchAll()
  }

  function handleClose() {
    setShowUpload(false); setFiles([]); setUploadResults([])
    setUploadDone(false); setForceDuplicate(null)
  }

  const allDocs = [
    ...contracts.map(c => ({
      _tipo: 'contrato',
      _id: c.id,
      _nome: c.contract_file_path?.split('/').pop() ?? '—',
      _associado: `${getTenantName(c.tenant)} · ${getSpaceRef(c.space)}`,
      _data: c.start_date,
      _path: c.contract_file_path ?? '',
      _amount: null as number | null,
      _expense_id: null,
      _doc: null as Document | null,
      _contrato: c,
    })),
    ...documents.map(d => ({
      _tipo: d.tipo,
      _id: d.id,
      _nome: d.original_name ?? d.file_path.split('/').pop() ?? '—',
      _associado: d.supplier_name ?? d.items_summary ?? '—',
      _data: d.doc_date,
      _path: d.file_path,
      _amount: d.amount,
      _expense_id: d.expense_id,
      _doc: d,
      _contrato: null,
    })),
  ]

  const filtered = allDocs.filter(d => {
    const matchSearch = !search ||
      d._nome.toLowerCase().includes(search.toLowerCase()) ||
      d._associado.toLowerCase().includes(search.toLowerCase())
    const matchTipo = filterTipo === 'all' || d._tipo === filterTipo
    return matchSearch && matchTipo
  }).sort((a, b) => {
    if (!a._data) return 1
    if (!b._data) return -1
    return b._data.localeCompare(a._data)
  })

  const countByTipo = (tipo: string) => allDocs.filter(d => d._tipo === tipo).length

  return (
    <AppLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Documentos</h1>
            <p className="text-sm text-gray-500 mt-1">{allDocs.length} ficheiros guardados</p>
          </div>
          {isAdmin && (
            <button className="btn-primary" onClick={() => setShowUpload(true)}>
              <Plus className="w-4 h-4" />
              Carregar Documento
            </button>
          )}
        </div>

        {/* Resumo por tipo */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          {[
            { tipo: 'contrato', emoji: '📄', label: 'Contratos', color: 'text-blue-600' },
            { tipo: 'fatura', emoji: '🧾', label: 'Faturas', color: 'text-orange-600' },
            { tipo: 'fatura_luz', emoji: '⚡', label: 'Luz', color: 'text-yellow-600' },
            { tipo: 'fatura_agua', emoji: '💧', label: 'Água', color: 'text-blue-500' },
          ].map(({ tipo, emoji, label, color }) => (
            <div key={tipo}
              className={`card text-center py-3 cursor-pointer transition-colors hover:border-emerald-300 ${filterTipo === tipo ? 'border-emerald-400 bg-emerald-50' : ''}`}
              onClick={() => setFilterTipo(filterTipo === tipo ? 'all' : tipo)}>
              <p className="text-xl mb-1">{emoji}</p>
              <p className={`text-lg font-bold ${color}`}>{countByTipo(tipo)}</p>
              <p className="text-xs text-gray-500">{label}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { tipo: 'registo_predial', emoji: '🏠', label: 'Registos Prediais', color: 'text-purple-600' },
            { tipo: 'carta', emoji: '✉️', label: 'Cartas', color: 'text-gray-600' },
            { tipo: 'outro', emoji: '📦', label: 'Outros', color: 'text-gray-500' },
          ].map(({ tipo, emoji, label, color }) => (
            <div key={tipo}
              className={`card text-center py-3 cursor-pointer transition-colors hover:border-emerald-300 ${filterTipo === tipo ? 'border-emerald-400 bg-emerald-50' : ''}`}
              onClick={() => setFilterTipo(filterTipo === tipo ? 'all' : tipo)}>
              <p className="text-xl mb-1">{emoji}</p>
              <p className={`text-lg font-bold ${color}`}>{countByTipo(tipo)}</p>
              <p className="text-xs text-gray-500">{label}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-3 mb-6">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9" placeholder="Pesquisar por nome, fornecedor..."
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="input w-52" value={filterTipo} onChange={e => setFilterTipo(e.target.value)}>
            <option value="all">Todos os tipos</option>
            <option value="contrato">📄 Contratos</option>
            <option value="fatura">🧾 Faturas</option>
            <option value="fatura_luz">⚡ Faturas Luz</option>
            <option value="fatura_agua">💧 Faturas Água</option>
            <option value="registo_predial">🏠 Registos Prediais</option>
            <option value="carta">✉️ Cartas</option>
            <option value="outro">📦 Outros</option>
          </select>
          {filterTipo !== 'all' && (
            <button onClick={() => setFilterTipo('all')} className="text-xs text-gray-500 hover:underline">
              Limpar filtro
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-gray-400">
            <FolderOpen className="w-12 h-12 mb-3" />
            <p className="text-sm">Nenhum documento encontrado</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="table-header">Tipo</th>
                  <th className="table-header">Ficheiro</th>
                  <th className="table-header">Associado a</th>
                  <th className="table-header">Data</th>
                  <th className="table-header">Valor</th>
                  <th className="table-header">Despesa</th>
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
                        <span className="text-sm text-gray-700 truncate max-w-xs">{doc._nome}</span>
                      </div>
                    </td>
                    <td className="table-cell text-sm text-gray-600">{doc._associado}</td>
                    <td className="table-cell text-sm text-gray-500">
                      {doc._data ? formatDate(doc._data) : '—'}
                    </td>
                    <td className="table-cell text-sm font-medium text-red-600">
                      {doc._amount ? formatCurrency(doc._amount) : '—'}
                    </td>
                    <td className="table-cell">
                      {doc._expense_id ? (
                        <span className="text-xs text-emerald-600 font-medium">✅ Sim</span>
                      ) : doc._tipo === 'contrato' ? (
                        <span className="text-xs text-gray-400">—</span>
                      ) : (
                        <span className="text-xs text-yellow-600">⚠ Não</span>
                      )}
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        <button onClick={() => openDoc(doc._path)}
                          className="flex items-center gap-1 text-xs text-emerald-600 hover:underline font-medium">
                          <Eye className="w-3.5 h-3.5" /> Abrir
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => doc._contrato
                              ? deleteContract(doc._contrato)
                              : setDeleteConfirm({ doc: doc._doc!, hasExpense: !!doc._expense_id })
                            }
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

      {/* Modal Upload */}
      {showUpload && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-lg text-gray-900">Carregar Documento</h2>
              <button onClick={handleClose}><X className="w-5 h-5 text-gray-400" /></button>
            </div>

            {!uploading && !uploadDone && !forceDuplicate && (
              <div className="space-y-4">
                <div>
                  <label className="label">Tipo de Documento *</label>
                  <select className="input" value={uploadTipo} onChange={e => setUploadTipo(e.target.value)}>
                    <option value="fatura">🧾 Fatura</option>
                    <option value="fatura_luz">⚡ Fatura da Luz</option>
                    <option value="fatura_agua">💧 Fatura da Água</option>
                    <option value="registo_predial">🏠 Registo Predial</option>
                    <option value="carta">✉️ Carta</option>
                    <option value="outro">📦 Outro</option>
                  </select>
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
                </div>
              </div>
            )}

            {/* Deteção de duplicado */}
            {forceDuplicate && !uploading && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 space-y-3">
                <p className="text-sm text-yellow-800 font-medium">⚠ Este ficheiro já foi carregado anteriormente!</p>
                <p className="text-xs text-yellow-700">Ficheiro: <strong>{forceDuplicate.file.name}</strong></p>
                <p className="text-sm text-yellow-700">Queres carregar mesmo assim?</p>
                <div className="flex gap-2">
                  <button onClick={handleForceDuplicate}
                    className="flex-1 py-2 rounded-lg bg-yellow-500 text-white text-sm font-medium hover:bg-yellow-600">
                    Sim, carregar na mesma
                  </button>
                  <button onClick={handleClose}
                    className="flex-1 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50">
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {(uploading || uploadDone) && !forceDuplicate && (
              <div className="space-y-2">
                {!uploadDone && <p className="text-sm text-gray-600 mb-3">A processar com IA...</p>}
                {uploadDone && <p className="text-sm font-medium text-gray-700 mb-3">Processamento concluído!</p>}
                {uploadResults.map((r, i) => (
                  <div key={i} className={`flex items-center gap-3 p-3 rounded-lg ${
                    r.status === 'success' ? 'bg-emerald-50' :
                    r.status === 'error' ? 'bg-red-50' :
                    r.status === 'duplicate' ? 'bg-yellow-50' :
                    r.status === 'processing' ? 'bg-blue-50' : 'bg-gray-50'
                  }`}>
                    {r.status === 'success' && <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />}
                    {r.status === 'error' && <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />}
                    {r.status === 'duplicate' && <AlertCircle className="w-4 h-4 text-yellow-600 flex-shrink-0" />}
                    {r.status === 'processing' && <Loader2 className="w-4 h-4 animate-spin text-blue-600 flex-shrink-0" />}
                    {r.status === 'pending' && <div className="w-4 h-4 rounded-full border-2 border-gray-300 flex-shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">{r.fileName}</p>
                      {r.status === 'success' && r.autoExpense && <p className="text-xs text-emerald-600">✓ Despesa criada automaticamente</p>}
                      {r.status === 'success' && !r.autoExpense && <p className="text-xs text-gray-500">✓ Documento guardado</p>}
                      {r.status === 'duplicate' && <p className="text-xs text-yellow-700">⚠ Ficheiro duplicado detetado</p>}
                      {r.error && <p className="text-xs text-red-600">{r.error}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-3 mt-6">
              <button className="btn-secondary" onClick={handleClose}>
                {uploadDone ? 'Fechar' : 'Cancelar'}
              </button>
              {!uploadDone && !uploading && !forceDuplicate && (
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
                <p className="text-sm text-yellow-800 font-medium mb-3">
                  💸 Este documento tem uma despesa associada. O que queres fazer?
                </p>
                <div className="flex flex-col gap-2">
                  <button onClick={() => handleDeleteConfirm(true)} disabled={deleting}
                    className="w-full py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                    {deleting ? 'A apagar...' : '🗑️ Apagar documento e despesa'}
                  </button>
                  <button onClick={() => handleDeleteConfirm(false)} disabled={deleting}
                    className="w-full py-2.5 rounded-lg bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 disabled:opacity-50">
                    {deleting ? 'A apagar...' : '📄 Apagar só o documento'}
                  </button>
                  <button onClick={() => setDeleteConfirm(null)}
                    className="w-full py-2.5 rounded-lg border border-gray-200 text-gray-600 text-sm">
                    Cancelar
                  </button>
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
    </AppLayout>
  )
}
