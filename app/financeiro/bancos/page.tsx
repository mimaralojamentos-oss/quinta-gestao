'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState, useRef, Fragment } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, Building, CreditCard, ArrowUpRight, ArrowDownRight, Upload, Eye, X, Loader2, FileText, CheckCircle } from 'lucide-react'
import { useFileDrop } from '@/lib/useFileDrop'
import { useAuth } from '@/lib/auth-context'
import { buildRentPaymentPlan, applyRentPaymentPlan } from '@/lib/rentPaymentPlan'
import { ensureExpenseForTransaction } from '@/lib/bankExpense'
import BankMatchModal from '@/components/BankMatchModal'
import BankImportModal from '@/components/BankImportModal'
import Link from 'next/link'

interface Bank {
  id: string
  name: string
  iban: string | null
  account_number: string | null
  holder_name: string | null
  notes: string | null
  active: boolean
  _stats?: {
    total_in: number
    total_out: number
    pending: number
    /** Saldo da última linha do extrato, e a data a que corresponde. */
    saldo: number | null
    saldo_data: string | null
  }
}

/**
 * Etiqueta curta para identificar a conta numa listagem agregada.
 *
 * Os nomes dos bancos aqui são do género "Millennium BCP - Ana Paula": o banco
 * repete-se entre contas e o que as distingue é o titular. Por isso usamos a
 * parte depois do travessão; se não houver, o primeiro e último nome do titular.
 */
function shortBankLabel(bank: { name: string; holder_name?: string | null }): string {
  const depoisDoTravessao = bank.name.split(/\s[-–]\s/).slice(1).join(' - ').trim()
  if (depoisDoTravessao) return depoisDoTravessao

  if (bank.holder_name?.trim()) {
    const partes = bank.holder_name.trim().split(/\s+/)
    return partes.length > 1 ? `${partes[0]} ${partes[partes.length - 1]}` : partes[0]
  }
  return bank.name
}

