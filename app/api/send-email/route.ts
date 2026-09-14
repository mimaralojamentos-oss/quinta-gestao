import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { requireRole } from '@/lib/require-role'
import { getAdminEmails } from '@/lib/adminEmails'
import { applySubjectPrefix } from '@/lib/emailConfig'
import { getEmailSettings } from '@/lib/emailSettings'
import { recordSentEmail } from '@/lib/sentEmails'
import { buildAppEmailHtml } from '@/lib/appEmailHtml'

export async function POST(request: NextRequest) {
  // Só quem tem sessão e permissão pode enviar e-mails em nome da empresa.
  // O Super Leitor está deliberadamente FORA desta lista: pode redigir e rever,
  // mas nunca enviar. Esta é a verificação que conta — o botão desativado no
  // ecrã é apenas conveniência.
  const auth = await requireRole(['admin', 'coadmin'])
  if (auth.error) return auth.error

  // Fora do try, para o bloco de erro conseguir registar a tentativa falhada.
  let payload: any = {}
  let finalSubject = ''
  let cc: string[] = []

  try {
    payload = await request.json()
    const { to, subject, body, replyTo, senderName, footerNote, skipAdminCc } = payload

    if (!to || !subject || !body) {
      return NextResponse.json({ error: 'Campos obrigatórios: to, subject, body' }, { status: 400 })
    }

    const settings = await getEmailSettings()

    if (!settings.smtpUser || !settings.smtpPassword) {
      return NextResponse.json({
        error: 'O envio de e-mail ainda não está configurado. Vai a Administração → Definições de E-mail.',
      }, { status: 500 })
    }

    // Prefixo obrigatório do assunto, aplicado no servidor para que nenhum
    // e-mail saia sem ele, independentemente de onde foi pedido.
    finalSubject = applySubjectPrefix(subject, settings.subjectPrefix)

    // Todos os administradores vão em CC.
    if (!skipAdminCc) {
      const admins = await getAdminEmails()
      const toList = String(to).split(/[,;]/).map(s => s.trim().toLowerCase())
      cc = admins.filter(e => !toList.includes(e.toLowerCase()))
    }

    const transporter = nodemailer.createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort,
      secure: settings.smtpPort === 465,
      auth: { user: settings.smtpUser, pass: settings.smtpPassword },
    })

    const displayName = senderName ?? settings.fromName
    const htmlBody = buildAppEmailHtml({ displayName, body, fromName: settings.fromName, footerNote })

    await transporter.sendMail({
      from: `"${displayName}" <${settings.fromEmail}>`,
      to,
      cc: cc.length > 0 ? cc.join(', ') : undefined,
      subject: finalSubject,
      html: htmlBody,
      text: body,
      replyTo: replyTo ?? settings.replyTo ?? settings.fromEmail,
    })

    // Histórico completo, incluindo o corpo do e-mail.
    await recordSentEmail({
      toEmail: String(to),
      toName: payload.recipientName ?? null,
      ccEmails: cc,
      subject: finalSubject,
      body: String(body),
      context: payload.context ?? null,
      sentById: auth.user?.id ?? null,
      sentByEmail: auth.user?.email ?? null,
      status: 'enviado',
    })

    return NextResponse.json({ success: true, subject: finalSubject, cc })
  } catch (e: any) {
    console.error('[send-email]', e)

    // As falhas também ficam registadas — é o que permite perceber
    // mais tarde porque é que um inquilino nunca recebeu o e-mail.
    if (payload?.to && payload?.subject) {
      await recordSentEmail({
        toEmail: String(payload.to),
        toName: payload.recipientName ?? null,
        ccEmails: cc,
        subject: finalSubject || String(payload.subject),
        body: String(payload.body ?? ''),
        context: payload.context ?? null,
        sentById: auth.user?.id ?? null,
        sentByEmail: auth.user?.email ?? null,
        status: 'erro',
        errorMessage: e.message ?? 'Erro desconhecido',
      })
    }

    return NextResponse.json({ error: e.message ?? 'Erro ao enviar e-mail' }, { status: 500 })
  }
}

// Devolve os destinatários em CC e o estado da configuração,
// para o utilizador os ver antes de enviar.
// O Super Leitor também pode ver esta informação.
export async function GET() {
  const auth = await requireRole(['admin', 'coadmin', 'super_reader'])
  if (auth.error) return auth.error

  const [admins, settings] = await Promise.all([getAdminEmails(), getEmailSettings()])

  return NextResponse.json({
    adminEmails: admins,
    subjectPrefix: settings.subjectPrefix,
    configured: Boolean(settings.smtpUser && settings.smtpPassword),
    canSend: auth.profile?.role === 'admin' || auth.profile?.role === 'coadmin',
  })
}
