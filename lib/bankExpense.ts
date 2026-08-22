// Criação automática de despesas a partir de movimentos bancários.
//
// Objetivo: garantir que cada débito bancário classificado como "despesa" tem
// exatamente UMA despesa correspondente, sem risco de duplicação manual.
//
// Regras (decididas com o Miguel):
//  1. A despesa é criada/ligada no momento em que a transação é validada.
//  2. Tipos que NÃO são despesa real nunca criam despesa:
//     custos_bancarios, impostos, transferencia_interna, receita_extraordinaria, renda, outro.
//  3. Quando existe fatura (documento) associada, os dados da fatura mandam
//     (valor, data, fornecedor, categoria). O banco serve para confirmar o pagamento.
//
// A proteção final contra duplicados está na base de dados:
// expenses.bank_transaction_id é UNIQUE, por isso mesmo que dois cliques
// aconteçam ao mesmo tempo só uma despesa sobrevive.

export interface BankTxLike {
  id: string
  transaction_date: string
  description: string
  amount: number
  confirmed_type: string | null
  confirmed_expense_id: string | null
  confirmed_document_id: string | null
  /** Marcada como histórico: identificada, mas fora de qualquer automatismo. */
  skip_processing?: boolean | null
  notes: string | null
}

export type BankExpenseOutcome =
  | 'created'          // criou uma despesa nova
  | 'linked_existing'  // encontrou despesa já existente e ligou-a
  | 'already_linked'   // esta transação já tinha despesa ligada
  | 'not_expense'      // tipo não gera despesa (comissões, impostos, renda...)
  | 'error'

export interface BankExpenseResult {
  outcome: BankExpenseOutcome
  expenseId: string | null
  message: string
}

// Tipos de movimento que representam saídas de dinheiro mas NÃO são despesas
// a registar (evita poluir as despesas com comissões, selos e transferências
// entre contas próprias).
const NON_EXPENSE_TYPES = new Set([
  'custos_bancarios',
  'impostos',
  'transferencia_interna',
  'receita_extraordinaria',
  'renda',
  'outro',
])

import { CASH_FUND_START_DATE } from './cashFundConfig'
import { createExpense } from './createExpense'

