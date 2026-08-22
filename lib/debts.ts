// Quanto falta pagar de uma dívida manual. Antes estava reimplementado em
// 6 sítios (às vezes com uma função local chamada getRemainingDebt, às
// vezes só inline) — sempre a mesma conta: original menos o que já foi
// pago, nunca negativo.

export interface DebtPaymentLike {
  amount: number
  debt_id?: string
}

export interface DebtLike {
  id: string
  original_amount: number
  payments?: DebtPaymentLike[]
}

/**
 * Quanto falta pagar de uma dívida — nunca negativo.
 *
 * Se a dívida já vier com os pagamentos incluídos (`debt.payments`, como
 * num select com join), chama-se só com a dívida. Se os pagamentos vierem
 * numa lista à parte (não ligados por join), passa-se essa lista em
 * `allPayments` — filtra-se aqui por `debt_id`.
 */
export function getDebtRemaining(debt: DebtLike, allPayments?: DebtPaymentLike[]): number {
  const payments = allPayments ? allPayments.filter(p => p.debt_id === debt.id) : (debt.payments ?? [])
  const paid = payments.reduce((s, p) => s + p.amount, 0)
  return Math.max(0, debt.original_amount - paid)
}
