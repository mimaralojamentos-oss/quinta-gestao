'use client'

// Ecrã completo de identificação de uma transação bancária.
//
// Vive aqui, e não dentro da página do extrato, porque é usado em dois sítios:
//   - no extrato de cada conta (/financeiro/bancos/[id])
//   - na vista agregada de entradas de todas as contas (/financeiro/bancos)
// Assim o utilizador vê exatamente o mesmo ecrã nos dois, com sugestões
// automáticas, associação a faturas/despesas, origem da receita e regras.

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, formatDate, matchesSearch, getMonthLabel } from '@/lib/utils'
import { EXPENSE_CATEGORIES } from '@/lib/expenseCategories'
import { Search, X, Sparkles, FileText, CheckCircle } from 'lucide-react'
import { mergeCategories, normalizeCategory } from '@/lib/incomeCategories'
import { buildRentPaymentPlan, DESTINOS, type RentPaymentPlan, type DestinoPagamento } from '@/lib/rentPaymentPlan'
import DestinoPagamentoPicker from '@/components/DestinoPagamentoPicker'
import { logAccess } from '@/lib/logAccess'
import { createExpense } from '@/lib/createExpense'
import { findSimilarExpenses } from '@/lib/expenseDuplicates'

const supabase = createClient()

/**
 * Âmbito da procura de despesas e faturas ao reconciliar o banco.
 * Por omissão só mostra o que tem exatamente o mesmo valor da transação —
 * é o caso normal e evita percorrer centenas de linhas. Os botões alargam
 * a procura a uma janela de dias, aí já sem filtro de valor.
 */
type Scope = 'valor' | '30' | '60' | '90'

const SCOPES: { key: Scope; label: string }[] = [
  { key: 'valor', label: 'Valor igual' },
  { key: '30', label: '30 dias' },
  { key: '60', label: '60 dias' },
  { key: '90', label: '90 dias' },
]

/** Diferença em dias entre uma data e a data da transação. */
function diasDeDiferenca(data: string | null | undefined, referencia: Date): number {
  if (!data) return Infinity
  const d = new Date(data)
  if (isNaN(d.getTime())) return Infinity
  return Math.abs(d.getTime() - referencia.getTime()) / 86400000
}

/** Decide se uma despesa/fatura entra na lista, conforme o âmbito escolhido. */
function dentroDoAmbito(
  scope: Scope,
  valorItem: number | null | undefined,
  dataItem: string | null | undefined,
  valorTransacao: number,
  txDate: Date,
): boolean {
  if (scope === 'valor') return Math.abs((valorItem ?? 0) - valorTransacao) <= 0.02
  return diasDeDiferenca(dataItem, txDate) <= Number(scope)
}

