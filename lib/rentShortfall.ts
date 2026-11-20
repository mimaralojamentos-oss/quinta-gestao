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
  /**
   * A data em que o dinheiro entrou. Quem chama TEM de a ler da base: é por
   * ela que se sabe se uma renda foi mesmo paga (ver ehRendaSemData).
   */
  payment_date?: string | null
}

// --------------------------------------------- renda sem data de pagamento

/** Uma linha é de renda quando o tipo é 'renda' ou está por preencher. */
export function ehRenda(p: { tipo?: string | null }): boolean {
  return p?.tipo === 'renda' || !p?.tipo
}

/**
 * Uma renda registada SEM data de pagamento.
 *
 * REGRA ÚNICA, em toda a app: uma linha destas NÃO conta como paga — nem no
 * estado mês a mês, nem nos planos de distribuição, nem no motor de alocação,
 * nem nos totais recebidos, nem nas impressões. O mês a que ela se refere
 * fica em falta como qualquer outro, e é o MÊS que leva a dívida; a linha
 * solta nunca soma por cima (seria contar a mesma renda duas vezes). Na
 * conta corrente aparece assinalada, para o gestor lhe pôr a data ou a
 * apagar.
 *
 * Antes havia duas leituras ao mesmo tempo: o cartão "Em dívida" contava a
 * linha como dívida e a lista mês a mês contava-a como pagamento. Os dois
 * números divergiam exatamente pelo valor da linha, cada um a esconder do
 * outro onde estava o dinheiro.
 *
 * "Sem data" é a data ter sido LIDA e estar vazia (null ou ''). Uma linha
 * que nem traz o campo (undefined) não é dada como sem data: se uma consulta
 * se esquecer de pedir a coluna, o pior que acontece é ficar como estava —
 * e não uma app inteira a dizer que ninguém pagou nada.
 */
export function ehRendaSemData(p: { tipo?: string | null; payment_date?: string | null }): boolean {
  return ehRenda(p) && (p?.payment_date === null || p?.payment_date === '')
}

/** As rendas que contam como pagas: de renda, e com data de pagamento. */
export function rendasPagas<P extends { tipo?: string | null; payment_date?: string | null }>(
  payments: P[] | null | undefined,
): P[] {
  return (payments ?? []).filter(p => ehRenda(p) && !ehRendaSemData(p))
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
  // Uma renda sem data de pagamento não é um pagamento: fica de fora, e o
  // mês aparece em falta (ver ehRendaSemData).
  const monthPayments = payments.filter(p =>
    p.lease_id === lease.id &&
    p.reference_month?.slice(0, 7) === monthStr &&
    ehRenda(p) && !ehRendaSemData(p)
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

// ------------------------------------------------- renda mensal do inquilino

export interface RendaMensal {
  /** Soma das rendas dos contratos ATIVOS. */
  total: number
  /** Quantos contratos ativos entraram na soma. */
  contratos: number
  /** A divisão por espaço, quando há mais do que um (ex.: "P24S 175,00 € + A07-A 325,00 €"). */
  divisao: string
}

/**
 * A renda mensal que um inquilino paga, somando os contratos ativos.
 *
 * Só para orientação de quem está a ver a ficha — não entra em nenhuma
 * conta. Sem contrato ativo devolve contratos = 0, para o ecrã poder dizer
 * "sem contrato ativo" em vez de mostrar 0 €, que daria a ideia errada.
 * Um contrato ativo com renda 0 é diferente disso: aí há contrato, e o
 * valor a mostrar é mesmo 0 €.
 */
export function rendaMensalDoInquilino(
  leases: { status?: string | null; monthly_rent?: number | null; space?: { ref?: string | null } | null }[] | null | undefined,
  formatar: (v: number) => string = (v) => `${v.toFixed(2)} €`,
): RendaMensal {
  const ativos = (leases ?? []).filter(l => l?.status === 'ativo')
  return {
    total: parseFloat(ativos.reduce((s, l) => s + Number(l.monthly_rent ?? 0), 0).toFixed(2)),
    contratos: ativos.length,
    divisao: ativos
      .map(l => `${l.space?.ref ?? '—'} ${formatar(Number(l.monthly_rent ?? 0))}`)
      .join(' + '),
  }
}

// ------------------------------------------------------------ prevenção

/** A mensagem de quando se tenta gravar uma renda sem data de pagamento. */
export const ERRO_RENDA_SEM_DATA =
  'Uma renda tem de ter data de pagamento. Se ainda não foi paga, não a registes: ' +
  'a renda em falta já aparece sozinha na lista, mês a mês.'

/**
 * Uma renda nunca se grava sem data de pagamento — nem a criar, nem a editar.
 * Devolve a mensagem de erro, ou null se estiver tudo bem.
 *
 * É chamada em todos os caminhos que escrevem em rent_payments. A última
 * linha de defesa é a restrição rent_payments_renda_com_data, na própria
 * base de dados (supabase-renda-com-data.sql): mesmo que um ecrã novo se
 * esqueça desta função, o Postgres recusa.
 */
export function validarRendaComData(p: { tipo?: string | null; payment_date?: string | null }): string | null {
  if (!ehRenda(p)) return null
  return String(p?.payment_date ?? '').trim() ? null : ERRO_RENDA_SEM_DATA
}
