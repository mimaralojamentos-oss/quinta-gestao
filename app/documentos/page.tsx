'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import { Search, FileText, Eye, FolderOpen } from 'lucide-react'

interface Documento {
  id: string
  nome: string
  tipo: 'contrato' | 'fatura' | 'despesa'
  associado: string
  data: string | null
  bucket: string
  path: string
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
  const [documentos, setDocumentos] = useState<Documento[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterTipo, setFilterTipo] = useState<'all' | 'contrato' | 'fatura' | 'despesa'>('all')

  useEffect(() => { fetchDocumentos() }, [])

  async function fetchDocumentos() {
    setLoading(true)
    const docs: Documento[] = []

    // 1. Contratos de arrendamento
    const { data: leases } = await supabase
      .from('leases')
      .select('id, contract_file_path, start_date, tenant:tenants(name), space:spaces(ref)')
      .not('contract_file_path', 'is', null)

    for (const l of leases ?? []) {
      if (!l.contract_file_path) continue
      const nomeFile = l.contract_file_path.split('/').pop() ?? l.contract_file_path
      docs.push({
        id: l.id,
        nome: nomeFile,
        tipo: 'contrato',
        associado: `${(l.tenant as any)?.name ?? '—'} · ${(l.space as any)?.ref ?? '—'}`,
        data: l.start_date,
        bucket: 'documents',
        path: l.contract_file_path,
      })
    }

    // 2. Faturas com OCR
    const { data: invoices } = await supabase
      .from('invoices')
      .select('id, file_path, invoice_date, supplier_name, invoice_number')
      .not('file_path', 'is', null)

    for (const inv of invoices ?? []) {
      if (!inv.file_path) continue
      const nomeFile = inv.file_path.split('/').pop() ?? inv.file_path
      docs.push({
        id: inv.id,
        nome: nomeFile,
        tipo: 'fatura',
        associado: `${inv.supplier_name ?? '—'}${inv.invoice_number ? ` · Nº ${inv.invoice_number}` : ''}`,
        data: inv.invoice_date,
        bucket: 'invoices',
        path: inv.file_path,
      })
    }

    // 3. Despesas com fatura
    const { data: expenses } = await supabase
      .from('expenses')
      .select('id, invoice_file_path, expense_date, description, supplier')
      .not('invoice_file_path', 'is', null)

    for (const exp of expenses ?? []) {
      if (!exp.invoice_file_path) continue
      const nomeFile = exp.invoice_file_path.split('/').pop() ?? exp.invoice_file_path
      docs.push({
        id: exp.id,
        nome: nomeFile,
        tipo: 'despesa',
        associado: `${exp.description ?? '—'}${exp.supplier ? ` · ${exp.supplier}` : ''}`,
        data: exp.expense_date,
        bucket: 'documents',
        path: exp.invoice_file_path,
      })
    }

    // Ordenar por data mais recente
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

  const filtered = documentos.filter(d => {
    const matchSearch = !search ||
      d.nome.toLowerCase().includes(search.toLowerCase()) ||
      d.associado.toLowerCase().includes(search.toLowerCase())
    const matchTipo = filterTipo === 'all' || d.tipo === filterTipo
    return matchSearch && matchTipo
  })

  const totalContratos = documentos.filter(d => d.tipo === 'contrato').length
  const totalFaturas = documentos.filter(d => d.tipo === 'fatura').length
  const totalDespesas = documentos.filter(d => d.tipo === 'despesa').length

  return (
    <AppLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Documentos</h1>
            <p className="text-sm text-gray-500 mt-1">{documentos.length} ficheiros guardados</p>
          </div>
        </div>

        {/* Resumo */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="card text-center py-4 cursor-pointer hover:border-blue-300 transition-colors"
            onClick={() => setFilterTipo(filterTipo === 'contrato' ? 'all' : 'contrato')}>
            <p className="text-2xl mb-1">📄</p>
            <p className="text-xl font-bold text-blue-600">{totalContratos}</p>
            <p className="text-xs text-gray-500 mt-1">Contratos</p>
          </div>
          <div className="card text-center py-4 cursor-pointer hover:border-orange-300 transition-colors"
            onClick={() => setFilterTipo(filterTipo === 'fatura' ? 'all' : 'fatura')}>
            <p className="text-2xl mb-1">🧾</p>
            <p className="text-xl font-bold text-orange-600">{totalFaturas}</p>
            <p className="text-xs text-gray-500 mt-1">Faturas</p>
          </div>
          <div className="card text-center py-4 cursor-pointer hover:border-red-300 transition-colors"
            onClick={() => setFilterTipo(filterTipo === 'despesa' ? 'all' : 'despesa')}>
            <p className="text-2xl mb-1">💸</p>
            <p className="text-xl font-bold text-red-600">{totalDespesas}</p>
            <p className="text-xs text-gray-500 mt-1">Despesas</p>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex gap-3 mb-6">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9" placeholder="Pesquisar por nome, inquilino, fornecedor..."
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="input w-44" value={filterTipo}
            onChange={e => setFilterTipo(e.target.value as any)}>
            <option value="all">Todos os tipos</option>
            <option value="contrato">📄 Contratos</option>
            <option value="fatura">🧾 Faturas</option>
            <option value="despesa">💸 Despesas</option>
          </select>
        </div>

        {/* Lista */}
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
                      <button
                        onClick={() => openDoc(doc.bucket, doc.path)}
                        className="flex items-center gap-1 text-xs text-emerald-600 hover:underline font-medium"
                      >
                        <Eye className="w-3.5 h-3.5" /> Abrir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
