'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-client'
import { Expense } from '@/lib/types'
import { X, Upload, FileText, Loader2, Sparkles, Search, Link } from 'lucide-react'
import { formatCurrency, formatDate, matchesSearch } from '@/lib/utils'
import { EXPENSE_CATEGORIES } from '@/lib/expenseCategories'
import { logAccess } from '@/lib/logAccess'
import { useFileDrop } from '@/lib/useFileDrop'
import { CASH_FUND_START_DATE } from '@/lib/bankExpense'
import { createExpense } from '@/lib/createExpense'
import { findSimilarExpenses } from '@/lib/expenseDuplicates'

const supabase = createClient()

interface Props {
  expense: Expense | null
  /**
   * Despesa a duplicar. Quando vem preenchida e `expense` é null, o ecrã
   * comporta-se como "nova despesa" — cria um registo novo — mas já com os
   * campos preenchidos e a data avançada um mês.
   */
  duplicateFrom?: Expense | null
  onClose: () => void
  onSaved: () => void
}

/**
 * Mesma data, um mês à frente. Se o dia não existir no mês seguinte
 * (ex.: 31 de Janeiro), usa o último dia desse mês.
 */
function avancarUmMes(data: string): string {
  const [ano, mes, dia] = String(data).slice(0, 10).split('-').map(Number)
  const alvo = new Date(ano, mes, 1)           // mês seguinte (mes é 1-based)
  const ultimoDia = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate()
  const diaFinal = Math.min(dia || 1, ultimoDia)
  return `${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, '0')}-${String(diaFinal).padStart(2, '0')}`
}

