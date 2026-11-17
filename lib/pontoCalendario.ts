import { formatCurrency } from './utils'
import { ehValorFixo, formatarHoras, feriadosNacionais, type EntradaComEstado } from './ponto'

/**
 * Vista de calendário da folha de ponto: o mapa de utilização dos
 * trabalhadores, mês a mês.
 *
 * SÓ LEITURA. Nada aqui grava, altera ou recalcula pagamentos — as contas de
 * cada entrada (quanto está pago, quanto falta) vêm já feitas do
 * `calcularConta`, que é a mesma lógica da lista e da ficha. Aqui só se
 * agrupa por dia e se soma o que está à vista.
 *
 * As datas andam todas em texto 'AAAA-MM-DD'. Nunca se passa uma data ISO por
 * `new Date(iso)` para depois lhe tirar o dia: isso lê-se em UTC e, num fuso a
 * oeste, uma entrada do dia 03 apareceria a 02. As contas de dias fazem-se em
 * UTC puro (que não tem horário de verão) e o dia da semana com um `Date`
 * local construído campo a campo, que é exato.
 */

// ----------------------------------------------------------------- datas

const pad = (n: number) => String(n).padStart(2, '0')

/** O dia de hoje em 'AAAA-MM-DD', pelo calendário de quem está a ver. */
export function isoDeHoje(agora: Date = new Date()): string {
  return `${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}`
}

