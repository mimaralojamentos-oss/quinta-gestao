import { formatCurrency, formatDate } from './utils'
import { ehDiaEspecial, motivoDiaEspecial } from './ponto'

/**
 * Valor fixo em vários dias de uma vez.
 *
 * Um fim de semana inteiro ao mesmo preço combinado era registado dia a dia,
 * em duplicado. Aqui escreve-se o intervalo e o valor POR DIA, e nascem
 * registos individuais normais — um por dia, iguais aos que já existem. Nada
 * os marca como lote: cada um edita-se, apaga-se e paga-se por si, e o
 * calendário, o relatório e os pagamentos tratam-nos como sempre.
 *
 * As datas andam em texto 'AAAA-MM-DD' e as contas de dias fazem-se em UTC,
 * que não tem hora legal: um intervalo de 3 dias tem sempre 3 dias.
 */

/** Acima disto pergunta-se se é mesmo o que se quer. */
export const DIAS_PARA_CONFIRMAR = 14
/** Acima disto não se grava: é engano de dedo, não uma decisão. */
export const DIAS_NO_MAXIMO = 31

const pad = (n: number) => String(n).padStart(2, '0')

/** Os dias de um intervalo, inclusive nas duas pontas. */
export function diasDoIntervalo(de: string, ate: string): string[] {
  const inicio = String(de ?? '').slice(0, 10)
  const fim = String(ate ?? '').slice(0, 10) || inicio
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) return []
  if (fim < inicio) return []

  const dias: string[] = []
  const [a, m, d] = inicio.split('-').map(Number)
  const t = new Date(Date.UTC(a, m - 1, d))
  for (let i = 0; i <= DIAS_NO_MAXIMO * 2; i++) {
    const iso = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
    dias.push(iso)
    if (iso >= fim) break
    t.setUTCDate(t.getUTCDate() + 1)
  }
  return dias
}

export interface EntradaExistente {
  work_date: string
  amount?: number | null
  description?: string | null
  entry_type?: string | null
  start_time?: string | null
}

export interface LoteValorFixo {
  /** Os dias que vão ser gravados. Vazio quando não dá para gravar. */
  dias: string[]
  /** O valor por dia, ao cêntimo. */
  valor: number
  /** valor × dias. */
  total: number
  /** Impede a gravação. */
  erro: string | null
  /** Obriga a confirmar, mas deixa gravar. */
  confirmar: string | null
  /** Dias que já têm um registo igual — provável duplicado, não bloqueia. */
  duplicados: string[]
  /** Os dias do intervalo que são fds ou feriado, para se saber o que se lança. */
  especiais: string[]
}

/**
 * Lê o que está no formulário e diz o que acontece se se gravar.
 *
 * O aviso de duplicado olha para o trabalhador que está à frente: mesmo dia,
 * mesmo valor, mesma descrição, também de valor fixo. É um aviso, não uma
 * proibição — há trabalhos que se repetem de propósito.
 */
export function prepararLote(p: {
  de: string
  ate?: string | null
  /** O valor por dia, como está escrito no formulário. */
  valor: string | number
  descricao: string
  /** As entradas que o trabalhador já tem, para o aviso de duplicado. */
  existentes?: EntradaExistente[]
}): LoteValorFixo {
  const valorLido = typeof p.valor === 'number'
    ? p.valor
    : parseFloat(String(p.valor ?? '').replace(',', '.'))
  const valor = Number.isFinite(valorLido) ? parseFloat(valorLido.toFixed(2)) : NaN
  const descricao = String(p.descricao ?? '').trim()

  const vazio = (erro: string): LoteValorFixo => ({
    dias: [], valor: Number.isFinite(valor) ? valor : 0, total: 0,
    erro, confirmar: null, duplicados: [], especiais: [],
  })

  const inicio = String(p.de ?? '').slice(0, 10)
  const fim = String(p.ate ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) return vazio('Indica o dia.')
  if (fim && !/^\d{4}-\d{2}-\d{2}$/.test(fim)) return vazio('A data de fim não é válida.')
  if (fim && fim < inicio) {
    return vazio(`O último dia (${formatDate(fim)}) é anterior ao primeiro (${formatDate(inicio)}).`)
  }

  const dias = diasDoIntervalo(inicio, fim)
  if (dias.length === 0) return vazio('O intervalo de dias não é válido.')
  if (dias.length > DIAS_NO_MAXIMO) {
    return vazio(`São ${dias.length} dias. O máximo de uma vez são ${DIAS_NO_MAXIMO} —`
      + ' se é mesmo um período tão longo, lança-o em lotes mais pequenos.')
  }

  if (!Number.isFinite(valor) || valor <= 0) return vazio('Indica o valor combinado.')
  if (!descricao) return vazio('Descreve o trabalho — é o que identifica estes registos.')

  const jaLa = (p.existentes ?? []).filter(e =>
    (e.entry_type ?? (e.start_time ? 'horas' : 'valor_fixo')) === 'valor_fixo'
    && Math.abs(Number(e.amount ?? 0) - valor) < 0.005
    && String(e.description ?? '').trim() === descricao)

  return {
    dias,
    valor,
    total: parseFloat((valor * dias.length).toFixed(2)),
    erro: null,
    confirmar: dias.length > DIAS_PARA_CONFIRMAR
      ? `São ${dias.length} dias seguidos, de ${formatDate(dias[0])} a ${formatDate(dias[dias.length - 1])}.`
        + ` Vão ficar ${dias.length} registos, ${formatCurrency(parseFloat((valor * dias.length).toFixed(2)))} no total. É mesmo isto?`
      : null,
    duplicados: dias.filter(d => jaLa.some(e => String(e.work_date).slice(0, 10) === d)),
    especiais: dias.filter(d => ehDiaEspecial(d)),
  }
}

