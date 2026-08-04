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
import { formatCurrency, formatDate } from '@/lib/utils'
import { Search, X, Sparkles, FileText, CheckCircle } from 'lucide-react'
import { mergeCategories, normalizeCategory } from '@/lib/incomeCategories'

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
  onSave: (tx: BankTransaction, type: string, tenantId: string, expenseId: string, notes: string, documentId?: string, referenceMonth?: string, incomeId?: string, skipProcessing?: boolean, cashMovementId?: string) => void
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
  const supabase = createClient()

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
            )
          }}>{creatingIncome ? 'A guardar...' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  )
}
