// Deteção de despesas por valor e data próxima — usado em dois cenários
// diferentes, que não devem ser confundidos:
//
//  1. findUnlinkedExpenseByAmount: reutilizar uma despesa órfã (sem documento
//     ligado) em vez de criar outra igual, quando a mesma fatura é processada
//     duas vezes. Usado pela importação automática de documentos.
//  2. findSimilarExpenses: avisar quem está a criar uma despesa à mão de que
//     já pode existir uma parecida — mesmo que essa já tenha documento
//     ligado. É só um aviso, nunca bloqueia.

export interface ExpenseCandidate {
  id: string
  expense_date: string
  description: string
  amount: number
}

function dateWindow(dateStr: string, windowDays: number): { from: string; to: string } {
  const from = new Date(dateStr); from.setDate(from.getDate() - windowDays)
  const to = new Date(dateStr); to.setDate(to.getDate() + windowDays)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

/**
 * Procura uma despesa com o mesmo valor, numa janela de dias à volta de uma
 * data, que ainda não esteja ligada a nenhum documento (via
 * documents.expense_id — o link oficial). Serve para a importação automática
 * reutilizar a despesa em vez de duplicar quando a mesma fatura é processada
 * mais que uma vez.
 */
export async function findUnlinkedExpenseByAmount(
  supabase: any,
  amount: number,
  dateStr: string,
  windowDays: number = 1,
): Promise<{ id: string } | null> {
  const { from, to } = dateWindow(dateStr, windowDays)

  const { data: candidates } = await supabase.from('expenses').select('id')
    .eq('amount', amount)
    .gte('expense_date', from)
    .lte('expense_date', to)

  if (!candidates || candidates.length === 0) return null

  const ids = candidates.map((c: any) => c.id)
  const { data: linkedDocs } = await supabase.from('documents').select('expense_id').in('expense_id', ids)
  const linkedIds = new Set((linkedDocs ?? []).map((d: any) => d.expense_id))

  return candidates.find((c: any) => !linkedIds.has(c.id)) ?? null
}

/**
 * Procura despesas parecidas (mesmo valor, data próxima) para mostrar como
 * aviso a quem está a criar uma despesa à mão — nunca bloqueia, só avisa.
 * Ao contrário de findUnlinkedExpenseByAmount, não filtra por já ter
 * documento ligado: o objetivo aqui é avisar de qualquer parecença, mesmo
 * que a despesa antiga já esteja associada a um documento.
 */
export async function findSimilarExpenses(
  supabase: any,
  amount: number,
  dateStr: string,
  windowDays: number = 3,
  excludeId?: string | null,
): Promise<ExpenseCandidate[]> {
  const { from, to } = dateWindow(dateStr, windowDays)

  let query = supabase.from('expenses').select('id, expense_date, description, amount')
    .eq('amount', amount)
    .gte('expense_date', from)
    .lte('expense_date', to)
  if (excludeId) query = query.neq('id', excludeId)

  const { data } = await query
  return data ?? []
}