/** "2 dias × 60,00 € = 120,00 € no total (um registo por dia)". */
export function textoPrevia(lote: LoteValorFixo): string {
  if (lote.dias.length <= 1) return ''
  return `${lote.dias.length} dias × ${formatCurrency(lote.valor)} = `
    + `${formatCurrency(lote.total)} no total (um registo por dia)`
}

/** O aviso de duplicado, já escrito. Null quando não há nenhum. */
export function textoDuplicados(lote: LoteValorFixo): string | null {
  if (lote.duplicados.length === 0) return null
  const dias = lote.duplicados.map(d => formatDate(d)).join(', ')
  return lote.duplicados.length === 1
    ? `Já existe um registo igual a este em ${dias} — mesmo valor e mesma descrição.`
      + ' Se for trabalho repetido, segue em frente; se não, confere antes de gravar.'
    : `Já existem registos iguais a este em ${lote.duplicados.length} destes dias (${dias}).`
      + ' Se for trabalho repetido, segue em frente; se não, confere antes de gravar.'
}

/** Os dias de fds/feriado do intervalo, escritos para o ecrã. */
export function textoEspeciais(lote: LoteValorFixo): string | null {
  if (lote.especiais.length === 0) return null
  const quais = lote.especiais
    .map(d => `${formatDate(d)}${motivoDiaEspecial(d) ? ` (${motivoDiaEspecial(d)})` : ''}`)
    .join(', ')
  return `Inclui ${quais}. No valor fixo o preço é o combinado — o fim de semana não muda o valor.`
}

/**
 * As linhas a gravar, uma por dia. Todas iguais, só muda o dia.
 *
 * `is_holiday` fica false, como já ficava no valor fixo de um dia só: a marca
 * de fds/feriado serve para escolher a tarifa por hora, e aqui não há tarifa.
 */
export function linhasDoLote(lote: LoteValorFixo, p: {
  workerId: string
  descricao: string
  createdBy?: string
}): Record<string, unknown>[] {
  return lote.dias.map(dia => ({
    worker_id: p.workerId,
    work_date: dia,
    start_time: null,
    end_time: null,
    hours: 0,
    is_holiday: false,
    hourly_rate: 0,
    amount: lote.valor,
    description: String(p.descricao ?? '').trim(),
    created_by: p.createdBy ?? 'gestor',
    entry_type: 'valor_fixo',
  }))
}

/** A linha do registo de acessos. */
export function detalheDoLote(lote: LoteValorFixo, p: { trabalhador: string; descricao: string }): string {
  if (lote.dias.length === 1) {
    return `Registou valor fixo de ${formatCurrency(lote.valor)} de "${p.trabalhador}"`
      + ` em ${formatDate(lote.dias[0])} (${p.descricao.trim()})`
  }
  return `Registou valor fixo de ${formatCurrency(lote.valor)}/dia de "${p.trabalhador}"`
    + ` em ${lote.dias.length} dias, de ${formatDate(lote.dias[0])} a ${formatDate(lote.dias[lote.dias.length - 1])}`
    + ` — ${formatCurrency(lote.total)} no total (${p.descricao.trim()})`
}
