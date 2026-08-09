/**
 * Motor partilhado dos adiantamentos (crédito do inquilino).
 *
 * Um adiantamento é uma linha da tabela `rent_payments` com `tipo = 'adiantamento'`.
 * Antes, quando era gasto, só ficava marcado `used = true` — não ficava registado
 * A QUE é que tinha sido aplicado, e a aplicação assumia sempre "eletricidade".
 *
 * Agora cada adiantamento consumido "assina" o destino:
 *   applied_to_type      'renda' | 'eletricidade'
 *   applied_to_id        id da cobrança de eletricidade (quando aplicável)
 *   applied_to_lease_id  contrato da renda que foi paga
 *   applied_to_month     mês da renda que foi paga (1.º dia do mês)
 *   applied_at           quando foi aplicado
 *
 * Regra de troco (mantém o comportamento que já existia): se o adiantamento for
 * maior do que o valor necessário, a linha original fica com o valor consumido e
 * é criada uma linha nova com o restante, disponível para uso futuro.
 */

export type AdvanceTargetType = 'renda' | 'eletricidade'

export interface AdvanceTarget {
  type: AdvanceTargetType
  /** Id da cobrança de eletricidade. Pode ficar a null e ser preenchido depois. */
  chargeId?: string | null
  /** Contrato da renda paga (obrigatório quando type === 'renda'). */
  leaseId?: string | null
  /** Mês da renda paga, em 'AAAA-MM' ou 'AAAA-MM-DD'. */
  month?: string | null
}

export interface ConsumeAdvancesResult {
  /** Total efetivamente aplicado. */
  applied: number
  /** Ids das linhas de adiantamento que ficaram consumidas (para atualizar depois). */
  consumedIds: string[]
  error?: string
}

/** Normaliza 'AAAA-MM' ou 'AAAA-MM-DD' para o 1.º dia do mês. */
function toMonthStart(month?: string | null): string | null {
  if (!month) return null
  const m = String(month).slice(0, 7)
  return /^\d{4}-\d{2}$/.test(m) ? `${m}-01` : null
}

/**
 * Consome adiantamentos disponíveis de um contrato, até ao valor pedido,
 * e regista o destino em cada linha consumida.
 */
export async function consumeAdvances(
  supabase: any,
  params: { leaseId: string; amountNeeded: number; target: AdvanceTarget },
): Promise<ConsumeAdvancesResult> {
  const { leaseId, target } = params
  let remaining = parseFloat(Number(params.amountNeeded ?? 0).toFixed(2))
  if (!leaseId || remaining <= 0) return { applied: 0, consumedIds: [] }

  const { data: advances, error: fetchError } = await supabase
    .from('rent_payments')
    .select('id, lease_id, reference_month, amount, payment_date, payment_method, notes')
    .eq('lease_id', leaseId)
    .eq('tipo', 'adiantamento')
    .or('used.is.null,used.eq.false')
    .order('payment_date', { ascending: true })

  if (fetchError) return { applied: 0, consumedIds: [], error: fetchError.message }

  const stamp = {
    used: true,
    applied_to_type: target.type,
    applied_to_id: target.type === 'eletricidade' ? (target.chargeId ?? null) : null,
    applied_to_lease_id: target.type === 'renda' ? (target.leaseId ?? leaseId) : null,
    applied_to_month: target.type === 'renda' ? toMonthStart(target.month) : null,
    applied_at: new Date().toISOString(),
  }

  let applied = 0
  const consumedIds: string[] = []

  for (const adv of advances ?? []) {
    if (remaining <= 0.001) break

    if (adv.amount <= remaining + 0.001) {
      // O adiantamento cabe todo — consome a linha inteira.
      const { error } = await supabase.from('rent_payments').update(stamp).eq('id', adv.id)
      if (error) return { applied, consumedIds, error: error.message }
      applied = parseFloat((applied + adv.amount).toFixed(2))
      remaining = parseFloat((remaining - adv.amount).toFixed(2))
      consumedIds.push(adv.id)
    } else {
      // Só é preciso uma parte — a linha fica com o valor usado e o troco
      // passa para uma linha nova, ainda disponível.
      const troco = parseFloat((adv.amount - remaining).toFixed(2))
      const { error } = await supabase
        .from('rent_payments')
        .update({ ...stamp, amount: remaining })
        .eq('id', adv.id)
      if (error) return { applied, consumedIds, error: error.message }

      const { error: insertError } = await supabase.from('rent_payments').insert({
        lease_id: adv.lease_id,
        reference_month: adv.reference_month,
        amount: troco,
        payment_date: adv.payment_date,
        payment_method: adv.payment_method,
        tipo: 'adiantamento',
        notes: adv.notes,
        used: false,
      })
      if (insertError) return { applied, consumedIds, error: insertError.message }

      applied = parseFloat((applied + remaining).toFixed(2))
      consumedIds.push(adv.id)
      remaining = 0
    }
  }

  return { applied, consumedIds }
}

