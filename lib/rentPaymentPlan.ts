import { formatCurrency, getMonthLabel, getCurrentMonth } from './utils'
import { getMonthlyRentStatus, getSingleMonthRentStatus } from './rentShortfall'
import { buildAppliedAdvanceMap, consumeAdvances } from './advanceCredit'
import { getDebtRemaining } from './debts'
import { getDepositShortfall } from './depositShortfall'
import { CASH_FUND_START_DATE } from './cashFundConfig'

export interface ElectricityChargePlan {
  id: string
  /** Valor a aplicar agora — pode ser inferior ao que falta (pagamento parcial). */
  amount: number
  chargeDate: string | null
  /** Valor total da fatura. */
  totalAmount: number
  /** Quanto já estava pago antes deste pagamento. */
  alreadyPaid: number
  /** Quanto continua por pagar depois de aplicar este valor. */
  remainingAfter: number
  /** true quando este pagamento não liquida a fatura por completo. */
  isPartial: boolean
}

export interface DebtPaymentPlan {
  debtId: string
  description: string
  amount: number
  remainingBefore: number
  remainingAfter: number
}

export interface RendaMonthPlan {
  /** 'AAAA-MM' */
  referenceMonth: string
  /** Renda aplicável a este mês (histórico de rendas incluído). */
  monthlyRent: number
  /** Quanto faltava deste mês antes deste pagamento (já descontando crédito formalmente aplicado antes). */
  owedBefore: number
  /** Crédito de adiantamento (já existente, ainda por usar) aplicado agora a este mês. */
  creditApplied: number
  /** Dinheiro novo (deste pagamento) aplicado a este mês. */
  amount: number
  fullyPaid: boolean
  remainingAfter: number
}

export interface CaucaoPlan {
  /** Quanto faltava da caução antes deste pagamento (lib/depositShortfall.ts). */
  owedBefore: number
  /** Dinheiro novo (deste pagamento) aplicado à caução. */
  amount: number
  fullyPaid: boolean
  remainingAfter: number
}

export interface RentPaymentPlan {
  /** Um item por mês tocado — pode ser vários, quando há atraso de mais de um mês. */
  rendaPayments: RendaMonthPlan[]
  /** Soma de rendaPayments[].amount — só dinheiro novo, sem contar crédito. */
  rendaTotal: number
  /** Soma de rendaPayments[].creditApplied — crédito de adiantamento consumido neste pagamento. */
  creditTotal: number
  /** null quando não há caução em falta (ou o contrato não é elegível — ver lib/depositShortfall.ts). */
  caucao: CaucaoPlan | null
  electricityCharges: ElectricityChargePlan[]
  electricityTotal: number
  debtPayments: DebtPaymentPlan[]
  debtTotal: number
  adiantamento: number
  summary: string
}

/**
 * Para onde vai o dinheiro recebido.
 *
 * 'auto' é a ordem habitual: primeiro a renda (todos os meses em falta, do
 * mais antigo ao mais recente), depois a caução em falta, depois a
 * eletricidade em atraso, depois as dívidas, e o que sobrar fica como
 * adiantamento.
 *
 * As outras servem para quando o inquilino diz expressamente ao que vem —
 * "isto é para a luz" — e não se quer que o valor seja absorvido pela renda.
 * Em "Só renda", ao contrário do automático, aplica-se só ao mês escolhido
 * por quem regista o pagamento (soRendaMonth) — mas a caução em falta, se
 * houver, continua a ser considerada, pela mesma razão de sempre andarem
 * juntas (ambas dependem só do contrato, não de um mês específico).
 */
export type DestinoPagamento = 'auto' | 'renda' | 'luz' | 'dividas'

export const DESTINOS: { valor: DestinoPagamento; label: string; descricao: string }[] = [
  { valor: 'auto', label: 'Automático', descricao: 'Renda, depois caução, depois luz, depois dívidas' },
  { valor: 'renda', label: 'Só renda', descricao: 'Renda e caução — o que sobrar fica como adiantamento' },
  { valor: 'luz', label: 'Só eletricidade', descricao: 'Não toca na renda nem na caução' },
  { valor: 'dividas', label: 'Só dívidas', descricao: 'Apenas dívidas em conta corrente' },
]

