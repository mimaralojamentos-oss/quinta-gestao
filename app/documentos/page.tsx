'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import { Search, FileText, Eye, FolderOpen, Trash2, X } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

interface Documento {
  id: string
  nome: string
  tipo: 'contrato' | 'fatura' | 'despesa'
  associado: string
  data: string | null
  bucket: string
  path: string
  linkedId?: string | null   // invoice_id ou expense_id relacionado
  linkedType?: 'invoice' | 'expense' | null
}

interface DeleteConfirm {
  doc: Documento
  hasLinked: boolean
  linkedLabel: string
}

const tipoLabels: Record<string, string> = {
  contrato: '📄 Contrato',
  fatura: '🧾 Fatura',
  despesa: '💸 Despesa',
}

const tipoColors: Record<string, string> = {
  contrato: 'bg-blue-100 text-blue-700',
  fatura: 'bg-orange-100 text-orange-700',
  despesa: 'bg-red-100 text-red-700',
}

export default function DocumentosPage() {
  const { isAdmin } = useAuth()
  const [documentos, setDocumentos] = useState<Documento[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterTipo, setFilterTipo] = useState<'all' | 'contrato' | 'fatura' | 'despesa'>('all')
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => { fetchDocumentos() }, [])

  async function fetchDocumentos() {
    setLoading(true)
    const docs: Documento[] = []

    // 1. Contratos
    const { data: leases } = await supabase
      .from('leases')
      .select('id, contract_file_path, start_date, tenant:tenants(name), space:spaces(ref)')
      .not('contract_file_path', 'is', null)

    for (const l of leases ?? []) {
      if (!l.contract_file_path) continue
      docs.push({
        id: l.id,
        nome: l.contract_file_path.split('/').pop() ?? l.contract_file_path,
        tipo: 'contrato',
        associado: `${(l.tenant as any)?.name ?? '—'} · ${(l.space as any)?.ref ?? '—'}`,
        data: l.start_date,
        bucket: 'documents',
        path: l.contract_file_path,
        linkedId: null,
        linkedType: null,
      })
    }

    // 2. Faturas OCR
    const { data: invoices } = await supabase
      .from('invoices')
      .select('id, file_path, invoice_date, supplier_name, invoice_number, expense_id')
      .not('file_path', 'is', null)

    for (const inv of invoices ?? []) {
      if (!inv.file_path) continue
      docs.push({
        id: inv.id,
        nome: inv.file_path.split('/').pop() ?? inv.file_path,
        tipo: 'fatura',
        associado: `${inv.supplier_name ?? '—'}${inv.invoice_number ? ` · Nº ${inv.invoice_number}` : ''}`,
        data: inv.invoice_date,
        bucket: 'invoices',
        path: inv.file_path,
        linkedId: inv.expense_id,
        linkedType: inv.expense_id ? 'expense' : null,
      })
    }

    // 3. Despesas com fatura
    const { data: expenses } = await supabase
      .from('expenses')
      .select('id, invoice_file_path, expense_date, description, supplier, invoice_id')
      .not('invoice_file_path', 'is', null)

    for (const exp of expenses ?? []) {
      if (!exp.invoice_file_path) continue
      docs.push({
        id: exp.id,
        nome: exp.invoice_file_path.split('/').pop() ?? exp.invoice_file_path,
        tipo: 'despesa',
        associado: `${exp.description ?? '—'}${exp.supplier ? ` · ${exp.supplier}` : ''}`,
        data: exp.expense_date,
        bucket: 'documents',
        path: exp.invoice_file_path,
        linkedId: exp.invoice_id,
        linkedType: exp.invoice_id ? 'invoice' : null,
      })
    }

    docs.sort((a, b) => {
      if (!a.data) return 1
      if (!b.data) return -1
      return b.data.localeCompare(a.data)
    })

    setDocumentos(docs)
    setLoading(false)
  }

  async function openDoc(bucket: string, path: string) {
    if (bucket === 'invoices') {
      const { data } = supabase.storage.from('invoices').getPublicUrl(path)
      if (data?.publicUrl) window.open(data.publicUrl, '_blank')
    } else {
      const { data } = await supabase.storage.from('documents').createSignedUrl(path, 60)
      if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    }
  }

  function handleDeleteClick(doc: Documento) {
    let linkedLabel = ''
    if (doc.linkedId && doc.linkedType === 'expense') linkedLabel = 'uma despesa associada'
    if (doc.linkedId && doc.linkedType === 'invoice') linkedLabel = 'uma fatura associada'
    setDeleteConfirm({ doc, hasLinked: !!doc.linkedId, linkedLabel })
  }

  async function handleDeleteConfirm(deleteLinked: boolean) {
    if (!deleteConfirm) return
    setDeleting(true)
    const { doc } = deleteConfirm

    try {
      if (doc.tipo === 'fatura') {
        // Apagar despesa associada se pedido
        if (deleteLinked && doc.linkedId) {
          await supabase.from('cash_fund_movements').delete().eq('source_id', doc.linkedId)
          await supabase.from('expenses').delete().eq('id', doc.linkedId)
        } else if (doc.linkedId) {
          await supabase.from('expenses').update({ invoice_id: null }).eq('id', doc.linkedId)
        }
        // Apagar ficheiro storage
        if (doc.path) await supabase.storage.from('invoices').remove([doc.path])
        // Apagar fatura
        await supabase.from('invoices').delete().eq('id', doc.id)

      } else if (doc.tipo === 'despesa') {
        // Apagar fatura associada se pedido
        if (deleteLinked && doc.linkedId) {
          const { data: inv } = await supabase
            .from('invoices').select('file_path').eq('id', doc.linkedId).single()
          if (inv?.file_path) await supabase.storage.from('invoices').remove([inv.file_path])
          await supabase.from('invoices').delete().eq('id', doc.linkedId)
        } else if (doc.linkedId) {
          await supabase.from('invoices').update({ expense_id: null }).eq('id', doc.linkedId)
        }
        // Apagar ficheiro storage
        if (doc.path) await supabase.storage.from('documents').remove([doc.path])
        // Apagar despesa
        await supabase.from('cash_fund_movements').delete().eq('source_id', doc.id)
        await supabase.from('expenses').delete().eq('id', doc.id)

      } else if (doc.tipo === 'contrato') {
        // Apagar ficheiro e limpar caminho no contrato
        if (doc.path) await supabase.storage.from('documents').remove([doc.path])
        await supabase.from('leases').update({ contract_file_path: null }).eq('id', doc.id)
      }

    } catch (e: any) {
      console.error('Erro ao apagar:', e)
    }

    setDeleting(false)
    setDeleteConfirm(null)
    fetchDocumentos()
  }

  const filtered = documentos.filter(d => {
    const matchSearch = !search ||
      d.nome.toLowerCase().includes(search.toLowerCase()) ||
      d.associado.toLowerCase().includes(search.toLowerCase())
    const matchTipo = filterTipo === 'all' || d.tipo === filterTipo
    return matchSearch && matchTipo
  })

  return (
    <AppLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Documentos</h1>
            <p className="text-sm text-gray-500 mt-1">{documentos.length} ficheiros guardados</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="card text-center py-4 cursor-pointer hover:border-blue-300 transition-colors"
            onClick={() => setFilterTipo(filterTipo === 'contrato' ? 'all' : 'contrato')}>
            <p className="text-2xl mb-1">📄</p>
            <p className="text-xl font-bold text-blue-600">{documentos.filter(d => d.tipo === 'contrato').length}</p>
            <p className="text-xs text-gray-500 mt-1">Contratos</p>
          </div>
          <div className="card text-center py-4 cursor-pointer hover:border-orange-300 transition-colors"
            onClick={() => setFilterTipo(filterTipo === 'fatura' ? 'all' : 'fatura')}>
            <p className="text-2xl mb-1">🧾</p>
            <p className="text-xl font-bold text-orange-600">{documentos.filter(d => d.tipo === 'fatura').length}</p>
            <p className="text-xs text-gray-500 mt-1">Faturas</p>
          </div>
          <div className="card text-center py-4 cursor-pointer hover:border-red-300 transition-colors"
            onClick={() => setFilterTipo(filterTipo === 'despesa' ? 'all' : 'despesa')}>
            <p className="text-2xl mb-1">💸</p>
            <p className="text-xl font-bold text-red-600">{documentos.filter(d => d.tipo === 'despesa').length}</p>
            <p className="text-xs text-gray-500 mt-1">Despesas</p>
          </div>
        </div>

        <div className="flex gap-3 mb-6">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9" placeholder="Pesquisar por nome, inquilino, fornecedor..."
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="input w-44" value={filterTipo} onChange={e => setFilterTipo(e.target.value as any)}>
            <option value="all">Todos os tipos</option>
            <option value="contrato">📄 Contratos</option>
            <option value="fatura">🧾 Faturas</option>
            <option value="despesa">💸 Despesas</option>
          </select>
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
                  <th className="table-header"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((doc, i) => (
                  <tr key={`${doc.tipo}-${doc.id}-${i}`} className="hover:bg-gray-50 transition-colors">
                    <td className="table-cell">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${tipoColors[doc.tipo]}`}>
                        {tipoLabels[doc.tipo]}
                      </span>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <span className="text-sm text-gray-700 truncate max-w-xs">{doc.nome}</span>
                      </div>
                    </td>
                    <td className="table-cell text-sm text-gray-600">{doc.associado}</td>
                    <td className="table-cell text-sm text-gray-500">
                      {doc.data ? formatDate(doc.data) : '—'}
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        <button onClick={() => openDoc(doc.bucket, doc.path)}
                          className="flex items-center gap-1 text-xs text-emerald-600 hover:underline font-medium">
                          <Eye className="w-3.5 h-3.5" /> Abrir
                        </button>
                        {isAdmin && (
                          <button onClick={() => handleDeleteClick(doc)}
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

      {/* Modal confirmação apagar */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg text-gray-900">Apagar Documento</h2>
              <button onClick={() => setDeleteConfirm(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <p className="text-sm text-gray-600 mb-2">Tens a certeza que queres apagar:</p>
            <p className="font-medium text-gray-900 mb-1">{deleteConfirm.doc.nome}</p>
            <p className="text-sm text-gray-500 mb-4">{deleteConfirm.doc.associado}</p>

            {deleteConfirm.hasLinked ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-2">
                <p className="text-sm text-yellow-800 font-medium mb-3">
                  ⚠ Este documento tem {deleteConfirm.linkedLabel}. O que queres fazer?
                </p>
                <div className="flex flex-col gap-2">
                  <button onClick={() => handleDeleteConfirm(true)} disabled={deleting}
                    className="w-full py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                    {deleting ? 'A apagar...' : `🗑️ Apagar documento e ${deleteConfirm.linkedLabel}`}
                  </button>
                  <button onClick={() => handleDeleteConfirm(false)} disabled={deleting}
                    className="w-full py-2.5 rounded-lg bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 disabled:opacity-50">
                    {deleting ? 'A apagar...' : '📄 Apagar só o documento'}
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
    </AppLayout>
  )
}