export default function BancosPage() {
  const { canWrite } = useAuth()
  const [banks, setBanks] = useState<Bank[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editBank, setEditBank] = useState<Bank | null>(null)
  const supabase = createClient()

  // Vista agregada de créditos de todas as contas
  const [credits, setCredits] = useState<any[]>([])
  const [tenants, setTenants] = useState<any[]>([])
  const [leases, setLeases] = useState<any[]>([])
  const [expenses, setExpenses] = useState<any[]>([])
  const [documents, setDocuments] = useState<any[]>([])
  // Transação a identificar — abre o mesmo ecrã completo do extrato individual
  const [matchModal, setMatchModal] = useState<any | null>(null)
  // Banco cujo extrato está a ser importado, a partir do próprio cartão
  const [importBank, setImportBank] = useState<Bank | null>(null)
  const [showCredits, setShowCredits] = useState(true)
  const [creditSearch, setCreditSearch] = useState('')
  const [creditYear, setCreditYear] = useState('all')
  const [creditBank, setCreditBank] = useState('all')
  const [creditStatus, setCreditStatus] = useState<'all' | 'por_validar' | 'validado' | 'ignorado'>('all')
  // Entradas por omissão; o utilizador alterna para saídas quando quiser.
  const [direcao, setDirecao] = useState<'entradas' | 'saidas'>('entradas')

  /** Ao trocar de direção, fecha a linha aberta — deixaria de fazer sentido. */
  function setDividaSeguro() { setMatchModal(null) }

  useEffect(() => { fetchBanks() }, [])

  async function fetchBanks() {
    setLoading(true)
    try {
      const { data: banksData } = await supabase.from('banks').select('*').order('name')
      const { data: txData } = await supabase
        .from('bank_transactions')
        .select('bank_id, amount, status, balance, transaction_date, created_at')

      const banksWithStats = (banksData ?? []).map(bank => {
        const txs = (txData ?? []).filter(t => t.bank_id === bank.id)

        // Saldo atual = saldo da última linha do extrato. Entre linhas do mesmo
        // dia, fica a que foi importada por último, que é a ordem do extrato.
        const comSaldo = txs
          .filter(t => t.balance != null && t.transaction_date)
          .sort((a, b) => {
            const porData = String(b.transaction_date).localeCompare(String(a.transaction_date))
            if (porData !== 0) return porData
            return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))
          })
        const ultima = comSaldo[0]

        return {
          ...bank,
          _stats: {
            total_in: txs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0),
            total_out: txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0),
            pending: txs.filter(t => t.status === 'por_validar').length,
            saldo: ultima?.balance ?? null,
            saldo_data: ultima?.transaction_date ?? null,
          }
        }
      })
      setBanks(banksWithStats)

      // Todos os movimentos de todas as contas. A separação entre entradas e
      // saídas é feita no ecrã, para alternar sem nova consulta.
      const { data: creditData } = await supabase
        .from('bank_transactions')
        .select('id, bank_id, transaction_date, description, amount, balance, reference, status, suggested_type, suggested_lease_id, confirmed_type, confirmed_tenant_id, confirmed_lease_id, confirmed_expense_id, confirmed_document_id, confirmed_income_id, skip_processing, notes')
        .neq('amount', 0)
        .order('transaction_date', { ascending: false })
      setCredits(creditData ?? [])

      const { data: tenantsData } = await supabase.from('tenants').select('id, name')
      setTenants(tenantsData ?? [])

      const { data: leasesData } = await supabase
        .from('leases')
        .select('id, monthly_rent, tenant:tenants(id, name), space:spaces(ref)')
        .eq('status', 'ativo')
      setLeases(leasesData ?? [])

      // Necessários ao ecrã completo de identificação
      const { data: expensesData } = await supabase
        .from('expenses').select('id, expense_date, description, amount, supplier, payment_method')
        .eq('payment_method', 'banco').order('expense_date', { ascending: false })
      setExpenses(expensesData ?? [])

      const { data: docsData } = await supabase
        .from('documents')
        .select('id, original_name, tipo, supplier_name, amount, doc_date, expense_id, file_path')
        .not('amount', 'is', null).eq('status', 'ativo')
      setDocuments(docsData ?? [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const bankById = Object.fromEntries(banks.map(b => [b.id, b]))

  const anosDisponiveis = Array.from(
    new Set(credits.map(c => c.transaction_date?.slice(0, 4)).filter(Boolean))
  ).sort((a, b) => b.localeCompare(a))

  const creditosFiltrados = credits.filter(c => {
    if (direcao === 'entradas' ? c.amount <= 0 : c.amount >= 0) return false
    if (creditBank !== 'all' && c.bank_id !== creditBank) return false
    if (creditStatus !== 'all' && c.status !== creditStatus) return false
    if (creditYear !== 'all' && !c.transaction_date?.startsWith(creditYear)) return false
    if (creditSearch) {
      const q = creditSearch.toLowerCase()
      const banco = bankById[c.bank_id] ? shortBankLabel(bankById[c.bank_id]).toLowerCase() : ''
      if (!c.description?.toLowerCase().includes(q) && !banco.includes(q)) return false
    }
    return true
  })

  const totalCreditos = creditosFiltrados.reduce((s, c) => s + c.amount, 0)

  // Contagens por estado — respeitam os restantes filtros (conta, ano, pesquisa),
  // para o número no botão corresponder ao que se vê ao clicar.
  const creditsBase = credits.filter(c => {
    if (direcao === 'entradas' ? c.amount <= 0 : c.amount >= 0) return false
    if (creditBank !== 'all' && c.bank_id !== creditBank) return false
    if (creditYear !== 'all' && !c.transaction_date?.startsWith(creditYear)) return false
    if (creditSearch) {
      const q = creditSearch.toLowerCase()
      const banco = bankById[c.bank_id] ? shortBankLabel(bankById[c.bank_id]).toLowerCase() : ''
      if (!c.description?.toLowerCase().includes(q) && !banco.includes(q)) return false
    }
    return true
  })

  const creditsPorEstado = {
    all: creditsBase.length,
    por_validar: creditsBase.filter(c => c.status === 'por_validar').length,
    validado: creditsBase.filter(c => c.status === 'validado').length,
    ignorado: creditsBase.filter(c => c.status === 'ignorado').length,
  }

  // Guarda a identificação feita no ecrã completo. Segue a mesma sequência do
  // extrato individual: grava, e depois processa renda ou despesa conforme o tipo.
  async function saveManualMatch(
    tx: any, type: string, tenantId: string, expenseId: string, notes: string,
    documentId?: string, referenceMonth?: string, incomeId?: string, skipProcessing?: boolean,
    cashMovementId?: string,
  ) {
    const lease = tenantId ? leases.find(l => (l.tenant as any)?.id === tenantId) : null

    const { error } = await supabase.from('bank_transactions').update({
      confirmed_type: type,
      confirmed_tenant_id: tenantId || null,
      confirmed_lease_id: lease?.id ?? null,
      confirmed_expense_id: expenseId || null,
      confirmed_document_id: documentId || null,
      confirmed_income_id: incomeId || null,
      skip_processing: skipProcessing ?? false,
      notes: notes || null,
      status: 'validado',
    }).eq('id', tx.id)

    if (error) {
      alert(`⚠️ Não foi possível guardar a identificação:\n\n${error.message}`)
      return
    }

    setMatchModal(null)

    // Fecha a transferência do fundo de maneio: o dinheiro que saiu da caixa
    // aparece confirmado no banco e deixa de estar pendente.
    if (type === 'transferencia_interna' && cashMovementId) {
      const { error: cashError } = await supabase.from('cash_fund_movements').update({
        transfer_status: 'confirmado',
        bank_transaction_id: tx.id,
        notes: `Confirmada no extrato bancário em ${formatDate(tx.transaction_date)}`,
      }).eq('id', cashMovementId)

      if (cashError?.code === '23505') {
        alert('⚠️ Esta transferência já tinha sido confirmada por outro movimento bancário.')
      } else if (cashError) {
        alert(`⚠️ Não foi possível confirmar a transferência: ${cashError.message}`)
      }
    }

    // Marcada como histórico: fica identificada e mais nada acontece.
    if (skipProcessing) {
      await fetchBanks()
      return
    }

    if (type === 'renda' && lease) {
      const mes = `${referenceMonth ?? tx.transaction_date.slice(0, 7)}-01`

      const { data: existentes } = await supabase
        .from('rent_payments').select('id, tipo, amount')
        .eq('lease_id', lease.id).eq('reference_month', mes)

      const jaPago = (existentes ?? [])
        .filter((p: any) => p.tipo === 'renda' || !p.tipo)
        .reduce((s: number, p: any) => s + (p.amount || 0), 0)

      const plan = await buildRentPaymentPlan(supabase, {
        leaseId: lease.id,
        tenantId,
        monthlyRent: lease.monthly_rent,
        amount: tx.amount,
        referenceMonth: mes,
        alreadyPaidRenda: jaPago,
      })

      if (window.confirm(`${plan.summary}\n\nConfirmar processamento deste pagamento?`)) {
        await applyRentPaymentPlan(supabase, plan, {
          leaseId: lease.id,
          tenantId,
          referenceMonth: mes,
          paymentDate: tx.transaction_date,
          paymentMethod: 'banco',
        })
      }
    } else if (type === 'despesa') {
      const result = await ensureExpenseForTransaction(
        supabase,
        { ...tx, confirmed_type: 'despesa', confirmed_expense_id: expenseId || null, confirmed_document_id: documentId || null },
        { documentId: documentId || null },
      )
      if (result.outcome === 'created') alert('✅ Despesa criada automaticamente a partir deste movimento.')
      else if (result.outcome === 'error') alert(`⚠️ Não foi possível criar a despesa: ${result.message}`)
    }

    await fetchBanks()
  }

  async function ignorarEntrada(c: any) {
    const { error } = await supabase.from('bank_transactions').update({ status: 'ignorado' }).eq('id', c.id)
    if (error) { alert(`⚠️ ${error.message}`); return }
    fetchBanks()
  }

  function identificacaoLabel(c: any): string {
    if (c.confirmed_type === 'renda') {
      const t = tenants.find(x => x.id === c.confirmed_tenant_id)
      return t ? `🏠 ${t.name}` : '🏠 Renda'
    }
    if (c.confirmed_type === 'receita_extraordinaria') return '💰 Receita'
    if (c.confirmed_type === 'transferencia_interna') return '🔄 Transf. interna'
    if (c.confirmed_type === 'outro') return `📝 ${c.notes ?? 'Outro'}`
    // Tipos que só aparecem nas saídas
    if (c.confirmed_type === 'despesa') {
      const e = expenses.find(x => x.id === c.confirmed_expense_id)
      return e ? `💸 ${e.description}` : '💸 Despesa'
    }
    if (c.confirmed_type === 'custos_bancarios') return `🏦 ${c.notes ?? 'Custos bancários'}`
    if (c.confirmed_type === 'impostos') return `🧾 ${c.notes ?? 'Impostos'}`
    if (c.confirmed_type) return c.confirmed_type
    return '—'
  }

  return (
    <AppLayout>
      <div className="p-4 md:p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Bancos</h1>
            <p className="text-sm text-gray-500 mt-1">
              Gestão de contas bancárias e extratos
              {banks.filter(b => b._stats?.saldo != null).length > 1 && (
                <span className="ml-2 text-gray-700">
                  · Saldo somado:{' '}
                  <strong>
                    {formatCurrency(banks.reduce((s, b) => s + (b._stats?.saldo ?? 0), 0))}
                  </strong>
                </span>
              )}
            </p>
          </div>
          {canWrite && (
            <button className="btn-primary" onClick={() => { setEditBank(null); setShowModal(true) }}>
              <Plus className="w-4 h-4" /> Novo Banco
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
          </div>
        ) : banks.length === 0 ? (
          <div className="card flex flex-col items-center py-16 text-center">
            <Building className="w-12 h-12 text-gray-300 mb-3" />
            <p className="text-lg font-semibold text-gray-700">Nenhum banco configurado</p>
            <p className="text-sm text-gray-500 mt-1 mb-4">Adiciona o teu primeiro banco para começar a importar extratos</p>
            {canWrite && (
              <button className="btn-primary" onClick={() => setShowModal(true)}>
                <Plus className="w-4 h-4" /> Adicionar Banco
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {banks.map(bank => (
              <div key={bank.id} className="card">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center">
                      <CreditCard className="w-6 h-6 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 text-lg">{bank.name}</h3>
                      {bank.holder_name && <p className="text-sm text-gray-600">{bank.holder_name}</p>}
                      {bank.iban && <p className="text-sm text-gray-500 font-mono">{bank.iban}</p>}
                      {bank.account_number && <p className="text-xs text-gray-400">Conta: {bank.account_number}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {bank._stats?.saldo != null && (
                      <div className="text-right mr-1">
                        <p className="text-xs text-gray-500">Saldo atual</p>
                        <p className={`text-xl font-bold leading-tight ${bank._stats.saldo >= 0 ? 'text-gray-900' : 'text-red-600'}`}>
                          {formatCurrency(bank._stats.saldo)}
                        </p>
                        {bank._stats.saldo_data && (
                          <p className="text-[11px] text-gray-400">
                            a {bank._stats.saldo_data.split('-').reverse().join('/')}
                          </p>
                        )}
                      </div>
                    )}
                    {bank._stats && bank._stats.pending > 0 && (
                      <span className="badge-amarelo">{bank._stats.pending} por validar</span>
                    )}
                    {canWrite && (
                      <>
                        <button onClick={() => setImportBank(bank)}
                          className="btn-secondary text-xs py-1.5 px-3"
                          title="Importar extrato sem sair desta página">
                          <Upload className="w-3 h-3" /> Importar
                        </button>
                        <button onClick={() => { setEditBank(bank); setShowModal(true) }}
                          className="btn-secondary text-xs py-1.5 px-3">Editar</button>
                      </>
                    )}
                    <Link href={`/financeiro/bancos/${bank.id}`} className="btn-primary text-xs py-1.5 px-3">
                      <Eye className="w-3 h-3" /> Ver extrato
                    </Link>
                  </div>
                </div>
                {bank._stats && (
                  <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-100">
                    <div className="flex items-center gap-2">
                      <ArrowUpRight className="w-4 h-4 text-emerald-500" />
                      <div>
                        <p className="text-xs text-gray-500">Total Entradas</p>
                        <p className="font-semibold text-emerald-600">{formatCurrency(bank._stats.total_in)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <ArrowDownRight className="w-4 h-4 text-red-500" />
                      <div>
                        <p className="text-xs text-gray-500">Total Saídas</p>
                        <p className="font-semibold text-red-600">{formatCurrency(bank._stats.total_out)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Upload className="w-4 h-4 text-blue-500" />
                      <div>
                        <p className="text-xs text-gray-500">Por Validar</p>
                        <p className="font-semibold text-gray-800">{bank._stats.pending} linhas</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Créditos de todas as contas juntos */}
        {!loading && banks.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {direcao === 'entradas'
                  ? <ArrowUpRight className="w-5 h-5 text-emerald-500" />
                  : <ArrowDownRight className="w-5 h-5 text-red-500" />}
                <h2 className="text-lg font-bold text-gray-900">
                  {direcao === 'entradas' ? 'Entradas' : 'Saídas'} de todas as contas
                </h2>
                <span className="text-xs text-gray-400">
                  {direcao === 'entradas' ? 'só créditos' : 'só débitos'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {/* Alternar entre entradas e saídas */}
                <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                  <button
                    onClick={() => { setDirecao('entradas'); setDividaSeguro() }}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      direcao === 'entradas' ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}>
                    ↑ Entradas
                  </button>
                  <button
                    onClick={() => { setDirecao('saidas'); setDividaSeguro() }}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      direcao === 'saidas' ? 'bg-red-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}>
                    ↓ Saídas
                  </button>
                </div>
                <button onClick={() => setShowCredits(v => !v)} className="btn-secondary text-xs py-1.5 px-3">
                  {showCredits ? 'Esconder' : 'Mostrar'}
                </button>
              </div>
            </div>

            {showCredits && (
              <div className="card">
                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <input
                    className="input flex-1 min-w-48 text-sm"
                    placeholder="Pesquisar na descrição ou no banco..."
                    value={creditSearch}
                    onChange={e => setCreditSearch(e.target.value)}
                  />
                  <select className="input w-44 text-sm" value={creditBank} onChange={e => setCreditBank(e.target.value)}>
                    <option value="all">Todas as contas</option>
                    {banks.map(b => (
                      <option key={b.id} value={b.id}>{shortBankLabel(b)}</option>
                    ))}
                  </select>
                  <select className="input w-28 text-sm" value={creditYear} onChange={e => setCreditYear(e.target.value)}>
                    <option value="all">Todos</option>
                    {anosDisponiveis.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>

                {/* Estado — atalho para o caso mais frequente: o que falta tratar */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {([
                    { key: 'all', label: 'Todas', count: creditsPorEstado.all },
                    { key: 'por_validar', label: '⏳ Por validar', count: creditsPorEstado.por_validar },
                    { key: 'validado', label: '✓ Validadas', count: creditsPorEstado.validado },
                    { key: 'ignorado', label: 'Ignoradas', count: creditsPorEstado.ignorado },
                  ] as const).map(btn => (
                    <button key={btn.key} onClick={() => setCreditStatus(btn.key)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                        creditStatus === btn.key
                          ? (btn.key === 'por_validar' ? 'bg-amber-500 text-white' : 'bg-emerald-600 text-white')
                          : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                      }`}>
                      {btn.label}
                      <span className={`px-1.5 py-0.5 rounded-full text-xs ${creditStatus === btn.key ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>
                        {btn.count}
                      </span>
                    </button>
                  ))}
                </div>

                <div className={`flex items-center justify-between rounded-lg px-4 py-2.5 mb-3 border ${
                  direcao === 'entradas'
                    ? 'bg-emerald-50 border-emerald-100'
                    : 'bg-red-50 border-red-100'
                }`}>
                  <span className={`text-sm ${direcao === 'entradas' ? 'text-emerald-700' : 'text-red-700'}`}>
                    {creditosFiltrados.length} {direcao === 'entradas' ? 'entrada(s)' : 'saída(s)'}
                    {creditStatus === 'por_validar' && ' por validar'}
                    {creditStatus === 'validado' && ' validadas'}
                    {creditStatus === 'ignorado' && ' ignoradas'}
                    {creditBank !== 'all' && ` · ${shortBankLabel(bankById[creditBank] ?? { name: '—' })}`}
                    {creditYear !== 'all' && ` · ${creditYear}`}
                  </span>
                  <span className={`text-xl font-bold ${direcao === 'entradas' ? 'text-emerald-700' : 'text-red-700'}`}>
                    {formatCurrency(Math.abs(totalCreditos))}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-left">
                        <th className="py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Conta</th>
                        <th className="py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Data</th>
                        <th className="py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Descrição</th>
                        <th className="py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Identificação</th>
                        <th className="py-2 px-2 text-xs font-semibold text-gray-500 uppercase text-right">Valor</th>
                        <th className="py-2 px-2 text-xs font-semibold text-gray-500 uppercase text-right">Saldo</th>
                        <th className="py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Estado</th>
                        {canWrite && <th className="py-2 px-2 text-xs font-semibold text-gray-500 uppercase text-right">Ações</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {creditosFiltrados.length === 0 ? (
                        <tr>
                          <td colSpan={canWrite ? 8 : 7} className="py-8 text-center text-gray-400">
                            Nenhuma {direcao === 'entradas' ? 'entrada' : 'saída'} com estes filtros.
                          </td>
                        </tr>
                      ) : creditosFiltrados.slice(0, 300).map(c => {
                        const banco = bankById[c.bank_id]
                        return (
                          <Fragment key={c.id}>
                          <tr className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                            <td className="py-2 px-2">
                              <Link href={`/financeiro/bancos/${c.bank_id}`}
                                className="text-xs font-medium text-blue-600 hover:underline whitespace-nowrap">
                                {banco ? shortBankLabel(banco) : '—'}
                              </Link>
                            </td>
                            <td className="py-2 px-2 text-gray-600 whitespace-nowrap">
                              {c.transaction_date?.split('-').reverse().join('/')}
                            </td>
                            <td className="py-2 px-2 text-gray-800">{c.description}</td>
                            <td className="py-2 px-2 text-gray-600 text-xs">
                              {identificacaoLabel(c)}
                              {c.skip_processing && (
                                <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded whitespace-nowrap"
                                  title="Identificada como histórico — não gera pagamentos nem despesas">
                                  📁 histórico
                                </span>
                              )}
                            </td>
                            <td className={`py-2 px-2 text-right font-semibold whitespace-nowrap ${
                              c.amount >= 0 ? 'text-emerald-600' : 'text-red-600'
                            }`}>
                              {c.amount >= 0 ? '+' : ''}{formatCurrency(c.amount)}
                            </td>
                            <td className="py-2 px-2 text-right text-gray-500 whitespace-nowrap">
                              {c.balance != null ? formatCurrency(c.balance) : '—'}
                            </td>
                            <td className="py-2 px-2">
                              <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${
                                c.status === 'validado' ? 'bg-emerald-100 text-emerald-700'
                                : c.status === 'ignorado' ? 'bg-gray-100 text-gray-500'
                                : 'bg-amber-100 text-amber-700'
                              }`}>
                                {c.status === 'validado' ? 'Validado' : c.status === 'ignorado' ? 'Ignorado' : 'Por validar'}
                              </span>
                            </td>
                            {canWrite && (
                              <td className="py-2 px-2 text-right whitespace-nowrap">
                                {c.status === 'por_validar' ? (
                                  <div className="flex items-center gap-2 justify-end">
                                    <button onClick={() => setMatchModal(c)}
                                      className="text-xs text-emerald-600 hover:underline font-medium">
                                      Identificar
                                    </button>
                                    <button onClick={() => ignorarEntrada(c)}
                                      className="text-xs text-gray-400 hover:text-gray-600">
                                      Ignorar
                                    </button>
                                  </div>
                                ) : (
                                  <button onClick={() => setMatchModal(c)}
                                    className="text-xs text-gray-400 hover:text-blue-600">
                                    Editar
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>

                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {creditosFiltrados.length > 300 && (
                  <p className="text-xs text-gray-400 mt-3 text-center">
                    A mostrar as 300 mais recentes de {creditosFiltrados.length}. Usa os filtros para reduzir.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {showModal && (
        <BankModal
          bank={editBank}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); fetchBanks() }}
        />
      )}

      {importBank && (
        <BankImportModal
          bankId={importBank.id}
          bankName={importBank.name}
          columnMapping={(importBank as any).column_mapping}
          onImported={fetchBanks}
          onClose={() => setImportBank(null)}
        />
      )}

      {matchModal && (
        <BankMatchModal
          tx={matchModal}
          tenants={tenants}
          leases={leases}
          expenses={expenses}
          documents={documents}
          autoMatches={[]}
          bankId={matchModal.bank_id}
          onSave={saveManualMatch}
          onSaveRule={fetchBanks}
          onClose={() => setMatchModal(null)}
        />
      )}
    </AppLayout>
  )
}

function BankModal({ bank, onClose, onSaved }: { bank: Bank | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: bank?.name ?? '',
    holder_name: bank?.holder_name ?? '',
    iban: bank?.iban ?? '',
    account_number: bank?.account_number ?? '',
    notes: bank?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [pdfFileName, setPdfFileName] = useState<string | null>(null)
  const [extractError, setExtractError] = useState('')
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  const bankPdfDrop = useFileDrop({
    accept: ['.pdf'],
    onFiles: dropped => { if (dropped[0]) processPdf(dropped[0]) },
    disabled: extracting,
  })

  function handlePdfUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processPdf(file)
  }

  async function processPdf(file: File) {
    setExtracting(true)
    setExtractError('')
    setPdfFileName(file.name)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/extract-bank-pdf', {
        method: 'POST',
        body: formData,
      })
      const json = await res.json()

      if (!res.ok || json.error) {
        setExtractError(json.error ?? 'Erro ao processar PDF')
        return
      }

      const d = json.data
      setForm(f => ({
        name: d.bank_name || f.name,
        holder_name: d.holder_name || f.holder_name,
        iban: d.iban || f.iban,
        account_number: d.account_number || f.account_number,
        notes: d.notes || f.notes,
      }))
    } catch {
      setExtractError('Erro ao processar PDF. Tenta novamente.')
    } finally {
      setExtracting(false)
      // Reset input para permitir re-upload do mesmo ficheiro
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('O nome é obrigatório'); return }
    setSaving(true); setError('')
    const payload = {
      name: form.name.trim(),
      holder_name: form.holder_name || null,
      iban: form.iban || null,
      account_number: form.account_number || null,
      notes: form.notes || null,
    }
    let err
    if (bank) {
      ;({ error: err } = await supabase.from('banks').update(payload).eq('id', bank.id))
    } else {
      ;({ error: err } = await supabase.from('banks').insert(payload))
    }
    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-lg text-gray-900">{bank ? 'Editar Banco' : 'Novo Banco'}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        {/* Upload PDF */}
        <div className="mb-5">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={handlePdfUpload}
          />
          <button
            type="button"
            {...bankPdfDrop.dropProps}
            onClick={() => fileInputRef.current?.click()}
            disabled={extracting}
            className={`w-full flex items-center justify-center gap-2 border-2 border-dashed rounded-lg py-3 px-4 text-sm font-medium transition-colors disabled:opacity-60 ${
              bankPdfDrop.isDragging
                ? 'border-emerald-500 bg-emerald-100 text-emerald-800'
                : 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
            }`}
          >
            {extracting ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> A ler PDF...</>
            ) : bankPdfDrop.isDragging ? (
              <><FileText className="w-4 h-4" /> Larga aqui o PDF</>
            ) : pdfFileName ? (
              <><CheckCircle className="w-4 h-4 text-emerald-600" /> {pdfFileName} — carregar outro</>
            ) : (
              <><FileText className="w-4 h-4" /> Arrasta para aqui ou clica para carregar o PDF do banco</>
            )}
          </button>
          {extractError && <p className="text-xs text-red-600 mt-1">{extractError}</p>}
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">Nome do Banco *</label>
            <input className="input" placeholder="ex: Caixa Geral de Depósitos" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className="label">Titular da Conta</label>
            <input className="input" placeholder="ex: João Silva" value={form.holder_name}
              onChange={e => setForm(f => ({ ...f, holder_name: e.target.value }))} />
          </div>
          <div>
            <label className="label">IBAN</label>
            <input className="input font-mono" placeholder="PT50 0000 0000 0000 0000 0000 0" value={form.iban}
              onChange={e => setForm(f => ({ ...f, iban: e.target.value }))} />
          </div>
          <div>
            <label className="label">Número de Conta</label>
            <input className="input" placeholder="ex: 0000000000" value={form.account_number}
              onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))} />
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
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> A guardar...</> : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