export default function ExpenseModal({ expense, duplicateFrom, onClose, onSaved }: Props) {
  // Ao duplicar não há despesa a editar — só os valores de partida.
  const base = expense ?? duplicateFrom ?? null
  const modoDuplicar = !expense && !!duplicateFrom

  const [form, setForm] = useState({
    expense_date: modoDuplicar && base?.expense_date
      ? avancarUmMes(base.expense_date)
      : base?.expense_date ?? new Date().toISOString().slice(0, 10),
    category: base?.category ?? 'outros',
    type: base?.type ?? 'pontual',
    description: base?.description ?? '',
    amount: base ? String(base.amount) : '',
    payment_method: base?.payment_method ?? 'dinheiro',
    supplier: base?.supplier ?? '',
    notes: base?.notes ?? '',
    project_id: (base as any)?.project_id ?? '',
  })
  const [projects, setProjects] = useState<any[]>([])
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [processingOcr, setProcessingOcr] = useState(false)
  const [ocrDone, setOcrDone] = useState(false)
  const [error, setError] = useState('')
  // Selecionar documento existente
  const [docMode, setDocMode] = useState<'upload' | 'existing'>('upload')
  const [docSearch, setDocSearch] = useState('')
  const [existingDocs, setExistingDocs] = useState<any[]>([])
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)

  useEffect(() => {
    async function fetchProjects() {
      const { data } = await supabase
        .from('projects')
        .select('id, name, type, status, location_label, space:spaces(ref)')
        .neq('status', 'concluido')
        .order('name')
      setProjects(data ?? [])
    }
    async function fetchDocs() {
      const { data } = await supabase
        .from('documents')
        .select('id, original_name, supplier_name, amount, doc_date, tipo, items_summary')
        .in('tipo', ['fatura', 'fatura_luz', 'fatura_agua', 'outro'])
        .order('created_at', { ascending: false })
        .limit(200)
      setExistingDocs(data ?? [])
    }
    fetchProjects()
    fetchDocs()
  }, [])

  function projectLabel(p: any) {
    const typeEmoji: Record<string, string> = {
      construcao: '🏗️', renovacao: '🔨', arranjo: '🔧', outro: '📦',
    }
    const emoji = typeEmoji[p.type] ?? '📦'
    const loc = p.is_general ? 'Geral' : p.space?.ref ?? p.location_label ?? ''
    return `${emoji} ${p.name}${loc ? ` (${loc})` : ''}`
  }

  const invoiceDrop = useFileDrop({
    accept: ['.pdf', '.jpg', '.jpeg', '.png'],
    onFiles: dropped => { if (dropped[0]) handleFileChange(dropped[0]) },
    disabled: processingOcr,
  })

  async function handleFileChange(file: File) {
    setInvoiceFile(file)
    setOcrDone(false)

    if (!expense && (file.type === 'application/pdf' || file.type.startsWith('image/'))) {
      setProcessingOcr(true)
      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('tipo', 'fatura')
        const res = await fetch('/api/process-document', { method: 'POST', body: formData })
        const data = await res.json()
        const doc = data.document ?? data.existing
        if (doc) {
          setForm(f => ({
            ...f,
            description: doc.items_summary ?? doc.supplier_name ?? f.description,
            amount: doc.amount ? String(doc.amount) : f.amount,
            expense_date: doc.doc_date ?? f.expense_date,
            category: doc.category ?? f.category,
            supplier: doc.supplier_name ?? f.supplier,
          }))
          setOcrDone(true)
        }
      } catch (e) {
        // OCR falhou — continua sem preencher
      }
      setProcessingOcr(false)
    }
  }

  async function handleSave() {
    if (!form.description || !form.amount) { setError('Descrição e valor são obrigatórios'); return }
    setSaving(true); setError('')

    const payload = {
      expense_date: form.expense_date,
      category: form.category,
      type: form.type,
      description: form.description,
      amount: parseFloat(form.amount),
      payment_method: form.payment_method,
      supplier: form.supplier || null,
      notes: form.notes || null,
      project_id: form.project_id || null,
    }

    if (expense) {
      // Editar existente
      const { error: err } = await supabase.from('expenses').update(payload).eq('id', expense.id)
      if (err) { setError(err.message); setSaving(false); return }

      // Sincronizar categoria com o documento associado
      const { data: linkedDoc } = await supabase
        .from('documents')
        .select('id')
        .eq('expense_id', expense.id)
        .single()
      if (linkedDoc) {
        await supabase.from('documents').update({ category: form.category }).eq('id', linkedDoc.id)
      }

      const { data: existingCash } = await supabase
        .from('cash_fund_movements').select('id').eq('source_id', expense.id).single()

      if (form.payment_method === 'dinheiro' && form.expense_date >= CASH_FUND_START_DATE) {
        if (existingCash) {
          await supabase.from('cash_fund_movements').update({
            amount: -Math.abs(parseFloat(form.amount)),
            movement_date: form.expense_date,
            description: `💸 ${form.description}${form.supplier ? ` — ${form.supplier}` : ''}`,
            notes: form.notes || null,
          }).eq('id', existingCash.id)
        } else {
          await supabase.from('cash_fund_movements').insert({
            movement_date: form.expense_date,
            description: `💸 ${form.description}${form.supplier ? ` — ${form.supplier}` : ''}`,
            amount: -Math.abs(parseFloat(form.amount)),
            type: 'saida', source: 'despesa', source_id: expense.id,
            notes: form.notes || null,
          })
        }
      } else if (form.payment_method !== 'dinheiro') {
        // Deixou de ser pago em dinheiro: o movimento de caixa deixa de fazer sentido.
        if (existingCash) {
          await supabase.from('cash_fund_movements').delete().eq('id', existingCash.id)
        }
      }
      // Continua "dinheiro" mas com data anterior ao início do fundo de maneio:
      // não cria nem apaga nada — um movimento antigo que já existisse fica como está.

      await logAccess({ action: 'editar', page: '/despesas', details: `Editou despesa "${form.description}" (${formatCurrency(parseFloat(form.amount))})` })

    } else {
      // Nova despesa
      const similares = await findSimilarExpenses(supabase, parseFloat(form.amount), form.expense_date)
      if (similares.length > 0) {
        const lista = similares.map(s => `• ${formatDate(s.expense_date)} — ${s.description} (${formatCurrency(s.amount)})`).join('\n')
        if (!confirm(`Já existe uma despesa parecida (mesmo valor, data próxima):\n\n${lista}\n\nCriar mesmo assim?`)) {
          setSaving(false)
          return
        }
      }

      const { expense: newExpense, error: err } = await createExpense(supabase, {
        ...payload,
        payment_method: payload.payment_method as 'dinheiro' | 'banco',
        documentId: selectedDocId || null,
      })
      if (err) { setError(err); setSaving(false); return }

      if (invoiceFile && newExpense) {
        const formData = new FormData()
        formData.append('file', invoiceFile)
        formData.append('tipo', 'fatura')
        const res = await fetch('/api/process-document', { method: 'POST', body: formData })
        const data = await res.json()
        const docId = data.document?.id ?? data.existing?.id
        if (docId) {
          await supabase.from('documents').update({ expense_id: newExpense.id }).eq('id', docId)
        }
      }

      await logAccess({
        action: 'criar',
        page: '/despesas',
        details: `${modoDuplicar ? 'Duplicou' : 'Criou'} despesa "${form.description}" (${formatCurrency(parseFloat(form.amount))})`,
      })
    }

    setSaving(false)
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-lg text-gray-900">
            {expense ? 'Editar Despesa' : modoDuplicar ? 'Duplicar Despesa' : 'Nova Despesa'}
          </h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="space-y-4">

          {/* Fatura / Recibo */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Fatura / Recibo</label>
              <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
                <button onClick={() => setDocMode('upload')}
                  className={`text-xs px-2.5 py-1 rounded-md transition-colors ${docMode === 'upload' ? 'bg-white text-gray-800 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
                  <Upload className="w-3 h-3 inline mr-1" />Upload
                </button>
                <button onClick={() => setDocMode('existing')}
                  className={`text-xs px-2.5 py-1 rounded-md transition-colors ${docMode === 'existing' ? 'bg-white text-gray-800 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
                  <Link className="w-3 h-3 inline mr-1" />Existente
                </button>
              </div>
            </div>

            {docMode === 'upload' ? (
              <label
                {...invoiceDrop.dropProps}
                className={`flex items-center gap-3 border-2 border-dashed rounded-lg p-4 cursor-pointer transition-colors ${
                invoiceDrop.isDragging ? 'border-emerald-500 bg-emerald-50' :
                ocrDone ? 'border-emerald-400 bg-emerald-50' :
                processingOcr ? 'border-blue-300 bg-blue-50' :
                'border-gray-200 hover:border-emerald-400'
              }`}>
                {processingOcr ? <Loader2 className="w-5 h-5 text-blue-500 animate-spin flex-shrink-0" />
                  : ocrDone ? <Sparkles className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                  : <Upload className={`w-5 h-5 flex-shrink-0 ${invoiceDrop.isDragging ? 'text-emerald-500' : 'text-gray-400'}`} />}
                <div>
                  {processingOcr ? <p className="text-sm text-blue-600 font-medium">A ler fatura com IA...</p>
                    : invoiceDrop.isDragging ? <p className="text-sm text-emerald-600 font-medium">Larga aqui a fatura</p>
                    : ocrDone ? <p className="text-sm text-emerald-600 font-medium">✓ Campos preenchidos automaticamente!</p>
                    : <p className="text-sm text-gray-600">{invoiceFile ? invoiceFile.name : expense ? 'Substituir fatura' : 'Arrasta para aqui ou clica para fazer upload (PDF, JPG, PNG)'}</p>}
                  {!processingOcr && !ocrDone && <p className="text-xs text-gray-400">{expense ? 'PDF, JPG, PNG — máximo 10MB' : 'PDF recomendado para melhor leitura automática'}</p>}
                  {ocrDone && invoiceFile && <p className="text-xs text-emerald-500">{invoiceFile.name}</p>}
                </div>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFileChange(f) }} />
              </label>
            ) : (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="relative border-b border-gray-100">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input className="w-full pl-9 pr-3 py-2.5 text-sm outline-none"
                    placeholder="Pesquisar por nome, fornecedor..."
                    value={docSearch}
                    onChange={e => setDocSearch(e.target.value)} />
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {existingDocs
                    .filter(d => !docSearch || matchesSearch(d.original_name ?? '', docSearch) || matchesSearch(d.supplier_name ?? '', docSearch))
                    .slice(0, 30)
                    .map(d => (
                      <button key={d.id} onClick={() => setSelectedDocId(d.id === selectedDocId ? null : d.id)}
                        className={`w-full text-left px-3 py-2.5 text-sm border-b border-gray-50 hover:bg-gray-50 transition-colors flex items-start gap-2 ${selectedDocId === d.id ? 'bg-emerald-50 border-emerald-100' : ''}`}>
                        <FileText className={`w-4 h-4 mt-0.5 flex-shrink-0 ${selectedDocId === d.id ? 'text-emerald-500' : 'text-gray-300'}`} />
                        <div className="min-w-0 flex-1">
                          <p className={`truncate font-medium ${selectedDocId === d.id ? 'text-emerald-700' : 'text-gray-700'}`}>{d.original_name ?? '—'}</p>
                          <p className="text-xs text-gray-400 truncate">{d.supplier_name ?? ''}{d.doc_date ? ` · ${formatDate(d.doc_date)}` : ''}{d.amount ? ` · ${formatCurrency(d.amount)}` : ''}</p>
                        </div>
                        {selectedDocId === d.id && <span className="text-xs text-emerald-600 font-medium flex-shrink-0">✓</span>}
                      </button>
                    ))}
                  {existingDocs.filter(d => !docSearch || matchesSearch(d.original_name ?? '', docSearch) || matchesSearch(d.supplier_name ?? '', docSearch)).length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-6">Nenhum documento encontrado</p>
                  )}
                </div>
                {selectedDocId && (
                  <div className="bg-emerald-50 px-3 py-2 flex items-center justify-between">
                    <span className="text-xs text-emerald-700 font-medium">✓ Documento selecionado</span>
                    <button onClick={() => setSelectedDocId(null)} className="text-xs text-gray-400 hover:text-gray-600">Limpar</button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="label">Descrição *</label>
            <input className="input" placeholder="ex: Material de construção - Leroy Merlin" value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Data *</label>
              <input className="input" type="date" value={form.expense_date}
                onChange={e => setForm(f => ({ ...f, expense_date: e.target.value }))} />
            </div>
            <div>
              <label className="label">Valor (€) *</label>
              <input className="input" type="number" step="0.01" value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Categoria</label>
              <select className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as any }))}>
                {EXPENSE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Tipo</label>
              <select className="input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as any }))}>
                <option value="pontual">Pontual</option>
                <option value="recorrente">Recorrente</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label">Projeto associado</label>
            <select className="input" value={form.project_id}
              onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}>
              <option value="">— Sem projeto (despesa geral) —</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{projectLabel(p)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Método de Pagamento</label>
            <div className="grid grid-cols-2 gap-3">
              {['dinheiro', 'banco'].map(m => (
                <button key={m} onClick={() => setForm(f => ({ ...f, payment_method: m as any }))}
                  className={`py-2.5 rounded-lg border text-sm font-medium ${form.payment_method === m ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                  {m === 'dinheiro' ? '💵 Dinheiro' : '🏦 Banco/Transferência'}
                </button>
              ))}
            </div>
            {form.payment_method === 'dinheiro' && (
              <p className="text-xs text-red-500 mt-1.5">⚠ Este valor será registado automaticamente como saída no Fundo de Maneio</p>
            )}
          </div>

          <div>
            <label className="label">Fornecedor</label>
            <input className="input" placeholder="ex: Leroy Merlin, Alfamat..." value={form.supplier}
              onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} />
          </div>

          <div>
            <label className="label">Notas</label>
            <textarea className="input" rows={2} value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving || processingOcr}>
            {saving ? 'A guardar...' : processingOcr ? 'A processar...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
