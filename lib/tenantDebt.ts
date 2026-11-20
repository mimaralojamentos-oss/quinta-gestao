/**
 * O total "Em dívida" da ficha do inquilino.
 *
 * Sai das MESMAS linhas que a conta corrente mostra: os meses em falta (que
 * vêm do getMonthlyRentStatus), a caução em falta, as dívidas manuais e as
 * cobranças de luz e água por pagar, menos o crédito de adiantamentos por
 * usar. É um cálculo só — o cartão é a soma da lista, não uma segunda conta
 * feita ao lado.
 *
 * A única linha sem data que NÃO entra é a renda registada sem data de
 * pagamento (`semDataDePagamento`): essa não é dívida por si — é um registo
 * por corrigir. A dívida desse mês já está na linha "em falta" do mês, e
 * somar as duas era contar a mesma renda duas vezes.
 */

export interface LinhaDaConta {
  payment_date?: string | null
  amount?: number | null
  remainingAmount?: number | null
  tipo?: string | null
  used?: boolean | null
  isManualDebt?: boolean
  isElecCharge?: boolean
  isWaterCharge?: boolean
  /** Renda lida da base com a data de pagamento vazia — por corrigir. */
  semDataDePagamento?: boolean
}

/** O crédito do inquilino: adiantamentos que ainda não foram usados. */
export function creditoPorUsar(linhas: LinhaDaConta[] | null | undefined): number {
  return (linhas ?? [])
    .filter(p => p.tipo === 'adiantamento' && !p.used)
    .reduce((s, p) => s + Number(p.amount ?? 0), 0)
}

/** Quanto uma linha pesa na dívida. Zero se não for dívida. */
export function pesoNaDivida(p: LinhaDaConta): number {
  // Com data, já foi pago (ou é uma dívida manual liquidada).
  if (p.payment_date) return 0
  // Renda sem data: registo por corrigir. A dívida está no mês em falta.
  if (p.semDataDePagamento) return 0
  if (p.isManualDebt) return Number(p.remainingAmount ?? 0)
  if (p.isElecCharge || p.isWaterCharge) return Number(p.remainingAmount ?? p.amount ?? 0)
  return Number(p.amount ?? 0)
}

/**
 * O número do cartão. Positivo = deve; negativo = tem crédito a favor.
 * Não arredonda, tal como a conta que substitui, para os valores de quem não
 * tem linhas sem data ficarem exatamente iguais ao que eram.
 */
export function totalEmDivida(linhas: LinhaDaConta[] | null | undefined): number {
  return (linhas ?? []).reduce((s, p) => s + pesoNaDivida(p), 0) - creditoPorUsar(linhas)
}