interface BuildPlanParams {
  leaseId: string
  tenantId: string | null | undefined
  amount: number
  /** Por omissão 'auto', que mantém o comportamento de sempre. */
  destino?: DestinoPagamento
  /** Só usado quando destino === 'renda': o mês específico a pagar ('AAAA-MM' ou 'AAAA-MM-DD'). Por omissão, o mês atual. */
  soRendaMonth?: string
}

/**
 * Distribui um pagamento por ordem de prioridade:
 *   1. Renda — no 'auto', todos os meses em falta, do mais antigo ao mais
 *      recente; no 'renda', só o mês escolhido (soRendaMonth). O crédito de
 *      adiantamento disponível é sempre aplicado primeiro, antes do dinheiro
 *      novo — por isso cada mês pode ficar liquidado com uma mistura dos
 *      dois.
 *   2. Caução em falta (lib/depositShortfall.ts — só contratos com início a
 *      partir de 2026-09-01). O crédito de adiantamento NÃO se aplica aqui,
 *      só à renda.
 *   3. Eletricidade em dívida (mais antiga primeiro).
 *   4. Dívidas abertas (mais antigas primeiro, pagamento parcial permitido).
 *   5. O que sobrar fica como adiantamento (crédito do inquilino).
 */
export async function buildRentPaymentPlan(supabase: any, params: BuildPlanParams): Promise<RentPaymentPlan> {
  const { leaseId, tenantId, amount, destino = 'auto' } = params
  let remaining = parseFloat(amount.toFixed(2))
  const lines: string[] = []

  const podeRenda = destino === 'auto' || destino === 'renda'
  const podeLuz = destino === 'auto' || destino === 'luz'
  const podeDividas = destino === 'auto' || destino === 'dividas'

  const rendaPayments: RendaMonthPlan[] = []
  let creditTotal = 0
  let caucao: CaucaoPlan | null = null

  if (podeRenda) {
    const { data: lease } = await supabase
      .from('leases').select('id, monthly_rent, deposit, start_date, end_date').eq('id', leaseId).single()

    if (lease) {
      const { data: allPayments } = await supabase
        .from('rent_payments').select('*').eq('lease_id', leaseId)
      const payments = allPayments ?? []

      const { data: rentHistoryData } = await supabase
        .from('lease_rent_history').select('lease_id, effective_date, monthly_rent').eq('lease_id', leaseId)

      const appliedAdvances = buildAppliedAdvanceMap(payments)

      let creditAvailable = payments
        .filter((p: any) => p.tipo === 'adiantamento' && !p.used)
        .reduce((s: number, p: any) => s + (p.amount ?? 0), 0)

      // No "Só renda", o mês escolhido também não pode ir além do fim do
      // contrato — um pagamento nunca pode ser distribuído para depois de o
      // inquilino sair (mesma regra do dia 1 <= end_date do getMonthlyRentStatus).
      const soRendaMonth = (params.soRendaMonth ?? getCurrentMonth()).slice(0, 7)
      const soRendaAlemDoFim = !!lease.end_date && `${soRendaMonth}-01` > lease.end_date
      const meses: string[] = destino === 'renda'
        ? (soRendaAlemDoFim ? [] : [soRendaMonth])
        : getMonthlyRentStatus({ lease, payments, rentHistory: rentHistoryData, appliedAdvances }).map(m => m.monthStr)

      for (const monthStr of meses) {
        // Fora do "Só renda", parar assim que não houver mais dinheiro nem crédito.
        if (destino !== 'renda' && remaining <= 0 && creditAvailable <= 0) break

        const status = getSingleMonthRentStatus({ lease, monthStr, payments, rentHistory: rentHistoryData, appliedAdvances })
        const owedBefore = parseFloat(Math.max(0, status.rentForMonth - status.totalPaidThisMonth - status.advanceThisMonth).toFixed(2))

        // No automático só interessam os meses onde falta mesmo alguma coisa.
        // No "Só renda" mostra-se sempre o mês escolhido, mesmo que já esteja em dia.
        if (destino !== 'renda' && owedBefore <= 0.01) continue

        const creditApplied = parseFloat(Math.min(creditAvailable, owedBefore).toFixed(2))
        creditAvailable = parseFloat((creditAvailable - creditApplied).toFixed(2))
        const owedAfterCredit = parseFloat((owedBefore - creditApplied).toFixed(2))

        const applyAmount = parseFloat(Math.max(0, Math.min(remaining, owedAfterCredit)).toFixed(2))
        remaining = parseFloat((remaining - applyAmount).toFixed(2))

        const remainingAfter = parseFloat((owedAfterCredit - applyAmount).toFixed(2))
        const fullyPaid = remainingAfter <= 0.01

        if (destino === 'renda' || creditApplied > 0 || applyAmount > 0) {
          rendaPayments.push({
            referenceMonth: monthStr,
            monthlyRent: status.rentForMonth,
            owedBefore,
            creditApplied,
            amount: applyAmount,
            fullyPaid,
            remainingAfter,
          })
          creditTotal = parseFloat((creditTotal + creditApplied).toFixed(2))
        }
      }

      // 2ª prioridade: caução em falta. O crédito de adiantamento não se
      // aplica aqui — é sempre só para a renda.
      const caucaoOwed = getDepositShortfall(lease, payments)
      if (caucaoOwed >= 0.01) {
        const aplicar = parseFloat(Math.max(0, Math.min(remaining, caucaoOwed)).toFixed(2))
        remaining = parseFloat((remaining - aplicar).toFixed(2))
        const remainingAfter = parseFloat((caucaoOwed - aplicar).toFixed(2))
        caucao = { owedBefore: caucaoOwed, amount: aplicar, fullyPaid: remainingAfter <= 0.01, remainingAfter }
      }
    }
  }

  const rendaTotal = parseFloat(rendaPayments.reduce((s, r) => s + r.amount, 0).toFixed(2))

  for (const rp of rendaPayments) {
    const mesLabel = getMonthLabel(rp.referenceMonth)
    const creditoTxt = rp.creditApplied > 0 ? ` (crédito ${formatCurrency(rp.creditApplied)} aplicado)` : ''
    lines.push(rp.fullyPaid
      ? `Renda ${mesLabel}: ${formatCurrency(rp.amount)}${creditoTxt} ✅`
      : `Renda ${mesLabel}: ${formatCurrency(rp.amount)}${creditoTxt} de ${formatCurrency(rp.monthlyRent)} ⚠️`)
  }
  if (podeRenda && rendaPayments.length === 0 && destino === 'auto') {
    lines.push('Renda: sem meses em falta')
  }
  if (creditTotal > 0) {
    lines.push(`Crédito usado: ${formatCurrency(creditTotal)}`)
  }
  if (caucao) {
    lines.push(caucao.fullyPaid
      ? `Caução: ${formatCurrency(caucao.amount)} ✅`
      : `Caução: ${formatCurrency(caucao.amount)} de ${formatCurrency(caucao.owedBefore)} ⚠️`)
  }

  const electricityCharges: ElectricityChargePlan[] = []
  let electricityTotal = 0
  if (podeLuz && remaining > 0) {
    const { data: charges } = await supabase
      .from('electricity_charges')
      .select('id, amount, amount_paid, charge_date')
      .eq('lease_id', leaseId)
      .eq('paid', false)
      .order('charge_date', { ascending: true })

    for (const charge of charges ?? []) {
      if (remaining <= 0) break

      const alreadyPaid = charge.amount_paid ?? 0
      const emFalta = parseFloat((charge.amount - alreadyPaid).toFixed(2))
      if (emFalta <= 0) continue

      // Aplica o que houver, mesmo que não chegue para liquidar a fatura.
      const aplicar = parseFloat(Math.min(emFalta, remaining).toFixed(2))
      const remainingAfter = parseFloat((emFalta - aplicar).toFixed(2))

      electricityCharges.push({
        id: charge.id,
        amount: aplicar,
        chargeDate: charge.charge_date,
        totalAmount: charge.amount,
        alreadyPaid,
        remainingAfter,
        isPartial: remainingAfter > 0,
      })

      electricityTotal = parseFloat((electricityTotal + aplicar).toFixed(2))
      remaining = parseFloat((remaining - aplicar).toFixed(2))
    }

    if (electricityTotal > 0) {
      const parciais = electricityCharges.filter(c => c.isPartial)
      lines.push(parciais.length > 0
        ? `Luz: ${formatCurrency(electricityTotal)} (parcial — falta ${formatCurrency(parciais.reduce((s, c) => s + c.remainingAfter, 0))})`
        : `Luz: ${formatCurrency(electricityTotal)} ✅`)
    }
  }

  const debtPayments: DebtPaymentPlan[] = []
  let debtTotal = 0
  if (podeDividas && remaining > 0 && tenantId) {
    const { data: debtsData } = await supabase
      .from('debts')
      .select('id, original_amount, description, payments:debt_payments(amount)')
      .eq('tenant_id', tenantId)
      .order('reference_date', { ascending: true })

    for (const debt of debtsData ?? []) {
      if (remaining <= 0) break
      const remainingDebt = getDebtRemaining(debt)
      if (remainingDebt <= 0) continue
      const toApply = parseFloat(Math.min(remainingDebt, remaining).toFixed(2))
      const remainingAfter = parseFloat((remainingDebt - toApply).toFixed(2))
      debtPayments.push({ debtId: debt.id, description: debt.description, amount: toApply, remainingBefore: remainingDebt, remainingAfter })
      debtTotal = parseFloat((debtTotal + toApply).toFixed(2))
      remaining = parseFloat((remaining - toApply).toFixed(2))
      if (remainingAfter <= 0) {
        lines.push(`Dívida: ${formatCurrency(toApply)} ✅`)
      } else {
        lines.push(`Dívida: ${formatCurrency(toApply)} de ${formatCurrency(remainingDebt)} pagos`)
        lines.push(`Dívida restante: ${formatCurrency(remainingAfter)}`)
      }
    }
  }

  let adiantamento = 0
  if (remaining > 0) {
    adiantamento = remaining
    // Com destino escolhido à mão, convém explicar porque é que sobrou:
    // não é um excedente, é o que não coube naquilo que foi mandado pagar.
    lines.push(destino === 'auto'
      ? `Adiantamento: ${formatCurrency(adiantamento)}`
      : `Sobra (fica como adiantamento): ${formatCurrency(adiantamento)}`)
  }

  return {
    rendaPayments, rendaTotal, creditTotal, caucao,
    electricityCharges, electricityTotal,
    debtPayments, debtTotal,
    adiantamento,
    summary: lines.join(', '),
  }
}

