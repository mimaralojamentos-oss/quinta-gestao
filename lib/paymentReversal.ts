import { formatCurrency, getMonthLabel } from './utils'
import { releaseAdvance } from './advanceCredit'

/**
 * Apagar um pagamento desfaz tudo o que o registo desse pagamento criou.
 *
 * Até aqui apagar era um DELETE seco na linha de rent_payments, e ficava
 * atrás:
 *   · o crédito de adiantamento que o registo consumiu continuava marcado
 *     como usado e preso ao mês que já ninguém pagava;
 *   · o adiantamento-irmão (o excedente criado pelo mesmo recebimento)
 *     sobrevivia, e o inquilino ficava com crédito a mais;
 *   · os movimentos do fundo de maneio ficavam órfãos — a coluna
 *     cash_fund_movements.source_id não tem chave estrangeira para
 *     rent_payments, por isso ninguém os apagava e o saldo do fundo inflava
 *     a cada apagar-e-registar.
 *
 * COMO SE SABE O QUE PERTENCE AO MESMO RECEBIMENTO
 * Os registos feitos de agora em diante levam um receipt_group_id: todas as
 * linhas nascidas do mesmo recebimento partilham-no, e cada adiantamento
 * consumido guarda em consumed_by_receipt_id o recebimento que o gastou.
 * Aí a ligação é exata.
 *
 * Nos registos antigos (sem grupo) usa-se a heurística do mesmo contrato,
 * mesma data e mesmo mês — e o diálogo diz claramente que foi por
 * aproximação, para quem confirma poder verificar.
 */

export interface PagamentoAReverter {
  id: string
  lease_id: string
  tipo: string | null
  amount: number
  payment_date: string | null
  reference_month: string | null
  used?: boolean | null
  receipt_group_id?: string | null
}

export interface LinhaSimples {
  id: string
  amount: number
}

export interface PlanoReversao {
  pagamento: PagamentoAReverter
  /** Adiantamentos a devolver ao crédito disponível. */
  creditosADevolver: LinhaSimples[]
  creditoTotal: number
  /** Adiantamentos criados pelo mesmo recebimento, ainda por usar: apagam-se. */
  irmaosAApagar: LinhaSimples[]
  /** Adiantamentos do mesmo recebimento já usados: ficam, com aviso. */
  irmaosUsadosQueFicam: LinhaSimples[]
  /** Movimentos do fundo de maneio a apagar. */
  movimentosAApagar: string[]
  movimentosTotal: number
  /** Outros meses de renda do mesmo recebimento (que NÃO são revertidos). */
  outrosMesesDoRecebimento: string[]
  /** true quando a ligação foi feita por aproximação, não por grupo. */
  porAproximacao: boolean
  avisos: string[]
}

/** O texto do diálogo de confirmação. */
export function textoConfirmacao(p: PlanoReversao): string {
  const tipoTxt = p.pagamento.tipo === 'adiantamento' ? 'o adiantamento' : 'o pagamento'
  const linhas = [`Vai apagar ${tipoTxt} de ${formatCurrency(p.pagamento.amount)}.`]

  const tambem: string[] = []
  if (p.creditoTotal > 0) {
    tambem.push(`devolver ${formatCurrency(p.creditoTotal)} ao crédito disponível`
      + (p.creditosADevolver.length > 1 ? ` (${p.creditosADevolver.length} linhas)` : ''))
  }
  for (const irmao of p.irmaosAApagar) {
    tambem.push(`apagar o adiantamento de ${formatCurrency(irmao.amount)} criado no mesmo recebimento`)
  }
  if (p.movimentosTotal > 0) {
    tambem.push(`apagar ${p.movimentosTotal} movimento(s) do Fundo de Maneio`)
  }

  if (tambem.length > 0) linhas.push('', 'Também vai:', ...tambem.map(t => `• ${t}`))
  else linhas.push('', 'Não há mais nada a desfazer: não usou crédito nem criou movimentos.')

  if (p.avisos.length > 0) linhas.push('', ...p.avisos.map(a => `⚠️ ${a}`))
  linhas.push('', 'Confirmas?')
  return linhas.join('\n')
}

/** As colunas de grupo existem na base? Só se pergunta uma vez. */
let grupoDisponivel: boolean | null = null

