'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, Search, FileText, Upload, Loader2, X, Eye, CheckCircle, AlertCircle, ArrowRightCircle, Trash2 } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

interface Invoice {
  id: string
  invoice_number: string | null
  supplier_name: string | null
  supplier_nif: string | null
  buyer_name: string | null
  buyer_nif: string | null
  amount: number | null
  invoice_date: string | null
  category: string | null
  payment_method: string | null
  owner: string | null
  description: string | null
  items_summary: string | null
  notes: string | null
  status: string
  file_path: string | null
  expense_id: string | null
  created_at: string
}

interface DeleteConfirm {
  invoice: Invoice
  hasExpense: boolean
}

const categoryColors: Record<string, string> = {
  obras: 'bg-orange-100 text-orange-700',
  edp: 'bg-yellow-100 text-yellow-700',
  pessoal: 'bg-blue-100 text-blue-700',
  contabilidade: 'bg-purple-100 text-purple-700',
  manutencao: 'bg-cyan-100 text-cyan-700',
  outros: 'bg-gray-100 text-gray-700',
}

const categoryLabels: Record<string, string> = {
  obras: 'Obras', edp: 'Eletricidade', pessoal: 'Pessoal',
  contabilidade: 'Contabilidade', manutencao: 'Manutenção', outros: 'Outros',
}

interface UploadResult {
  fileName: string
  status: 'pending' | 'processing' | 'success' | 'error'
  autoExpense?: boolean
  error?: string
}