function toISODate(value: string): string {
  return value.slice(0, 10)
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

// Descrição legível a partir da linha do extrato, para quando não há fatura.
function describeFromBank(description: string): string {
  const clean = description.replace(/\s+/g, ' ').trim()
  return clean.length > 120 ? `${clean.slice(0, 117)}...` : clean
}

/**
 * Garante que existe uma despesa para esta transação bancária.
 *
 * Ordem de preferência (da mais fiável para a menos fiável):
 *   1. A transação já tem confirmed_expense_id → nada a fazer.
 *   2. Já existe despesa com este bank_transaction_id → liga e termina.
 *   3. O documento associado já tem expense_id → liga essa despesa.
 *   4. Existe despesa órfã com o mesmo valor e data próxima (±15 dias) → liga.
 *   5. Cria despesa nova (dados da fatura se existir, senão do banco).
 */
export async function ensureExpenseForTransaction(
  supabase: any,
  tx: BankTxLike,
  options: { documentId?: string | null } = {},
): Promise<BankExpenseResult> {
  try {
    const type = tx.confirmed_type

    // Última linha de defesa: movimentos marcados como histórico nunca geram
    // despesa, venha o pedido de onde vier. Está aqui — e não só nas páginas —
    // para que qualquer código futuro que chame esta função fique coberto.
    if (tx.skip_processing) {
      return { outcome: 'not_expense', expenseId: null, message: 'Movimento marcado como histórico' }
    }

    // Só débitos classificados como despesa entram aqui.
    if (!type || NON_EXPENSE_TYPES.has(type)) {
      return { outcome: 'not_expense', expenseId: null, message: 'Tipo de movimento não gera despesa' }
    }
    if (type !== 'despesa') {
      return { outcome: 'not_expense', expenseId: null, message: 'Tipo de movimento não gera despesa' }
    }
    if (tx.amount >= 0) {
      return { outcome: 'not_expense', expenseId: null, message: 'Só saídas de dinheiro geram despesa' }
    }

    const amount = parseFloat(Math.abs(tx.amount).toFixed(2))
    const txDate = toISODate(tx.transaction_date)
    const documentId = options.documentId ?? tx.confirmed_document_id ?? null

    // (1) Já ligada nesta transação. Carimbamos também a ligação inversa
    //     (expenses.bank_transaction_id) para que esta despesa deixe de ser
    //     candidata a ser "adotada" por outro movimento no futuro.
    if (tx.confirmed_expense_id) {
      const { data: linked } = await supabase
        .from('expenses')
        .select('id, bank_transaction_id')
        .eq('id', tx.confirmed_expense_id)
        .maybeSingle()
      if (linked && !linked.bank_transaction_id) {
        await supabase.from('expenses')
          .update({ bank_transaction_id: tx.id })
          .eq('id', tx.confirmed_expense_id)
      }
      return { outcome: 'already_linked', expenseId: tx.confirmed_expense_id, message: 'Esta transação já tem despesa associada' }
    }

    // (2) Já existe despesa criada a partir desta mesma transação
    //     (protege contra duplo clique ou reprocessamento)
    const { data: alreadyFromTx } = await supabase
      .from('expenses')
      .select('id')
      .eq('bank_transaction_id', tx.id)
      .maybeSingle()

    if (alreadyFromTx) {
      await supabase.from('bank_transactions')
        .update({ confirmed_expense_id: alreadyFromTx.id })
        .eq('id', tx.id)
      return { outcome: 'already_linked', expenseId: alreadyFromTx.id, message: 'Despesa já existia para este movimento' }
    }

    // Carregar a fatura associada, se houver — os seus dados têm prioridade.
    let doc: any = null
    if (documentId) {
      const { data } = await supabase
        .from('documents')
        .select('id, expense_id, amount, doc_date, doc_number, supplier_name, items_summary, category, original_name')
        .eq('id', documentId)
        .maybeSingle()
      doc = data ?? null
    }

    // (3) A fatura já gerou despesa no upload → reutilizar, nunca criar outra.
    if (doc?.expense_id) {
      await supabase.from('expenses')
        .update({ bank_transaction_id: tx.id, payment_method: 'banco' })
        .eq('id', doc.expense_id)
      await supabase.from('bank_transactions')
        .update({ confirmed_expense_id: doc.expense_id })
        .eq('id', tx.id)
      return { outcome: 'linked_existing', expenseId: doc.expense_id, message: 'Ligada à despesa que já existia da fatura' }
    }

    // (4) Despesa órfã com o mesmo valor e data próxima — provavelmente
    //     lançada à mão ou criada por um documento sem ligação ao banco.
    const { data: orphanCandidates } = await supabase
      .from('expenses')
      .select('id, expense_date, amount, description')
      .eq('amount', amount)
      .is('bank_transaction_id', null)
      .gte('expense_date', addDays(txDate, -15))
      .lte('expense_date', addDays(txDate, 15))
      .order('expense_date', { ascending: true })
      .limit(1)

    const orphan = orphanCandidates?.[0]
    if (orphan) {
      await supabase.from('expenses')
        .update({ bank_transaction_id: tx.id, payment_method: 'banco' })
        .eq('id', orphan.id)
      await supabase.from('bank_transactions')
        .update({ confirmed_expense_id: orphan.id })
        .eq('id', tx.id)
      if (doc && !doc.expense_id) {
        await supabase.from('documents').update({ expense_id: orphan.id }).eq('id', doc.id)
      }
      return { outcome: 'linked_existing', expenseId: orphan.id, message: 'Ligada a uma despesa que já existia com o mesmo valor e data' }
    }

    // (5) Criar despesa nova. A fatura manda no valor/data quando existe.
    const expenseDate = doc?.doc_date ?? txDate
    const expenseAmount = doc?.amount != null ? parseFloat(Number(doc.amount).toFixed(2)) : amount
    const description = doc?.items_summary ?? doc?.supplier_name ?? describeFromBank(tx.description)
    const supplier = doc?.supplier_name ?? null
    const category = doc?.category ?? 'outros'

    const notesParts = [`Criado automaticamente a partir do movimento bancário de ${txDate}`]
    if (doc?.doc_number) notesParts.push(`Documento nº ${doc.doc_number}`)

    const { expense: newExpense, error: insertErrMsg, errorCode } = await createExpense(supabase, {
      expense_date: expenseDate,
      category,
      type: 'pontual',
      description,
      amount: expenseAmount,
      payment_method: 'banco',
      supplier,
      bank_transaction_id: tx.id,
      notes: notesParts.join(' · '),
      documentId: doc && !doc.expense_id ? doc.id : null,
    })

    // Se falhou por violação do UNIQUE, outra execução criou-a entretanto:
    // procura-a e liga, em vez de duplicar.
    if (!newExpense) {
      if (errorCode === '23505') {
        const { data: raced } = await supabase
          .from('expenses').select('id').eq('bank_transaction_id', tx.id).maybeSingle()
        if (raced) {
          await supabase.from('bank_transactions')
            .update({ confirmed_expense_id: raced.id }).eq('id', tx.id)
          return { outcome: 'already_linked', expenseId: raced.id, message: 'Despesa já tinha sido criada para este movimento' }
        }
      }
      return { outcome: 'error', expenseId: null, message: insertErrMsg ?? 'Erro desconhecido' }
    }

    await supabase.from('bank_transactions')
      .update({ confirmed_expense_id: newExpense.id })
      .eq('id', tx.id)

    return { outcome: 'created', expenseId: newExpense.id, message: 'Despesa criada automaticamente' }
  } catch (e: any) {
    console.error('ensureExpenseForTransaction falhou:', e)
    return { outcome: 'error', expenseId: null, message: e?.message ?? 'Erro desconhecido' }
  }
}

export interface BankExpenseSummary {
  created: number
  linked: number
  alreadyLinked: number
  errors: number
}

export function emptySummary(): BankExpenseSummary {
  return { created: 0, linked: 0, alreadyLinked: 0, errors: 0 }
}

export function addToSummary(summary: BankExpenseSummary, result: BankExpenseResult): BankExpenseSummary {
  if (result.outcome === 'created') summary.created++
  else if (result.outcome === 'linked_existing') summary.linked++
  else if (result.outcome === 'already_linked') summary.alreadyLinked++
  else if (result.outcome === 'error') summary.errors++
  return summary
}

export function describeSummary(summary: BankExpenseSummary): string | null {
  const parts: string[] = []
  if (summary.created > 0) parts.push(`${summary.created} despesa(s) criada(s)`)
  if (summary.linked > 0) parts.push(`${summary.linked} ligada(s) a despesas existentes`)
  if (summary.alreadyLinked > 0) parts.push(`${summary.alreadyLinked} já estavam ligadas`)
  if (summary.errors > 0) parts.push(`${summary.errors} com erro`)
  return parts.length > 0 ? parts.join('\n') : null
}

export { CASH_FUND_START_DATE }