interface ApplyPlanParams {
  leaseId: string
  tenantId: string | null | undefined
  paymentDate: string
  paymentMethod: string
  notes?: string | null
  /** Para os textos dos movimentos de caixa (ex.: "🏠 Renda Julho 2026 — H35 (Samuel)"). */
  spaceRef?: string | null
  tenantName?: string | null
}

export interface ApplyPlanResult {
  /** Um por mês de renda efetivamente pago (dinheiro novo > 0). */
  rendaPayments: any[]
  adiantamentoPayment: any | null
  error?: string
}

// Executa as escritas correspondentes a um plano já confirmado pelo utilizador.
export async function applyRentPaymentPlan(supabase: any, plan: RentPaymentPlan, params: ApplyPlanParams): Promise<ApplyPlanResult> {
  const { leaseId, paymentDate, paymentMethod, notes, spaceRef, tenantName } = params
  const cashOk = paymentMethod === 'dinheiro' && paymentDate >= CASH_FUND_START_DATE
  const quemTexto = spaceRef ? `${spaceRef}${tenantName ? ` (${tenantName})` : ''}` : (tenantName ?? '')

  const rendaPayments: any[] = []

  for (const rp of plan.rendaPayments) {
    if (rp.creditApplied > 0) {
      const { error } = await consumeAdvances(supabase, {
        leaseId,
        amountNeeded: rp.creditApplied,
        target: { type: 'renda', leaseId, month: rp.referenceMonth },
      })
      if (error) return { rendaPayments, adiantamentoPayment: null, error: `Erro ao aplicar o crédito de adiantamento: ${error}` }
    }

    if (rp.amount <= 0) continue

    const { data: newPayment, error: insertErr } = await supabase.from('rent_payments').insert({
      lease_id: leaseId,
      reference_month: rp.referenceMonth + '-01',
      payment_date: paymentDate,
      amount: rp.amount,
      payment_method: paymentMethod,
      tipo: 'renda',
      notes: !rp.fullyPaid ? 'Pagamento parcial' : (notes || null),
    }).select().single()

    if (insertErr) return { rendaPayments, adiantamentoPayment: null, error: insertErr.message }
    rendaPayments.push(newPayment)

    if (cashOk && newPayment) {
      await supabase.from('cash_fund_movements').insert({
        movement_date: paymentDate,
        description: `🏠 Renda ${getMonthLabel(rp.referenceMonth)}${quemTexto ? ` — ${quemTexto}` : ''}`,
        amount: rp.amount,
        type: 'entrada',
        source: 'renda',
        source_id: newPayment.id,
      })
    }
  }

  if (plan.caucao && plan.caucao.amount > 0) {
    const { data: caucaoPayment, error: caucaoErr } = await supabase.from('rent_payments').insert({
      lease_id: leaseId,
      reference_month: paymentDate.slice(0, 7) + '-01',
      payment_date: paymentDate,
      amount: plan.caucao.amount,
      payment_method: paymentMethod,
      tipo: 'caucao',
      notes: !plan.caucao.fullyPaid ? 'Pagamento parcial' : (notes || null),
    }).select().single()

    if (caucaoErr) return { rendaPayments, adiantamentoPayment: null, error: caucaoErr.message }

    if (cashOk && caucaoPayment) {
      await supabase.from('cash_fund_movements').insert({
        movement_date: paymentDate,
        description: `🔒 Caução${quemTexto ? ` — ${quemTexto}` : ''}`,
        amount: plan.caucao.amount,
        type: 'entrada',
        source: 'renda',
        source_id: caucaoPayment.id,
      })
    }
  }

  for (const charge of plan.electricityCharges) {
    if (charge.isPartial) {
      // Parcial: acumula o que foi pago e a fatura continua em aberto.
      await supabase.from('electricity_charges').update({
        amount_paid: parseFloat((charge.alreadyPaid + charge.amount).toFixed(2)),
      }).eq('id', charge.id)
    } else {
      await supabase.from('electricity_charges').update({
        paid: true,
        amount_paid: charge.totalAmount,
        payment_date: paymentDate,
        payment_method: paymentMethod,
      }).eq('id', charge.id)
    }

    if (cashOk) {
      await supabase.from('cash_fund_movements').insert({
        movement_date: paymentDate,
        description: `⚡ Eletricidade ${charge.chargeDate?.slice(0, 7) ?? ''}${charge.isPartial ? ' (parcial)' : ''}${quemTexto ? ` — ${quemTexto}` : ''}`,
        amount: charge.amount,
        type: 'entrada',
        source: 'eletricidade',
        source_id: charge.id,
      })
    }
  }

  for (const dp of plan.debtPayments) {
    await supabase.from('debt_payments').insert({
      debt_id: dp.debtId, payment_date: paymentDate, amount: dp.amount,
      payment_method: paymentMethod, notes: 'Aplicado automaticamente via processamento de pagamento',
    })

    if (cashOk) {
      await supabase.from('cash_fund_movements').insert({
        movement_date: paymentDate,
        description: `⚠️ ${dp.description}${quemTexto ? ` — ${quemTexto}` : ''}`,
        amount: dp.amount,
        type: 'entrada',
        source: 'divida',
        source_id: dp.debtId,
      })
    }
  }

  let adiantamentoPayment = null
  if (plan.adiantamento > 0) {
    const { data } = await supabase.from('rent_payments').insert({
      lease_id: leaseId,
      reference_month: paymentDate.slice(0, 7) + '-01',
      payment_date: paymentDate,
      amount: plan.adiantamento,
      payment_method: paymentMethod,
      tipo: 'adiantamento',
      used: false,
      notes: 'Excedente (adiantamento)',
    }).select().single()
    adiantamentoPayment = data

    if (cashOk && data) {
      await supabase.from('cash_fund_movements').insert({
        movement_date: paymentDate,
        description: `💰 Adiantamento${quemTexto ? ` — ${quemTexto}` : ''}`,
        amount: plan.adiantamento,
        type: 'entrada',
        source: 'renda',
        source_id: data.id,
      })
    }
  }

  return { rendaPayments, adiantamentoPayment }
}