/**
 * Preenche o id da cobrança de eletricidade nas linhas já consumidas.
 * Usado quando a cobrança só é criada depois de os adiantamentos serem aplicados.
 */
export async function linkAdvancesToCharge(
  supabase: any,
  advanceIds: string[],
  chargeId: string,
): Promise<void> {
  if (advanceIds.length === 0 || !chargeId) return
  await supabase
    .from('rent_payments')
    .update({ applied_to_id: chargeId })
    .in('id', advanceIds)
}

/**
 * Devolve um adiantamento ao crédito disponível do inquilino.
 *
 * Serve para corrigir enganos: o valor volta a ficar por usar e a renda (ou
 * a fatura) a que tinha sido aplicado volta a mostrar o que falta.
 *
 * Não junta de novo o troco que tenha sido separado numa linha à parte —
 * ficam duas linhas de crédito em vez de uma, o que dá o mesmo total
 * disponível e mantém o histórico legível.
 */
export async function releaseAdvance(
  supabase: any,
  advanceId: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('rent_payments')
    .update({
      used: false,
      applied_to_type: null,
      applied_to_id: null,
      applied_to_lease_id: null,
      applied_to_month: null,
      applied_at: null,
    })
    .eq('id', advanceId)
    .eq('tipo', 'adiantamento')   // salvaguarda: nunca tocar noutro tipo de registo

  return error ? { error: error.message } : {}
}

/**
 * Constrói o mapa "contrato + mês → adiantamento já aplicado a essa renda".
 * Serve para os vários ecrãs contarem o crédito como pagamento do mês,
 * em vez de mostrarem a renda como parcialmente em falta.
 *
 * Recebe a lista de linhas de `rent_payments` (a query tem de trazer os campos
 * applied_to_type, applied_to_month e applied_to_lease_id).
 */
export function buildAppliedAdvanceMap(payments: any[] | null | undefined): Record<string, number> {
  const map: Record<string, number> = {}
  for (const p of payments ?? []) {
    if (p?.tipo !== 'adiantamento' || p?.applied_to_type !== 'renda' || !p?.applied_to_month) continue
    const key = `${p.applied_to_lease_id ?? p.lease_id}__${String(p.applied_to_month).slice(0, 7)}`
    map[key] = parseFloat(((map[key] ?? 0) + (p.amount ?? 0)).toFixed(2))
  }
  return map
}

/** Quanto crédito já foi aplicado à renda de um contrato num dado mês ('AAAA-MM'). */
export function appliedAdvanceFor(
  map: Record<string, number>,
  leaseId: string,
  month: string,
): number {
  return map[`${leaseId}__${String(month).slice(0, 7)}`] ?? 0
}

/** Texto a mostrar na linha de um adiantamento já consumido. */
export function describeAdvanceTarget(row: {
  applied_to_type?: string | null
  applied_to_month?: string | null
}): string {
  if (row.applied_to_type === 'renda' && row.applied_to_month) {
    return `✓ Aplicado à renda de ${String(row.applied_to_month).slice(0, 7)}`
  }
  if (row.applied_to_type === 'renda') return '✓ Aplicado a uma renda'
  if (row.applied_to_type === 'eletricidade') return '✓ Aplicado a uma fatura de eletricidade'
  return '✓ Aplicado'
}
