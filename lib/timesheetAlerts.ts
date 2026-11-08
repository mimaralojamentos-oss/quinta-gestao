import { formatCurrency, formatDate } from './utils'
import { ehValorFixo, formatarHoras } from './ponto'

/**
 * Alertas de e-mail da Folha de Ponto.
 *
 * Quem recebe e com que frequência está em timesheet_alert_recipients, e
 * cada envio agendado fica marcado em timesheet_alert_sends — é essa marca
 * que impede um segundo envio do mesmo período se o cron correr duas vezes.
 *
 * Aqui vive só a parte decidível sem base de dados: que período é que cada
 * periodicidade cobre, como se agrupam as entradas e que texto sai. O envio
 * em si está em app/api/cron/timesheet-alerts e app/api/timesheet-alert.
 *
 * REGRA GERAL: sem entradas no período, não há e-mail. Em todas as
 * periodicidades.
 */

export type Periodicidade = 'imediato' | 'diario' | 'semanal' | 'mensal'

export const PERIODICIDADES: { valor: Periodicidade; label: string; descricao: string }[] = [
  { valor: 'imediato', label: 'Imediatamente', descricao: 'Um e-mail por cada registo novo, no momento em que é gravado' },
  { valor: 'diario', label: 'Diariamente', descricao: 'Às 9h, o resumo das entradas do dia anterior' },
  { valor: 'semanal', label: 'Semanalmente', descricao: 'Sexta-feira às 20h, o resumo da semana (sábado a sexta)' },
  { valor: 'mensal', label: 'Mensalmente', descricao: 'No último dia do mês às 20h, o resumo do mês' },
]

export interface AlertRecipient {
  id: string
  email: string
  imediato: boolean
  diario: boolean
  semanal: boolean
  mensal: boolean
  active: boolean
}

export function periodicidadesDe(r: AlertRecipient): Periodicidade[] {
  const todas: Periodicidade[] = []
  if (r.imediato) todas.push('imediato')
  if (r.diario) todas.push('diario')
  if (r.semanal) todas.push('semanal')
  if (r.mensal) todas.push('mensal')
  return todas
}

/**
 * A chamada do cron está autorizada?
 *
 * O Vercel manda `Authorization: Bearer <CRON_SECRET>`. Sem segredo
 * configurado a rota fica fechada: mais vale não enviar nada do que deixar
 * qualquer pessoa disparar e-mails.
 */
export function cronAutorizado(authHeader: string | null | undefined, segredo: string | undefined): boolean {
  if (!segredo) return false
  return authHeader === `Bearer ${segredo}`
}

// ------------------------------------------------------------- calendário

/** A data de hoje em Lisboa, em AAAA-MM-DD (os crons correm em UTC). */
export function hojeEmLisboa(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(agora)
}

/** Dia da semana de uma data AAAA-MM-DD (0 = domingo). */
export function diaDaSemana(dataISO: string): number {
  return new Date(`${dataISO}T12:00:00Z`).getUTCDay()
}

