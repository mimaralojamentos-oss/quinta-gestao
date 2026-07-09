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
  amount: number
  chargeDate: string | null
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
      .select('id, amount, charge_date')
      .eq('lease_id', leaseId)
      .eq('paid', false)
      .order('charge_date', { ascending: true })

    for (const charge of charges ?? []) {
      if (remaining <= 0) break
      if (charge.amount <= remaining) {
        electricityCharges.push({ id: charge.id, amount: charge.amount, chargeDate: charge.charge_date })
        electricityTotal = parseFloat((electricityTotal + charge.amount).toFixed(2))
        remaining = parseFloat((remaining - charge.amount).toFixed(2))
      }
    }
    if (electricityTotal > 0) lines.push(`Luz: ${formatCurrency(electricityTotal)} ✅`)
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
    await supabase.from('electricity_charges').update({
      paid: true, payment_date: paymentDate, payment_method: paymentMethod,
    }).eq('id', charge.id)
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