function ScopePicker({ value, onChange }: { value: Scope; onChange: (s: Scope) => void }) {
  return (
    <div className="flex gap-1.5 mb-2 flex-wrap">
      {SCOPES.map(s => (
        <button key={s.key} type="button" onClick={() => onChange(s.key)}
          className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${
            value === s.key
              ? 'bg-emerald-600 text-white border-emerald-600'
              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
          }`}>
          {s.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Linha de apoio ao operador: quanto estava em dívida antes deste pagamento
 * e quanto continua por pagar depois. Fica fora do componente principal
 * para não ser recriada em cada render.
 */
function SaldoLinha({ emDivida, fica }: { emDivida: number; fica: number }) {
  if (emDivida <= 0.01) return null
  return (
    <span className="block text-[11px] text-gray-500 mt-0.5">
      Em dívida {formatCurrency(emDivida)}
      {fica > 0.01
        ? <span className="text-amber-600 font-medium"> · ficam {formatCurrency(fica)}</span>
        : <span className="text-emerald-600 font-medium"> · fica liquidada</span>}
    </span>
  )
}

export interface BankTransaction {
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
  confirmed_income_id: string | null
  /** Identificada mas deliberadamente fora de qualquer processamento automático. */
  skip_processing?: boolean | null
  notes: string | null
}

export default function BankMatchModal({ tx, tenants, leases, expenses, documents, autoMatches, bankId, onSave, onSaveRule, onClose }: {
  tx: BankTransaction
  tenants: any[]
  leases: any[]
  expenses: any[]
  documents: any[]
  autoMatches: any[]
  bankId: string
  onSave: (tx: BankTransaction, type: string, tenantId: string, expenseId: string, notes: string, documentId?: string, referenceMonth?: string, incomeId?: string, skipProcessing?: boolean, cashMovementId?: string, destino?: DestinoPagamento) => void
  onSaveRule: () => void
  onClose: () => void
}) {
  const [type, setType] = useState(tx.confirmed_type ?? (tx.amount > 0 ? 'renda' : 'despesa'))
  const [tenantId, setTenantId] = useState(tx.confirmed_tenant_id ?? '')
  const [expenseId, setExpenseId] = useState(tx.confirmed_expense_id ?? '')
  const [notes, setNotes] = useState(tx.notes ?? '')
  const [referenceMonth, setReferenceMonth] = useState(tx.transaction_date.slice(0, 7))
  const [searchExpense, setSearchExpense] = useState('')
  // Por omissão só aparecem despesas/faturas com o valor exato da transação.
  const [expenseScope, setExpenseScope] = useState<Scope>('valor')
  const [docScope, setDocScope] = useState<Scope>('valor')
  // Despesas/faturas já associadas a outra transação bancária.
  const [usedExpenseIds, setUsedExpenseIds] = useState<Set<string>>(new Set())
  const [usedDocumentIds, setUsedDocumentIds] = useState<Set<string>>(new Set())
  // Criação rápida de despesa sem sair desta janela (compras sem fatura).
  const [showNewExpense, setShowNewExpense] = useState(false)
  const [savingNewExpense, setSavingNewExpense] = useState(false)
  const [newExpenseError, setNewExpenseError] = useState('')
  const [localExpenses, setLocalExpenses] = useState<any[]>([])
  const [newExpense, setNewExpense] = useState({
    expense_date: tx.transaction_date.slice(0, 10),
    amount: Math.abs(tx.amount).toFixed(2),
    description: tx.description.replace(/\s+/g, ' ').trim().slice(0, 120),
    category: 'outros',
    supplier: '',
    notes: '',
  })
  const [searchTenant, setSearchTenant] = useState('')
  const [documentId, setDocumentId] = useState(tx.confirmed_document_id ?? '')
  const [searchDoc, setSearchDoc] = useState('')
  const [saveAsRule, setSaveAsRule] = useState(false)
  const [skipProcessing, setSkipProcessing] = useState(tx.skip_processing ?? false)
  const [ruleKeyword, setRuleKeyword] = useState('')
  const [incomeId, setIncomeId] = useState(tx.confirmed_income_id ?? '')
  const [incomeRecords, setIncomeRecords] = useState<any[]>([])
  const [incomeCategoryInput, setIncomeCategoryInput] = useState('')
  const [creatingIncome, setCreatingIncome] = useState(false)
  const [wideSearch, setWideSearch] = useState(false)
  // Transferências do fundo de maneio ainda por confirmar no extrato
  const [cashTransfers, setCashTransfers] = useState<any[]>([])
  const [cashMovementId, setCashMovementId] = useState('')
  // Para onde vai o dinheiro: por omissão a ordem habitual, mas o operador
  // pode dizer que aquele valor é só para a luz ou só para dívidas.
  const [destino, setDestino] = useState<DestinoPagamento>('auto')
  // Pré-visualização da distribuição do valor recebido
  const [plan, setPlan] = useState<RentPaymentPlan | null>(null)
  const [planLoading, setPlanLoading] = useState(false)

  // Origens conhecidas + as que já foram usadas antes, para a lista crescer sozinha
  const categoriasDisponiveis = mergeCategories(incomeRecords.map(r => r.category))

  useEffect(() => {
    supabase.from('income_records').select('id, description, amount, income_date, category').order('income_date', { ascending: false }).then(({ data }) => setIncomeRecords(data ?? []))

    supabase
      .from('cash_fund_movements')
      .select('id, movement_date, description, amount, bank_id')
      .eq('transfer_status', 'pendente')
      .order('movement_date', { ascending: false })
      .then(({ data }) => {
        const lista = data ?? []
        setCashTransfers(lista)

        // Pré-seleciona a transferência com o mesmo valor e data próxima —
        // é quase sempre a certa, e evita ter de a procurar na lista.
        const provavel = lista.find(m => {
          const dias = Math.abs(
            (new Date(tx.transaction_date).getTime() - new Date(m.movement_date).getTime()) / 86400000
          )
          return Math.abs(Math.abs(m.amount) - Math.abs(tx.amount)) <= 0.02 && dias <= 10
        })
        if (provavel) setCashMovementId(provavel.id)
      })
  }, [])

  // Que despesas e faturas já foram usadas noutras reconciliações.
  // Serve só para avisar o operador — continua a poder escolhê-las.
  useEffect(() => {
    supabase
      .from('bank_transactions')
      .select('id, confirmed_expense_id, confirmed_document_id')
      .or('confirmed_expense_id.not.is.null,confirmed_document_id.not.is.null')
      .then(({ data }) => {
        const despesas = new Set<string>()
        const faturas = new Set<string>()
        for (const t of data ?? []) {
          if (t.id === tx.id) continue // a própria transação não conta
          if (t.confirmed_expense_id) despesas.add(t.confirmed_expense_id)
          if (t.confirmed_document_id) faturas.add(t.confirmed_document_id)
        }
        setUsedExpenseIds(despesas)
        setUsedDocumentIds(faturas)
      })
  }, [])

  const txDate = new Date(tx.transaction_date)
  // Valor absoluto da transação — as saídas do banco vêm negativas.
  const txAmountAbs = parseFloat(Math.abs(tx.amount).toFixed(2))

  /** Uma despesa conta como usada se outra transação a reclamou. */
  function despesaJaUsada(e: any): boolean {
    if (usedExpenseIds.has(e.id)) return true
    return !!e.bank_transaction_id && e.bank_transaction_id !== tx.id
  }

  // Calcula a distribuição enquanto o utilizador escolhe, para o valor
  // deixar de ser uma caixa preta até ao momento de gravar.
  useEffect(() => {
    let cancelado = false

    async function calcular() {
      const lease = tenantId ? leases.find(l => (l.tenant as any)?.id === tenantId) : null
      if (type !== 'renda' || !lease || tx.amount <= 0) { setPlan(null); return }

      setPlanLoading(true)
      try {
        const resultado = await buildRentPaymentPlan(supabase, {
          leaseId: lease.id,
          tenantId,
          amount: tx.amount,
          destino,
          // Só é usado quando destino === 'renda' — no automático, o motor
          // paga sempre o(s) mês(es) mais antigo(s) em falta, seja qual for
          // este campo.
          soRendaMonth: referenceMonth || tx.transaction_date.slice(0, 7),
        })

        if (!cancelado) setPlan(resultado)
      } finally {
        if (!cancelado) setPlanLoading(false)
      }
    }

    calcular()
    return () => { cancelado = true }
  }, [type, tenantId, referenceMonth, tx.amount, destino])

  /**
   * Cria uma despesa a partir dos dados do movimento bancário, sem sair
   * da janela. Serve para compras de que não há fatura nem documento.
   * Não grava bank_transaction_id — quem faz a ligação é o fluxo normal
   * de gravação, para não ficar uma despesa presa se o operador mudar de ideias.
   */
  async function handleCreateExpense() {
    const valor = parseFloat(newExpense.amount)
    if (!newExpense.description.trim()) { setNewExpenseError('A descrição é obrigatória'); return }
    if (!valor || valor <= 0) { setNewExpenseError('Indica um valor válido'); return }

    const valorArredondado = parseFloat(valor.toFixed(2))
    const similares = await findSimilarExpenses(supabase, valorArredondado, newExpense.expense_date)
    if (similares.length > 0) {
      const lista = similares.map(s => `• ${formatDate(s.expense_date)} — ${s.description} (${formatCurrency(s.amount)})`).join('\n')
      if (!confirm(`Já existe uma despesa parecida (mesmo valor, data próxima):\n\n${lista}\n\nCriar mesmo assim?`)) return
    }

    setSavingNewExpense(true); setNewExpenseError('')

    // Saiu do banco, por isso nunca mexe no fundo de maneio. Não grava
    // bank_transaction_id — quem faz a ligação é o fluxo normal de gravação,
    // para não ficar uma despesa presa se o operador mudar de ideias.
    const { expense: data, error } = await createExpense(supabase, {
      expense_date: newExpense.expense_date,
      category: newExpense.category,
      type: 'pontual',
      description: newExpense.description.trim(),
      amount: valorArredondado,
      payment_method: 'banco',
      supplier: newExpense.supplier.trim() || null,
      notes: [newExpense.notes.trim(), `Registo manual criado na reconciliação bancária de ${formatDate(tx.transaction_date)} — sem documento de compra`]
        .filter(Boolean).join(' · '),
    })

    setSavingNewExpense(false)
    if (error || !data) { setNewExpenseError(error ?? 'Erro desconhecido'); return }

    await logAccess({
      action: 'criar',
      page: '/financeiro/bancos',
      details: `Criou despesa manual (${formatCurrency(valor)}) na reconciliação bancária — ${newExpense.description.trim()}`,
    })

    // Fica logo na lista e selecionada, para o operador não ter de a procurar.
    setLocalExpenses(prev => [data, ...prev])
    setExpenseId(data.id)
    if (Math.abs(data.amount - txAmountAbs) > 0.02) setExpenseScope('90')
    setShowNewExpense(false)
  }

  const sortedExpenses = [...expenses, ...localExpenses].sort((a, b) => {
    const diffA = Math.abs(new Date(a.expense_date).getTime() - txDate.getTime())
    const diffB = Math.abs(new Date(b.expense_date).getTime() - txDate.getTime())
    return diffA - diffB
  })

  const filteredExpenses = sortedExpenses
    .filter(e => dentroDoAmbito(expenseScope, e.amount, e.expense_date, txAmountAbs, txDate))
    .filter(e =>
      !searchExpense || matchesSearch(e.description, searchExpense) ||
      matchesSearch(e.supplier, searchExpense) ||
      String(e.amount).includes(searchExpense)
    )

  const filteredDocuments = [...documents]
    .filter(d => dentroDoAmbito(docScope, d.amount, d.doc_date, txAmountAbs, txDate))
    .filter(d =>
      !searchDoc ||
      matchesSearch(d.supplier_name ?? d.original_name, searchDoc) ||
      String(d.amount).includes(searchDoc)
    )
    .sort((a, b) => {
      const diffA = diasDeDiferenca(a.doc_date, txDate)
      const diffB = diasDeDiferenca(b.doc_date, txDate)
      if (diffA !== diffB) return diffA - diffB
      return Math.abs((a.amount ?? 0) - txAmountAbs) - Math.abs((b.amount ?? 0) - txAmountAbs)
    })

  const filteredTenants = tenants.filter(t =>
    !searchTenant || matchesSearch(t.name, searchTenant)
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
                {destino === 'auto' && (
                  <p className="text-xs text-gray-400 mt-1">
                    No destino Automático este campo não é usado — paga sempre o(s) mês(es) mais antigo(s) em falta.
                  </p>
                )}
              </div>

              {/* Como o valor vai ser distribuído */}
              {planLoading && (
                <p className="text-xs text-gray-400">A calcular a distribuição...</p>
              )}

              {/* Para onde vai o dinheiro. Por omissão segue a ordem habitual,
                  mas quando o inquilino diz "isto é para a luz" pode-se
                  impedir que o valor seja absorvido pela renda do mês. */}
              <div className="mb-3">
                <DestinoPagamentoPicker valor={destino} onChange={setDestino} />
              </div>

              {plan && !planLoading && (
                <div className="border border-emerald-200 bg-emerald-50/60 rounded-lg p-3">
                  <p className="text-xs font-medium text-emerald-800 mb-2">
                    Distribuição de {formatCurrency(tx.amount)}
                    {destino !== 'auto' && (
                      <span className="ml-1 font-normal">
                        — {DESTINOS.find(d => d.valor === destino)?.label.toLowerCase()}
                      </span>
                    )}
                  </p>

                  <div className="space-y-1.5 text-sm">
                    {plan.rendaPayments.map(rp => (
                      <div key={rp.referenceMonth} className="flex justify-between items-start gap-2">
                        <span className="text-gray-700">
                          🏠 Renda {getMonthLabel(rp.referenceMonth)}
                          <span className="text-xs text-gray-400 ml-1">
                            {rp.fullyPaid ? 'liquidada' : `de ${formatCurrency(rp.monthlyRent)}`}
                          </span>
                          {rp.creditApplied > 0 && (
                            <span className="block text-[11px] text-purple-600 mt-0.5">
                              💰 crédito {formatCurrency(rp.creditApplied)} aplicado
                            </span>
                          )}
                          <SaldoLinha emDivida={rp.owedBefore} fica={rp.remainingAfter} />
                        </span>
                        <span className={`font-medium ${rp.fullyPaid ? 'text-gray-900' : 'text-amber-700'}`}>
                          {formatCurrency(rp.amount)}
                        </span>
                      </div>
                    ))}
                    {destino !== 'luz' && destino !== 'dividas' && plan.rendaPayments.length === 0 && (
                      <p className="text-xs text-gray-400">Sem meses de renda em falta.</p>
                    )}

                    {plan.caucao && (
                      <div className="flex justify-between items-start gap-2">
                        <span className="text-gray-700">
                          🔒 Caução
                          <span className="text-xs text-gray-400 ml-1">
                            {plan.caucao.fullyPaid ? 'liquidada' : `de ${formatCurrency(plan.caucao.owedBefore)}`}
                          </span>
                          <SaldoLinha emDivida={plan.caucao.owedBefore} fica={plan.caucao.remainingAfter} />
                        </span>
                        <span className={`font-medium ${plan.caucao.fullyPaid ? 'text-gray-900' : 'text-amber-700'}`}>
                          {formatCurrency(plan.caucao.amount)}
                        </span>
                      </div>
                    )}

                    {plan.electricityCharges.map(c => (
                      <div key={c.id} className="flex justify-between items-start gap-2">
                        <span className="text-gray-700">
                          ⚡ Eletricidade
                          {c.chargeDate && <span className="text-xs text-gray-400 ml-1">{formatDate(c.chargeDate)}</span>}
                          {c.isPartial && <span className="text-xs text-amber-600 ml-1">parcial</span>}
                          <SaldoLinha
                            emDivida={parseFloat((c.totalAmount - c.alreadyPaid).toFixed(2))}
                            fica={c.remainingAfter}
                          />
                        </span>
                        <span className={`font-medium ${c.isPartial ? 'text-amber-700' : 'text-gray-900'}`}>
                          {formatCurrency(c.amount)}
                        </span>
                      </div>
                    ))}

                    {plan.debtPayments.map(d => (
                      <div key={d.debtId} className="flex justify-between items-start gap-2">
                        <span className="text-gray-700">
                          💰 {d.description}
                          <SaldoLinha emDivida={d.remainingBefore} fica={d.remainingAfter} />
                        </span>
                        <span className="font-medium text-gray-900">{formatCurrency(d.amount)}</span>
                      </div>
                    ))}

                    {plan.adiantamento > 0 && (
                      <div className="flex justify-between items-baseline gap-2">
                        <span className="text-gray-700">
                          🪙 Adiantamento
                          <span className="text-xs text-gray-400 ml-1">crédito do inquilino</span>
                        </span>
                        <span className="font-medium text-purple-700">{formatCurrency(plan.adiantamento)}</span>
                      </div>
                    )}
                  </div>

                  {plan.adiantamento > 0 && (
                    <p className="text-xs text-gray-500 mt-2 pt-2 border-t border-emerald-100">
                      Não havia mais nada em dívida — o valor que sobrou fica como crédito do inquilino
                      e é usado no próximo pagamento.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {type === 'receita_extraordinaria' && (
            <div className="space-y-3">
              <div>
                <label className="label">Origem da receita</label>
                <input
                  className="input"
                  list="origens-receita"
                  placeholder="ex: Juros bancários, Energia solar..."
                  value={incomeCategoryInput}
                  onChange={e => setIncomeCategoryInput(e.target.value)}
                />
                <datalist id="origens-receita">
                  {categoriasDisponiveis.map(c => (
                    <option key={c.value} value={c.label.replace(/^\S+\s/, '')} />
                  ))}
                </datalist>
                <p className="text-xs text-gray-400 mt-1">
                  Escolhe da lista ou escreve uma origem nova — fica disponível das próximas vezes.
                </p>
              </div>

              <div>
                <label className="label">
                  Receita já registada <span className="font-normal text-gray-400">(opcional)</span>
                </label>
                <select className="input" value={incomeId} onChange={e => setIncomeId(e.target.value)} size={4}>
                  <option value="">— Criar nova a partir desta transação —</option>
                  {incomeRecords.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.income_date} · {r.description.slice(0, 50)} · {r.amount}€
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  {incomeId
                    ? 'A transação vai ser ligada a esta receita já existente.'
                    : `Vai ser criada uma receita de ${formatCurrency(Math.abs(tx.amount))} com a origem indicada acima.`}
                </p>
              </div>
            </div>
          )}

          {type === 'despesa' && (
            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="label">Despesa associada</label>
                {!showNewExpense && (
                  <button type="button" onClick={() => { setShowNewExpense(true); setNewExpenseError('') }}
                    className="text-xs font-medium text-emerald-700 hover:text-emerald-800 hover:underline whitespace-nowrap">
                    ➕ Criar despesa manual
                  </button>
                )}
              </div>

              {showNewExpense && (
                <div className="border border-emerald-300 bg-emerald-50/70 rounded-lg p-3 mb-3 space-y-2.5">
                  <p className="text-xs font-medium text-emerald-800">
                    Nova despesa — para compras sem fatura nem documento
                  </p>

                  <div>
                    <label className="label text-xs">Descrição *</label>
                    <input className="input text-sm" value={newExpense.description}
                      onChange={e => setNewExpense(f => ({ ...f, description: e.target.value }))}
                      placeholder="ex: Portagem Ponte Vasco da Gama" />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="label text-xs">Data</label>
                      <input className="input text-sm" type="date" value={newExpense.expense_date}
                        onChange={e => setNewExpense(f => ({ ...f, expense_date: e.target.value }))} />
                    </div>
                    <div>
                      <label className="label text-xs">Valor (€) *</label>
                      <input className="input text-sm" type="number" step="0.01" value={newExpense.amount}
                        onChange={e => setNewExpense(f => ({ ...f, amount: e.target.value }))} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="label text-xs">Categoria</label>
                      <select className="input text-sm" value={newExpense.category}
                        onChange={e => setNewExpense(f => ({ ...f, category: e.target.value }))}>
                        {EXPENSE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label text-xs">Fornecedor</label>
                      <input className="input text-sm" value={newExpense.supplier}
                        onChange={e => setNewExpense(f => ({ ...f, supplier: e.target.value }))}
                        placeholder="opcional" />
                    </div>
                  </div>

                  <div>
                    <label className="label text-xs">Notas</label>
                    <input className="input text-sm" value={newExpense.notes}
                      onChange={e => setNewExpense(f => ({ ...f, notes: e.target.value }))}
                      placeholder="opcional" />
                  </div>

                  <p className="text-xs text-gray-500">
                    Fica registada como paga por banco, por isso não mexe no fundo de maneio.
                  </p>

                  {newExpenseError && (
                    <p className="text-xs text-red-600 bg-red-100 px-2.5 py-1.5 rounded-md">{newExpenseError}</p>
                  )}

                  <div className="flex gap-2">
                    <button type="button" className="btn-secondary flex-1 justify-center text-sm py-1.5"
                      onClick={() => { setShowNewExpense(false); setNewExpenseError('') }}>
                      Cancelar
                    </button>
                    <button type="button" onClick={handleCreateExpense} disabled={savingNewExpense}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50 transition-colors">
                      {savingNewExpense ? 'A guardar...' : 'Criar e selecionar'}
                    </button>
                  </div>
                </div>
              )}

              <p className="text-xs text-gray-500 mb-1.5">
                {expenseScope === 'valor'
                  ? <>A mostrar só despesas de <strong className="text-gray-700">{formatCurrency(txAmountAbs)}</strong>. Não encontra? Alargue a procura:</>
                  : <>A mostrar despesas dos últimos {expenseScope} dias, com qualquer valor:</>}
              </p>
              <ScopePicker value={expenseScope} onChange={setExpenseScope} />
              {expenseScope === 'valor' && expensesNearby > 0 && (
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
                  <div className="text-center py-4 px-3">
                    <p className="text-sm text-gray-400">
                      {expenseScope === 'valor'
                        ? `Nenhuma despesa de ${formatCurrency(txAmountAbs)}. Carregue em 30/60/90 dias para ver as outras.`
                        : 'Nenhuma despesa encontrada'}
                    </p>
                    {!showNewExpense && (
                      <button type="button" onClick={() => { setShowNewExpense(true); setNewExpenseError('') }}
                        className="mt-2 text-xs font-medium text-emerald-700 hover:underline">
                        ➕ Não há documento desta compra? Criar despesa manual
                      </button>
                    )}
                  </div>
                ) : (
                  filteredExpenses.slice(0, 200).map(e => {
                    const diffDays = Math.round(Math.abs(new Date(e.expense_date).getTime() - txDate.getTime()) / (1000 * 60 * 60 * 24))
                    const isNearby = diffDays <= 15
                    const jaUsada = despesaJaUsada(e)
                    return (
                      <div key={e.id} onClick={() => setExpenseId(e.id)}
                        className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors ${
                          expenseId === e.id ? 'bg-emerald-50 border-l-4 border-l-emerald-500' : jaUsada ? 'bg-gray-100' : ''
                        }`}>
                        <span className={`text-xs whitespace-nowrap flex-shrink-0 w-20 ${jaUsada ? 'text-gray-400' : 'text-gray-400'}`}>{formatDate(e.expense_date)}</span>
                        <span className={`text-sm font-semibold whitespace-nowrap flex-shrink-0 w-20 ${jaUsada ? 'text-gray-400' : 'text-red-600'}`}>{formatCurrency(e.amount)}</span>
                        <span className={`text-xs truncate flex-1 ${jaUsada ? 'text-gray-400' : 'text-gray-700'}`}>{e.description}</span>
                        {jaUsada && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-500 flex-shrink-0 font-medium whitespace-nowrap" title="Esta despesa já está associada a outra transação bancária">
                            já usada
                          </span>
                        )}
                        {isNearby && !jaUsada && (
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
                <p className="text-xs text-gray-400 mt-1">
                  A mostrar {filteredExpenses.length} despesa(s)
                  {expenseScope === 'valor' ? ` com o valor de ${formatCurrency(txAmountAbs)}` : ''} — ordenadas por proximidade de data
                </p>
              )}
            </div>
          )}

          {type !== 'renda' && (
            <div className="mt-3">
              <label className="label">Fatura associada (opcional)</label>
              <p className="text-xs text-gray-500 mb-1.5">
                {docScope === 'valor'
                  ? <>A mostrar só faturas de <strong className="text-gray-700">{formatCurrency(txAmountAbs)}</strong>. Não encontra? Alargue a procura:</>
                  : <>A mostrar faturas dos últimos {docScope} dias, com qualquer valor:</>}
              </p>
              <ScopePicker value={docScope} onChange={setDocScope} />
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
                {filteredDocuments.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-3">
                    {docScope === 'valor'
                      ? `Nenhuma fatura de ${formatCurrency(txAmountAbs)}. Carregue em 30/60/90 dias para ver as outras.`
                      : 'Nenhuma fatura encontrada'}
                  </p>
                )}
                {filteredDocuments
                  .slice(0, 50)
                  .map(d => {
                    const jaUsada = usedDocumentIds.has(d.id)
                    return (
                      <div key={d.id} onClick={() => setDocumentId(d.id)}
                        className={`flex items-center gap-3 px-3 py-2 cursor-pointer border-b border-gray-50 hover:bg-gray-50 ${
                          documentId === d.id ? 'bg-emerald-50 border-l-4 border-l-emerald-500' : jaUsada ? 'bg-gray-100' : ''
                        }`}>
                        <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0 w-20">{d.doc_date ? formatDate(d.doc_date) : '—'}</span>
                        <span className={`text-sm font-semibold whitespace-nowrap flex-shrink-0 w-20 ${jaUsada ? 'text-gray-400' : 'text-red-600'}`}>{d.amount ? formatCurrency(d.amount) : '—'}</span>
                        <span className={`text-xs truncate flex-1 ${jaUsada ? 'text-gray-400' : 'text-gray-700'}`}>{d.supplier_name ?? d.original_name ?? '—'}</span>
                        {jaUsada && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-500 flex-shrink-0 font-medium whitespace-nowrap" title="Esta fatura já está associada a outra transação bancária">
                            já usada
                          </span>
                        )}
                        {documentId === d.id && <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                      </div>
                    )
                  })}
              </div>
              {filteredDocuments.length > 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  {filteredDocuments.length > 50
                    ? `A mostrar 50 de ${filteredDocuments.length} fatura(s) — pesquisa para filtrar`
                    : `A mostrar ${filteredDocuments.length} fatura(s)${docScope === 'valor' ? ` com o valor de ${formatCurrency(txAmountAbs)}` : ''}`}
                </p>
              )}
            </div>
          )}

          {/* Transferência interna: fechar a ponta que saiu do fundo de maneio */}
          {type === 'transferencia_interna' && (
            <div>
              <label className="label">Transferência do fundo de maneio</label>
              {cashTransfers.length === 0 ? (
                <p className="text-sm text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
                  Não há transferências de caixa por confirmar. Podes guardar na mesma —
                  serve para movimentos entre contas próprias.
                </p>
              ) : (
                <>
                  <select className="input" value={cashMovementId} onChange={e => setCashMovementId(e.target.value)}>
                    <option value="">— Nenhuma —</option>
                    {cashTransfers.map(m => (
                      <option key={m.id} value={m.id}>
                        {formatDate(m.movement_date)} · {m.description} · {formatCurrency(Math.abs(m.amount))}
                      </option>
                    ))}
                  </select>
                  {cashMovementId ? (
                    <p className="text-xs text-emerald-600 mt-1">
                      Ao guardar, esta transferência deixa de estar pendente — o dinheiro passa a estar
                      confirmado como tendo saído da caixa e entrado no banco.
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400 mt-1">
                      Escolhe a transferência correspondente para fechar as duas pontas.
                    </p>
                  )}
                </>
              )}
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

        <div className="border-t border-gray-100 pt-4 mt-4 space-y-3">
          {/* Movimentos antigos: identificar sem mexer nas contas correntes */}
          <label className={`flex items-start gap-2 cursor-pointer rounded-lg px-3 py-2 border transition-colors ${
            skipProcessing ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-100'
          }`}>
            <input type="checkbox" className="rounded mt-0.5" checked={skipProcessing}
              onChange={e => setSkipProcessing(e.target.checked)} />
            <span className="text-xs">
              <span className={`font-medium ${skipProcessing ? 'text-amber-800' : 'text-gray-700'}`}>
                📁 Histórico — não processar
              </span>
              <span className="block text-gray-500 mt-0.5">
                Identifica a transação mas não cria pagamentos nem despesas, agora nem no futuro.
                Fica de fora dos botões de sincronização. Para movimentos antigos já tratados.
              </span>
            </span>
          </label>

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

            // Marcada como histórico: não cria nada, só identifica.
            let finalIncomeId = incomeId
            if (type === 'receita_extraordinaria' && !incomeId && !skipProcessing) {
              setCreatingIncome(true)
              const categoria = normalizeCategory(incomeCategoryInput) || 'outros'
              const { data: novaReceita } = await supabase.from('income_records').insert({
                description: notes.trim() || tx.description,
                amount: Math.abs(tx.amount),
                income_date: tx.transaction_date,
                category: categoria,
                notes: `Criada a partir do movimento bancário de ${formatDate(tx.transaction_date)}`,
              }).select().single()
              setCreatingIncome(false)
              if (novaReceita) finalIncomeId = novaReceita.id
            }

            onSave(
              tx, type, tenantId, expenseId, notes,
              documentId || undefined,
              type === 'renda' ? referenceMonth : undefined,
              type === 'receita_extraordinaria' ? (finalIncomeId || undefined) : undefined,
              skipProcessing,
              type === 'transferencia_interna' ? (cashMovementId || undefined) : undefined,
              type === 'renda' ? destino : undefined,
            )
          }}>{creatingIncome ? 'A guardar...' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  )
}
