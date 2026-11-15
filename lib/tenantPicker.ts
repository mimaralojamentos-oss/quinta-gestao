import { formatCurrency, matchesSearch } from './utils'

/**
 * A lista de inquilinos como ela é lida por quem identifica transações no
 * banco: primeiro a fração, que é por onde se pensa, depois o nome e a renda.
 *
 * Só apresentação — nada aqui escolhe, grava ou altera seja o que for. O valor
 * escolhido continua a ser o id do inquilino, como sempre foi.
 */

export interface InquilinoCru {
  id: string
  name: string | null
}

/** O contrato como as páginas do banco o leem: ativo, com fração e renda. */
export interface ContratoCru {
  id?: string
  monthly_rent?: number | null
  tenant?: { id?: string; name?: string | null } | null
  space?: { ref?: string | null } | null
}

export interface OpcaoInquilino {
  /** O que vai no `value` do option: continua a ser o inquilino. */
  id: string
  nome: string
  /** As frações com contrato ativo, por ordem natural. Vazio = sem contrato. */
  refs: string[]
  /** A soma das rendas dos contratos ativos. Null quando não há contrato. */
  renda: number | null
  /** true quando o inquilino não tem contrato ativo nenhum. */
  semContrato: boolean
}

/** P4 antes de P12, A07-A antes de A07-B — a ordem por que se lê uma fração. */
export function compararRefs(a: string, b: string): number {
  return String(a ?? '').localeCompare(String(b ?? ''), 'pt', { numeric: true, sensitivity: 'base' })
}

/**
 * Junta inquilinos e contratos ativos numa lista pronta a mostrar.
 *
 * Ordem: pela fração, com ordenação natural. Quem não tem contrato ativo vai
 * para o fim, por nome — não se esconde ninguém, porque há transações antigas
 * de quem já saiu que ainda precisam de ser identificadas.
 *
 * Um inquilino com mais do que uma fração ativa continua a ser UMA opção (a
 * escolha é do inquilino, não do contrato): leva as frações todas no texto e a
 * soma das rendas.
 */
export function opcoesDeInquilino(tenants: InquilinoCru[], leases: ContratoCru[]): OpcaoInquilino[] {
  const porInquilino = new Map<string, ContratoCru[]>()
  for (const l of leases ?? []) {
    const id = l?.tenant?.id
    if (!id) continue
    const lista = porInquilino.get(id)
    if (lista) lista.push(l)
    else porInquilino.set(id, [l])
  }

  const opcoes = (tenants ?? []).map<OpcaoInquilino>(t => {
    const contratos = porInquilino.get(t.id) ?? []
    const refs = contratos
      .map(l => l?.space?.ref)
      .filter((r): r is string => !!r)
      .sort(compararRefs)
    // Um contrato ativo sem renda escrita não vale zero: vale "não se sabe".
    const comRenda = contratos.filter(l => l?.monthly_rent !== null && l?.monthly_rent !== undefined)
    const renda = comRenda.length
      ? parseFloat(comRenda.reduce((s, l) => s + Number(l.monthly_rent ?? 0), 0).toFixed(2))
      : null

    return {
      id: t.id,
      nome: t.name ?? '—',
      refs,
      renda,
      semContrato: contratos.length === 0,
    }
  })

  return opcoes.sort((a, b) => {
    // Sem contrato vai para o fim, seja qual for o nome.
    if (a.semContrato !== b.semContrato) return a.semContrato ? 1 : -1
    if (a.semContrato) return String(a.nome).localeCompare(String(b.nome), 'pt', { sensitivity: 'base' })
    const porRef = compararRefs(a.refs[0] ?? '', b.refs[0] ?? '')
    return porRef !== 0 ? porRef : String(a.nome).localeCompare(String(b.nome), 'pt', { sensitivity: 'base' })
  })
}

/**
 * A linha como ela aparece: "P01 — Marco Vieira — 325,00 €".
 * Sem contrato ativo, fica só o nome.
 */
export function textoDaOpcao(o: OpcaoInquilino): string {
  const partes: string[] = []
  if (o.refs.length) partes.push(o.refs.join(' · '))
  partes.push(o.nome)
  if (o.renda !== null) partes.push(formatCurrency(o.renda))
  const texto = partes.join(' — ')
  return o.refs.length > 1 ? `${texto} (${o.refs.length} frações)` : texto
}

/** A pesquisa encontra pelo nome e pela fração: escrever "P01" chega. */
export function opcaoCorresponde(o: OpcaoInquilino, termo: string | null | undefined): boolean {
  if (!termo || !termo.trim()) return true
  return matchesSearch(o.nome, termo) || o.refs.some(r => matchesSearch(r, termo))
}
