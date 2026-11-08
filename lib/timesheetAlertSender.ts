import {
  agruparResumo, assuntoImediato, assuntoResumo, corpoImediato, corpoResumo, periodoDe,
  type AlertRecipient, type EntradaDoResumo, type Periodo,
} from './timesheetAlerts'
import { enviarEmailApp, enviarEmailAppSemFalhar, type EnvioApp, type ResultadoEnvio } from './appMailer'

/**
 * Quem envia os alertas da Folha de Ponto.
 *
 * Corre sempre no servidor (service role): o alerta imediato é disparado
 * pelo caminho que grava a entrada — incluindo o link do trabalhador, que
 * não tem sessão de utilizador — e os resumos vêm do cron.
 *
 * O envio é injetável (parâmetro `enviar`) para os ensaios poderem apanhar
 * os e-mails em vez de os mandar.
 *
 * IDEMPOTÊNCIA: antes de enviar, grava-se a marca em timesheet_alert_sends.
 * A chave única (destinatário, periodicidade, período) faz a segunda
 * tentativa falhar, e é isso que impede e-mails em dobro quando o cron
 * corre repetido. A marca fica mesmo que o envio falhe — com o erro
 * registado —, para um problema de SMTP não virar uma chuva de tentativas;
 * o histórico de e-mails mostra o que falhou.
 */

export type Enviador = (envio: EnvioApp) => Promise<ResultadoEnvio>

export interface ResultadoAlertas {
  periodo?: Periodo
  destinatarios: number
  enviados: number
  saltados: number
  falhados: number
  semEntradas: boolean
  detalhe: string[]
}

async function destinatariosDe(
  supabase: any,
  coluna: 'imediato' | 'diario' | 'semanal' | 'mensal',
): Promise<AlertRecipient[]> {
  const { data } = await supabase
    .from('timesheet_alert_recipients')
    .select('id, email, imediato, diario, semanal, mensal, active')
    .eq('active', true)
    .eq(coluna, true)
  return (data ?? []) as AlertRecipient[]
}

/** Grava a marca. false = já existia, ou seja já foi enviado. */
async function marcar(
  supabase: any,
  p: { recipientId: string; periodicidade: string; periodo: string; entradas: number },
): Promise<boolean> {
  const { error } = await supabase.from('timesheet_alert_sends').insert({
    recipient_id: p.recipientId,
    periodicidade: p.periodicidade,
    periodo: p.periodo,
    entradas: p.entradas,
  })
  return !error
}

async function registarFalha(supabase: any, p: { recipientId: string; periodicidade: string; periodo: string; erro: string }) {
  await supabase.from('timesheet_alert_sends')
    .update({ enviado: false, erro: p.erro.slice(0, 500) })
    .eq('recipient_id', p.recipientId).eq('periodicidade', p.periodicidade).eq('periodo', p.periodo)
}

// ----------------------------------------------------------------- imediato

/**
 * Alerta de uma entrada nova. Nunca lança e nunca atrasa quem gravou a
 * entrada: se não houver destinatários, sai logo; se o envio demorar, segue
 * sozinho e o resultado fica no histórico de e-mails.
 */
