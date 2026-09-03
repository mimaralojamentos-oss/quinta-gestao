import { appliedAdvanceFor } from './advanceCredit'

// A partir desta data é que se verificam rendas em falta mês a mês. Antes
// disso não há cobrança retroativa.
export const RENT_SHORTFALL_START_DATE = '2026-05-01'

export interface RentHistoryEntry {
  lease_id: string
  effective_date: string
  monthly_rent: number
}

// Renda aplicável a um contrato num dado mês, considerando o histórico de
// atualizações (a renda de um mês antigo pode ser diferente da atual).
export function getRentForMonth(
  rentHistory: RentHistoryEntry[] | null | undefined,
  leaseId: string,
  monthStr: string,
  fallback: number,
): number {
  const aplicaveis = (rentHistory ?? [])
    .filter((h: any) => h.lease_id === leaseId && h.effective_date <= `${monthStr}-01`)
    .sort((a: any, b: any) => b.effective_date.localeCompare(a.effective_date))
  return aplicaveis[0]?.monthly_rent ?? fallback
}

export interface RentPaymentLike {
  lease_id?: string | null
  reference_month?: string | null
  tipo?: string | null
  amount?: number | null
}

export interface MonthlyRentStatus<P extends RentPaymentLike = RentPaymentLike> {
  monthStr: string
  rentForMonth: number
  monthPayments: P[]
  totalPaidThisMonth: number
  advanceThisMonth: number
  hasPayment: boolean
}

/**
 * Estado de um único mês (renda aplicável, pagamentos desse mês, crédito
 * aplicado) — usado tanto pelo ciclo de getMonthlyRentStatus como por quem
 * precisa de olhar só para um mês específico (ex.: motor de alocação de
 * pagamentos, no destino "Só renda").
 */
export function getSingleMonthRentStatus<P extends RentPaymentLike>(params: {
  lease: { id: string; monthly_rent: number }
  monthStr: string
  payments: P[]
  rentHistory?: RentHistoryEntry[] | null
  appliedAdvances: Record<string, number>
}): MonthlyRentStatus<P> {
  const { lease, monthStr, payments, rentHistory, appliedAdvances } = params
  const rentForMonth = getRentForMonth(rentHistory, lease.id, monthStr, lease.monthly_rent)
  const monthPayments = payments.filter(p =>
    p.lease_id === lease.id &&
    p.reference_month?.slice(0, 7) === monthStr &&
    (p.tipo === 'renda' || !p.tipo)
  )
  const totalPaidThisMonth = monthPayments.reduce((s, p) => s + (p.amount ?? 0), 0)
  const advanceThisMonth = appliedAdvanceFor(appliedAdvances, lease.id, monthStr)
  const hasPayment = monthPayments.length > 0 || advanceThisMonth > 0

  return { monthStr, rentForMonth, monthPayments, totalPaidThisMonth, advanceThisMonth, hasPayment }
}

/**
 * Percorre mês a mês, de RENT_SHORTFALL_START_DATE (ou do início do contrato,
 * o que for mais tarde) até ao mês atual OU ao fim do contrato — o que vier
 * primeiro —, e devolve os dados de cada mês para o contrato indicado. Cada
 * sítio que usa isto calcula o valor em falta à sua maneira — os
 * arredondamentos finais diferem ligeiramente entre sítios e não foram
 * unificados aqui, só a parte que era mesmo igual em todos.
 *
 * Regra do fim de contrato (end_date), sem pro-rata: um mês conta se o dia 1
 * desse mês for <= end_date. Sair a 31/08 → agosto é o último mês devido;
 * sair a 15/09 → setembro ainda conta por inteiro (não há divisão pelo
 * número de dias). Contratos sem end_date não são afetados por esta regra.
 */
export function getMonthlyRentStatus<P extends RentPaymentLike>(params: {
  lease: { id: string; start_date: string | null; end_date?: string | null; monthly_rent: number }
  payments: P[]
  rentHistory?: RentHistoryEntry[] | null
  appliedAdvances: Record<string, number>
}): MonthlyRentStatus<P>[] {
  const { lease, payments, rentHistory, appliedAdvances } = params
  if (!lease.start_date) return []

  const startCutoff = new Date(RENT_SHORTFALL_START_DATE)
  const contractStart = new Date(lease.start_date)
  contractStart.setDate(1)
  const start = contractStart > startCutoff ? contractStart : startCutoff
  const today = new Date()
  today.setDate(1)
  const end = lease.end_date ? new Date(lease.end_date) : null

  const result: MonthlyRentStatus<P>[] = []
  const cursor = new Date(start)
  while (cursor <= today && (!end || cursor <= end)) {
    const monthStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
    result.push(getSingleMonthRentStatus({ lease, monthStr, payments, rentHistory, appliedAdvances }))
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return result
}
