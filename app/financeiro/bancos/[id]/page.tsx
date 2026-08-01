'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { buildRentPaymentPlan, applyRentPaymentPlan } from '@/lib/rentPaymentPlan'
import { ensureExpenseForTransaction, emptySummary, addToSummary, describeSummary } from '@/lib/bankExpense'
import { useFileDrop } from '@/lib/useFileDrop'
import { useAuth } from '@/lib/auth-context'
import {
  Upload, CheckCircle, Clock, XCircle, ArrowUpRight,
  ArrowDownRight, ChevronLeft, Loader2, X, ArrowRight, Link2, Edit2, Search, SlidersHorizontal, Sparkles, RefreshCw, FileText
} from 'lucide-react'
import Link from 'next/link'
import * as XLSX from 'xlsx'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface Transaction {
  id: string
  transaction_date: string
  description: string
  amount: number
  balance: number | null
  reference: string | null
  status: 'por_validar' | 'validado' | 'ignorado'
  suggested_type: string | null
  suggested_lease_id: string | null
  confirmed_type: string | null
  confirmed_lease_id: string | null
  confirmed_expense_id: string | null
  confirmed_tenant_id: string | null
  confirmed_document_id: string | null
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

interface AutoMatch {
  type: 'renda' | 'despesa' | 'fatura' | 'regra' | 'transferencia_caixa'
  confidence: 'high' | 'medium' | 'low'
  reason: string
  tenant?: any
  lease?: any
  expense?: any
  document?: any
  cashMovement?: any
  ruleType?: string
}

interface MatchingRule {
  id: string
  bank_id: string
  keyword: string
  confirmed_type: string
  tenant_id: string | null
  notes: string | null
  created_at: string
}

function parsePortugueseNumber(raw: any): number {
  if (typeof raw === 'number') return raw
  const str = String(raw).replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.')
  return parseFloat(str)
}

const MESES_ABREV_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function formatMonthShortPT(dateString: string): string {
  const [year, month] = dateString.split('-').map(Number)
  return `${MESES_ABREV_PT[month - 1]} ${year}`
}

export default function BankDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [bankId, setBankId] = useState('')
  const [bank, setBank] = useState<Bank | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [validatingAll, setValidatingAll] = useState(false)
  const [validatingAllHigh, setValidatingAllHigh] = useState(false)
  const [showImport, setShowImport] = useState(false)

  const [filterStatus, setFilterStatus] = useState<'all' | 'por_validar' | 'validado' | 'ignorado'>('all')
  const [filterConfidence, setFilterConfidence] = useState<'all' | 'high' | 'medium' | 'low'>('all')
  const [filterIdentification, setFilterIdentification] = useState<'all' | 'identificadas' | 'nao_identificadas'>('all')
  const [filterCustosBancarios, setFilterCustosBancarios] = useState(false)

  const [importStep, setImportStep] = useState<'upload' | 'mapping' | 'preview'>('upload')
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([])
  const [parsedRows, setParsedRows] = useState<any[][]>([])
  const [headerRowIndex, setHeaderRowIndex] = useState(0)
  const [mapping, setMapping] = useState<ColumnMapping>({ date: '', description: '', amount: '', balance: '', type: '' })
  const [importFile, setImportFile] = useState<File | null>(null)
  const [matchModal, setMatchModal] = useState<Transaction | null>(null)
  const [tenants, setTenants] = useState<any[]>([])
  const [expenses, setExpenses] = useState<any[]>([])
  const [leases, setLeases] = useState<any[]>([])
  const [allLeases, setAllLeases] = useState<any[]>([])
  const [rentPayments, setRentPayments] = useState<any[]>([])
  const [txMatches, setTxMatches] = useState<Record<string, AutoMatch[]>>({})
  const [showFilters, setShowFilters] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncingExpenses, setSyncingExpenses] = useState(false)
  const [documents, setDocuments] = useState<any[]>([])
  const [pendingCashTransfers, setPendingCashTransfers] = useState<any[]>([])
  const [matchingRules, setMatchingRules] = useState<MatchingRule[]>([])
  const [showRules, setShowRules] = useState(false)
  const [newRuleKeyword, setNewRuleKeyword] = useState('')
  const [newRuleType, setNewRuleType] = useState('despesa')
  const [newRuleTenantId, setNewRuleTenantId] = useState('')
  const [newRuleNotes, setNewRuleNotes] = useState('')
  const [savingRule, setSavingRule] = useState(false)

  const [editingTxId, setEditingTxId] = useState<string | null>(null)
  const [editDate, setEditDate] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const [search, setSearch] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterAmountMin, setFilterAmountMin] = useState('')
  const [filterAmountMax, setFilterAmountMax] = useState('')
  const [filterDirection, setFilterDirection] = useState<'all' | 'entrada' | 'saida'>('all')

  const supabase = createClient()
  const { canWrite } = useAuth()

  const extratoDrop = useFileDrop({
    accept: ['.xlsx', '.xls', '.csv'],
    onFiles: dropped => { if (dropped[0]) handleFileSelect(dropped[0]) },
    disabled: importing,
  })

  useEffect(() => { params.then(p => setBankId(p.id)) }, [])
  useEffect(() => { if (bankId) fetchData() }, [bankId])

  async function fetchData() {
    setLoading(true)
    try {
      const { data: bankData } = await supabase.from('banks').select('*').eq('id', bankId).single()
      setBank(bankData)
      const { data: txData } = await supabase
        .from('bank_transactions').select('*').eq('bank_id', bankId)
        .order('transaction_date', { ascending: false }).order('balance', { ascending: true })
      setTransactions(txData ?? [])
      const { data: tenantsData } = await supabase.from('tenants').select('id, name, bank_reference').order('name')
      setTenants(tenantsData ?? [])
      const { data: leasesData } = await supabase
        .from('leases').select('id, monthly_rent, tenant:tenants(id, name), space:spaces(ref)').eq('status', 'ativo')
      setLeases(leasesData ?? [])
      const { data: allLeasesData } = await supabase
        .from('leases').select('id, monthly_rent, tenant:tenants(id, name), space:spaces(ref)')
      setAllLeases(allLeasesData ?? [])
      const { data: expensesData } = await supabase
        .from('expenses').select('id, expense_date, description, amount, supplier, payment_method')
        .eq('payment_method', 'banco')
        .order('expense_date', { ascending: false })
      setExpenses(expensesData ?? [])
      const { data: rentData } = await supabase
        .from('rent_payments').select('id, reference_month, amount, payment_date, payment_method, lease_id, lease:leases(id, space:spaces(ref), tenant:tenants(name))')
        .eq('payment_method', 'banco')
        .order('payment_date', { ascending: false })
      setRentPayments(rentData ?? [])

      const { data: docsData } = await supabase
        .from('documents')
        .select('id, original_name, tipo, supplier_name, amount, doc_date, expense_id, file_path')
        .not('amount', 'is', null)
        .eq('status', 'ativo')
      setDocuments(docsData ?? [])

      const { data: rulesData } = await supabase
        .from('bank_matching_rules')
        .select('*')
        .eq('bank_id', bankId)
        .order('created_at', { ascending: false })
      setMatchingRules(rulesData ?? [])

      // Transferências de caixa pendentes — para sugerir a entrada correspondente
      const { data: cashData } = await supabase
        .from('cash_fund_movements')
        .select('id, movement_date, description, amount, bank_id, transfer_status')
        .eq('transfer_status', 'pendente')
      setPendingCashTransfers(cashData ?? [])

      if (txData && leasesData && expensesData && tenantsData) {
        const matches: Record<string, AutoMatch[]> = {}
        for (const tx of txData) {
          if (!tx.confirmed_type) {
            const found = findAutoMatches(tx, leasesData, expensesData, tenantsData, rentData ?? [], docsData ?? [], rulesData ?? [], cashData ?? [])
            if (found.length > 0) matches[tx.id] = found
          }
        }
        setTxMatches(matches)
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  function findAutoMatches(tx: Transaction, leasesData: any[], expensesData: any[], tenantsData: any[], rentData: any[], docsData: any[], rulesData: MatchingRule[], cashTransfers: any[] = []): AutoMatch[] {
    const results: AutoMatch[] = []
    const txDate = new Date(tx.transaction_date)

    // Transferências do fundo de maneio que ainda não foram vistas no banco.
    // Máxima prioridade: se o valor bate certo e a data é próxima, é quase de
    // certeza a entrada correspondente ao dinheiro que saiu da caixa.
    if (tx.amount > 0) {
      for (const mov of cashTransfers) {
        const movAmount = Math.abs(mov.amount)
        const movDate = new Date(mov.movement_date)
        const daysApart = Math.abs((txDate.getTime() - movDate.getTime()) / (1000 * 60 * 60 * 24))
        if (Math.abs(movAmount - tx.amount) <= 0.02 && daysApart <= 10) {
          results.push({
            type: 'transferencia_caixa',
            confidence: 'high',
            reason: `Transferência do fundo de maneio de ${formatDate(mov.movement_date)}`,
            cashMovement: mov,
          })
        }
      }
    }

    // Regras personalizadas (máxima prioridade)
    for (const rule of rulesData) {
      if (tx.description.toLowerCase().includes(rule.keyword.toLowerCase())) {
        if (rule.confirmed_type === 'renda' && rule.tenant_id) {
          const tenant = tenantsData.find(t => t.id === rule.tenant_id)
          const lease = leasesData.find(l => (l.tenant as any)?.id === rule.tenant_id)
          results.push({ type: 'regra', confidence: 'high', reason: `Regra: "${rule.keyword}"`, tenant, lease, ruleType: 'renda' })
        } else {
          results.push({ type: 'regra', confidence: 'high', reason: `Regra: "${rule.keyword}"`, ruleType: rule.confirmed_type })
        }
      }
    }

    if (tx.amount > 0) {
      for (const tenant of tenantsData) {
        if (tenant.bank_reference && tx.description.toLowerCase().includes(tenant.bank_reference.toLowerCase())) {
          const lease = leasesData.find(l => (l.tenant as any)?.id === tenant.id)
          results.push({ type: 'renda', confidence: 'high', reason: `Referência bancária "${tenant.bank_reference}" encontrada`, tenant, lease })
        }
      }
      for (const tenant of tenantsData) {
        const nameParts = tenant.name.split(' ')
        const lastName = nameParts[nameParts.length - 1]
        if (lastName.length > 3 && tx.description.toLowerCase().includes(lastName.toLowerCase())) {
          const lease = leasesData.find(l => (l.tenant as any)?.id === tenant.id)
          if (!results.find(r => r.tenant?.id === tenant.id)) {
            results.push({ type: 'renda', confidence: 'medium', reason: `Nome "${lastName}" encontrado na descrição`, tenant, lease })
          }
        }
      }
      const rentMatches = leasesData.filter(l => Math.abs(l.monthly_rent - tx.amount) <= 1)
      for (const lease of rentMatches) {
        if (!results.find(r => r.lease?.id === lease.id)) {
          results.push({ type: 'renda', confidence: 'medium', reason: `Valor ${formatCurrency(tx.amount)} coincide com renda mensal`, tenant: lease.tenant, lease })
        }
      }
    }

    if (tx.amount < 0) {
      const amt = Math.abs(tx.amount)
      const dateFrom = new Date(txDate); dateFrom.setDate(dateFrom.getDate() - 15)
      const dateTo = new Date(txDate); dateTo.setDate(dateTo.getDate() + 15)
      const exactMatches = expensesData.filter(e => {
        const eDate = new Date(e.expense_date)
        return Math.abs(e.amount - amt) <= 0.02 && eDate >= dateFrom && eDate <= dateTo
      })
      for (const exp of exactMatches) {
        results.push({ type: 'despesa', confidence: 'high', reason: `Valor exato ${formatCurrency(amt)} e data próxima (±15 dias)`, expense: exp })
      }
      const supplierMatches = expensesData.filter(e => {
        if (!e.supplier) return false
        const supplierWords = e.supplier.split(' ').filter((w: string) => w.length >= 2)
        return supplierWords.some((w: string) => tx.description.toLowerCase().includes(w.toLowerCase()))
      })
      for (const exp of supplierMatches.slice(0, 2)) {
        if (!results.find(r => r.expense?.id === exp.id)) {
          results.push({ type: 'despesa', confidence: 'medium', reason: `Fornecedor "${exp.supplier}" encontrado na descrição`, expense: exp })
        }
      }
      if (results.length === 0) {
        const approxMatches = expensesData.filter(e => Math.abs(e.amount - amt) / amt <= 0.05)
        for (const exp of approxMatches.slice(0, 2)) {
          results.push({ type: 'despesa', confidence: 'low', reason: `Valor aproximado (${formatCurrency(exp.amount)} vs ${formatCurrency(amt)})`, expense: exp })
        }
      }

      // Matching com documentos/faturas
      const docDateFrom = new Date(txDate); docDateFrom.setDate(docDateFrom.getDate() - 30)
      const docDateTo = new Date(txDate); docDateTo.setDate(docDateTo.getDate() + 30)

      for (const doc of docsData) {
        if (!doc.amount) continue
        const docDate = doc.doc_date ? new Date(doc.doc_date) : null
        const dateOk = !docDate || (docDate >= docDateFrom && docDate <= docDateTo)
        const amountExact = Math.abs(doc.amount - amt) <= 0.02
        const amountApprox = Math.abs(doc.amount - amt) / Math.max(amt, 1) <= 0.05
        const supplierWords2 = doc.supplier_name
          ? doc.supplier_name.toLowerCase().split(' ').filter((w: string) => w.length >= 2)
          : []
        const fileKeywords = (doc.file_path || '').toLowerCase().split(/[\/_\-\s]+/).filter((w: string) => w.length >= 3)
        const allMatchWords = [...supplierWords2, ...fileKeywords]
        const supplierMatch = allMatchWords.some((w: string) => tx.description.toLowerCase().includes(w))

        if (amountExact && dateOk) {
          if (!results.find(r => r.document?.id === doc.id)) {
            results.push({ type: 'fatura', confidence: 'high', reason: `Valor exato ${formatCurrency(amt)} e data próxima`, document: doc })
          }
        } else if (supplierMatch && dateOk) {
          if (!results.find(r => r.document?.id === doc.id)) {
            results.push({ type: 'fatura', confidence: 'medium', reason: `Fornecedor "${doc.supplier_name}" encontrado`, document: doc })
          }
        } else if (amountApprox && dateOk) {
          if (!results.find(r => r.document?.id === doc.id)) {
            results.push({ type: 'fatura', confidence: 'low', reason: `Valor aproximado (${formatCurrency(doc.amount)} vs ${formatCurrency(amt)})`, document: doc })
          }
        }
      }
    }

    return results.slice(0, 3)
  }

  function getMatchLabel(tx: Transaction) {
    if (tx.confirmed_type === 'renda' && tx.confirmed_tenant_id) {
      const tenant = tenants.find(t => t.id === tx.confirmed_tenant_id)
      const lease = leases.find(l => (l.tenant as any)?.id === tx.confirmed_tenant_id)
      return { label: `🏠 ${tenant?.name ?? '—'}${lease?.space ? ` · ${(lease.space as any).ref}` : ''}`, color: 'text-emerald-600', confirmed: true }
    }
    if (tx.confirmed_type === 'despesa' && tx.confirmed_expense_id) {
      const exp = expenses.find(e => e.id === tx.confirmed_expense_id)
      return { label: `💸 ${exp?.description ?? '—'}`, color: 'text-red-600', confirmed: true }
    }
    if (tx.confirmed_type === 'despesa' && tx.confirmed_document_id) {
      const doc = documents.find(d => d.id === tx.confirmed_document_id)
      const label = doc ? `📄 ${doc.supplier_name ?? doc.original_name ?? 'Fatura'}` : '📄 Fatura'
      return { label, color: 'text-orange-600', confirmed: true, documentId: tx.confirmed_document_id, filePath: doc?.file_path }
    }
    if (tx.confirmed_type === 'custos_bancarios') {
      return { label: `🏦 ${tx.notes ?? 'Custos Bancários'}`, color: 'text-blue-600', confirmed: true }
    }
    if (tx.confirmed_type === 'impostos') {
      return { label: `🧾 ${tx.notes ?? 'Impostos'}`, color: 'text-orange-600', confirmed: true }
    }
    if (tx.confirmed_type === 'outro') {
      return { label: `📝 ${tx.notes ?? 'Outro'}`, color: 'text-gray-600', confirmed: true }
    }
    if (tx.confirmed_type === 'receita_extraordinaria') {
      return { label: `💰 Receita Extraordinária`, color: 'text-emerald-600', confirmed: true }
    }
    if (tx.confirmed_type === 'transferencia_interna') {
      return { label: `🔄 ${tx.notes ?? 'Transferência Interna'}`, color: 'text-indigo-600', confirmed: true }
    }
    const autoMatches = txMatches[tx.id]
    if (autoMatches && autoMatches.length > 0) {
      const best = autoMatches[0]
      if (best.type === 'renda') {
        return { label: `~ 🏠 ${best.tenant?.name ?? '—'}${best.lease?.space ? ` · ${(best.lease.space as any).ref}` : ''}`, color: 'text-emerald-400', confirmed: false, confidence: best.confidence }
      }
      if (best.type === 'despesa') {
        return { label: `~ 💸 ${best.expense?.description ?? '—'}`, color: 'text-red-400', confirmed: false, confidence: best.confidence }
      }
      if (best.type === 'transferencia_caixa') {
        return { label: `~ 🏦 Transferência do fundo de maneio`, color: 'text-indigo-400', confirmed: false, confidence: best.confidence }
      }
    }
    return null
  }

  // Cria o(s) rent_payment(s) correspondente(s) a uma transação bancária confirmada como "renda",
  // aplicando o valor por ordem de prioridade: renda > eletricidade em dívida > dívidas abertas > adiantamento.
  // Devolve 'created' se criou, 'skipped' se já existia pagamento de renda para o mês,
  // 'cancelled' se o utilizador rejeitou o resumo, ou 'no_lease' se não há contrato associado.
  async function processRendaTransaction(tx: Transaction, overrideMonth?: string, skipConfirm?: boolean): Promise<'created' | 'skipped' | 'no_lease' | 'cancelled'> {
    if (tx.confirmed_type !== 'renda' || !tx.confirmed_lease_id || tx.amount <= 0) return 'no_lease'

    const lease = allLeases.find(l => l.id === tx.confirmed_lease_id)
    if (!lease) return 'no_lease'

    const referenceMonth = (overrideMonth ?? tx.transaction_date.slice(0, 7)) + '-01'

    const { data: existingPayments } = await supabase
      .from('rent_payments')
      .select('id, tipo, amount')
      .eq('lease_id', tx.confirmed_lease_id)
      .eq('reference_month', referenceMonth)

    const existingRenda = (existingPayments ?? []).filter((p: any) => p.tipo === 'renda' || !p.tipo)
    const alreadyPaidRenda = existingRenda.reduce((sum: number, p: any) => sum + (p.amount || 0), 0)

    const tenantId = tx.confirmed_tenant_id ?? lease.tenant?.id

    const plan = await buildRentPaymentPlan(supabase, {
      leaseId: tx.confirmed_lease_id,
      tenantId,
      monthlyRent: lease.monthly_rent,
      amount: tx.amount,
      referenceMonth,
      alreadyPaidRenda,
    })

    if (!skipConfirm && !window.confirm(`${plan.summary}\n\nConfirmar processamento deste pagamento?`)) return 'cancelled'

    await applyRentPaymentPlan(supabase, plan, {
      leaseId: tx.confirmed_lease_id,
      tenantId,
      referenceMonth,
      paymentDate: tx.transaction_date,
      paymentMethod: 'banco',
    })

    return 'created'
  }

  // Cria (ou reutiliza) a despesa correspondente a um débito validado como "despesa".
  // Toda a proteção anti-duplicação está em lib/bankExpense.ts + UNIQUE na BD.
  async function ensureExpense(tx: Transaction, documentId?: string | null) {
    return ensureExpenseForTransaction(supabase, tx as any, { documentId })
  }

  function warnIfSkipped(result: 'created' | 'skipped' | 'no_lease' | 'cancelled') {
    if (result === 'skipped') {
      alert('⚠️ Já existe um pagamento de renda registado para este mês. A transação foi validada, mas não foi criado um novo registo de pagamento.')
    } else if (result === 'cancelled') {
      alert('ℹ️ Processamento cancelado. A transação foi validada, mas não foi criado nenhum registo de pagamento.')
    }
  }

  // Liga uma entrada bancária à transferência que saiu do fundo de maneio.
  // A partir daqui o dinheiro deixa de estar "em trânsito": saiu da caixa e
  // entrou no banco, com as duas pontas ligadas para não haver dupla contagem.
  async function confirmCashTransfer(tx: Transaction, cashMovement: any) {
    await supabase.from('bank_transactions').update({
      confirmed_type: 'transferencia_interna',
      status: 'validado',
      notes: `Transferência do fundo de maneio de ${formatDate(cashMovement.movement_date)}`,
    }).eq('id', tx.id)

    const { error } = await supabase.from('cash_fund_movements').update({
      transfer_status: 'confirmado',
      bank_transaction_id: tx.id,
      notes: `Confirmada no extrato bancário em ${formatDate(tx.transaction_date)}`,
    }).eq('id', cashMovement.id)

    if (error?.code === '23505') {
      alert('⚠️ Esta transferência já tinha sido confirmada por outro movimento bancário.')
    }
  }

  async function confirmAutoMatch(tx: Transaction) {
    const autoMatches = txMatches[tx.id]
    if (!autoMatches || autoMatches.length === 0) return
    const best = autoMatches[0]
    if (best.type === 'transferencia_caixa') {
      await confirmCashTransfer(tx, best.cashMovement)
      fetchData()
      return
    }
    if (best.type === 'renda') {
      const confirmedLeaseId = best.lease?.id ?? null
      await supabase.from('bank_transactions').update({
        confirmed_type: 'renda', confirmed_tenant_id: best.tenant?.id ?? null,
        confirmed_lease_id: confirmedLeaseId, status: 'validado',
      }).eq('id', tx.id)
      const result = await processRendaTransaction({ ...tx, confirmed_type: 'renda', confirmed_tenant_id: best.tenant?.id ?? null, confirmed_lease_id: confirmedLeaseId })
      warnIfSkipped(result)
    } else if (best.type === 'despesa') {
      await supabase.from('bank_transactions').update({
        confirmed_type: 'despesa', confirmed_expense_id: best.expense?.id ?? null, status: 'validado',
      }).eq('id', tx.id)
      // Se a sugestão trouxe uma despesa existente, apenas garantimos a ligação;
      // caso contrário a despesa é criada agora.
      await ensureExpense({ ...tx, confirmed_type: 'despesa', confirmed_expense_id: best.expense?.id ?? null })
    } else if (best.type === 'fatura') {
      const updateData: any = {
        confirmed_type: 'despesa',
        confirmed_document_id: best.document.id,
        status: 'validado',
      }
      if (best.document.expense_id) {
        updateData.confirmed_expense_id = best.document.expense_id
      }
      await supabase.from('bank_transactions').update(updateData).eq('id', tx.id)
      await ensureExpense(
        { ...tx, confirmed_type: 'despesa', confirmed_document_id: best.document.id, confirmed_expense_id: best.document.expense_id ?? null },
        best.document.id,
      )
      fetchData()
    } else if (best.type === 'regra') {
      const updateData: any = {
        confirmed_type: best.ruleType,
        status: 'validado',
      }
      if (best.tenant) {
        updateData.confirmed_tenant_id = best.tenant.id
        updateData.confirmed_lease_id = best.lease?.id ?? null
      }
      await supabase.from('bank_transactions').update(updateData).eq('id', tx.id)
      if (best.ruleType === 'renda' && best.lease) {
        const tx2 = { ...tx, confirmed_type: 'renda', confirmed_tenant_id: best.tenant?.id ?? null, confirmed_lease_id: best.lease?.id ?? null }
        warnIfSkipped(await processRendaTransaction(tx2 as Transaction))
      } else if (best.ruleType === 'despesa') {
        await ensureExpense({ ...tx, confirmed_type: 'despesa' })
      }
      fetchData()
    }
    fetchData()
  }

  async function saveManualMatch(tx: Transaction, type: string, tenantId: string, expenseId: string, notes: string, documentId?: string, referenceMonth?: string) {
    const confirmedLeaseId = tenantId ? (leases.find(l => (l.tenant as any)?.id === tenantId)?.id ?? null) : null
    await supabase.from('bank_transactions').update({
      confirmed_type: type,
      confirmed_tenant_id: tenantId || null,
      confirmed_lease_id: confirmedLeaseId,
      confirmed_expense_id: expenseId || null,
      confirmed_document_id: documentId || null,
      notes: notes || null, status: 'validado',
    }).eq('id', tx.id)
    setMatchModal(null)
    if (type === 'renda' && confirmedLeaseId) {
      const result = await processRendaTransaction({ ...tx, confirmed_type: 'renda', confirmed_tenant_id: tenantId || null, confirmed_lease_id: confirmedLeaseId }, referenceMonth)
      warnIfSkipped(result)
    } else if (type === 'despesa') {
      const result = await ensureExpense({
        ...tx,
        confirmed_type: 'despesa',
        confirmed_expense_id: expenseId || null,
        confirmed_document_id: documentId || null,
      }, documentId || null)
      if (result.outcome === 'created') {
        alert('✅ Despesa criada automaticamente a partir deste movimento.')
      } else if (result.outcome === 'linked_existing') {
        alert(`ℹ️ ${result.message} — não foi criada uma despesa nova.`)
      } else if (result.outcome === 'error') {
        alert(`⚠️ Não foi possível criar a despesa: ${result.message}`)
      }
    }
    fetchData()
  }

  async function validateAll() {
    const pending = transactions.filter(t => t.status === 'por_validar')
    if (pending.length === 0) return
    setValidatingAll(true)
    await supabase.from('bank_transactions').update({ status: 'validado' }).eq('bank_id', bankId).eq('status', 'por_validar')

    let created = 0, skipped = 0, cancelled = 0
    const expenseSummary = emptySummary()
    for (const tx of pending) {
      if (tx.confirmed_type === 'renda' && tx.confirmed_lease_id) {
        const result = await processRendaTransaction(tx)
        if (result === 'created') created++
        else if (result === 'skipped') skipped++
        else if (result === 'cancelled') cancelled++
      } else if (tx.confirmed_type === 'despesa') {
        addToSummary(expenseSummary, await ensureExpense(tx))
      }
    }
    const expenseMsg = describeSummary(expenseSummary)
    if (created > 0 || skipped > 0 || cancelled > 0 || expenseMsg) {
      alert([
        created > 0 ? `✅ ${created} pagamento(s) de renda criado(s) automaticamente.` : null,
        skipped > 0 ? `⚠️ ${skipped} transação(ões) já tinham pagamento de renda registado para o mês correspondente.` : null,
        cancelled > 0 ? `ℹ️ ${cancelled} transação(ões) ficaram sem registo de pagamento (processamento cancelado).` : null,
        expenseMsg ? `\n💸 Despesas:\n${expenseMsg}` : null,
      ].filter(Boolean).join('\n'))
    }

    await fetchData()
    setValidatingAll(false)
  }

  async function quickCustoBancario(tx: Transaction) {
    await supabase.from('bank_transactions').update({
      confirmed_type: 'custos_bancarios',
      status: 'validado',
    }).eq('id', tx.id)
    if (window.confirm('Criar regra para todas as transações com esta descrição?')) {
      await supabase.from('bank_matching_rules').insert({
        bank_id: bankId,
        keyword: tx.description,
        confirmed_type: 'custos_bancarios',
        tenant_id: null,
        notes: null,
      })
    }
    fetchData()
  }

  async function validateAllHighConfidence() {
    const candidates = transactions.filter(t =>
      t.status === 'por_validar' && !t.confirmed_type && txMatches[t.id]?.[0]?.confidence === 'high'
    )
    if (candidates.length === 0) return
    setValidatingAllHigh(true)
    for (const tx of candidates) {
      await confirmAutoMatch(tx)
    }
    await fetchData()
    setValidatingAllHigh(false)
  }

  // Recuperação retroativa: percorre os débitos já validados como "despesa"
  // e garante que cada um tem a sua despesa. Nunca cria duplicados — se já
  // existir despesa ligada (ou uma compatível), apenas liga.
  async function syncExpenses() {
    const candidates = transactions.filter(t =>
      t.status === 'validado' && t.confirmed_type === 'despesa' && t.amount < 0
    )
    if (candidates.length === 0) { alert('Não há débitos validados como despesa para sincronizar.'); return }
    if (!window.confirm(`Verificar ${candidates.length} movimento(s) e criar as despesas em falta?\n\nMovimentos que já tenham despesa associada não serão duplicados.`)) return

    setSyncingExpenses(true)
    const summary = emptySummary()
    for (const tx of candidates) {
      addToSummary(summary, await ensureExpense(tx))
    }
    await fetchData()
    setSyncingExpenses(false)
    alert(`🔄 Sincronização de despesas concluída!\n\n${describeSummary(summary) ?? 'Nada a fazer — estava tudo em dia.'}`)
  }

  async function syncRentPayments() {
    const candidates = transactions.filter(t =>
      t.status === 'validado' && t.confirmed_type === 'renda' && t.confirmed_lease_id && t.amount > 0
    )
    if (candidates.length === 0) { alert('Não há transações de renda validadas para sincronizar.'); return }
    setSyncing(true)
    let created = 0, skipped = 0, cancelled = 0
    for (const tx of candidates) {
      const result = await processRendaTransaction(tx, undefined, true)
      if (result === 'created') created++
      else if (result === 'skipped') skipped++
    }
    await fetchData()
    setSyncing(false)
    alert(`🔄 Sincronização concluída!\n\n${created} pagamento(s) de renda criado(s)\n${skipped} já existiam${cancelled > 0 ? `\n${cancelled} cancelado(s)` : ''}`)
  }

  async function updateStatus(id: string, status: 'validado' | 'ignorado' | 'por_validar') {
    await supabase.from('bank_transactions').update({ status }).eq('id', id)
    if (status === 'validado') {
      const tx = transactions.find(t => t.id === id)
      if (tx) {
        warnIfSkipped(await processRendaTransaction(tx))
        if (tx.confirmed_type === 'despesa') await ensureExpense(tx)
      }
    }
    fetchData()
  }

  function startEditTx(tx: Transaction) {
    setEditingTxId(tx.id)
    setEditDate(tx.transaction_date.slice(0, 10))
    setEditAmount(String(tx.amount))
    setEditDescription(tx.description)
  }

  function cancelEditTx() {
    setEditingTxId(null)
  }

  async function saveEditTx(id: string) {
    const amount = parseFloat(editAmount.replace(',', '.'))
    if (!editDate || !editDescription.trim() || isNaN(amount)) {
      alert('Preenche a data, a descrição e o valor corretamente.')
      return
    }
    setSavingEdit(true)
    await supabase.from('bank_transactions').update({
      transaction_date: editDate,
      description: editDescription.trim(),
      amount,
    }).eq('id', id)
    setSavingEdit(false)
    setEditingTxId(null)
    fetchData()
  }

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
          const match = headers.find(h => h.toLowerCase().includes(kw.toLowerCase()))
          if (match) return match
        }
        return ''
      }
      setMapping(bank?.column_mapping ?? {
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
      setShowImport(false); setImportStep('upload'); fetchData()
    } catch (err) { console.error(err); alert('Erro durante a importação.') }
    setImporting(false)
  }

  function resetFilters() {
    setSearch(''); setFilterDateFrom(''); setFilterDateTo('')
    setFilterAmountMin(''); setFilterAmountMax(''); setFilterDirection('all')
    setFilterStatus('all'); setFilterConfidence('all'); setFilterIdentification('all'); setFilterCustosBancarios(false)
  }

  const hasActiveFilters = search || filterDateFrom || filterDateTo || filterAmountMin || filterAmountMax || filterDirection !== 'all'
  const hasActiveGroupFilters = filterStatus !== 'all' || filterConfidence !== 'all' || filterIdentification !== 'all' || filterCustosBancarios

  const countPorValidar = transactions.filter(t => t.status === 'por_validar').length
  const countValidado = transactions.filter(t => t.status === 'validado').length
  const countIgnorado = transactions.filter(t => t.status === 'ignorado').length
  const countAlt = transactions.filter(t => !t.confirmed_type && txMatches[t.id]?.[0]?.confidence === 'high').length
  const countHighConfidencePending = transactions.filter(t => t.status === 'por_validar' && !t.confirmed_type && txMatches[t.id]?.[0]?.confidence === 'high').length
  const countMed = transactions.filter(t => !t.confirmed_type && txMatches[t.id]?.[0]?.confidence === 'medium').length
  const countBai = transactions.filter(t => !t.confirmed_type && txMatches[t.id]?.[0]?.confidence === 'low').length
  const countIdentificadas = transactions.filter(t => t.confirmed_type || (txMatches[t.id]?.length > 0)).length
  const countNaoIdentificadas = transactions.filter(t => !t.confirmed_type && (!txMatches[t.id] || txMatches[t.id].length === 0)).length
  const countCustosBancarios = transactions.filter(t => t.confirmed_type === 'custos_bancarios').length
  const countCreditos = transactions.filter(t => t.amount > 0).length
  const countDebitos = transactions.filter(t => t.amount < 0).length

  const filtered = transactions.filter(t => {
    const autoMatches = txMatches[t.id]
    const bestConfidence = autoMatches?.[0]?.confidence

    if (filterStatus === 'por_validar' && t.status !== 'por_validar') return false
    if (filterStatus === 'validado' && t.status !== 'validado') return false
    if (filterStatus === 'ignorado' && t.status !== 'ignorado') return false

    if (filterConfidence === 'high' && (t.confirmed_type || bestConfidence !== 'high')) return false
    if (filterConfidence === 'medium' && (t.confirmed_type || bestConfidence !== 'medium')) return false
    if (filterConfidence === 'low' && (t.confirmed_type || bestConfidence !== 'low')) return false

    if (filterIdentification === 'identificadas' && !(t.confirmed_type || (autoMatches && autoMatches.length > 0))) return false
    if (filterIdentification === 'nao_identificadas' && (t.confirmed_type || (autoMatches && autoMatches.length > 0))) return false
    if (filterCustosBancarios && t.confirmed_type !== 'custos_bancarios') return false

    if (search && !t.description.toLowerCase().includes(search.toLowerCase())) return false
    if (filterDateFrom && t.transaction_date < filterDateFrom) return false
    if (filterDateTo && t.transaction_date > filterDateTo) return false
    if (filterAmountMin && t.amount < parseFloat(filterAmountMin)) return false
    if (filterAmountMax && t.amount > parseFloat(filterAmountMax)) return false
    if (filterDirection === 'entrada' && t.amount <= 0) return false
    if (filterDirection === 'saida' && t.amount >= 0) return false

    return true
  })

  const balanceChartData = transactions
    .filter(t => t.status !== 'ignorado' && t.balance != null)
    .slice()
    .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date))
    .map(t => ({ date: t.transaction_date, balance: t.balance as number }))

  const totalIn = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0)
  const totalOut = transactions.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)
  const pending = transactions.filter(t => t.status === 'por_validar').length
  const identified = transactions.filter(t => t.confirmed_type || txMatches[t.id]).length
  const headers = parsedRows[headerRowIndex]?.map((h: any) => String(h ?? '').trim()) ?? []
  const previewRows = parsedRows.slice(headerRowIndex + 1).slice(0, 5).filter(r => r && r.length > 0)

  function toggleStatus(val: 'por_validar' | 'validado' | 'ignorado') {
    setFilterStatus(prev => prev === val ? 'all' : val)
  }
  function toggleConfidence(val: 'high' | 'medium' | 'low') {
    setFilterConfidence(prev => prev === val ? 'all' : val)
  }
  function toggleIdentification(val: 'identificadas' | 'nao_identificadas') {
    setFilterIdentification(prev => prev === val ? 'all' : val)
  }

  return (
    <AppLayout>
      <div className="p-4 md:p-8">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/financeiro/bancos" prefetch={false} className="text-gray-400 hover:text-gray-600">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900">{bank?.name ?? 'Banco'}</h1>
            {bank?.iban && <p className="text-sm text-gray-500 font-mono mt-0.5">{bank.iban}</p>}
          </div>
          <div className="flex gap-3">
            <button onClick={() => setShowRules(v => !v)} className={`btn-secondary ${showRules ? 'ring-2 ring-blue-300' : ''}`}>
              <SlidersHorizontal className="w-4 h-4" /> Regras
            </button>
            {canWrite && (
              <>
                {pending > 0 && (
                  <button onClick={validateAll} disabled={validatingAll} className="btn-secondary">
                    {validatingAll ? <><Loader2 className="w-4 h-4 animate-spin" /> A validar...</> : <><CheckCircle className="w-4 h-4" /> Validar Todas ({pending})</>}
                  </button>
                )}
                <button onClick={syncRentPayments} disabled={syncing} className="btn-secondary">
                  {syncing ? <><Loader2 className="w-4 h-4 animate-spin" /> A sincronizar...</> : <><RefreshCw className="w-4 h-4" /> Sincronizar pagamentos</>}
                </button>
                <button onClick={syncExpenses} disabled={syncingExpenses} className="btn-secondary">
                  {syncingExpenses ? <><Loader2 className="w-4 h-4 animate-spin" /> A sincronizar...</> : <><RefreshCw className="w-4 h-4" /> Sincronizar despesas</>}
                </button>
                <button className="btn-primary" onClick={() => { setShowImport(true); setImportStep('upload') }}>
                  <Upload className="w-4 h-4" /> Importar Extrato
                </button>
              </>
            )}
          </div>
        </div>

        {/* Gráfico de Evolução do Saldo */}
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-6 mb-5">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Evolução do Saldo</h2>
          {balanceChartData.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Sem dados para mostrar</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={balanceChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tickFormatter={formatMonthShortPT} tick={{ fontSize: 12, fill: '#6b7280' }} />
                <YAxis tickFormatter={v => `${v}€`} tick={{ fontSize: 12, fill: '#6b7280' }} />
                <Tooltip
                  labelFormatter={(label: any) => formatDate(label)}
                  formatter={(value: any) => [formatCurrency(value), 'Saldo']}
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '12px' }}
                />
                <Line type="monotone" dataKey="balance" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Cards compactos */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          <div className="bg-white border border-gray-100 rounded-lg shadow-sm px-4 py-3 flex items-center gap-3">
            <ArrowUpRight className="w-4 h-4 text-emerald-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-400">Total Entradas</p>
              <p className="text-base font-bold text-emerald-600">{formatCurrency(totalIn)}</p>
            </div>
          </div>
          <div className="bg-white border border-gray-100 rounded-lg shadow-sm px-4 py-3 flex items-center gap-3">
            <ArrowDownRight className="w-4 h-4 text-red-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-400">Total Saídas</p>
              <p className="text-base font-bold text-red-600">{formatCurrency(totalOut)}</p>
            </div>
          </div>
          <div className="bg-white border border-gray-100 rounded-lg shadow-sm px-4 py-3 flex items-center gap-3">
            <Clock className="w-4 h-4 text-yellow-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-400">Por Validar</p>
              <p className="text-base font-bold text-yellow-600">{pending}</p>
            </div>
          </div>
          <div className="bg-white border border-gray-100 rounded-lg shadow-sm px-4 py-3 flex items-center gap-3">
            <Link2 className="w-4 h-4 text-blue-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-400">Identificadas</p>
              <p className="text-base font-bold text-blue-600">{identified} / {transactions.length}</p>
            </div>
          </div>
        </div>

        {showRules && (
          <div className="bg-white border border-blue-100 rounded-xl shadow-sm p-5 mb-5">
            <h2 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-blue-500" /> Regras de Identificação Automática
            </h2>

            {matchingRules.length === 0 ? (
              <p className="text-sm text-gray-400 mb-4">Ainda não tens regras definidas.</p>
            ) : (
              <div className="border border-gray-100 rounded-lg overflow-hidden mb-4">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-3 py-2 text-xs text-gray-500 font-medium">Palavra-chave</th>
                      <th className="text-left px-3 py-2 text-xs text-gray-500 font-medium">Tipo</th>
                      <th className="text-left px-3 py-2 text-xs text-gray-500 font-medium">Inquilino / Nota</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {matchingRules.map(rule => (
                      <tr key={rule.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono text-xs text-blue-700 bg-blue-50 rounded">{rule.keyword}</td>
                        <td className="px-3 py-2 text-xs text-gray-700 capitalize">{rule.confirmed_type}</td>
                        <td className="px-3 py-2 text-xs text-gray-500">
                          {rule.tenant_id ? tenants.find(t => t.id === rule.tenant_id)?.name ?? '—' : rule.notes ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={async () => {
                              if (!confirm(`Apagar regra "${rule.keyword}"?`)) return
                              await supabase.from('bank_matching_rules').delete().eq('id', rule.id)
                              fetchData()
                            }}
                            className="text-xs text-red-400 hover:text-red-600"
                          >
                            Apagar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs font-semibold text-gray-500 mb-3">Nova regra</p>
              <div className="grid grid-cols-4 gap-3 items-end">
                <div>
                  <label className="label">Palavra-chave</label>
                  <input className="input text-sm" placeholder="ex: EDP, SILVA, AT-" value={newRuleKeyword} onChange={e => setNewRuleKeyword(e.target.value)} />
                </div>
                <div>
                  <label className="label">Tipo</label>
                  <select className="input text-sm" value={newRuleType} onChange={e => setNewRuleType(e.target.value)}>
                    <option value="renda">🏠 Renda</option>
                    <option value="despesa">💸 Despesa</option>
                    <option value="custos_bancarios">🏦 Custos Bancários</option>
                    <option value="impostos">🧾 Impostos</option>
                    <option value="outro">📝 Outro</option>
                  </select>
                </div>
                {newRuleType === 'renda' ? (
                  <div>
                    <label className="label">Inquilino</label>
                    <select className="input text-sm" value={newRuleTenantId} onChange={e => setNewRuleTenantId(e.target.value)}>
                      <option value="">— Seleciona —</option>
                      {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="label">Nota (opcional)</label>
                    <input className="input text-sm" placeholder="ex: Água, IMI..." value={newRuleNotes} onChange={e => setNewRuleNotes(e.target.value)} />
                  </div>
                )}
                <button
                  disabled={!newRuleKeyword.trim() || savingRule}
                  onClick={async () => {
                    if (!newRuleKeyword.trim()) return
                    setSavingRule(true)
                    await supabase.from('bank_matching_rules').insert({
                      bank_id: bankId,
                      keyword: newRuleKeyword.trim(),
                      confirmed_type: newRuleType,
                      tenant_id: newRuleType === 'renda' && newRuleTenantId ? newRuleTenantId : null,
                      notes: newRuleNotes.trim() || null,
                    })
                    setNewRuleKeyword('')
                    setNewRuleNotes('')
                    setNewRuleTenantId('')
                    setSavingRule(false)
                    fetchData()
                  }}
                  className="btn-primary disabled:opacity-50"
                >
                  {savingRule ? <Loader2 className="w-4 h-4 animate-spin" /> : '+ Adicionar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Grupo 1: Estado */}
        <div className="flex flex-wrap gap-2 mb-2">
          <span className="text-xs font-medium text-gray-400 self-center w-16">Estado</span>
          {([
            { key: 'por_validar', label: 'Por Validar', count: countPorValidar },
            { key: 'validado', label: 'Validadas', count: countValidado },
            { key: 'ignorado', label: 'Ignoradas', count: countIgnorado },
          ] as const).map(btn => (
            <button key={btn.key} onClick={() => toggleStatus(btn.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${filterStatus === btn.key ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
              {btn.label}
              <span className={`px-1.5 py-0.5 rounded-full text-xs ${filterStatus === btn.key ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>{btn.count}</span>
            </button>
          ))}
        </div>

        {/* Grupo 2: Confiança */}
        <div className="flex flex-wrap gap-2 mb-2">
          <span className="text-xs font-medium text-gray-400 self-center w-16">Confiança</span>
          {([
            { key: 'high', label: '🟢 Alta', count: countAlt },
            { key: 'medium', label: '🟡 Média', count: countMed },
            { key: 'low', label: '🔴 Baixa', count: countBai },
          ] as const).map(btn => (
            <button key={btn.key} onClick={() => toggleConfidence(btn.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${filterConfidence === btn.key ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
              {btn.label}
              <span className={`px-1.5 py-0.5 rounded-full text-xs ${filterConfidence === btn.key ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>{btn.count}</span>
            </button>
          ))}
        </div>

        {/* Grupo 3: Identificação */}
        <div className="flex flex-wrap gap-2 mb-4">
          <span className="text-xs font-medium text-gray-400 self-center w-16">Identif.</span>
          {([
            { key: 'identificadas', label: '🔗 Identificadas', count: countIdentificadas },
            { key: 'nao_identificadas', label: '❓ Não identificadas', count: countNaoIdentificadas },
          ] as const).map(btn => (
            <button key={btn.key} onClick={() => toggleIdentification(btn.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${filterIdentification === btn.key ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
              {btn.label}
              <span className={`px-1.5 py-0.5 rounded-full text-xs ${filterIdentification === btn.key ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>{btn.count}</span>
            </button>
          ))}
          <button onClick={() => setFilterCustosBancarios(v => !v)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${filterCustosBancarios ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
            🏦 Custos Bancários
            <span className={`px-1.5 py-0.5 rounded-full text-xs ${filterCustosBancarios ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>{countCustosBancarios}</span>
          </button>
        </div>

        {/* Grupo 4: Créditos / Débitos */}
        <div className="flex flex-wrap gap-2 mb-4">
          <span className="text-xs font-medium text-gray-400 self-center w-16">Movimento</span>
          {([
            { key: 'all', label: '↕ Ambos', count: transactions.length, cor: 'bg-gray-600' },
            { key: 'entrada', label: '↑ Créditos', count: countCreditos, cor: 'bg-emerald-600' },
            { key: 'saida', label: '↓ Débitos', count: countDebitos, cor: 'bg-red-600' },
          ] as const).map(btn => (
            <button key={btn.key} onClick={() => setFilterDirection(btn.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                filterDirection === btn.key
                  ? `${btn.cor} text-white`
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}>
              {btn.label}
              <span className={`px-1.5 py-0.5 rounded-full text-xs ${filterDirection === btn.key ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>{btn.count}</span>
            </button>
          ))}
          {filterDirection !== 'all' && (
            <span className="self-center text-xs text-gray-500 ml-1">
              {filterDirection === 'entrada' ? 'Total: ' : 'Total: '}
              <strong className={filterDirection === 'entrada' ? 'text-emerald-600' : 'text-red-600'}>
                {formatCurrency(Math.abs(filtered.reduce((s, t) => s + t.amount, 0)))}
              </strong>
            </span>
          )}
        </div>

        <div className="flex gap-3 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9" placeholder="Pesquisar na descrição..."
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button onClick={() => setShowFilters(v => !v)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${hasActiveFilters ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
            <SlidersHorizontal className="w-4 h-4" /> Filtros
          </button>
          {(hasActiveFilters || hasActiveGroupFilters) && (
            <button onClick={resetFilters}
              className="flex items-center gap-1 px-3 py-2 rounded-lg border border-red-200 text-red-600 text-sm hover:bg-red-50 transition-colors">
              <X className="w-3.5 h-3.5" /> Limpar tudo
            </button>
          )}
        </div>

        {showFilters && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-4 space-y-3">
            {/* A direção (créditos/débitos) passou para a barra de filtros
                visível, por isso deixou de estar aqui duplicada. */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Data — de</label>
                <input type="date" className="input text-sm" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Data — até</label>
                <input type="date" className="input text-sm" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Valor mínimo (€)</label>
                <input type="number" step="0.01" min="0" className="input text-sm" placeholder="0.00"
                  value={filterAmountMin} onChange={e => setFilterAmountMin(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Valor máximo (€)</label>
                <input type="number" step="0.01" min="0" className="input text-sm" placeholder="9999.00"
                  value={filterAmountMax} onChange={e => setFilterAmountMax(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {(hasActiveFilters || hasActiveGroupFilters) && (
          <p className="text-sm text-gray-500 mb-3">
            A mostrar <strong>{filtered.length}</strong> de {transactions.length} transações
          </p>
        )}

        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" /></div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="table-header w-28">Data</th>
                  <th className="table-header" style={{ maxWidth: '280px' }}>Descrição</th>
                  <th className="table-header w-28">Valor</th>
                  <th className="table-header w-28">Saldo</th>
                  <th className="table-header w-64">Identificação</th>
                  <th className="table-header w-28">Estado</th>
                  <th className="table-header w-32"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(tx => {
                  const matchInfo = getMatchLabel(tx)
                  const autoMatches = txMatches[tx.id]
                  return (
                    <tr key={tx.id} className={`hover:bg-gray-50 ${tx.status === 'ignorado' ? 'opacity-50' : ''}`}>
                      <td className="table-cell text-sm whitespace-nowrap">
                        {editingTxId === tx.id ? (
                          <input type="date" className="input text-sm w-full" value={editDate} onChange={e => setEditDate(e.target.value)} />
                        ) : formatDate(tx.transaction_date)}
                      </td>
                      <td className="table-cell" style={{ maxWidth: '280px' }}>
                        {editingTxId === tx.id ? (
                          <input type="text" className="input text-sm w-full" value={editDescription} onChange={e => setEditDescription(e.target.value)} />
                        ) : (
                          <p className="text-sm text-gray-800 break-words">{tx.description}</p>
                        )}
                      </td>
                      <td className="table-cell whitespace-nowrap">
                        {editingTxId === tx.id ? (
                          <input type="number" step="0.01" className="input text-sm w-full" value={editAmount} onChange={e => setEditAmount(e.target.value)} />
                        ) : (
                          <span className={`font-semibold text-sm ${tx.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {tx.amount >= 0 ? '+' : ''}{formatCurrency(tx.amount)}
                          </span>
                        )}
                      </td>
                      <td className="table-cell text-sm text-gray-500 whitespace-nowrap">
                        {tx.balance != null ? formatCurrency(tx.balance) : '—'}
                      </td>
                      <td className="table-cell">
                        {matchInfo ? (
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-xs font-medium ${matchInfo.color}`}>{matchInfo.label}</span>
                              {(matchInfo as any).filePath && (
                                <a
                                  href={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/documents/${(matchInfo as any).filePath}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-blue-500 hover:underline flex items-center gap-0.5 flex-shrink-0"
                                  title="Ver fatura"
                                >
                                  <FileText className="w-3 h-3" /> Ver
                                </a>
                              )}
                              {!matchInfo.confirmed && (matchInfo as any).confidence && (
                                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${
                                  (matchInfo as any).confidence === 'high' ? 'bg-emerald-100 text-emerald-700' :
                                  (matchInfo as any).confidence === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                  'bg-gray-100 text-gray-600'
                                }`}>
                                  {(matchInfo as any).confidence === 'high' ? 'Alta' : (matchInfo as any).confidence === 'medium' ? 'Média' : 'Baixa'}
                                </span>
                              )}
                            </div>
                            {!matchInfo.confirmed && autoMatches && autoMatches.length > 0 && (
                              <div className="flex items-center gap-2 mt-1">
                                {autoMatches[0]?.confidence === 'high' && (
                                  <button onClick={() => confirmAutoMatch(tx)} className="text-xs text-emerald-600 hover:underline font-medium">✓ Confirmar</button>
                                )}
                                {autoMatches.length > 1 && <span className="text-xs text-gray-400">+{autoMatches.length - 1} sugestão(ões)</span>}
                              </div>
                            )}
                            <button onClick={() => setMatchModal(tx)} className="text-xs text-gray-400 hover:text-blue-500 transition-colors mt-0.5">
                              <Edit2 className="w-3 h-3 inline" /> {matchInfo.confirmed ? 'Editar' : 'Ver todas'}
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1">
                            <button onClick={() => setMatchModal(tx)}
                              className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 transition-colors">
                              <Link2 className="w-3 h-3" /> Identificar
                            </button>
                            <button onClick={() => quickCustoBancario(tx)}
                              className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 transition-colors">
                              🏦 Custo Bancário
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="table-cell">
                        {tx.status === 'validado' ? (
                          <span className="badge-verde flex items-center gap-1 w-fit"><CheckCircle className="w-3 h-3" /> Validado</span>
                        ) : tx.status === 'ignorado' ? (
                          <span className="badge-cinza flex items-center gap-1 w-fit"><XCircle className="w-3 h-3" /> Ignorado</span>
                        ) : (
                          <span className="badge-amarelo flex items-center gap-1 w-fit"><Clock className="w-3 h-3" /> Por validar</span>
                        )}
                      </td>
                      <td className="table-cell">
                        {editingTxId === tx.id ? (
                          <div className="flex gap-2 items-center">
                            <button onClick={() => saveEditTx(tx.id)} disabled={savingEdit} className="text-xs text-emerald-600 hover:underline font-medium flex items-center gap-1">
                              {savingEdit ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />} Guardar
                            </button>
                            <button onClick={cancelEditTx} disabled={savingEdit} className="text-xs text-gray-400 hover:underline font-medium flex items-center gap-1">
                              <X className="w-3 h-3" /> Cancelar
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-2 items-center">
                            <button onClick={() => startEditTx(tx)} title="Editar transação" className="text-gray-400 hover:text-blue-500">
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            {tx.status !== 'validado' && <button onClick={() => updateStatus(tx.id, 'validado')} className="text-xs text-emerald-600 hover:underline font-medium">✓ Validar</button>}
                            {tx.status !== 'ignorado' && <button onClick={() => updateStatus(tx.id, 'ignorado')} className="text-xs text-gray-400 hover:underline font-medium">Ignorar</button>}
                            {tx.status !== 'por_validar' && <button onClick={() => updateStatus(tx.id, 'por_validar')} className="text-xs text-blue-500 hover:underline font-medium">Reset</button>}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="py-12 text-center text-gray-400 text-sm">
                    {transactions.length === 0 ? 'Ainda não há transações. Importa um extrato para começar.' : 'Nenhuma transação com este filtro.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {matchModal && (
        <MatchModalComponent
          tx={matchModal}
          tenants={tenants}
          leases={leases}
          expenses={expenses}
          documents={documents}
          autoMatches={txMatches[matchModal.id] ?? []}
          bankId={bankId}
          onSave={saveManualMatch}
          onSaveRule={fetchData}
          onClose={() => setMatchModal(null)}
        />
      )}

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
              <button onClick={() => { setShowImport(false); setImportStep('upload') }}><X className="w-5 h-5 text-gray-400" /></button>
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
      )}
    </AppLayout>
  )
}

function MatchModalComponent({ tx, tenants, leases, expenses, documents, autoMatches, bankId, onSave, onSaveRule, onClose }: {
  tx: Transaction
  tenants: any[]
  leases: any[]
  expenses: any[]
  documents: any[]
  autoMatches: any[]
  bankId: string
  onSave: (tx: Transaction, type: string, tenantId: string, expenseId: string, notes: string, documentId?: string, referenceMonth?: string) => void
  onSaveRule: () => void
  onClose: () => void
}) {
  const [type, setType] = useState(tx.confirmed_type ?? (tx.amount > 0 ? 'renda' : 'despesa'))
  const [tenantId, setTenantId] = useState(tx.confirmed_tenant_id ?? '')
  const [expenseId, setExpenseId] = useState(tx.confirmed_expense_id ?? '')
  const [notes, setNotes] = useState(tx.notes ?? '')
  const [referenceMonth, setReferenceMonth] = useState(tx.transaction_date.slice(0, 7))
  const [searchExpense, setSearchExpense] = useState('')
  const [searchTenant, setSearchTenant] = useState('')
  const [documentId, setDocumentId] = useState(tx.confirmed_document_id ?? '')
  const [searchDoc, setSearchDoc] = useState('')
  const [saveAsRule, setSaveAsRule] = useState(false)
  const [ruleKeyword, setRuleKeyword] = useState('')
  const [incomeId, setIncomeId] = useState('')
  const [incomeRecords, setIncomeRecords] = useState<any[]>([])
  const [wideSearch, setWideSearch] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    supabase.from('income_records').select('id, description, amount, income_date, category').order('income_date', { ascending: false }).then(({ data }) => setIncomeRecords(data ?? []))
  }, [])

  const txDate = new Date(tx.transaction_date)

  const sortedExpenses = [...expenses].sort((a, b) => {
    const diffA = Math.abs(new Date(a.expense_date).getTime() - txDate.getTime())
    const diffB = Math.abs(new Date(b.expense_date).getTime() - txDate.getTime())
    return diffA - diffB
  })

  const filteredExpenses = sortedExpenses.filter(e =>
    !searchExpense ||
    e.description.toLowerCase().includes(searchExpense.toLowerCase()) ||
    e.supplier?.toLowerCase().includes(searchExpense.toLowerCase()) ||
    String(e.amount).includes(searchExpense)
  )

  const filteredTenants = tenants.filter(t =>
    !searchTenant || t.name.toLowerCase().includes(searchTenant.toLowerCase())
  )

  const expensesNearby = sortedExpenses.filter(e => {
    const diff = Math.abs(new Date(e.expense_date).getTime() - txDate.getTime())
    return diff <= 15 * 24 * 60 * 60 * 1000
  }).length

  const wideMatches = wideSearch ? (() => {
    const amt = Math.abs(tx.amount)
    const dateFrom = new Date(txDate); dateFrom.setDate(dateFrom.getDate() - 60)
    const dateTo = new Date(txDate); dateTo.setDate(dateTo.getDate() + 60)
    return expenses.filter(e => {
      const eDate = new Date(e.expense_date)
      return Math.abs(e.amount - amt) <= 0.02 && eDate >= dateFrom && eDate <= dateTo
    })
  })() : []

  const tiposComNotes = ['outro', 'custos_bancarios', 'impostos', 'transferencia_interna', 'receita_extraordinaria']

  function applyAutoMatch(match: any) {
    if (match.type === 'renda') { setType('renda'); setTenantId(match.tenant?.id ?? '') }
    else if (match.type === 'despesa') { setType('despesa'); setExpenseId(match.expense?.id ?? '') }
    else if (match.type === 'fatura') { setType('despesa'); setDocumentId(match.document?.id ?? '') }
    else if (match.type === 'regra') { setType(match.ruleType ?? 'despesa') }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg text-gray-900">Identificar Transação</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="bg-gray-50 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-4 mb-3">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Data</p>
              <p className="text-sm font-semibold text-gray-700">{formatDate(tx.transaction_date)}</p>
            </div>
            <div className="w-px h-8 bg-gray-200" />
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Valor</p>
              <p className={`text-lg font-bold ${tx.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {tx.amount >= 0 ? '+' : ''}{formatCurrency(tx.amount)}
              </p>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">Descrição</p>
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 overflow-x-auto">
              <p className="text-sm text-gray-800 whitespace-nowrap">{tx.description}</p>
            </div>
          </div>
        </div>

        <div className="mb-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-blue-500" /> Sugestões automáticas
          </p>
          {autoMatches.length > 0 ? (
            <div className="space-y-2">
              {autoMatches.map((match, i) => (
                <div key={i} className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-lg p-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-blue-800 truncate">
                      {match.type === 'renda' ? `🏠 ${match.tenant?.name ?? '—'}${match.lease?.space ? ` · ${match.lease.space.ref}` : ''}` : `💸 ${match.expense?.description ?? '—'}`}
                    </p>
                    <p className="text-xs text-blue-600 mt-0.5">{match.reason}</p>
                    {match.expense && <p className="text-xs text-blue-500">{formatDate(match.expense.expense_date)} · {formatCurrency(match.expense.amount)}</p>}
                  </div>
                  <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${match.confidence === 'high' ? 'bg-emerald-100 text-emerald-700' : match.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'}`}>
                      {match.confidence === 'high' ? 'Alta' : match.confidence === 'medium' ? 'Média' : 'Baixa'}
                    </span>
                    <button onClick={() => applyAutoMatch(match)} className="text-xs bg-blue-600 text-white px-2 py-1 rounded-lg hover:bg-blue-700">Usar</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400 mb-2">Nenhuma sugestão automática encontrada (±15 dias).</p>
          )}
          {!wideSearch && tx.amount < 0 && (
            <button onClick={() => setWideSearch(true)} className="mt-2 text-xs text-blue-600 hover:text-blue-800 underline">
              🔍 Procurar despesas com ±60 dias de diferença
            </button>
          )}
          {wideSearch && wideMatches.length > 0 && (
            <div className="mt-2 space-y-2">
              <p className="text-xs font-medium text-orange-600">Despesas com valor igual encontradas (±60 dias):</p>
              {wideMatches.map((e, i) => (
                <div key={i} className="flex items-center justify-between bg-orange-50 border border-orange-100 rounded-lg p-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-orange-800 truncate">💸 {e.description ?? '—'}</p>
                    <p className="text-xs text-orange-600">{formatDate(e.expense_date)} · {formatCurrency(e.amount)}</p>
                  </div>
                  <button onClick={() => { setType('despesa'); setExpenseId(e.id) }} className="text-xs bg-orange-500 text-white px-2 py-1 rounded-lg hover:bg-orange-600 ml-3 flex-shrink-0">Usar</button>
                </div>
              ))}
            </div>
          )}
          {wideSearch && wideMatches.length === 0 && (
            <p className="text-xs text-gray-400 mt-2">Nenhuma despesa com valor igual encontrada em ±60 dias.</p>
          )}
          <div className="border-t border-gray-100 mt-3 pt-3">
            <p className="text-xs text-gray-400 mb-2">Ou escolhe manualmente:</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">Tipo</label>
            {/* Linha 1 */}
            <div className="grid grid-cols-3 gap-2 mb-2">
              {[
                { value: 'renda', label: '🏠 Renda / Luz / Dívida' },
                { value: 'despesa', label: '💸 Despesa' },
                { value: 'outro', label: '📝 Outro' },
              ].map(opt => (
                <button key={opt.value} onClick={() => setType(opt.value)}
                  className={`py-2 rounded-lg border text-sm font-medium transition-colors ${type === opt.value ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
            {/* Linha 2 */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'custos_bancarios', label: '🏦 Custos Bancários' },
                { value: 'impostos', label: '🧾 Impostos' },
                { value: 'transferencia_interna', label: '🔄 Transf. Interna' },
                { value: 'receita_extraordinaria', label: '💰 Receita' },
              ].map(opt => (
                <button key={opt.value} onClick={() => setType(opt.value)}
                  className={`py-2 rounded-lg border text-sm font-medium transition-colors ${type === opt.value ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {type === 'renda' && (
            <div className="space-y-3">
              <div>
                <label className="label">Inquilino</label>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input className="input pl-8 text-sm" placeholder="Pesquisar inquilino..."
                    value={searchTenant} onChange={e => setSearchTenant(e.target.value)} />
                </div>
                <select className="input" value={tenantId} onChange={e => setTenantId(e.target.value)} size={5}>
                  <option value="">— Nenhum —</option>
                  {filteredTenants.map(t => {
                    const lease = leases.find(l => (l.tenant as any)?.id === t.id)
                    return <option key={t.id} value={t.id}>{t.name}{lease?.space ? ` · ${(lease.space as any).ref}` : ''}</option>
                  })}
                </select>
              </div>
              <div>
                <label className="label">Mes de referencia da renda</label>
                <input type="month" className="input" value={referenceMonth}
                  onChange={e => setReferenceMonth(e.target.value)} />
                {referenceMonth !== tx.transaction_date.slice(0, 7) && (
                  <p className="text-xs text-amber-600 mt-1">Diferente do mes da transacao ({tx.transaction_date.slice(0, 7)})</p>
                )}
              </div>
            </div>
          )}

          {type === 'receita_extraordinaria' && (
            <div>
              <label className="label">Receita Extraordinária associada</label>
              <select className="input" value={incomeId} onChange={e => setIncomeId(e.target.value)} size={5}>
                <option value="">— Nenhuma —</option>
                {incomeRecords.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.income_date} · {r.description.slice(0, 50)} · {r.amount}€
                  </option>
                ))}
              </select>
            </div>
          )}

          {type === 'despesa' && (
            <div>
              <label className="label">Despesa associada</label>
              {expensesNearby > 0 && (
                <p className="text-xs text-emerald-600 mb-2">
                  📅 {expensesNearby} despesa(s) dentro de ±15 dias aparecem primeiro
                </p>
              )}
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input className="input pl-8 text-sm" placeholder="Pesquisar por descrição, fornecedor ou valor..."
                  value={searchExpense} onChange={e => setSearchExpense(e.target.value)} />
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden max-h-56 overflow-y-auto">
                {filteredExpenses.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">Nenhuma despesa encontrada</p>
                ) : (
                  filteredExpenses.slice(0, 200).map(e => {
                    const diffDays = Math.round(Math.abs(new Date(e.expense_date).getTime() - txDate.getTime()) / (1000 * 60 * 60 * 24))
                    const isNearby = diffDays <= 15
                    return (
                      <div key={e.id} onClick={() => setExpenseId(e.id)}
                        className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors ${expenseId === e.id ? 'bg-emerald-50 border-l-4 border-l-emerald-500' : ''}`}>
                        <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0 w-20">{formatDate(e.expense_date)}</span>
                        <span className="text-sm font-semibold text-red-600 whitespace-nowrap flex-shrink-0 w-20">{formatCurrency(e.amount)}</span>
                        <span className="text-xs text-gray-700 truncate flex-1">{e.description}</span>
                        {isNearby && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex-shrink-0 font-medium">
                            {diffDays === 0 ? 'hoje' : `${diffDays}d`}
                          </span>
                        )}
                        {expenseId === e.id && <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0 ml-1" />}
                      </div>
                    )
                  })
                )}
              </div>
              {filteredExpenses.length > 200 && <p className="text-xs text-gray-400 mt-1">A mostrar 200 de {filteredExpenses.length} — pesquisa para filtrar</p>}
              {filteredExpenses.length > 0 && filteredExpenses.length <= 200 && (
                <p className="text-xs text-gray-400 mt-1">A mostrar {filteredExpenses.length} despesa(s) — ordenadas por proximidade de data</p>
              )}
            </div>
          )}

          {type !== 'renda' && (
            <div className="mt-3">
              <label className="label">Fatura associada (opcional)</label>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input className="input pl-8 text-sm" placeholder="Pesquisar fatura..." value={searchDoc} onChange={e => setSearchDoc(e.target.value)} />
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                <div
                  onClick={() => setDocumentId('')}
                  className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 border-b border-gray-50 ${documentId === '' ? 'bg-emerald-50 border-l-4 border-l-emerald-500' : ''}`}
                >
                  <span className="text-xs text-gray-400">— Nenhuma —</span>
                </div>
                {[...documents]
                  .sort((a, b) => {
                    const diffA = a.doc_date ? Math.abs(new Date(a.doc_date).getTime() - txDate.getTime()) : Infinity
                    const diffB = b.doc_date ? Math.abs(new Date(b.doc_date).getTime() - txDate.getTime()) : Infinity
                    if (diffA !== diffB) return diffA - diffB
                    const amtA = Math.abs((a.amount ?? 0) - Math.abs(tx.amount))
                    const amtB = Math.abs((b.amount ?? 0) - Math.abs(tx.amount))
                    return amtA - amtB
                  })
                  .filter(d => !searchDoc || (d.supplier_name ?? d.original_name ?? '').toLowerCase().includes(searchDoc.toLowerCase()) || String(d.amount).includes(searchDoc))
                  .slice(0, 50)
                  .map(d => (
                    <div key={d.id} onClick={() => setDocumentId(d.id)}
                      className={`flex items-center gap-3 px-3 py-2 cursor-pointer border-b border-gray-50 hover:bg-gray-50 ${documentId === d.id ? 'bg-emerald-50 border-l-4 border-l-emerald-500' : ''}`}>
                      <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0 w-20">{d.doc_date ? formatDate(d.doc_date) : '—'}</span>
                      <span className="text-sm font-semibold text-red-600 whitespace-nowrap flex-shrink-0 w-20">{d.amount ? formatCurrency(d.amount) : '—'}</span>
                      <span className="text-xs text-gray-700 truncate flex-1">{d.supplier_name ?? d.original_name ?? '—'}</span>
                      {documentId === d.id && <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {tiposComNotes.includes(type) && (
            <div>
              <label className="label">Descrição</label>
              <input className="input" placeholder="ex: Comissão bancária, IRS, IMI..."
                value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 pt-4 mt-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="rounded" checked={saveAsRule} onChange={e => setSaveAsRule(e.target.checked)} />
            <span className="text-xs text-gray-600">Guardar como regra automática</span>
          </label>
          {saveAsRule && (
            <div className="mt-2">
              <input className="input text-sm" placeholder="Palavra-chave (parte da descrição bancária)..." value={ruleKeyword} onChange={e => setRuleKeyword(e.target.value)} />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={async () => {
            if (saveAsRule && ruleKeyword.trim()) {
              await supabase.from('bank_matching_rules').insert({
                bank_id: bankId,
                keyword: ruleKeyword.trim(),
                confirmed_type: type,
                tenant_id: type === 'renda' && tenantId ? tenantId : null,
                notes: notes.trim() || null,
              })
              onSaveRule()
            }
            onSave(tx, type, tenantId, expenseId, notes, type === 'receita_extraordinaria' ? (incomeId || undefined) : (documentId || undefined), type === 'renda' ? referenceMonth : undefined)
          }}>Guardar</button>
        </div>
      </div>
    </div>
  )
}

async function generateHash(str: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(str)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}