export async function receiptGroupsDisponiveis(supabase: any): Promise<boolean> {
  // Só o "sim" fica guardado: assim, uma sessão aberta no browser quando a
  // migração for aplicada passa a usar os grupos sem ser preciso recarregar.
  if (grupoDisponivel === true) return true
  const { error } = await supabase.from('rent_payments').select('receipt_group_id').limit(1)
  if (!error) grupoDisponivel = true
  return !error
}

/** Para os testes: volta a perguntar à base na próxima chamada. */
export function esquecerDeteccaoDeGrupos() { grupoDisponivel = null }

const mesDe = (d: string | null | undefined) => (d ? String(d).slice(0, 7) : null)

/**
 * O que é que apagar este pagamento vai desfazer. Só lê — não altera nada.
 */
export async function planearReversaoPagamento(
  supabase: any,
  pagamento: PagamentoAReverter,
): Promise<PlanoReversao> {
  const temGrupos = await receiptGroupsDisponiveis(supabase)
  const grupo = temGrupos ? (pagamento.receipt_group_id ?? null) : null
  const avisos: string[] = []

  const colunas = temGrupos
    ? 'id, lease_id, tipo, amount, payment_date, reference_month, used, applied_to_type, applied_to_lease_id, applied_to_month, receipt_group_id, consumed_by_receipt_id'
    : 'id, lease_id, tipo, amount, payment_date, reference_month, used, applied_to_type, applied_to_lease_id, applied_to_month'

  const { data: doContrato } = await supabase
    .from('rent_payments').select(colunas).eq('lease_id', pagamento.lease_id)
  const linhas: any[] = doContrato ?? []

  // ── 1. Crédito consumido por este pagamento ──
  let creditosADevolver: LinhaSimples[] = []
  let porAproximacao = false

  if (pagamento.tipo !== 'adiantamento') {
    if (grupo) {
      creditosADevolver = linhas
        .filter(l => l.tipo === 'adiantamento' && l.used && l.consumed_by_receipt_id === grupo)
        .map(l => ({ id: l.id, amount: Number(l.amount) }))
    } else {
      const mes = mesDe(pagamento.reference_month)
      creditosADevolver = linhas
        .filter(l => l.tipo === 'adiantamento' && l.used
          && l.applied_to_type === 'renda'
          && l.applied_to_lease_id === pagamento.lease_id
          && mesDe(l.applied_to_month) === mes)
        .map(l => ({ id: l.id, amount: Number(l.amount) }))

      if (creditosADevolver.length > 0) {
        porAproximacao = true
        // Se o mês tem mais do que um pagamento, o crédito pode ter sido
        // consumido pelo outro: quem confirma tem de olhar.
        const pagamentosDoMes = linhas.filter(l =>
          l.tipo !== 'adiantamento' && mesDe(l.reference_month) === mes).length
        avisos.push(pagamentosDoMes > 1
          ? `Este registo é antigo (sem grupo de recebimento) e o mês de ${getMonthLabel(String(mes))} tem ${pagamentosDoMes} pagamentos: confirma que o crédito a devolver pertence a este.`
          : 'Este registo é antigo (sem grupo de recebimento): a ligação ao crédito foi feita por aproximação (mesmo contrato e mesmo mês).')
      }
    }
  }

  // ── 2. Adiantamento-irmão criado pelo mesmo recebimento ──
  const irmaos: any[] = grupo
    ? linhas.filter(l => l.tipo === 'adiantamento' && l.id !== pagamento.id && l.receipt_group_id === grupo)
    : (pagamento.tipo === 'adiantamento' ? [] : linhas.filter(l =>
        l.tipo === 'adiantamento'
        && l.id !== pagamento.id
        && l.payment_date === pagamento.payment_date
        && mesDe(l.reference_month) === mesDe(pagamento.reference_month)
        // o crédito antigo que foi consumido não é irmão: esse devolve-se
        && !creditosADevolver.some(c => c.id === l.id)))

  const irmaosAApagar = irmaos.filter(l => !l.used).map(l => ({ id: l.id, amount: Number(l.amount) }))
  const irmaosUsadosQueFicam = irmaos.filter(l => l.used).map(l => ({ id: l.id, amount: Number(l.amount) }))

  if (!grupo && irmaosAApagar.length > 0) {
    porAproximacao = true
    avisos.push('O adiantamento a apagar foi identificado por aproximação (mesmo contrato, mesma data).')
  }
  for (const u of irmaosUsadosQueFicam) {
    avisos.push(`O adiantamento de ${formatCurrency(u.amount)} deste recebimento já foi usado entretanto — fica como está, não é apagado.`)
  }

  // ── 3. Movimentos do fundo de maneio ──
  const idsComMovimento = [pagamento.id, ...irmaosAApagar.map(i => i.id)]
  const { data: movimentos } = await supabase
    .from('cash_fund_movements').select('id, amount, source_id, source')
    .in('source_id', idsComMovimento)
  const movimentosAApagar = (movimentos ?? []).map((m: any) => m.id)

  // ── 4. Outros meses do mesmo recebimento ──
  const outrosMeses = (grupo
    ? linhas.filter(l => l.tipo !== 'adiantamento' && l.id !== pagamento.id && l.receipt_group_id === grupo)
    : linhas.filter(l => l.tipo !== 'adiantamento' && l.id !== pagamento.id
        && l.payment_date === pagamento.payment_date && pagamento.tipo !== 'adiantamento'))
    .map(l => getMonthLabel(String(mesDe(l.reference_month))))

  if (outrosMeses.length > 0) {
    avisos.push(`Este recebimento cobriu também ${outrosMeses.join(', ')} — essas linhas ficam como estão.`)
  }

  if (pagamento.tipo === 'adiantamento' && pagamento.used) {
    avisos.push('Este adiantamento já foi usado: ao apagá-lo, o que ele cobria volta a aparecer em falta.')
  }

  return {
    pagamento,
    creditosADevolver,
    creditoTotal: parseFloat(creditosADevolver.reduce((s, c) => s + c.amount, 0).toFixed(2)),
    irmaosAApagar,
    irmaosUsadosQueFicam,
    movimentosAApagar,
    movimentosTotal: movimentosAApagar.length,
    outrosMesesDoRecebimento: outrosMeses,
    porAproximacao,
    avisos,
  }
}

