import { formatCurrency } from './utils'

const MESES_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

function formatReferenceMonthPT(referenceMonth: string): string {
  const [year, month] = referenceMonth.split('-').map(Number)
  return `${MESES_PT[month - 1]} ${year}`
}

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

export interface RentPaymentPlan {
  monthlyRent: number
  rendaAmount: number
  rendaFullyPaid: boolean
  /** Quanto faltava da renda deste mês antes deste pagamento. */
  rendaOwedBefore: number
  /** Quanto continua por pagar da renda depois deste pagamento. */
  rendaRemainingAfter: number
  electricityCharges: ElectricityChargePlan[]
  electricityTotal: number
  debtPayments: DebtPaymentPlan[]
  adiantamento: number
  underpaymentDebt: number
  summary: string
}

interface BuildPlanParams {
  leaseId: string
  tenantId: string | null | undefined
  monthlyRent: number
  amount: number
  referenceMonth: string
  alreadyPaidRenda?: number
}

// Distribui um pagamento de renda por ordem de prioridade:
// 1. Renda do mês, 2. Eletricidade em dívida (mais antiga primeiro),
// 3. Dívidas abertas (mais antigas primeiro, pagamento parcial permitido), 4. Adiantamento.
// Se o valor pago for inferior à renda, regista a diferença como nova dívida.
export async function buildRentPaymentPlan(supabase: any, params: BuildPlanParams): Promise<RentPaymentPlan> {
  const { leaseId, tenantId, monthlyRent, amount, referenceMonth, alreadyPaidRenda = 0 } = params
  let remaining = parseFloat(amount.toFixed(2))
  const lines: string[] = []

  const remainingRent = Math.max(0, monthlyRent - alreadyPaidRenda)
  const rendaAmount = Math.min(remaining, remainingRent)
  remaining = parseFloat((remaining - rendaAmount).toFixed(2))
  const rendaFullyPaid = alreadyPaidRenda + rendaAmount >= monthlyRent
  lines.push(rendaFullyPaid
    ? `Renda: ${formatCurrency(rendaAmount)} ✅`
    : `Renda: ${formatCurrency(rendaAmount)} de ${formatCurrency(monthlyRent)} ⚠️`)

  const electricityCharges: ElectricityChargePlan[] = []
  let electricityTotal = 0
  if (remaining > 0) {
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
      // Antes só liquidava faturas que coubessem por inteiro e o resto ia
      // para adiantamento, ao contrário do registo manual de pagamentos.
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
  if (remaining > 0 && tenantId) {
    const { data: debtsData } = await supabase
      .from('debts')
      .select('id, original_amount, description, payments:debt_payments(amount)')
      .eq('tenant_id', tenantId)
      .order('reference_date', { ascending: true })

    for (const debt of debtsData ?? []) {
      if (remaining <= 0) break
      const paid = (debt.payments ?? []).reduce((s: number, p: any) => s + p.amount, 0)
      const remainingDebt = parseFloat((debt.original_amount - paid).toFixed(2))
      if (remainingDebt <= 0) continue
      const toApply = Math.min(remainingDebt, remaining)
      const remainingAfter = parseFloat((remainingDebt - toApply).toFixed(2))
      debtPayments.push({ debtId: debt.id, description: debt.description, amount: toApply, remainingBefore: remainingDebt, remainingAfter })
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
    lines.push(`Adiantamento: ${formatCurrency(adiantamento)}`)
  }

  return {
    monthlyRent, rendaAmount, rendaFullyPaid,
    rendaOwedBefore: parseFloat(remainingRent.toFixed(2)),
    rendaRemainingAfter: parseFloat(Math.max(0, remainingRent - rendaAmount).toFixed(2)),
    electricityCharges, electricityTotal,
    debtPayments, adiantamento, underpaymentDebt: 0,
    summary: lines.join(', '),
  }
}

interface ApplyPlanParams {
  leaseId: string
  tenantId: string | null | undefined
  referenceMonth: string
  paymentDate: string
  paymentMethod: string
  notes?: string | null
}

export interface ApplyPlanResult {
  rendaPayment: any
  adiantamentoPayment: any
}

// Executa as escritas correspondentes a um plano já confirmado pelo utilizador.
export async function applyRentPaymentPlan(supabase: any, plan: RentPaymentPlan, params: ApplyPlanParams): Promise<ApplyPlanResult> {
  const { leaseId, tenantId, referenceMonth, paymentDate, paymentMethod, notes } = params

  const { data: rendaPayment } = await supabase.from('rent_payments').insert({
    lease_id: leaseId,
    reference_month: referenceMonth,
    payment_date: paymentDate,
    amount: plan.rendaAmount,
    payment_method: paymentMethod,
    tipo: 'renda',
    notes: notes || null,
  }).select().single()

  for (const charge of plan.electricityCharges) {
    if (charge.isPartial) {
      // Parcial: acumula o que foi pago e a fatura continua em aberto.
      // Mesmo tratamento do registo manual de pagamentos.
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
  }

  for (const dp of plan.debtPayments) {
    await supabase.from('debt_payments').insert({
      debt_id: dp.debtId, payment_date: paymentDate, amount: dp.amount,
      payment_method: paymentMethod, notes: 'Aplicado automaticamente via processamento de pagamento',
    })
  }

  let adiantamentoPayment = null
  if (plan.adiantamento > 0) {
    const { data } = await supabase.from('rent_payments').insert({
      lease_id: leaseId,
      reference_month: referenceMonth,
      payment_date: paymentDate,
      amount: plan.adiantamento,
      payment_method: paymentMethod,
      tipo: 'adiantamento',
      used: false,
    }).select().single()
    adiantamentoPayment = data
  }

  return { rendaPayment, adiantamentoPayment }
}
