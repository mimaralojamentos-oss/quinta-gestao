// Caução em falta.
//
// Um contrato pode ter uma caução definida (leases.deposit) sem que exista
// nenhum registo do pagamento correspondente em rent_payments (tipo
// 'caucao'). Esta função calcula quanto falta, comparando o valor do
// contrato com a soma do que já foi registado.
//
// Só se aplica a contratos com início a partir de DEPOSIT_TRACKING_START_DATE
// (inclusive). Contratos mais antigos podem já ter tido a caução paga fora da
// app, antes de existirem registos de pagamento do tipo 'caucao' — aplicar a
// todos encheria a app de dívidas falsas para contratos que já estão em dia.
export const DEPOSIT_TRACKING_START_DATE = '2026-09-01'

export interface DepositLeaseLike {
  id: string
  deposit?: number | null
  start_date?: string | null
}

export interface DepositPaymentLike {
  lease_id?: string | null
  tipo?: string | null
  amount?: number | null
}

export function getDepositShortfall(lease: DepositLeaseLike, payments: DepositPaymentLike[]): number {
  if (!lease.deposit || lease.deposit <= 0) return 0
  if (!lease.start_date || lease.start_date < DEPOSIT_TRACKING_START_DATE) return 0

  const pago = payments
    .filter(p => p.lease_id === lease.id && p.tipo === 'caucao')
    .reduce((s, p) => s + (p.amount ?? 0), 0)

  return Math.max(0, parseFloat((lease.deposit - pago).toFixed(2)))
}
