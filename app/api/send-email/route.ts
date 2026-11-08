import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/require-role'
import { getAdminEmails } from '@/lib/adminEmails'
import { getEmailSettings } from '@/lib/emailSettings'
import { enviarEmailApp } from '@/lib/appMailer'

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

    // Todos os administradores vão em CC.
    if (!skipAdminCc) {
      const admins = await getAdminEmails()
      const toList = String(to).split(/[,;]/).map(s => s.trim().toLowerCase())
      cc = admins.filter(e => !toList.includes(e.toLowerCase()))
    }

    // O envio, o prefixo do assunto, a moldura HTML e o registo no histórico
    // vivem todos em lib/appMailer — o mesmo caminho que o cron e o alerta
    // imediato da folha de ponto usam.
    const resultado = await enviarEmailApp({
      to: String(to), subject: String(subject), body: String(body),
      cc, replyTo, senderName, footerNote,
      context: payload.context ?? null,
      recipientName: payload.recipientName ?? null,
      sentById: auth.user?.id ?? null,
      sentByEmail: auth.user?.email ?? null,
    })
    finalSubject = resultado.subject

    if (!resultado.enviado) {
      return NextResponse.json({ error: resultado.erro ?? 'Erro ao enviar e-mail' }, { status: 500 })
    }

    return NextResponse.json({ success: true, subject: finalSubject, cc })
  } catch (e: any) {
    console.error('[send-email]', e)

    // As falhas do próprio envio já ficam registadas pelo appMailer; isto
    // apanha só o que falhe antes dele (payload inválido, definições, CC).
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