/**
 * Executa a reversão: devolve o crédito, apaga os irmãos por usar, os
 * movimentos do fundo e, por fim, o próprio pagamento.
 *
 * O pagamento é o último a ser apagado de propósito: se algo falhar antes,
 * a linha continua lá e nada fica a meio sem se perceber porquê.
 */
export async function reverterPagamento(
  supabase: any,
  plano: PlanoReversao,
): Promise<{ erro?: string; resumo: string }> {
  for (const credito of plano.creditosADevolver) {
    const { error } = await releaseAdvance(supabase, credito.id)
    if (error) return { erro: `ao devolver o crédito: ${error}`, resumo: '' }
  }

  if (plano.movimentosAApagar.length > 0) {
    const { error } = await supabase.from('cash_fund_movements').delete().in('id', plano.movimentosAApagar)
    if (error) return { erro: `ao apagar os movimentos do fundo de maneio: ${error.message}`, resumo: '' }
  }

  if (plano.irmaosAApagar.length > 0) {
    const { error } = await supabase.from('rent_payments').delete().in('id', plano.irmaosAApagar.map(i => i.id))
    if (error) return { erro: `ao apagar o adiantamento do mesmo recebimento: ${error.message}`, resumo: '' }
  }

  const { error } = await supabase.from('rent_payments').delete().eq('id', plano.pagamento.id)
  if (error) return { erro: error.message, resumo: '' }

  const partes = [`apagou ${formatCurrency(plano.pagamento.amount)}`]
  if (plano.creditoTotal > 0) partes.push(`devolveu ${formatCurrency(plano.creditoTotal)} ao crédito`)
  if (plano.irmaosAApagar.length > 0) {
    partes.push(`apagou ${plano.irmaosAApagar.length} adiantamento(s) do mesmo recebimento`)
  }
  if (plano.movimentosTotal > 0) partes.push(`apagou ${plano.movimentosTotal} movimento(s) do fundo de maneio`)

  return { resumo: partes.join(', ') }
}