export async function enviarAlertaImediato(
  supabase: any,
  p: {
    entrada: EntradaDoResumo & { id?: string }
    trabalhador: string
    quemRegistou: string
    enviar?: Enviador
  },
): Promise<ResultadoAlertas> {
  const resultado: ResultadoAlertas = {
    destinatarios: 0, enviados: 0, saltados: 0, falhados: 0, semEntradas: false, detalhe: [],
  }

  try {
    const destinatarios = await destinatariosDe(supabase, 'imediato')
    resultado.destinatarios = destinatarios.length
    if (destinatarios.length === 0) return resultado

    const enviar = p.enviar ?? enviarEmailAppSemFalhar
    const subject = assuntoImediato(p.trabalhador, p.entrada.work_date)
    const body = corpoImediato({ trabalhador: p.trabalhador, entrada: p.entrada, quemRegistou: p.quemRegistou })
    const periodo = `imediato:${p.entrada.id ?? `${p.entrada.work_date}:${p.entrada.amount}`}`

    for (const d of destinatarios) {
      const novo = await marcar(supabase, {
        recipientId: d.id, periodicidade: 'imediato', periodo, entradas: 1,
      })
      if (!novo) { resultado.saltados++; continue }

      const r = await enviar({ to: d.email, subject, body, context: 'alerta_ponto_imediato' })
      if (r.enviado) { resultado.enviados++; resultado.detalhe.push(`${d.email}: enviado`) }
      else {
        resultado.falhados++
        resultado.detalhe.push(`${d.email}: ${r.erro ?? 'falhou'}`)
        await registarFalha(supabase, { recipientId: d.id, periodicidade: 'imediato', periodo, erro: r.erro ?? 'falhou' })
      }
    }
  } catch (e: any) {
    // Um alerta nunca pode fazer falhar o registo de horas.
    console.error('[alerta imediato]', e?.message ?? e)
    resultado.detalhe.push(`erro: ${e?.message ?? e}`)
  }

  return resultado
}

// ------------------------------------------------------------------ resumos

/**
 * Resumo de um período para todos os destinatários dessa periodicidade.
 * Sem entradas no período, não envia nada a ninguém.
 */
export async function enviarResumos(
  supabase: any,
  p: {
    periodicidade: 'diario' | 'semanal' | 'mensal'
    hojeISO: string
    enviar?: Enviador
  },
): Promise<ResultadoAlertas> {
  const periodo = periodoDe(p.periodicidade, p.hojeISO)
  const resultado: ResultadoAlertas = {
    periodo, destinatarios: 0, enviados: 0, saltados: 0, falhados: 0, semEntradas: false, detalhe: [],
  }

  const destinatarios = await destinatariosDe(supabase, p.periodicidade)
  resultado.destinatarios = destinatarios.length
  if (destinatarios.length === 0) return resultado

  const { data: entradas } = await supabase
    .from('work_entries')
    .select('id, work_date, start_time, end_time, hours, amount, description, entry_type, is_holiday, worker_id, worker:workers(name)')
    .gte('work_date', periodo.inicio)
    .lte('work_date', periodo.fim)

  const lista = (entradas ?? []) as EntradaDoResumo[]
  const corpo = corpoResumo(p.periodicidade, periodo, lista)

  // Sem entradas no período não há e-mail — em nenhuma periodicidade.
  if (!corpo) {
    resultado.semEntradas = true
    resultado.detalhe.push(`sem entradas entre ${periodo.inicio} e ${periodo.fim}`)
    return resultado
  }

  const subject = assuntoResumo(p.periodicidade, periodo)
  const enviar = p.enviar ?? enviarEmailApp
  const quantas = agruparResumo(lista).reduce((s, g) => s + g.dias, 0)

  for (const d of destinatarios) {
    const novo = await marcar(supabase, {
      recipientId: d.id, periodicidade: p.periodicidade, periodo: periodo.chave, entradas: quantas,
    })
    if (!novo) {
      resultado.saltados++
      resultado.detalhe.push(`${d.email}: já tinha sido enviado`)
      continue
    }

    const r = await enviar({ to: d.email, subject, body: corpo, context: `alerta_ponto_${p.periodicidade}` })
    if (r.enviado) { resultado.enviados++; resultado.detalhe.push(`${d.email}: enviado`) }
    else {
      resultado.falhados++
      resultado.detalhe.push(`${d.email}: ${r.erro ?? 'falhou'}`)
      await registarFalha(supabase, {
        recipientId: d.id, periodicidade: p.periodicidade, periodo: periodo.chave, erro: r.erro ?? 'falhou',
      })
    }
  }

  return resultado
}