/** Soma dias a uma data ISO. Em UTC, para não haver saltos de hora legal. */
export function somarDiasISO(iso: string, dias: number): string {
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  const t = new Date(Date.UTC(a, m - 1, d))
  t.setUTCDate(t.getUTCDate() + dias)
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** 0 = segunda … 6 = domingo. A semana portuguesa começa à segunda. */
export function diaDaSemana(iso: string): number {
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return (new Date(a, m - 1, d).getDay() + 6) % 7
}

/** Quantos dias tem o mês. */
export function diasDoMes(ano: number, mes: number): number {
  return new Date(ano, mes, 0).getDate()
}

/** Avança ou recua meses, com a volta do ano feita como deve ser. */
export function mesDeslocado(ano: number, mes: number, passos: number): { ano: number; mes: number } {
  const total = ano * 12 + (mes - 1) + passos
  return { ano: Math.floor(total / 12), mes: (total % 12) + 1 }
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** "novembro de 2026" — como se diz, não como se escreve numa máquina. */
export function rotuloDoMes(ano: number, mes: number): string {
  return `${MESES[mes - 1]} de ${ano}`
}

export const DIAS_DA_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

export interface DiaDoCalendario {
  iso: string
  /** O número do dia, 1 a 31. */
  dia: number
  /** false nos dias das pontas, que pertencem ao mês vizinho. */
  noMes: boolean
  fimDeSemana: boolean
  feriado: boolean
}

/**
 * A grelha do mês, em semanas de segunda a domingo. As pontas levam os dias
 * do mês vizinho (marcados com `noMes: false`) para a grelha não ter buracos
 * num mês que começa a meio da semana.
 */
export function semanasDoMes(ano: number, mes: number): DiaDoCalendario[][] {
  const primeiro = `${ano}-${pad(mes)}-01`
  const inicio = somarDiasISO(primeiro, -diaDaSemana(primeiro))
  const total = diasDoMes(ano, mes)
  const ultimo = `${ano}-${pad(mes)}-${pad(total)}`
  const fim = somarDiasISO(ultimo, 6 - diaDaSemana(ultimo))

  const feriados = new Set([
    ...feriadosNacionais(ano),
    ...feriadosNacionais(ano + (mes === 12 ? 1 : 0)),
    ...feriadosNacionais(ano - (mes === 1 ? 1 : 0)),
  ])

  const semanas: DiaDoCalendario[][] = []
  let atual: DiaDoCalendario[] = []
  for (let iso = inicio; iso <= fim; iso = somarDiasISO(iso, 1)) {
    const ds = diaDaSemana(iso)
    atual.push({
      iso,
      dia: Number(iso.slice(8, 10)),
      noMes: iso.slice(0, 7) === `${ano}-${pad(mes)}`,
      fimDeSemana: ds >= 5,
      feriado: feriados.has(iso),
    })
    if (ds === 6) { semanas.push(atual); atual = [] }
  }
  if (atual.length) semanas.push(atual)
  return semanas
}

// ------------------------------------------------------------------ cores

export interface CorTrabalhador {
  /** Classes do cartãozinho da entrada no dia. */
  chip: string
  /** Classes do botão da legenda quando está ligado. */
  legenda: string
  /** A bolinha da legenda e do rodapé. */
  ponto: string
}

/**
 * Paleta fixa. A cor sai da POSIÇÃO do trabalhador na lista ordenada, não de
 * nada aleatório: é a mesma cor o mês inteiro e de mês para mês, que é o que
 * permite ler a grelha de relance.
 */
export const CORES_TRABALHADOR: CorTrabalhador[] = [
  { chip: 'bg-emerald-50 text-emerald-800 border-emerald-200', legenda: 'bg-emerald-600 text-white border-emerald-600', ponto: 'bg-emerald-500' },
  { chip: 'bg-blue-50 text-blue-800 border-blue-200', legenda: 'bg-blue-600 text-white border-blue-600', ponto: 'bg-blue-500' },
  { chip: 'bg-amber-50 text-amber-800 border-amber-200', legenda: 'bg-amber-600 text-white border-amber-600', ponto: 'bg-amber-500' },
  { chip: 'bg-violet-50 text-violet-800 border-violet-200', legenda: 'bg-violet-600 text-white border-violet-600', ponto: 'bg-violet-500' },
  { chip: 'bg-rose-50 text-rose-800 border-rose-200', legenda: 'bg-rose-600 text-white border-rose-600', ponto: 'bg-rose-500' },
  { chip: 'bg-cyan-50 text-cyan-800 border-cyan-200', legenda: 'bg-cyan-600 text-white border-cyan-600', ponto: 'bg-cyan-500' },
  { chip: 'bg-orange-50 text-orange-800 border-orange-200', legenda: 'bg-orange-600 text-white border-orange-600', ponto: 'bg-orange-500' },
  { chip: 'bg-teal-50 text-teal-800 border-teal-200', legenda: 'bg-teal-600 text-white border-teal-600', ponto: 'bg-teal-500' },
  { chip: 'bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200', legenda: 'bg-fuchsia-600 text-white border-fuchsia-600', ponto: 'bg-fuchsia-500' },
  { chip: 'bg-lime-50 text-lime-800 border-lime-200', legenda: 'bg-lime-600 text-white border-lime-600', ponto: 'bg-lime-500' },
]

/** A cor de cada trabalhador, pela ordem em que a lista os dá. */
export function coresPorTrabalhador(ids: string[]): Map<string, CorTrabalhador> {
  const mapa = new Map<string, CorTrabalhador>()
  ;(ids ?? []).forEach((id, i) => mapa.set(id, CORES_TRABALHADOR[i % CORES_TRABALHADOR.length]))
  return mapa
}

/** A cor de quem não está na lista (trabalhador apagado, por exemplo). */
export const COR_DESCONHECIDA: CorTrabalhador = {
  chip: 'bg-gray-50 text-gray-600 border-gray-200',
  legenda: 'bg-gray-500 text-white border-gray-500',
  ponto: 'bg-gray-400',
}

// ----------------------------------------------------------------- texto

/**
 * O nome que cabe numa casa de calendário: o primeiro nome, e se for curto
 * demais para distinguir, a inicial do apelido a seguir.
 */
export function nomeCurto(nome: string | null | undefined): string {
  const partes = String(nome ?? '').trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '—'
  if (partes.length === 1) return partes[0]
  const primeiro = partes[0]
  return primeiro.length <= 3 ? `${primeiro} ${partes[partes.length - 1][0]}.` : primeiro
}

/**
 * A entrada numa linha: "Yuran 4h" por horas, "Xavier VF 55,00 €" a valor
 * fixo — um registo de valor fixo não tem horas e não finge que tem.
 */
export function etiquetaEntrada(e: EntradaComEstado, nome: string | null | undefined): string {
  const quem = nomeCurto(nome)
  return ehValorFixo(e)
    ? `${quem} VF ${formatCurrency(Number(e.amount ?? 0))}`
    : `${quem} ${formatarHoras(Number(e.hours ?? 0))}`
}

// ---------------------------------------------------------------- agrupar

/** As entradas de um mês. O mês vem do texto da data, sem conversões. */
export function entradasDoMes(entradas: EntradaComEstado[], ano: number, mes: number): EntradaComEstado[] {
  const prefixo = `${ano}-${pad(mes)}`
  return (entradas ?? []).filter(e => String(e.work_date).slice(0, 7) === prefixo)
}

/**
 * As entradas por dia, cada dia ordenado pela hora de início. Os registos de
 * valor fixo não têm horário e ficam à frente, que é onde se espera encontrar
 * o trabalho combinado do dia.
 */
export function agruparPorDia(entradas: EntradaComEstado[]): Map<string, EntradaComEstado[]> {
  const mapa = new Map<string, EntradaComEstado[]>()
  for (const e of entradas ?? []) {
    const dia = String(e.work_date).slice(0, 10)
    const lista = mapa.get(dia)
    if (lista) lista.push(e)
    else mapa.set(dia, [e])
  }
  for (const lista of mapa.values()) {
    lista.sort((a, b) => String(a.start_time ?? '').localeCompare(String(b.start_time ?? '')))
  }
  return mapa
}

// ----------------------------------------------------------------- totais

export interface TotalDeTrabalhador {
  workerId: string
  nome: string
  registos: number
  horas: number
  ganho: number
  /** O que falta receber destas entradas — vem do `calcularConta`. */
  porPagar: number
}

export interface TotaisDoMes {
  porTrabalhador: TotalDeTrabalhador[]
  registos: number
  horas: number
  ganho: number
  porPagar: number
}

const soma = (ns: number[]) => parseFloat(ns.reduce((s, n) => s + n, 0).toFixed(2))

/**
 * Os totais do mês que está à vista, por trabalhador e no conjunto.
 *
 * Somam-se as entradas mostradas, para o rodapé bater sempre com a grelha. O
 * "por pagar" é a soma do que falta em cada entrada, tal como o `calcularConta`
 * já o distribuiu — não é uma conta nova.
 */
export function totaisDoMes(
  entradas: EntradaComEstado[],
  nomes: Map<string, string> | Record<string, string>,
): TotaisDoMes {
  const nomeDe = (id: string) =>
    (nomes instanceof Map ? nomes.get(id) : nomes?.[id]) ?? '—'

  const porId = new Map<string, EntradaComEstado[]>()
  for (const e of entradas ?? []) {
    const lista = porId.get(e.worker_id)
    if (lista) lista.push(e)
    else porId.set(e.worker_id, [e])
  }

  const porTrabalhador = [...porId.entries()]
    .map<TotalDeTrabalhador>(([workerId, es]) => ({
      workerId,
      nome: nomeDe(workerId),
      registos: es.length,
      horas: soma(es.map(e => Number(e.hours ?? 0))),
      ganho: soma(es.map(e => Number(e.amount ?? 0))),
      porPagar: soma(es.map(e => Number(e.emFalta ?? 0))),
    }))
    .sort((a, b) => b.ganho - a.ganho || String(a.nome).localeCompare(String(b.nome), 'pt'))

  return {
    porTrabalhador,
    registos: (entradas ?? []).length,
    horas: soma(porTrabalhador.map(t => t.horas)),
    ganho: soma(porTrabalhador.map(t => t.ganho)),
    porPagar: soma(porTrabalhador.map(t => t.porPagar)),
  }
}