const somarDias = (dataISO: string, dias: number): string => {
  const d = new Date(`${dataISO}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export const ehSexta = (dataISO: string) => diaDaSemana(dataISO) === 5

export function ehUltimoDiaDoMes(dataISO: string): boolean {
  return somarDias(dataISO, 1).slice(0, 7) !== dataISO.slice(0, 7)
}

export interface Periodo {
  /** Primeiro dia incluído (AAAA-MM-DD). */
  inicio: string
  /** Último dia incluído (AAAA-MM-DD). */
  fim: string
  /** Como se escreve no assunto e no corpo. */
  etiqueta: string
  /** Chave única do período, para a marca de envio não repetir. */
  chave: string
}

/**
 * O período de cada periodicidade, a partir do dia em que o cron corre.
 *
 *   diário   — o dia anterior (o cron das 9h)
 *   semanal  — sábado a sexta, a semana que termina HOJE (cron de sexta às 20h)
 *   mensal   — o mês civil que termina HOJE (cron do último dia às 20h)
 */
export function periodoDe(periodicidade: 'diario' | 'semanal' | 'mensal', hojeISO: string): Periodo {
  if (periodicidade === 'diario') {
    const ontem = somarDias(hojeISO, -1)
    return { inicio: ontem, fim: ontem, etiqueta: formatDate(ontem), chave: `diario:${ontem}` }
  }
  if (periodicidade === 'semanal') {
    const inicio = somarDias(hojeISO, -6)
    return {
      inicio, fim: hojeISO,
      etiqueta: `${formatDate(inicio)} a ${formatDate(hojeISO)}`,
      chave: `semanal:${hojeISO}`,
    }
  }
  const inicio = `${hojeISO.slice(0, 7)}-01`
  return {
    inicio, fim: hojeISO,
    etiqueta: `${formatDate(inicio)} a ${formatDate(hojeISO)}`,
    chave: `mensal:${hojeISO.slice(0, 7)}`,
  }
}

/** Que resumos é que o cron das 20h tem de enviar neste dia. */
export function periodicidadesDoFimDoDia(hojeISO: string): ('semanal' | 'mensal')[] {
  const quais: ('semanal' | 'mensal')[] = []
  if (ehSexta(hojeISO)) quais.push('semanal')
  if (ehUltimoDiaDoMes(hojeISO)) quais.push('mensal')
  return quais
}

// --------------------------------------------------------------- resumos

/**
 * Uma entrada como vem da base de dados para o resumo. Não estende a
 * WorkEntry de propósito: aqui os campos podem vir a null (é o que a
 * consulta devolve) e junta-se o nome do trabalhador da tabela ligada.
 */
export interface EntradaDoResumo {
  id?: string
  work_date: string
  amount?: number | null
  hours?: number | null
  description?: string | null
  start_time?: string | null
  end_time?: string | null
  entry_type?: string | null
  is_holiday?: boolean | null
  worker?: { name?: string | null } | null
  worker_id?: string
}

export interface GrupoDoResumo {
  trabalhador: string
  horas: number
  dias: number
  valorFixo: number
  total: number
  linhas: string[]
}

/**
 * Agrupa as entradas por trabalhador, pela ordem alfabética do nome.
 *
 * O resumo mostra o estado ATUAL das entradas do período: se uma foi
 * corrigida ou apagada entretanto, é o que está agora que conta — não há
 * histórico de alterações no e-mail.
 */
export function agruparResumo(entradas: EntradaDoResumo[]): GrupoDoResumo[] {
  const porTrabalhador = new Map<string, EntradaDoResumo[]>()
  for (const e of entradas ?? []) {
    const nome = e.worker?.name?.trim() || '(sem nome)'
    if (!porTrabalhador.has(nome)) porTrabalhador.set(nome, [])
    porTrabalhador.get(nome)!.push(e)
  }

  return [...porTrabalhador.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'pt', { sensitivity: 'base' }))
    .map(([trabalhador, lista]) => {
      const ordenadas = [...lista].sort((a, b) =>
        String(a.work_date).localeCompare(String(b.work_date))
        || String(a.start_time ?? '').localeCompare(String(b.start_time ?? '')))

      let horas = 0, valorFixo = 0, total = 0
      const linhas: string[] = []

      for (const e of ordenadas) {
        const valor = Number(e.amount ?? 0)
        total += valor
        const fixo = ehValorFixo(e as any)
        if (fixo) valorFixo += valor
        else horas += Number(e.hours ?? 0)

        const marcas = [
          fixo ? 'valor fixo' : null,
          e.is_holiday ? 'fds/feriado' : null,
        ].filter(Boolean).join(', ')

        linhas.push(
          `  · ${formatDate(e.work_date)}`
          + (fixo
            ? ''
            : ` ${String(e.start_time ?? '').slice(0, 5)}-${String(e.end_time ?? '').slice(0, 5)} (${formatarHoras(Number(e.hours ?? 0))})`)
          + ` — ${formatCurrency(valor)}`
          + (marcas ? ` [${marcas}]` : '')
          + (e.description ? ` — ${e.description}` : ''))
      }

      return {
        trabalhador,
        horas: parseFloat(horas.toFixed(2)),
        dias: ordenadas.length,
        valorFixo: parseFloat(valorFixo.toFixed(2)),
        total: parseFloat(total.toFixed(2)),
        linhas,
      }
    })
}

const nomeDaApp = () => process.env.NEXT_PUBLIC_APP_NAME ?? 'Gestão de Alojamentos'

const TITULOS: Record<'diario' | 'semanal' | 'mensal', string> = {
  diario: 'resumo de', semanal: 'resumo da semana', mensal: 'resumo do mês',
}

export function assuntoResumo(periodicidade: 'diario' | 'semanal' | 'mensal', periodo: Periodo): string {
  const meio = periodicidade === 'diario'
    ? `${TITULOS.diario} ${periodo.etiqueta}`
    : `${TITULOS[periodicidade]} (${periodo.etiqueta})`
  return `Folha de Ponto — ${meio} (${nomeDaApp()})`
}

/** O corpo do resumo. Devolve null quando não há entradas: aí não se envia. */
export function corpoResumo(
  periodicidade: 'diario' | 'semanal' | 'mensal',
  periodo: Periodo,
  entradas: EntradaDoResumo[],
): string | null {
  const grupos = agruparResumo(entradas)
  if (grupos.length === 0) return null

  const totalGeral = parseFloat(grupos.reduce((s, g) => s + g.total, 0).toFixed(2))
  const horasGeral = parseFloat(grupos.reduce((s, g) => s + g.horas, 0).toFixed(2))
  const registos = grupos.reduce((s, g) => s + g.dias, 0)

  const titulo = periodicidade === 'diario'
    ? `Entradas de ${periodo.etiqueta}`
    : `Entradas de ${periodo.etiqueta}`

  const partes = [
    titulo,
    '',
    `${registos} registo(s) · ${formatarHoras(horasGeral)} · ${formatCurrency(totalGeral)}`,
    '',
  ]

  for (const g of grupos) {
    partes.push(`${g.trabalhador} — ${formatarHoras(g.horas)}, ${formatCurrency(g.total)}`
      + (g.valorFixo > 0 ? ` (inclui ${formatCurrency(g.valorFixo)} de valor fixo)` : ''))
    partes.push(...g.linhas, '')
  }

  partes.push('Os valores mostram o estado atual dos registos: correções e remoções já estão refletidas.')
  return partes.join('\n')
}

// ------------------------------------------------------------- imediato

export function assuntoImediato(trabalhador: string, dataISO: string): string {
  return `Folha de Ponto — ${trabalhador} registou ${formatDate(dataISO)} (${nomeDaApp()})`
}

export function corpoImediato(p: {
  trabalhador: string
  entrada: EntradaDoResumo
  /** Quem registou: o próprio trabalhador ou o gestor. */
  quemRegistou: string
}): string {
  const e = p.entrada
  const fixo = ehValorFixo(e as any)
  const linhas = [
    `${p.trabalhador} tem um registo novo na Folha de Ponto.`,
    '',
    `Dia: ${formatDate(e.work_date)}${e.is_holiday ? ' (fds/feriado)' : ''}`,
  ]

  if (fixo) linhas.push('Tipo: valor fixo (sem horário)')
  else linhas.push(`Horário: ${String(e.start_time ?? '').slice(0, 5)} — ${String(e.end_time ?? '').slice(0, 5)}`,
                   `Horas: ${formatarHoras(Number(e.hours ?? 0))}`)

  linhas.push(`Valor: ${formatCurrency(Number(e.amount ?? 0))}`)
  if (e.description) linhas.push(`Trabalho: ${e.description}`)
  linhas.push(`Registado por: ${p.quemRegistou}`)

  return linhas.join('\n')
}
