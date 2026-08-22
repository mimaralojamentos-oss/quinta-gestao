'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { X, Download, CheckCircle, Loader2 } from 'lucide-react'
import { logAccess } from '@/lib/logAccess'
import { slugifyFilename } from '@/lib/utils'
import { CASH_FUND_START_DATE } from '@/lib/bankExpense'

interface Props {
  onClose: () => void
  onSaved: () => void
}

type DocTipo = 'despesa' | 'receita' | 'nota'

interface FormState {
  tipo: DocTipo
  title: string
  supplier: string
  doc_date: string
  doc_number: string
  description: string
  amount: string
  payment_method: string
  createExpense: boolean
  addToFundo: boolean
}

async function computeHash(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export default function ManualDocumentModal({ onClose, onSaved }: Props) {
  const today = new Date().toISOString().slice(0, 10)

  const [form, setForm] = useState<FormState>({
    tipo: 'despesa',
    title: '',
    supplier: '',
    doc_date: today,
    doc_number: '',
    description: '',
    amount: '',
    payment_method: 'dinheiro',
    createExpense: false,
    addToFundo: false,
  })

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [pdfName, setPdfName] = useState('')

  function set(field: keyof FormState, value: any) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function generatePDF(autoDocNum: string): Promise<Blob> {
    const { default: jsPDF } = await import('jspdf')
    const pdf = new jsPDF('p', 'mm', 'a4')
    const pageWidth = pdf.internal.pageSize.getWidth()
    const margin = 20
    let y = 20

    // — Header bar —
    pdf.setFillColor(16, 122, 86)
    pdf.rect(0, 0, pageWidth, 14, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(11)
    pdf.setTextColor(255, 255, 255)
    pdf.text('DOCUMENTO INTERNO', margin, 9.5)

    const tipoLabel = form.tipo === 'despesa' ? 'Despesa' : form.tipo === 'receita' ? 'Receita' : 'Nota'
    pdf.setFontSize(9)
    pdf.text(tipoLabel.toUpperCase(), pageWidth - margin, 9.5, { align: 'right' })
    pdf.setTextColor(0, 0, 0)

    y = 28

    // — Title —
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(18)
    pdf.text(form.title || 'Documento Manual', margin, y)
    y += 7

    // — Doc number & date —
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.setTextColor(100)
    pdf.text(`Nº ${autoDocNum}   ·   ${new Date(form.doc_date + 'T00:00:00').toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' })}`, margin, y)
    pdf.setTextColor(0)
    y += 10

    // — Divider —
    pdf.setDrawColor(220)
    pdf.line(margin, y, pageWidth - margin, y)
    y += 8

    // — Supplier / Entity —
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9)
    pdf.setTextColor(100)
    pdf.text('FORNECEDOR / ENTIDADE', margin, y)
    y += 5
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(11)
    pdf.setTextColor(0)
    pdf.text(form.supplier || '—', margin, y)
    y += 10

    // — Type badge —
    const badgeColors: Record<DocTipo, [number, number, number]> = {
      despesa: [239, 68, 68],
      receita: [16, 122, 86],
      nota: [99, 102, 241],
    }
    const [br, bg, bb] = badgeColors[form.tipo]
    pdf.setFillColor(br, bg, bb)
    pdf.roundedRect(margin, y - 4, 22, 6, 1.5, 1.5, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7.5)
    pdf.setTextColor(255, 255, 255)
    pdf.text(tipoLabel.toUpperCase(), margin + 11, y, { align: 'center' })
    pdf.setTextColor(0)
    y += 10

    // — Divider —
    pdf.setDrawColor(220)
    pdf.line(margin, y, pageWidth - margin, y)
    y += 8

    // — Description —
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9)
    pdf.setTextColor(100)
    pdf.text('DESCRICAO', margin, y)
    y += 5
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(10)
    pdf.setTextColor(30)
    const lines = pdf.splitTextToSize(form.description || '—', pageWidth - margin * 2)
    pdf.text(lines, margin, y)
    y += lines.length * 5 + 6

    // — Amount (if present) —
    if (form.amount && parseFloat(form.amount) > 0) {
      pdf.setDrawColor(220)
      pdf.line(margin, y, pageWidth - margin, y)
      y += 8

      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(9)
      pdf.setTextColor(100)
      pdf.text('VALOR TOTAL', margin, y)
      y += 6

      const amountStr = `${parseFloat(form.amount).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`
      pdf.setFontSize(20)
      if (form.tipo === 'despesa') pdf.setTextColor(200, 40, 40)
      else if (form.tipo === 'receita') pdf.setTextColor(16, 122, 86)
      else pdf.setTextColor(0)
      pdf.text(amountStr, margin, y)
      pdf.setTextColor(0)
      y += 6
    }

    // — Footer —
    const pageHeight = pdf.internal.pageSize.getHeight()
    pdf.setDrawColor(200)
    pdf.line(margin, pageHeight - 18, pageWidth - margin, pageHeight - 18)
    pdf.setFont('helvetica', 'italic')
    pdf.setFontSize(7.5)
    pdf.setTextColor(140)
    pdf.text(
      `Documento gerado internamente para uso exclusivo  -  ${new Date().toLocaleDateString('pt-PT')} ${new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}`,
      pageWidth / 2, pageHeight - 12, { align: 'center' }
    )

    return pdf.output('blob')
  }

  async function handleSave() {
    if (!form.supplier.trim()) { setError('Nome do fornecedor / entidade é obrigatório'); return }
    if (!form.doc_date) { setError('A data é obrigatória'); return }
    if (!form.description.trim()) { setError('A descrição é obrigatória'); return }

    setSaving(true); setError('')

    try {
      const autoDocNum = form.doc_number || `DOC-${Date.now().toString().slice(-6)}`

      // 1. Generate PDF
      const blob = await generatePDF(autoDocNum)

      // 2. Compute hash
      const fileHash = await computeHash(blob)

      // 3. Upload to storage
      const safeName = slugifyFilename(form.supplier.trim(), { maxLength: 30 })
      const fileName = `manual/${form.doc_date}_${safeName}_${autoDocNum}.pdf`

      const { error: uploadErr } = await supabase.storage
        .from('documents')
        .upload(fileName, blob, { contentType: 'application/pdf', upsert: false })
      if (uploadErr) { setError('Erro ao guardar PDF: ' + uploadErr.message); setSaving(false); return }

      // 4. Insert document record
      const tipoCustom = form.tipo === 'despesa' ? 'Despesa Manual' : form.tipo === 'receita' ? 'Receita Manual' : 'Nota Manual'
      const docTitle = form.title || tipoCustom
      const { data: newDoc, error: docErr } = await supabase.from('documents').insert({
        file_path: fileName,
        original_name: `${docTitle} — ${form.supplier} — ${autoDocNum}.pdf`,
        tipo: 'outro',
        tipo_custom: tipoCustom,
        supplier_name: form.supplier || null,
        amount: form.amount ? parseFloat(form.amount) : null,
        doc_date: form.doc_date,
        doc_number: autoDocNum,
        items_summary: form.description || null,
        category: form.tipo === 'despesa' ? 'outros' : null,
        ocr_done: false,
        status: 'ativo',
        file_hash: fileHash,
      }).select().single()

      if (docErr) { setError('Erro ao criar documento: ' + docErr.message); setSaving(false); return }

      // 5. Create expense (optional)
      let newExpenseId: string | null = null
      if (form.tipo === 'despesa' && form.createExpense && form.amount && parseFloat(form.amount) > 0) {
        const { data: newExpense, error: expErr } = await supabase.from('expenses').insert({
          expense_date: form.doc_date,
          category: 'outros',
          type: 'pontual',
          description: form.title || form.description,
          amount: parseFloat(form.amount),
          payment_method: form.payment_method,
          supplier: form.supplier || null,
          notes: `Criado via Documento Manual — ${autoDocNum}`,
        }).select().single()

        if (!expErr && newExpense) {
          newExpenseId = newExpense.id
          await supabase.from('documents').update({ expense_id: newExpense.id }).eq('id', newDoc.id)
        }
      }

      // 6. Add to Fundo de Maneio (optional)
      // O movimento tem de apontar para a despesa (quando existe), nunca para
      // o documento — é pela despesa que o resto da app localiza e limpa este
      // movimento (ex: ao apagar a despesa). A regra da data do fundo de
      // maneio é a mesma para despesas e receitas em dinheiro.
      if (form.addToFundo && form.amount && parseFloat(form.amount) > 0 && form.doc_date >= CASH_FUND_START_DATE) {
        const isSaida = form.tipo === 'despesa'
        const amtVal = parseFloat(form.amount)
        await supabase.from('cash_fund_movements').insert({
          movement_date: form.doc_date,
          description: `${docTitle} — ${form.supplier}`,
          amount: isSaida ? -Math.abs(amtVal) : Math.abs(amtVal),
          type: isSaida ? 'saida' : 'entrada',
          source: newExpenseId ? 'despesa' : 'documento_manual',
          source_id: newExpenseId ?? newDoc.id,
          notes: form.description || null,
        })
      }

      await logAccess({
        action: 'criar',
        page: '/documentos',
        details: `Criou documento manual "${docTitle}" — ${form.supplier}${form.amount ? ` (${form.amount}EUR)` : ''}`,
      })

      setPdfBlob(blob)
      setPdfName(`${docTitle}_${form.supplier}_${autoDocNum}.pdf`)
      setDone(true)
      onSaved()
    } catch (e: any) {
      setError('Erro inesperado: ' + e.message)
    }
    setSaving(false)
  }

  function handleDownload() {
    if (!pdfBlob) return
    const url = URL.createObjectURL(pdfBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = pdfName
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-semibold text-lg text-gray-900">Criar Documento Manual</h2>
            <p className="text-sm text-gray-500">Documento interno para uso próprio</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {done ? (
          <div className="text-center py-8 space-y-4">
            <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto" />
            <p className="font-medium text-gray-900">Documento criado com sucesso!</p>
            <p className="text-sm text-gray-500">O PDF foi guardado na pasta Documentos e pode ser descarregado agora ou mais tarde.</p>
            <div className="flex gap-3 justify-center pt-2">
              <button className="btn-primary flex items-center gap-2" onClick={handleDownload}>
                <Download className="w-4 h-4" /> Descarregar PDF
              </button>
              <button className="btn-secondary" onClick={onClose}>Fechar</button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">

            {/* Tipo */}
            <div>
              <label className="label">Tipo de Documento</label>
              <div className="flex gap-2">
                {(['despesa', 'receita', 'nota'] as DocTipo[]).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => { set('tipo', t); set('createExpense', false); set('addToFundo', false) }}
                    className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                      form.tipo === t
                        ? t === 'despesa' ? 'bg-red-50 border-red-300 text-red-700'
                          : t === 'receita' ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                          : 'bg-indigo-50 border-indigo-300 text-indigo-700'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {t === 'despesa' ? '💸 Despesa' : t === 'receita' ? '💰 Receita' : '📝 Nota'}
                  </button>
                ))}
              </div>
            </div>

            {/* Título */}
            <div>
              <label className="label">Título do Documento</label>
              <input
                className="input"
                placeholder="ex: Pagamento Wabo Junho, Reparação Canalização..."
                value={form.title}
                onChange={e => set('title', e.target.value)}
              />
            </div>

            {/* Fornecedor */}
            <div>
              <label className="label">Fornecedor / Entidade *</label>
              <input
                className="input"
                placeholder="ex: Wabo, Câmara Municipal..."
                value={form.supplier}
                onChange={e => set('supplier', e.target.value)}
              />
            </div>

            {/* Data e Nº Doc */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Data *</label>
                <input type="date" className="input" value={form.doc_date} onChange={e => set('doc_date', e.target.value)} />
              </div>
              <div>
                <label className="label">Nº Documento</label>
                <input className="input" placeholder="ex: 2024-001 (auto)" value={form.doc_number} onChange={e => set('doc_number', e.target.value)} />
              </div>
            </div>

            {/* Descrição */}
            <div>
              <label className="label">Descrição *</label>
              <textarea
                className="input"
                rows={4}
                placeholder="Descreve o que foi comprado, recebido ou a nota que pretendes registar..."
                value={form.description}
                onChange={e => set('description', e.target.value)}
              />
            </div>

            {/* Valor */}
            <div>
              <label className="label">Valor Total (€)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input"
                placeholder="0.00"
                value={form.amount}
                onChange={e => set('amount', e.target.value)}
              />
            </div>

            {/* Opções extras */}
            {form.amount && parseFloat(form.amount) > 0 && (
              <div className="bg-gray-50 rounded-lg p-4 space-y-3 border border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Opções adicionais</p>

                {form.tipo === 'despesa' && (
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-emerald-600"
                      checked={form.createExpense}
                      onChange={e => set('createExpense', e.target.checked)}
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-700">Criar despesa em /despesas</p>
                      <p className="text-xs text-gray-500">Aparece na lista de despesas para controlo financeiro</p>
                    </div>
                  </label>
                )}

                {form.tipo === 'despesa' && form.createExpense && (
                  <div className="pl-7">
                    <label className="label text-xs">Método de pagamento</label>
                    <select className="input text-sm" value={form.payment_method} onChange={e => set('payment_method', e.target.value)}>
                      <option value="dinheiro">Dinheiro</option>
                      <option value="banco">Transferência / Banco</option>
                    </select>
                  </div>
                )}

                {(form.tipo === 'despesa' || form.tipo === 'receita') && (
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-emerald-600"
                      checked={form.addToFundo}
                      onChange={e => set('addToFundo', e.target.checked)}
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-700">
                        {form.tipo === 'despesa' ? 'Registar saída no Fundo de Maneio' : 'Registar entrada no Fundo de Maneio'}
                      </p>
                      <p className="text-xs text-gray-500">
                        {form.tipo === 'despesa' ? 'Deduz este valor do saldo disponível em caixa' : 'Adiciona este valor ao saldo disponível em caixa'}
                      </p>
                    </div>
                  </label>
                )}
              </div>
            )}

            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

            <div className="flex justify-end gap-3 pt-2">
              <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
              <button className="btn-primary flex items-center gap-2" onClick={handleSave} disabled={saving}>
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> A criar...</> : 'Criar Documento'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
