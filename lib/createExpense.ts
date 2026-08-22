import { CASH_FUND_START_DATE } from './cashFundConfig'

// Mecânica única de criação de despesa, partilhada pelos vários sítios que
// criam despesas na app. Centraliza só o que é sempre igual: gravar a
// despesa, ligar ao documento oficial (documents.expense_id) e, quando é
// paga em dinheiro, criar o movimento de saída no Fundo de Maneio (sempre a
// apontar para a despesa, e só a partir de CASH_FUND_START_DATE).
//
// O que cada sítio já fazia de forma diferente (textos de notes/descrição,
// se há aviso de duplicado antes de criar, categoria por omissão, etc.)
// fica à responsabilidade de quem chama — esta função não decide isso.

export type ExpensePaymentMethod = 'dinheiro' | 'banco'

export interface CreateExpenseInput {
  expense_date: string
  category: string
  type: string
  description: string
  amount: number
  payment_method: ExpensePaymentMethod
  supplier?: string | null
  notes?: string | null
  project_id?: string | null
  bank_transaction_id?: string | null
  /** Documento a ligar via documents.expense_id (o link oficial), depois de criar. */
  documentId?: string | null
  /**
   * Descrição do movimento de caixa, quando payment_method é 'dinheiro'.
   * Por omissão usa "💸 {description} — {supplier}". Passa isto quando o
   * texto do sítio já é diferente (ex: o fornecedor já está incluído na
   * própria descrição, e repeti-lo ficaria redundante).
   */
  cashMovementDescription?: string
  /** Notas do movimento de caixa. Por omissão usa as mesmas notes da despesa. */
  cashMovementNotes?: string | null
  /**
   * Não criar o movimento de caixa automaticamente, mesmo que payment_method
   * seja 'dinheiro'. Usado só pelo Documento Manual, onde a criação do
   * movimento é controlada por uma checkbox à parte ("Adicionar ao Fundo de
   * Maneio"), independente do método de pagamento escolhido.
   */
  skipCashMovement?: boolean
}

export interface CreateExpenseResult {
  expense: { id: string; [key: string]: any } | null
  cashMovementCreated: boolean
  error?: string
  /** Código de erro do Postgres (ex: '23505' em violação de UNIQUE), para quem precisa de reagir a uma corrida. */
  errorCode?: string
}

export async function createExpense(supabase: any, input: CreateExpenseInput): Promise<CreateExpenseResult> {
  const { data: newExpense, error } = await supabase.from('expenses').insert({
    expense_date: input.expense_date,
    category: input.category,
    type: input.type,
    description: input.description,
    amount: input.amount,
    payment_method: input.payment_method,
    supplier: input.supplier ?? null,
    notes: input.notes ?? null,
    project_id: input.project_id ?? null,
    bank_transaction_id: input.bank_transaction_id ?? null,
  }).select().single()

  if (error || !newExpense) {
    return { expense: null, cashMovementCreated: false, error: error?.message, errorCode: error?.code }
  }

  if (input.documentId) {
    await supabase.from('documents').update({ expense_id: newExpense.id }).eq('id', input.documentId)
  }

  let cashMovementCreated = false
  if (!input.skipCashMovement && input.payment_method === 'dinheiro' && input.expense_date >= CASH_FUND_START_DATE) {
    const description = input.cashMovementDescription
      ?? `💸 ${input.description}${input.supplier ? ` — ${input.supplier}` : ''}`
    await supabase.from('cash_fund_movements').insert({
      movement_date: input.expense_date,
      description,
      amount: -Math.abs(input.amount),
      type: 'saida',
      source: 'despesa',
      source_id: newExpense.id,
      notes: input.cashMovementNotes !== undefined ? input.cashMovementNotes : (input.notes ?? null),
    })
    cashMovementCreated = true
  }

  return { expense: newExpense, cashMovementCreated }
}
