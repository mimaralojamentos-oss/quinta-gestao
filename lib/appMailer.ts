import nodemailer from 'nodemailer'
import { applySubjectPrefix } from './emailConfig'
import { getEmailSettings } from './emailSettings'
import { recordSentEmail } from './sentEmails'
import { buildAppEmailHtml } from './appEmailHtml'

/**
 * O envio de e-mail da aplicação, num sítio só.
 *
 * Junta o que já existia espalhado pelas rotas: as definições SMTP da base
 * de dados (lib/emailSettings), o prefixo obrigatório do assunto
 * (lib/emailConfig), a moldura HTML (lib/appEmailHtml) e o registo no
 * histórico (lib/sentEmails).
 *
 * Serve tanto as rotas com sessão (/api/send-email) como as que correm sem
 * utilizador — o alerta imediato da folha de ponto, que é disparado pelo
 * link do trabalhador, e os resumos enviados pelo cron.
 */

export interface EnvioApp {
  to: string
  subject: string
  /** Texto simples; a moldura converte as linhas em HTML. */
  body: string
  cc?: string[]
  replyTo?: string | null
  senderName?: string | null
  footerNote?: string | null
  /** Área da app que pediu o e-mail, para o histórico. */
  context?: string | null
  recipientName?: string | null
  sentById?: string | null
  sentByEmail?: string | null
}

export interface ResultadoEnvio {
  enviado: boolean
  subject: string
  erro?: string
}

/**
 * Envia e registra. Nunca lança: devolve o erro, porque há caminhos onde um
 * e-mail falhado não pode fazer falhar a operação que o pediu.
 */
export async function enviarEmailApp(envio: EnvioApp): Promise<ResultadoEnvio> {
  const settings = await getEmailSettings()
  const subject = applySubjectPrefix(envio.subject, settings.subjectPrefix)

  if (!settings.smtpUser || !settings.smtpPassword) {
    const erro = 'O envio de e-mail não está configurado (Administração → Definições de E-mail).'
    await registar(envio, subject, 'erro', erro)
    return { enviado: false, subject, erro }
  }

  try {
    const transporter = nodemailer.createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort,
      secure: settings.smtpPort === 465,
      auth: { user: settings.smtpUser, pass: settings.smtpPassword },
    })

    const displayName = envio.senderName ?? settings.fromName
    await transporter.sendMail({
      from: `"${displayName}" <${settings.fromEmail}>`,
      to: envio.to,
      cc: envio.cc && envio.cc.length > 0 ? envio.cc.join(', ') : undefined,
      subject,
      html: buildAppEmailHtml({
        displayName, body: envio.body, fromName: settings.fromName, footerNote: envio.footerNote,
      }),
      text: envio.body,
      replyTo: envio.replyTo ?? settings.replyTo ?? settings.fromEmail,
    })

    await registar(envio, subject, 'enviado')
    return { enviado: true, subject }
  } catch (e: any) {
    const erro = e?.message ?? 'Erro desconhecido ao enviar o e-mail'
    console.error('[appMailer]', erro)
    await registar(envio, subject, 'erro', erro)
    return { enviado: false, subject, erro }
  }
}

function registar(envio: EnvioApp, subject: string, status: 'enviado' | 'erro', erro?: string) {
  return recordSentEmail({
    toEmail: envio.to,
    toName: envio.recipientName ?? null,
    ccEmails: envio.cc ?? [],
    subject,
    body: envio.body,
    context: envio.context ?? null,
    sentById: envio.sentById ?? null,
    sentByEmail: envio.sentByEmail ?? null,
    status,
    errorMessage: erro ?? null,
  })
}

/**
 * Envia sem nunca atrasar nem fazer falhar quem chamou.
 *
 * Numa função serverless não há forma garantida de continuar trabalho depois
 * da resposta, por isso espera-se — mas com um tempo limite curto: passado
 * esse tempo segue-se o caminho normal e o envio fica a correr sozinho, com
 * o resultado (ou a falha) a ficar no histórico de e-mails.
 */
export async function enviarEmailAppSemFalhar(
  envio: EnvioApp,
  limiteMs = 3000,
): Promise<ResultadoEnvio> {
  const envioComApanha = enviarEmailApp(envio).catch((e: any) => ({
    enviado: false, subject: envio.subject, erro: e?.message ?? 'erro desconhecido',
  }))
  const aTempo = new Promise<ResultadoEnvio>(resolve =>
    setTimeout(() => resolve({ enviado: false, subject: envio.subject, erro: 'ainda a enviar' }), limiteMs))
  return Promise.race([envioComApanha, aTempo])
}
