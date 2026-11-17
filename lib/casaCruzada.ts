import type { EntradaComEstado, ResumoConta, Worker } from './ponto'

/**
 * Trabalhadores partilhados pelas duas casas.
 *
 * O Xavier e o Yuran trabalham para a Serpa Pinto e para a Quinta. Têm um
 * link só — o desta app — mas cada casa tem a sua base de dados, as suas
 * tarifas e paga o que é seu. Por isso, em cada registo, o trabalhador diz
 * para quem trabalhou, e o registo vai para a base DESSA casa.
 *
 * REGRAS DE SEGURANÇA, que vivem aqui e não no telemóvel:
 *
 *   - A chave de serviço da outra casa está em variáveis de ambiente do
 *     SERVIDOR (sem `NEXT_PUBLIC_`), por isso nunca chega ao browser.
 *   - Sem as variáveis, nada disto existe: a app é a de sempre.
 *   - Um trabalhador só pode registar na outra casa se o ADMIN lhe tiver
 *     posto o `cross_worker_id` na ficha. O que vem do telemóvel é uma
 *     sugestão; quem decide é esta verificação, do lado do servidor.
 *   - Dinheiro nunca atravessa: os pagamentos de cada casa pagam só as
 *     entradas dessa casa, e as contas são feitas uma a uma, em separado.
 */

export type Casa = 'local' | 'cruzada'

export interface CasaDescrita {
  id: Casa
  nome: string
}

/** O nome desta casa, como aparece no ecrã. */
export function nomeCasaLocal(): string {
  return process.env.NEXT_PUBLIC_APP_NAME?.trim() || 'Esta casa'
}

/** O nome da outra casa. Sem ele, não se mostra escolha nenhuma. */
export function nomeCasaCruzada(): string {
  return process.env.CROSS_APP_NAME?.trim() || 'A outra casa'
}

/**
 * A ligação à outra casa está configurada?
 *
 * As duas variáveis têm de estar lá. Com meia configuração não se arrisca:
 * fica tudo como hoje.
 */
export function crossConfigurada(): boolean {
  return Boolean(
    process.env.CROSS_SUPABASE_URL?.trim()
    && process.env.CROSS_SUPABASE_SERVICE_KEY?.trim(),
  )
}

/**
 * Lê o que o telemóvel mandou. Qualquer coisa que não seja exatamente
 * 'cruzada' é a casa local — na dúvida, grava-se em casa.
 */
export function lerCasa(valor: unknown): Casa {
  return String(valor ?? '').trim() === 'cruzada' ? 'cruzada' : 'local'
}

export interface PermissaoCasa {
  ok: boolean
  erro?: string
}

/**
 * Pode este trabalhador registar nesta casa?
 *
 * A casa local é sempre permitida. A outra exige as duas coisas: a ligação
 * configurada no servidor E o mapeamento na ficha do trabalhador. É esta
 * função que o /api/ponto chama antes de gravar seja o que for.
 */
export function podeRegistarNaCasa(
  worker: Pick<Worker, 'id'> & { cross_worker_id?: string | null },
  casa: Casa,
  configurada: boolean = crossConfigurada(),
): PermissaoCasa {
  if (casa === 'local') return { ok: true }
  if (!configurada) {
    return { ok: false, erro: 'Esta app não está ligada à outra casa.' }
  }
  if (!worker?.cross_worker_id) {
    return { ok: false, erro: 'Não estás registado na outra casa. Fala com o gestor.' }
  }
  return { ok: true }
}

/**
 * As casas a oferecer no ecrã. Lista vazia = não se mostra escolha nenhuma,
 * que é o comportamento de quem só trabalha para uma casa.
 */
export function casasDisponiveis(
  worker: { cross_worker_id?: string | null },
  configurada: boolean = crossConfigurada(),
): CasaDescrita[] {
  if (!configurada || !worker?.cross_worker_id) return []
  return [
    { id: 'local', nome: nomeCasaLocal() },
    { id: 'cruzada', nome: nomeCasaCruzada() },
  ]
}

// ------------------------------------------------------------ as contas

export interface EntradaDeCasa extends EntradaComEstado {
  casa: Casa
  casaNome: string
}

export interface ContaDeCasa {
  casa: Casa
  nome: string
  totalGanho: number
  totalPago: number
  saldo: number
  totalHoras: number
  registos: number
}

export interface ContasJuntas {
  /** Tudo somado — o número grande do topo. */
  totalGanho: number
  totalPago: number
  saldo: number
  totalHoras: number
  /** Uma linha por casa, para se ver quem deve o quê. */
  porCasa: ContaDeCasa[]
  /** As entradas das duas casas, da mais recente para a mais antiga. */
  entradas: EntradaDeCasa[]
}

const soma = (ns: number[]) => parseFloat(ns.reduce((s, n) => s + n, 0).toFixed(2))

/** Carimba as entradas de uma conta com a casa de onde vieram. */
export function etiquetarEntradas(conta: ResumoConta, casa: Casa, nome: string): EntradaDeCasa[] {
  return (conta?.entradas ?? []).map(e => ({ ...e, casa, casaNome: nome }))
}

/**
 * Junta as contas das duas casas SEM as misturar.
 *
 * Cada conta foi calculada em separado, com os pagamentos da sua casa — é
 * isso que garante que o dinheiro da Serpa nunca paga horas da Quinta. Aqui
 * só se somam os totais para o número do topo e se junta a lista de dias.
 */
export function juntarContas(partes: { casa: Casa; nome: string; conta: ResumoConta }[]): ContasJuntas {
  const presentes = (partes ?? []).filter(p => p?.conta)

  const entradas = presentes
    .flatMap(p => etiquetarEntradas(p.conta, p.casa, p.nome))
    // Do mais recente para o mais antigo, como já se lia numa casa só.
    .sort((a, b) => String(b.work_date).localeCompare(String(a.work_date))
      || String(b.start_time ?? '').localeCompare(String(a.start_time ?? '')))

  return {
    totalGanho: soma(presentes.map(p => p.conta.totalGanho)),
    totalPago: soma(presentes.map(p => p.conta.totalPago)),
    saldo: soma(presentes.map(p => p.conta.saldo)),
    totalHoras: soma(presentes.map(p => p.conta.totalHoras)),
    porCasa: presentes.map(p => ({
      casa: p.casa,
      nome: p.nome,
      totalGanho: p.conta.totalGanho,
      totalPago: p.conta.totalPago,
      saldo: p.conta.saldo,
      totalHoras: p.conta.totalHoras,
      registos: p.conta.entradas.length,
    })),
    entradas,
  }
}

// ----------------------------------------------- o mapeamento, no admin

/** Um uuid, como o Postgres o escreve. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Lê o id que o admin colou na ficha. Vazio = não é partilhado.
 *
 * Só se aceita um uuid inteiro: um id meio colado passaria a verificação e
 * só daria erro muito mais tarde, na hora de gravar um registo.
 */
export function lerIdDaOutraCasa(texto: string | null | undefined):
  { erro: string } | { valor: string | null } {
  const limpo = String(texto ?? '').trim()
  if (!limpo) return { valor: null }
  if (!UUID.test(limpo)) {
    return { erro: 'O id da outra casa tem de ser um uuid completo, copiado da ficha de lá.' }
  }
  return { valor: limpo.toLowerCase() }
}