export default function FaturasPage() {
  const { isAdmin } = useAuth()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterOwner, setFilterOwner] = useState('all')
  const [filterStatus, setFilterStatus] = useState<'all' | 'convertida' | 'por_converter'>('all')
  const [showUpload, setShowUpload] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [uploadError, setUploadError] = useState('')
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([])
  const [uploadDone, setUploadDone] = useState(false)
  const [converting, setConverting] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null)
  const [deleting, setDeleting] = useState(false)
  const supabase = createClient()

  useEffect(() => { fetchInvoices() }, [])

  async function fetchInvoices() {
    setLoading(true)
    const { data } = await supabase
      .from('invoices')
      .select('*')
      .order('invoice_date', { ascending: false })
    setInvoices(data ?? [])
    setLoading(false)
  }

  async function handleUpload() {
    if (files.length === 0) { setUploadError('Selecione pelo menos um ficheiro PDF'); return }
    setUploading(true); setUploadError(''); setUploadDone(false)
    const results: UploadResult[] = files.map(f => ({ fileName: f.name, status: 'pending' }))
    setUploadResults(results)
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      setUploadResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'processing' } : r))
      try {
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch('/api/process-invoice', { method: 'POST', body: formData })
        const data = await res.json()
        if (data.error) {
          setUploadResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'error', error: data.error } : r))
        } else {
          setUploadResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'success', autoExpense: data.autoExpense } : r))
        }
      } catch (e: any) {
        setUploadResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'error', error: e.message } : r))
      }
    }
    setUploading(false); setUploadDone(true)
    fetchInvoices()
  }

  async function handleConvertToExpense(inv: Invoice) {
    setConverting(inv.id)
    try {
      const { data: newExpense, error: expErr } = await supabase
        .from('expenses')
        .insert({
          expense_date: inv.invoice_date ?? new Date().toISOString().slice(0, 10),
          category: inv.category ?? 'outros',
          type: 'pontual',
          description: inv.items_summary ?? inv.supplier_name ?? 'Fatura',
          amount: inv.amount ?? 0,
          payment_method: 'banco',
          supplier: inv.supplier_name ?? null,
          notes: `Convertido da fatura ${inv.invoice_number ?? ''}`.trim(),
          invoice_id: inv.id,
        })
        .select().single()
      if (expErr) { alert('Erro: ' + expErr.message); setConverting(null); return }
      await supabase.from('invoices').update({ expense_id: newExpense.id, status: 'categorizada' }).eq('id', inv.id)
      setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, expense_id: newExpense.id, status: 'categorizada' } : i))
    } catch (e: any) {
      alert('Erro: ' + e.message)
    }
    setConverting(null)
  }

  async function handleDeleteConfirm(deleteExpense: boolean) {
    if (!deleteConfirm) return
    setDeleting(true)
    const { invoice } = deleteConfirm

    try {
      // 1. Apagar despesa associada se pedido
      if (deleteExpense && invoice.expense_id) {
        await supabase.from('cash_fund_movements').delete().eq('source_id', invoice.expense_id)
        await supabase.from('expenses').delete().eq('id', invoice.expense_id)
      } else if (invoice.expense_id) {
        // Manter despesa mas desligar a fatura
        await supabase.from('expenses').update({ invoice_id: null }).eq('id', invoice.expense_id)
      }

      // 2. Apagar ficheiro do storage
      if (invoice.file_path) {
        await supabase.storage.from('invoices').remove([invoice.file_path])
      }

      // 3. Apagar fatura
      await supabase.from('invoices').delete().eq('id', invoice.id)

    } catch (e: any) {
      console.error('Erro ao apagar:', e)
    }

    setDeleting(false)
    setDeleteConfirm(null)
    fetchInvoices()
  }

  function handleClose() {
    setShowUpload(false); setFiles([]); setUploadResults([])
    setUploadDone(false); setUploadError('')
  }

  async function viewPDF(filePath: string) {
    const { data } = supabase.storage.from('invoices').getPublicUrl(filePath)
    if (data?.publicUrl) window.open(data.publicUrl, '_blank')
  }

  const filtered = invoices.filter(inv => {
    const matchSearch = !search ||
      inv.supplier_name?.toLowerCase().includes(search.toLowerCase()) ||
      inv.invoice_number?.toLowerCase().includes(search.toLowerCase()) ||
      inv.items_summary?.toLowerCase().includes(search.toLowerCase()) ||
      inv.buyer_name?.toLowerCase().includes(search.toLowerCase())
    const matchCat = filterCategory === 'all' || inv.category === filterCategory
    const matchOwner = filterOwner === 'all' || inv.owner === filterOwner
    const matchStatus = filterStatus === 'all' ||
      (filterStatus === 'convertida' && inv.expense_id) ||
      (filterStatus === 'por_converter' && !inv.expense_id)
    return matchSearch && matchCat && matchOwner && matchStatus
  })

  const owners = [...new Set(invoices.map(i => i.owner).filter(Boolean))]
  const totalAmount = filtered.reduce((s, i) => s + (i.amount ?? 0), 0)
  const porConverter = invoices.filter(i => !i.expense_id).length

  return (
    <AppLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Faturas</h1>
            <p className="text-sm text-gray-500 mt-1">{invoices.length} faturas registadas</p>
          </div>
          {isAdmin && (
            <button className="btn-primary" onClick={() => setShowUpload(true)}>
              <Plus className="w-4 h-4" />
              Importar Faturas
            </button>
          )}
        </div>

        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="card">
            <p className="text-sm text-gray-500 mb-1">Total Faturas</p>
            <p className="text-xl font-bold text-gray-900">{invoices.length}</p>
          </div>
          <div className="card">
            <p className="text-sm text-gray-500 mb-1">Valor Total (filtrado)</p>
            <p className="text-xl font-bold text-red-600">{formatCurrency(totalAmount)}</p>
          </div>
          <div className="card cursor-pointer hover:border-emerald-300 transition-colors"
            onClick={() => setFilterStatus(filterStatus === 'convertida' ? 'all' : 'convertida')}>
            <p className="text-sm text-gray-500 mb-1">Convertidas em Despesa</p>
            <p className="text-xl font-bold text-emerald-600">{invoices.filter(i => i.expense_id).length}</p>
          </div>
          <div className="card cursor-pointer hover:border-yellow-300 transition-colors"
            onClick={() => setFilterStatus(filterStatus === 'por_converter' ? 'all' : 'por_converter')}>
            <p className="text-sm text-gray-500 mb-1">Por Converter</p>
            <p className={`text-xl font-bold ${porConverter > 0 ? 'text-yellow-600' : 'text-gray-400'}`}>{porConverter}</p>
          </div>
        </div>

        {porConverter > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 mb-4 flex items-center justify-between">
            <p className="text-sm text-yellow-700">⚠ <strong>{porConverter}</strong> fatura(s) ainda não convertidas em despesa</p>
            <button onClick={() => setFilterStatus('por_converter')} className="text-xs text-yellow-700 hover:underline font-medium">Ver só estas</button>
          </div>
        )}

        <div className="flex gap-3 mb-6 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9" placeholder="Pesquisar fornecedor, produtos..."
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="input w-44" value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
            <option value="all">Todas as categorias</option>
            {Object.entries(categoryLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="input w-44" value={filterOwner} onChange={e => setFilterOwner(e.target.value)}>
            <option value="all">Todos os proprietários</option>
            {owners.map(o => <option key={o} value={o!}>{o}</option>)}
          </select>
          <select className="input w-44" value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)}>
            <option value="all">Todas</option>
            <option value="convertida">✅ Convertidas</option>
            <option value="por_converter">⚠ Por converter</option>
          </select>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="table-header">Data</th>
                  <th className="table-header">Nº Fatura</th>
                  <th className="table-header">Fornecedor</th>
                  <th className="table-header">Produtos/Serviços</th>
                  <th className="table-header">Categoria</th>
                  <th className="table-header">Valor</th>
                  <th className="table-header">Estado</th>
                  <th className="table-header">PDF</th>
                  {isAdmin && <th className="table-header"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(inv => (
                  <tr key={inv.id} className={`hover:bg-gray-50 ${!inv.expense_id ? 'bg-yellow-50/20' : ''}`}>
                    <td className="table-cell text-sm">{inv.invoice_date ? formatDate(inv.invoice_date) : '—'}</td>
                    <td className="table-cell text-sm text-gray-600">{inv.invoice_number ?? '—'}</td>
                    <td className="table-cell">
                      <p className="font-medium text-gray-800">{inv.supplier_name ?? '—'}</p>
                      {inv.supplier_nif && <p className="text-xs text-gray-400">NIF: {inv.supplier_nif}</p>}
                    </td>
                    <td className="table-cell max-w-xs">
                      <p className="text-xs text-gray-600 truncate">{inv.items_summary ?? '—'}</p>
                    </td>
                    <td className="table-cell">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${categoryColors[inv.category ?? 'outros'] ?? 'bg-gray-100 text-gray-700'}`}>
                        {categoryLabels[inv.category ?? 'outros'] ?? 'Outros'}
                      </span>
                    </td>
                    <td className="table-cell font-semibold text-red-600">
                      {inv.amount ? formatCurrency(inv.amount) : '—'}
                    </td>
                    <td className="table-cell">
                      {inv.expense_id ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                          <CheckCircle className="w-3 h-3" /> Despesa criada
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-yellow-100 text-yellow-700 font-medium">
                          ⚠ Por converter
                        </span>
                      )}
                    </td>
                    <td className="table-cell">
                      {inv.file_path ? (
                        <button onClick={() => viewPDF(inv.file_path!)}
                          className="flex items-center gap-1 text-xs text-emerald-600 hover:underline">
                          <Eye className="w-3 h-3" /> Ver
                        </button>
                      ) : '—'}
                    </td>
                    {isAdmin && (
                      <td className="table-cell">
                        <div className="flex items-center gap-2">
                          {!inv.expense_id && (
                            <button onClick={() => handleConvertToExpense(inv)} disabled={converting === inv.id}
                              className="flex items-center gap-1 text-xs text-blue-600 hover:underline font-medium whitespace-nowrap">
                              {converting === inv.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRightCircle className="w-3 h-3" />}
                              Converter
                            </button>
                          )}
                          <button onClick={() => setDeleteConfirm({ invoice: inv, hasExpense: !!inv.expense_id })}
                            className="text-gray-300 hover:text-red-500 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={isAdmin ? 9 : 8} className="py-12 text-center text-gray-400 text-sm">Nenhuma fatura encontrada</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal apagar fatura */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg text-gray-900">Apagar Fatura</h2>
              <button onClick={() => setDeleteConfirm(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <p className="text-sm text-gray-600 mb-1">Tens a certeza que queres apagar a fatura de:</p>
            <p className="font-medium text-gray-900 mb-1">{deleteConfirm.invoice.supplier_name ?? '—'}</p>
            <p className="text-sm text-red-600 font-semibold mb-4">{deleteConfirm.invoice.amount ? formatCurrency(deleteConfirm.invoice.amount) : '—'}</p>

            {deleteConfirm.hasExpense ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-2">
                <p className="text-sm text-yellow-800 font-medium mb-3">
                  💸 Esta fatura tem uma despesa associada. O que queres fazer?
                </p>
                <div className="flex flex-col gap-2">
                  <button onClick={() => handleDeleteConfirm(true)} disabled={deleting}
                    className="w-full py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                    {deleting ? 'A apagar...' : '🗑️ Apagar fatura e despesa associada'}
                  </button>
                  <button onClick={() => handleDeleteConfirm(false)} disabled={deleting}
                    className="w-full py-2.5 rounded-lg bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 disabled:opacity-50">
                    {deleting ? 'A apagar...' : '🧾 Apagar só a fatura (manter despesa)'}
                  </button>
                  <button onClick={() => setDeleteConfirm(null)}
                    className="w-full py-2.5 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50">
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

      {showUpload && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-lg text-gray-900">Importar Faturas</h2>
              <button onClick={handleClose}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            {!uploading && !uploadDone && (
              <div className="space-y-4">
                <div>
                  <label className="label">Ficheiros PDF <span className="text-gray-400 font-normal">(pode selecionar vários)</span></label>
                  <label className="flex flex-col items-center gap-3 border-2 border-dashed border-gray-200 rounded-xl p-6 cursor-pointer hover:border-emerald-400 transition-colors">
                    <Upload className="w-8 h-8 text-gray-300" />
                    <div className="text-center">
                      <p className="font-medium text-gray-700 text-sm">
                        {files.length > 0 ? `${files.length} ficheiro(s) selecionado(s)` : 'Clica para selecionar PDFs'}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">O proprietário é identificado automaticamente pelo NIF</p>
                    </div>
                    <input type="file" accept=".pdf" multiple className="hidden"
                      onChange={e => setFiles(Array.from(e.target.files ?? []))} />
                  </label>
                  {files.length > 0 && (
                    <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                      {files.map((f, i) => (
                        <p key={i} className="text-xs text-gray-500 flex items-center gap-1">
                          <FileText className="w-3 h-3 flex-shrink-0" /> {f.name}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
                {uploadError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{uploadError}</p>}
              </div>
            )}
            {(uploading || uploadDone) && (
              <div className="space-y-2">
                {!uploadDone && <p className="text-sm text-gray-600 mb-3">A processar faturas com IA...</p>}
                {uploadDone && <p className="text-sm text-gray-600 mb-3">Processamento concluído!</p>}
                {uploadResults.map((r, i) => (
                  <div key={i} className={`flex items-center gap-3 p-3 rounded-lg ${r.status === 'success' ? 'bg-emerald-50' : r.status === 'error' ? 'bg-red-50' : r.status === 'processing' ? 'bg-blue-50' : 'bg-gray-50'}`}>
                    {r.status === 'success' && <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />}
                    {r.status === 'error' && <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />}
                    {r.status === 'processing' && <Loader2 className="w-4 h-4 animate-spin text-blue-600 flex-shrink-0" />}
                    {r.status === 'pending' && <div className="w-4 h-4 rounded-full border-2 border-gray-300 flex-shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">{r.fileName}</p>
                      {r.status === 'success' && r.autoExpense && <p className="text-xs text-emerald-600">✓ Despesa criada automaticamente</p>}
                      {r.status === 'success' && !r.autoExpense && <p className="text-xs text-yellow-600">⚠ Usa "Converter" para criar a despesa</p>}
                      {r.error && <p className="text-xs text-red-600">{r.error}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-3 mt-6">
              <button className="btn-secondary" onClick={handleClose}>{uploadDone ? 'Fechar' : 'Cancelar'}</button>
              {!uploadDone && !uploading && (
                <button className="btn-primary" onClick={handleUpload}>
                  <FileText className="w-4 h-4" />
                  Importar {files.length > 0 ? `${files.length} fatura(s)` : ''}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
