'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  Upload, CheckCircle, Clock, XCircle, ArrowUpRight,
  ArrowDownRight, ChevronLeft, Loader2, X, ArrowRight
} from 'lucide-react'
import Link from 'next/link'
import * as XLSX from 'xlsx'

interface Transaction {
  id: string
  transaction_date: string
  description: string
  amount: number
  balance: number | null
  reference: string | null
  status: 'por_validar' | 'validado' | 'ignorado'
  suggested_type: string | null
  notes: string | null
}

interface Bank {
  id: string
  name: string
  iban: string | null
  column_mapping?: any
}

interface ColumnMapping {
  date: string
  description: string
  amount: string
  balance: string
  type: string
}

export default function BankDetailPage({ params }: { params: { id: string } }) {
  const bankId = params?.id ?? ''
  const [bank, setBank] = useState<Bank | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [filterStatus, setFilterStatus] = useState<'all' | 'por_validar' | 'validado' | 'ignorado'>('all')
  const [importStep, setImportStep] = useState<'upload' | 'mapping' | 'preview'>('upload')
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([])
  const [parsedRows, setParsedRows] = useState<any[][]>([])
  const [headerRowIndex, setHeaderRowIndex] = useState(0)
  const [mapping, setMapping] = useState<ColumnMapping>({ date: '', description: '', amount: '', balance: '', type: '' })
  const [importFile, setImportFile] = useState<File | null>(null)
  const supabase = createClient()

  useEffect(() => { if (bankId) fetchData() }, [bankId])

  async function fetchData() {
    setLoading(true)
    try {
      const { data: bankData } = await supabase.from('banks').select('*').eq('id', bankId).single()
      setBank(bankData)
      const { data: txData } = await supabase
        .from('bank_transactions')
        .select('*')
        .eq('bank_id', bankId)
        .order('transaction_date', { ascending: false })
      setTransactions(txData ?? [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function handleFileSelect(file: File) {
    setImportFile(file)
    setImporting(true)
    try {
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data)
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 })

      let bestRow = 0
      let bestCount = 0
      rows.slice(0, 15).forEach((row, i) => {
        const count = row.filter(c => c !== null && c !== undefined && String(c).trim() !== '').length
        if (count > bestCount) { bestCount = count; bestRow = i }
      })

      setParsedRows(rows)
      setHeaderRowIndex(bestRow)
      const headers = rows[bestRow].map((h: any) => String(h ?? '').trim()).filter(h => h !== '')
      setParsedHeaders(headers)

      const suggest = (keywords: string[]) => {
        for (const kw of keywords) {
          const match = headers.find(h => h.toLowerCase().includes(kw.toLowerCase()))
          if (match) return match
        }
        return ''
      }

      const savedMapping = bank?.column_mapping
      setMapping(savedMapping ?? {
        date: suggest(['data mov', 'date', 'data']),
        description: suggest(['descri', 'movimento', 'detalhe']),
        amount: suggest(['valor', 'amount', 'montante']),
        balance: suggest(['saldo', 'balance']),
        type: suggest(['tipo', 'type', 'débito', 'credito']),
      })

      setImportStep('mapping')
    } catch (err) {
      alert('Erro ao ler o ficheiro.')
    }
    setImporting(false)
  }

  function handleMappingConfirm() {
    if (!mapping.date || !mapping.description || !mapping.amount) {
      alert('Data, Descrição e Valor são obrigatórios')
      return
    }
    setImportStep('preview')
  }

  async function handleImport() {
    if (!importFile) return
    setImporting(true)
    try {
      const headers = parsedRows[headerRowIndex].map((h: any) => String(h ?? '').trim())
      const dataRows = parsedRows.slice(headerRowIndex + 1)

      const getCol = (fieldName: string) => headers.indexOf(fieldName)
      const dateCol = getCol(mapping.date)
      const descCol = getCol(mapping.description)
      const amountCol = getCol(mapping.amount)
      const balanceCol = mapping.balance ? getCol(mapping.balance) : -1
      const typeCol = mapping.type ? getCol(mapping.type) : -1

      await supabase.from('banks').update({ column_mapping: mapping }).eq('id', bankId)

      const { data: leases } = await supabase
        .from('leases').select('id, monthly_rent').eq('status', 'ativo')

      let imported = 0
      let skipped = 0

      for (const row of dataRows) {
        if (!row || row.length === 0) continue
        const rawDate = row[dateCol]
        const rawAmount = row[amountCol]
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

        let amount: number
        if (typeof rawAmount === 'number') {
          amount = rawAmount
        } else {
          amount = parseFloat(String(rawAmount).replace(/[^\d,.\-]/g, '').replace(',', '.'))
        }
        if (isNaN(amount)) continue

        if (rawType.toLowerCase().includes('déb') || rawType.toLowerCase().includes('deb')) {
          amount = -Math.abs(amount)
        } else if (rawType.toLowerCase().includes('cré') || rawType.toLowerCase().includes('cre')) {
          amount = Math.abs(amount)
        }

        const balance = balanceCol >= 0
          ? parseFloat(String(row[balanceCol] ?? '').replace(/[^\d,.\-]/g, '').replace(',', '.'))
          : null

        const codeStr = `${bankId}|${txDate}|${amount}|${rawDesc}`
        const importCode = await generateHash(codeStr)

        let suggestedType = null
        let suggestedLeaseId = null
        if (amount > 0 && leases) {
          const match = leases.find(l => Math.abs(l.monthly_rent - amount) < 5)
          if (match) { suggestedType = 'renda'; suggestedLeaseId = match.id }
        }

        const { error } = await supabase.from('bank_transactions').insert({
          bank_id: bankId,
          transaction_date: txDate,
          description: rawDesc,
          amount,
          balance: isNaN(balance!) ? null : balance,
          reference: null,
          import_code: importCode,
          status: 'por_validar',
          suggested_type: suggestedType,
          suggested_lease_id: suggestedLeaseId,
        })

        if (error?.code === '23505') { skipped++ } else if (!error) { imported++ }
      }

      alert(`✅ Importação concluída!\n\n${imported} linhas importadas\n${skipped} duplicados ignorados`)
      setShowImport(false)
      setImportStep('upload')
      fetchData()
    } catch (err) {
      console.error(err)
      alert('Erro durante a importação.')
    }
    setImporting(false)
  }

  async function updateStatus(id: string, status: 'validado' | 'ignorado' | 'por_validar') {
    await supabase.from('bank_transactions').update({ status }).eq('id', id)
    fetchData()
  }

  const filtered = transactions.filter(t => filterStatus === 'all' || t.status === filterStatus)
  const totalIn = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0)
  const totalOut = transactions.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)
  const pending = transactions.filter(t => t.status === 'por_validar').length
  const headers = parsedRows[headerRowIndex]?.map((h: any) => String(h ?? '').trim()) ?? []
  const previewRows = parsedRows.slice(headerRowIndex + 1).slice(0, 5).filter(r => r && r.length > 0)

  return (
    <AppLayout>
      <div className="p-8">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/financeiro/bancos" prefetch={false} className="text-gray-400 hover:text-gray-600">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900">{bank?.name ?? 'Banco'}</h1>
            {bank?.iban && <p className="text-sm text-gray-500 font-mono mt-0.5">{bank.iban}</p>}
          </div>
          <button className="btn-primary" onClick={() => { setShowImport(true); setImportStep('upload') }}>
            <Upload className="w-4 h-4" /> Importar Extrato
          </button>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="card">
            <div className="flex items-center gap-2 mb-1">
              <ArrowUpRight className="w-4 h-4 text-emerald-500" />
              <p className="text-sm text-gray-500">Total Entradas</p>
            </div>
            <p className="text-xl font-bold text-emerald-600">{formatCurrency(totalIn)}</p>
          </div>
          <div className="card">
            <div className="flex items-center gap-2 mb-1">
              <ArrowDownRight className="w-4 h-4 text-red-500" />
              <p className="text-sm text-gray-500">Total Saídas</p>
            </div>
            <p className="text-xl font-bold text-red-600">{formatCurrency(totalOut)}</p>
          </div>
          <div className="card">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-yellow-500" />
              <p className="text-sm text-gray-500">Por Validar</p>
            </div>
            <p className="text-xl font-bold text-yellow-600">{pending}</p>
          </div>
          <div className="card">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              <p className="text-sm text-gray-500">Validadas</p>
            </div>
            <p className="text-xl font-bold text-gray-800">{transactions.filter(t => t.status === 'validado').length}</p>
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          {(['all', 'por_validar', 'validado', 'ignorado'] as const).map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${filterStatus === s ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}>
              {s === 'all' ? 'Todas' : s === 'por_validar' ? 'Por Validar' : s === 'validado' ? 'Validadas' : 'Ignoradas'}
              {s !== 'all' && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs bg-black/10">
                  {transactions.filter(t => t.status === s).length}
                </span>
              )}
            </button>
          ))}
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
                  <th className="table-header">Descrição</th>
                  <th className="table-header">Valor</th>
                  <th className="table-header">Saldo</th>
                  <th className="table-header">Sugestão</th>
                  <th className="table-header">Estado</th>
                  <th className="table-header"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(tx => (
                  <tr key={tx.id} className={`hover:bg-gray-50 ${tx.status === 'ignorado' ? 'opacity-50' : ''}`}>
                    <td className="table-cell text-sm">{formatDate(tx.transaction_date)}</td>
                    <td className="table-cell max-w-xs">
                      <p className="text-sm text-gray-800 truncate">{tx.description}</p>
                    </td>
                    <td className="table-cell">
                      <span className={`font-semibold text-sm ${tx.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {tx.amount >= 0 ? '+' : ''}{formatCurrency(tx.amount)}
                      </span>
                    </td>
                    <td className="table-cell text-sm text-gray-500">
                      {tx.balance != null ? formatCurrency(tx.balance) : '—'}
                    </td>
                    <td className="table-cell">
                      {tx.suggested_type ? (
                        <span className="text-xs text-blue-600">{tx.suggested_type}</span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="table-cell">
                      {tx.status === 'validado' ? (
                        <span className="badge-verde flex items-center gap-1 w-fit">
                          <CheckCircle className="w-3 h-3" /> Validado
                        </span>
                      ) : tx.status === 'ignorado' ? (
                        <span className="badge-cinza flex items-center gap-1 w-fit">
                          <XCircle className="w-3 h-3" /> Ignorado
                        </span>
                      ) : (
                        <span className="badge-amarelo flex items-center gap-1 w-fit">
                          <Clock className="w-3 h-3" /> Por validar
                        </span>
                      )}
                    </td>
                    <td className="table-cell">
                      <div className="flex gap-2">
                        {tx.status !== 'validado' && (
                          <button onClick={() => updateStatus(tx.id, 'validado')}
                            className="text-xs text-emerald-600 hover:underline font-medium">✓ Validar</button>
                        )}
                        {tx.status !== 'ignorado' && (
                          <button onClick={() => updateStatus(tx.id, 'ignorado')}
                            className="text-xs text-gray-400 hover:underline font-medium">Ignorar</button>
                        )}
                        {tx.status !== 'por_validar' && (
                          <button onClick={() => updateStatus(tx.id, 'por_validar')}
                            className="text-xs text-blue-500 hover:underline font-medium">Reset</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-gray-400 text-sm">
                      {transactions.length === 0
                        ? 'Ainda não há transações. Importa um extrato para começar.'
                        : 'Nenhuma transação com este filtro.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showImport && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="font-semibold text-lg text-gray-900">Importar Extrato</h2>
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
              <button onClick={() => { setShowImport(false); setImportStep('upload') }}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
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
                  <label className="flex flex-col items-center gap-3 border-2 border-dashed border-gray-200 rounded-xl p-8 cursor-pointer hover:border-emerald-400 transition-colors">
                    <Upload className="w-10 h-10 text-gray-300" />
                    <div className="text-center">
                      <p className="font-medium text-gray-700">Clica para selecionar o ficheiro</p>
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
                      <select className="input flex-1"
                        value={(mapping as any)[field.key]}
                        onChange={e => setMapping(m => ({ ...m, [field.key]: e.target.value }))}>
                        <option value="">— Não importar —</option>
                        {parsedHeaders.map(h => (
                          <option key={h} value={h}>{h}</option>
                        ))}
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
                        const getVal = (field: string) => {
                          const idx = headers.indexOf(field)
                          return idx >= 0 ? String(row[idx] ?? '') : '—'
                        }
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
                  ✅ Linhas duplicadas serão automaticamente ignoradas. O mapeamento será guardado para importações futuras.
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
      )}
    </AppLayout>
  )
}

async function generateHash(str: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(str)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}
