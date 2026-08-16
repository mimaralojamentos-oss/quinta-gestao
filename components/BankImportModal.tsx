'use client'

// Importação de extratos bancários (Excel/CSV).
//
// Vive aqui, e não dentro da página do extrato, porque é usado em dois sítios:
//   - no extrato de cada conta (/financeiro/bancos/[id])
//   - diretamente no cartão de cada banco (/financeiro/bancos)
// Assim é possível importar sem abrir o extrato.

import { useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { Upload, X, Loader2, ArrowRight } from 'lucide-react'
// Vem do CDN oficial do SheetJS (ver "xlsx" no package.json), não do
// registo do npm: a versão publicada lá ficou parada na 0.18.5 (2022) e
// não tem as correções de segurança de versões mais recentes. Não trocar
// para a versão do npm — seria uma regressão de segurança.
import * as XLSX from 'xlsx'
import { useFileDrop } from '@/lib/useFileDrop'
import { matchesSearch } from '@/lib/utils'

interface ColumnMapping {
  date: string
  description: string
  amount: string
  balance: string
  type: string
}

function parsePortugueseNumber(raw: any): number {
  if (typeof raw === 'number') return raw
  const str = String(raw).replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.')
  return parseFloat(str)
}

async function generateHash(str: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(str)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

export default function BankImportModal({ bankId, bankName, columnMapping, onImported, onClose }: {
  bankId: string
  bankName?: string
  columnMapping?: any
  onImported: () => void
  onClose: () => void
}) {
  const supabase = createClient()
  const [importing, setImporting] = useState(false)
  const [importStep, setImportStep] = useState<'upload' | 'mapping' | 'preview'>('upload')
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([])
  const [parsedRows, setParsedRows] = useState<any[][]>([])
  const [headerRowIndex, setHeaderRowIndex] = useState(0)
  const [mapping, setMapping] = useState<ColumnMapping>({ date: '', description: '', amount: '', balance: '', type: '' })
  const [importFile, setImportFile] = useState<File | null>(null)

  const extratoDrop = useFileDrop({
    accept: ['.xlsx', '.xls', '.csv'],
    onFiles: dropped => { if (dropped[0]) handleFileSelect(dropped[0]) },
    disabled: importing,
  })

  async function handleFileSelect(file: File) {
    setImportFile(file); setImporting(true)
    try {
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data)
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 })
      let bestRow = 0, bestCount = 0
      rows.slice(0, 15).forEach((row, i) => {
        const count = row.filter(c => c !== null && c !== undefined && String(c).trim() !== '').length
        if (count > bestCount) { bestCount = count; bestRow = i }
      })
      setParsedRows(rows); setHeaderRowIndex(bestRow)
      const headers = rows[bestRow].map((h: any) => String(h ?? '').trim()).filter(h => h !== '')
      setParsedHeaders(headers)
      const suggest = (keywords: string[]) => {
        for (const kw of keywords) {
          const match = headers.find(h => matchesSearch(h, kw))
          if (match) return match
        }
        return ''
      }
      setMapping(columnMapping ?? {
        date: suggest(['data mov', 'date', 'data']),
        description: suggest(['descri', 'movimento', 'detalhe']),
        amount: suggest(['valor', 'amount', 'montante']),
        balance: suggest(['saldo', 'balance']),
        type: suggest(['tipo', 'type', 'débito', 'credito']),
      })
      setImportStep('mapping')
    } catch (err) { alert('Erro ao ler o ficheiro.') }
    setImporting(false)
  }

  function handleMappingConfirm() {
    if (!mapping.date || !mapping.description || !mapping.amount) { alert('Data, Descrição e Valor são obrigatórios'); return }
    setImportStep('preview')
  }

  async function handleImport() {
    if (!importFile) return
    setImporting(true)
    try {
      const headers = parsedRows[headerRowIndex].map((h: any) => String(h ?? '').trim())
      const dataRows = parsedRows.slice(headerRowIndex + 1)
      const getCol = (fieldName: string) => headers.indexOf(fieldName)
      const dateCol = getCol(mapping.date), descCol = getCol(mapping.description)
      const amountCol = getCol(mapping.amount), balanceCol = mapping.balance ? getCol(mapping.balance) : -1
      const typeCol = mapping.type ? getCol(mapping.type) : -1
      await supabase.from('banks').update({ column_mapping: mapping }).eq('id', bankId)
      let imported = 0, skipped = 0
      for (const row of dataRows) {
        if (!row || row.length === 0) continue
        const rawDate = row[dateCol], rawAmount = row[amountCol]
        const rawDesc = String(row[descCol] ?? '').trim()
        const rawType = typeCol >= 0 ? String(row[typeCol] ?? '').trim() : ''
        if (!rawDate || rawAmount === undefined || !rawDesc) continue
        let txDate: string
        if (typeof rawDate === 'number') {
          const d = XLSX.SSF.parse_date_code(rawDate)
          txDate = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
        } else {
          const parts = String(rawDate).split(/[\/\-\.]/)
          if (parts.length === 3) {
            txDate = parts[0].length === 4
              ? `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`
              : `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
          } else { txDate = String(rawDate) }
        }
        let amount = parsePortugueseNumber(rawAmount)
        if (isNaN(amount)) continue
        if (rawType.toLowerCase().includes('déb') || rawType.toLowerCase().includes('deb')) amount = -Math.abs(amount)
        else if (rawType.toLowerCase().includes('cré') || rawType.toLowerCase().includes('cre')) amount = Math.abs(amount)
        const balance = balanceCol >= 0 ? parsePortugueseNumber(row[balanceCol]) : null
        const codeStr = `${bankId}|${txDate}|${amount}|${rawDesc}`
        const importCode = await generateHash(codeStr)
        const { error } = await supabase.from('bank_transactions').insert({
          bank_id: bankId, transaction_date: txDate, description: rawDesc, amount,
          balance: isNaN(balance!) ? null : balance, reference: null,
          import_code: importCode, status: 'por_validar',
          suggested_type: null, suggested_lease_id: null,
        })
        if (error?.code === '23505') { skipped++ } else if (!error) { imported++ }
      }
      alert(`✅ Importação concluída!\n\n${imported} linhas importadas\n${skipped} duplicados ignorados`)
      onImported(); onClose()
    } catch (err) { console.error(err); alert('Erro durante a importação.') }
    setImporting(false)
  }

  const headers = parsedRows[headerRowIndex]?.map((h: any) => String(h ?? '').trim()) ?? []
  const previewRows = parsedRows.slice(headerRowIndex + 1).slice(0, 5).filter(r => r && r.length > 0)

  return (

        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="font-semibold text-lg text-gray-900">
                  Importar Extrato{bankName ? ` — ${bankName}` : ''}
                </h2>
                <div className="flex items-center gap-2 mt-1">
                  {['upload', 'mapping', 'preview'].map((step, i) => (
                    <div key={step} className="flex items-center gap-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${importStep === step ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                        {i + 1}. {step === 'upload' ? 'Ficheiro' : step === 'mapping' ? 'Colunas' : 'Confirmar'}
                      </span>
                      {i < 2 && <ArrowRight className="w-3 h-3 text-gray-400" />}
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={() => { onClose() }}><X className="w-5 h-5 text-gray-400" /></button>
            </div>

            {importStep === 'upload' && (
              <div>
                <p className="text-sm text-gray-500 mb-4">Seleciona o ficheiro Excel ou CSV exportado do teu banco.</p>
                {importing ? (
                  <div className="flex flex-col items-center py-8 gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
                    <p className="text-sm text-gray-600">A analisar o ficheiro...</p>
                  </div>
                ) : (
                  <label
                    {...extratoDrop.dropProps}
                    className={`flex flex-col items-center gap-3 border-2 border-dashed rounded-xl p-8 cursor-pointer transition-colors ${
                      extratoDrop.isDragging ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:border-emerald-400'
                    }`}>
                    <Upload className={`w-10 h-10 ${extratoDrop.isDragging ? 'text-emerald-500' : 'text-gray-300'}`} />
                    <div className="text-center">
                      <p className="font-medium text-gray-700">
                        {extratoDrop.isDragging ? 'Larga aqui o ficheiro' : 'Arrasta para aqui ou clica para selecionar'}
                      </p>
                      <p className="text-sm text-gray-400 mt-1">Excel (.xlsx) ou CSV (.csv)</p>
                    </div>
                    <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f) }} />
                  </label>
                )}
              </div>
            )}

            {importStep === 'mapping' && (
              <div>
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-4 text-sm text-blue-700">
                  Encontrámos <strong>{parsedHeaders.length} colunas</strong> no ficheiro. Confirma a associação:
                </div>
                <div className="space-y-3">
                  {[
                    { key: 'date', label: 'Data da transação', required: true },
                    { key: 'description', label: 'Descrição / Movimento', required: true },
                    { key: 'amount', label: 'Valor', required: true },
                    { key: 'balance', label: 'Saldo após movimento', required: false },
                    { key: 'type', label: 'Tipo (Débito/Crédito)', required: false },
                  ].map(field => (
                    <div key={field.key} className="flex items-center gap-4">
                      <div className="w-48 flex-shrink-0">
                        <p className="text-sm font-medium text-gray-700">{field.label}</p>
                        {field.required && <p className="text-xs text-red-500">obrigatório</p>}
                      </div>
                      <ArrowRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <select className="input flex-1" value={(mapping as any)[field.key]}
                        onChange={e => setMapping(m => ({ ...m, [field.key]: e.target.value }))}>
                        <option value="">— Não importar —</option>
                        {parsedHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between mt-6">
                  <button className="btn-secondary" onClick={() => setImportStep('upload')}>← Voltar</button>
                  <button className="btn-primary" onClick={handleMappingConfirm}>Ver pré-visualização →</button>
                </div>
              </div>
            )}

            {importStep === 'preview' && (
              <div>
                <p className="text-sm text-gray-500 mb-3">Pré-visualização das primeiras 5 linhas:</p>
                <div className="overflow-x-auto rounded-lg border border-gray-100 mb-4">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-gray-500">Data</th>
                        <th className="px-3 py-2 text-left text-gray-500">Descrição</th>
                        <th className="px-3 py-2 text-left text-gray-500">Valor</th>
                        <th className="px-3 py-2 text-left text-gray-500">Saldo</th>
                        <th className="px-3 py-2 text-left text-gray-500">Tipo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {previewRows.map((row, i) => {
                        const getVal = (field: string) => { const idx = headers.indexOf(field); return idx >= 0 ? String(row[idx] ?? '') : '—' }
                        return (
                          <tr key={i}>
                            <td className="px-3 py-2">{getVal(mapping.date)}</td>
                            <td className="px-3 py-2 max-w-xs truncate">{getVal(mapping.description)}</td>
                            <td className="px-3 py-2">{getVal(mapping.amount)}</td>
                            <td className="px-3 py-2">{mapping.balance ? getVal(mapping.balance) : '—'}</td>
                            <td className="px-3 py-2">{mapping.type ? getVal(mapping.type) : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 text-sm text-emerald-700 mb-4">
                  ✅ Linhas duplicadas serão automaticamente ignoradas.
                </div>
                <div className="flex justify-between">
                  <button className="btn-secondary" onClick={() => setImportStep('mapping')}>← Voltar</button>
                  <button className="btn-primary" onClick={handleImport} disabled={importing}>
                    {importing ? <><Loader2 className="w-4 h-4 animate-spin" /> A importar...</> : '✓ Importar'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
  )
}
