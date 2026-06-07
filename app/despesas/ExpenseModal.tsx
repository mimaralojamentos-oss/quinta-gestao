'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-client'
import { Expense } from '@/lib/types'
import { X, Upload, FileText, Loader2, Sparkles } from 'lucide-react'

interface Props {
  expense: Expense | null
  onClose: () => void
  onSaved: () => void
}

export default function ExpenseModal({ expense, onClose, onSaved }: Props) {
  const supabase = createClient()
  const [form, setForm] = useState({
    expense_date: expense?.expense_date ?? new Date().toISOString().slice(0, 10),
    category: expense?.category ?? 'outros',
    type: expense?.type ?? 'pontual',
    description: expense?.description ?? '',
    amount: expense ? String(expense.amount) : '',
    payment_method: expense?.payment_method ?? 'dinheiro',
    supplier: expense?.supplier ?? '',
    notes: expense?.notes ?? '',
    project_id: (expense as any)?.project_id ?? '',
  })
  const [projects, setProjects] = useState<any[]>([])
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [processingOcr, setProcessingOcr] = useState(false)
  const [ocrDone, setOcrDone] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function fetchProjects() {
      const { data } = await supabase
        .from('projects')
        .select('id, name, type, status, location_label, space:spaces(ref)')
        .neq('status', 'concluido')
        .order('name')
      setProjects(data ?? [])
    }
    fetchProjects()
  }, [])

  function projectLabel(p: any) {
    const typeEmoji: Record<string, string> = {
      construcao: '🏗️', renovacao: '🔨', arranjo: '🔧', outro: '📦',
    }
    const emoji = typeEmoji[p.type] ?? '📦'
    const loc = p.is_general ? 'Geral' : p.space?.ref ?? p.location_label ?? ''
    return `${emoji} ${p.name}${loc ? ` (${loc})` : ''}`
  }

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

      if (form.payment_method === 'dinheiro') {
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
      } else {
        if (existingCash) {
          await supabase.from('cash_fund_movements').delete().eq('id', existingCash.id)
        }
      }

    } else {
      // Nova despesa
      const { data: newExpense, error: err } = await supabase
        .from('expenses').insert(payload).select().single()
      if (err) { setError(err.message); setSaving(false); return }

      if (form.payment_method === 'dinheiro' && newExpense) {
        await supabase.from('cash_fund_movements').insert({
          movement_date: form.expense_date,
          description: `💸 ${form.description}${form.supplier ? ` — ${form.supplier}` : ''}`,
          amount: -Math.abs(parseFloat(form.amount)),
          type: 'saida', source: 'despesa', source_id: newExpense.id,
          notes: form.notes || null,
        })
      }

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
    }

    setSaving(false)
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-lg text-gray-900">{expense ? 'Editar Despesa' : 'Nova Despesa'}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="space-y-4">

          {/* Upload no topo — só para nova despesa */}
          {!expense && (
            <div>
              <label className="label">
                Fatura / Recibo
                <span className="text-xs text-emerald-600 font-normal ml-2">✨ preenche automaticamente com IA</span>
              </label>
              <label className={`flex items-center gap-3 border-2 border-dashed rounded-lg p-4 cursor-pointer transition-colors ${
                ocrDone ? 'border-emerald-400 bg-emerald-50' :
                processingOcr ? 'border-blue-300 bg-blue-50' :
                'border-gray-200 hover:border-emerald-400'
              }`}>
                {processingOcr
                  ? <Loader2 className="w-5 h-5 text-blue-500 animate-spin flex-shrink-0" />
                  : ocrDone
                  ? <Sparkles className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                  : <Upload className="w-5 h-5 text-gray-400 flex-shrink-0" />
                }
                <div>
                  {processingOcr
                    ? <p className="text-sm text-blue-600 font-medium">A ler fatura com IA...</p>
                    : ocrDone
                    ? <p className="text-sm text-emerald-600 font-medium">✓ Campos preenchidos automaticamente!</p>
                    : <p className="text-sm text-gray-600">{invoiceFile ? invoiceFile.name : 'Clique para fazer upload (PDF, JPG, PNG)'}</p>
                  }
                  {!processingOcr && !ocrDone && (
                    <p className="text-xs text-gray-400">PDF recomendado para melhor leitura automática</p>
                  )}
                  {ocrDone && invoiceFile && (
                    <p className="text-xs text-emerald-500">{invoiceFile.name} — confirma os dados abaixo</p>
                  )}
                </div>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFileChange(f) }} />
              </label>
            </div>
          )}

          {/* Fatura existente (edição) */}
          {expense && (
            <div>
              <label className="label">Fatura / Recibo</label>
              <label className="flex items-center gap-3 border-2 border-dashed border-gray-200 rounded-lg p-4 cursor-pointer hover:border-emerald-400 transition-colors">
                <Upload className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-600">{invoiceFile ? invoiceFile.name : 'Substituir fatura'}</p>
                  <p className="text-xs text-gray-400">PDF, JPG, PNG — máximo 10MB</p>
                </div>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                  onChange={e => setInvoiceFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
          )}

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
