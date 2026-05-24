'use client'

export const dynamic = 'force-dynamic'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  Upload, CheckCircle, Clock, XCircle, ArrowUpRight,
  ArrowDownRight, ChevronLeft, Loader2, Link2, X
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
  import_code: string
  status: 'por_validar' | 'validado' | 'ignorado'
  suggested_type: string | null
  suggested_lease_id: string | null
  notes: string | null
  lease?: { space?: { ref: string }; tenant?: { name: string } }
}

interface Bank {
  id: string
  name: string
  iban: string | null
}

export default function BankDetailPage({ params }: { params: { id: string } }) {
  const [bank, setBank] = useState<Bank | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [filterStatus, setFilterStatus] = useState<'all' | 'por_validar' | 'validado' | 'ignorado'>('all')
  const supabase = createClient()

  useEffect(() => { fetchData() }, [params.id])

  async function fetchData() {
    setLoading(true)
    const { data: bankData } = await supabase.from('banks').select('*').eq('id', params.id).single()
    setBank(bankData)
    const { data: txData } = await supabase
      .from('bank_transactions')
      .select('*, lease:leases(space:spaces(ref), tenant:tenants(name))')
      .eq('bank_id', params.id)
      .order('transaction_date', { ascending: false })
    setTransactions(txData ?? [])
    setLoading(false)
  }

  async function handleFileImport(file: File) {
    setImporting(true)
    try {
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data)
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1 })

      if (rows.length < 2) { alert('Ficheiro vazio ou sem dados'); setImporting(false); return }

      const headers: string[] = rows[0].map((h: any) => String(h ?? '').toLowerCase())
      const findCol = (keywords: string[]) => {
        for (const kw of keywords) {
          const idx = headers.findIndex(h => h.includes(kw))
          if (idx >= 0) return idx
        }
        return -1
      }

      const dateCol = findCol(['data', 'date', 'dia'])
      const descCol = findCol(['descri', 'movimento', 'detail'])
      const amountCol = findCol(['valor', 'amount', 'montante', 'debito', 'crédito'])
      const balanceCol = findCol(['saldo', 'balance'])
      const refCol = findCol(['ref', 'referencia', 'referência', 'doc'])

      if (dateCol < 0 || descCol < 0 || amountCol < 0) {
        alert(`Não foi possível detetar as colunas automaticamente.\n\nColunas encontradas:\n${rows[0].join(', ')}\n\nO ficheiro deve ter colunas de Data, Descrição e Valor.`)
        setImporting(false)
        return
      }

      const { data: leases } = await supabase
        .from('leases')
        .select('id, monthly_rent, space:spaces(ref), tenant:tenants(name)')
        .eq('status', 'ativo')

      let imported = 0
      let skipped = 0

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i]
        if (!row || row.length === 0) continue

        const rawDate = row[dateCol]
        const rawAmount = row[amountCol]
        const rawDesc = String(row[descCol] ?? '').trim()
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

        const reference = refCol >= 0 ? String(row[refCol] ?? '').trim() : null
        const balance = balanceCol >= 0 ? parseFloat(String(row[balanceCol] ?? '0').replace(',', '.')) : null

        const codeStr = `${params.id}|${txDate}|${amount}|${rawDesc}`
        const importCode = await generateHash(codeStr)

        let suggestedType = null
        let suggestedLeaseId = null
        if (amount > 0 && leases) {
          const match = leases.find(l => Math.abs(l.monthly_rent - amount) < 5)
          if (match) { suggestedType = 'renda'; suggestedLeaseId = match.id }
        }

        const { error } = await supabase.from('bank_transactions').insert({
          bank_id: params.id,
          transaction_date: txDate,
          description: rawDesc,
          amount,
          balance,
          reference: reference || null,
          import_code: importCode,
          status: 'por_validar',
          suggested_type: suggestedType,
          suggested_lease_id: suggestedLeaseId,
        })

        if (error?.code === '23505') { skipped++ } else if (!error) { imported++ }
      }

      alert(`✅ Importação concluída!\n\n${imported} linhas importadas\n${skipped} duplicados ignorados`)
      setShowImport(false)
      fetchData()
    } catch (err) {
      console.error(err)
      alert('Erro ao processar o ficheiro. Verifica se é um ficheiro Excel ou CSV válido.')
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

  return (
    <AppLayout>
      <div className="p-8">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/financeiro/bancos" className="text-gray-400 hover:text-gray-600">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900">{bank?.name ?? 'Banco'}</h1>
            {bank?.iban && <p className="text-sm text-gray-500 font-mono mt-0.5">{bank.iban}</p>}
          </div>
          <button className="btn-primary" onClick={() => setShowImport(true)}>
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
                  <th className="table-header">Referência</th>
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
                    <td className="table-cell text-xs text-gray-500">{tx.reference ?? '—'}</td>
                    <td className="table-cell">
                      <span className={`font-semibold text-sm ${tx.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {tx.amount >= 0 ? '+' : ''}{formatCurrency(tx.amount)}
                      </span>
                    </td>
                    <td className="table-cell text-sm text-gray-500">
                      {tx.balance != null ? formatCurrency(tx.balance) : '—'}
                    </td>
                    <td className="table-cell">
                      {tx.suggested_type && tx.lease ? (
                        <div className="flex items-center gap-1.5">
                          <Link2 className="w-3 h-3 text-blue-500" />
                          <span className="text-xs text-blue-600">
                            {tx.lease.space?.ref} · {tx.lease.tenant?.name}
                          </span>
                        </div>
                      ) : tx.suggested_type ? (
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
                    <td colSpan={8} className="py-12 text-center text-gray-400 text-sm">
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
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-lg text-gray-900">Importar Extrato</h2>
              <button onClick={() => setShowImport(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mb-5 text-sm text-blue-700">
              <p className="font-medium mb-1">Formatos suportados: Excel (.xlsx) e CSV (.csv)</p>
              <p>O ficheiro deve ter colunas de <strong>Data</strong>, <strong>Descrição</strong> e <strong>Valor</strong>. Linhas já importadas são automaticamente ignoradas.</p>
            </div>
            {importing ? (
              <div className="flex flex-col items-center py-8 gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
                <p className="text-sm text-gray-600">A processar o ficheiro...</p>
              </div>
            ) : (
              <label className="flex flex-col items-center gap-3 border-2 border-dashed border-gray-200 rounded-xl p-8 cursor-pointer hover:border-emerald-400 transition-colors">
                <Upload className="w-10 h-10 text-gray-300" />
                <div className="text-center">
                  <p className="font-medium text-gray-700">Clica para selecionar o ficheiro</p>
                  <p className="text-sm text-gray-400 mt-1">Excel (.xlsx) ou CSV (.csv)</p>
                </div>
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFileImport(f) }} />
              </label>
            )}
            <div className="flex justify-end mt-5">
              <button className="btn-secondary" onClick={() => setShowImport(false)}>Cancelar</button>
            </div>
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
