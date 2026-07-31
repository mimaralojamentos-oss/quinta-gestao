import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { requireAdmin } from '@/lib/require-admin'
import { getEmailSettings, getEmailSettingsPublic, saveEmailSettings } from '@/lib/emailSettings'
import { applySubjectPrefix } from '@/lib/emailConfig'

// Gestão das definições de envio de e-mail. Só administradores.
// A palavra-passe nunca sai daqui para o navegador.

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  return NextResponse.json({ success: true, settings: await getEmailSettingsPublic() })
}

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const values = await request.json()

    if (values.smtpUser && !String(values.smtpUser).includes('@')) {
      return NextResponse.json({ error: 'O utilizador SMTP deve ser um endereço de e-mail' }, { status: 400 })
    }
    if (values.fromEmail && !String(values.fromEmail).includes('@')) {
      return NextResponse.json({ error: 'O endereço de remetente é inválido' }, { status: 400 })
    }

    const error = await saveEmailSettings(values, auth.user?.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ success: true, settings: await getEmailSettingsPublic() })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Erro ao guardar' }, { status: 500 })
  }
}

// Envia um e-mail de teste ao próprio administrador, para confirmar
// que a configuração funciona antes de a usar com inquilinos.
export async function PUT(request: Request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const { testTo } = await request.json()
    const destino = testTo || auth.user?.email
    if (!destino) return NextResponse.json({ error: 'Indica um endereço de destino' }, { status: 400 })

    const settings = await getEmailSettings()
    if (!settings.smtpUser || !settings.smtpPassword) {
      return NextResponse.json({ error: 'Configuração incompleta. Guarda as definições primeiro.' }, { status: 400 })
    }

    const transporter = nodemailer.createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort,
      secure: settings.smtpPort === 465,
      auth: { user: settings.smtpUser, pass: settings.smtpPassword },
    })

    await transporter.verify()

    await transporter.sendMail({
      from: `"${settings.fromName}" <${settings.fromEmail}>`,
      to: destino,
      replyTo: settings.replyTo ?? settings.fromEmail,
      subject: applySubjectPrefix('Teste de configuração', settings.subjectPrefix),
      text: `Este é um e-mail de teste enviado pela aplicação.

Servidor: ${settings.smtpHost}:${settings.smtpPort}
Remetente: ${settings.fromName} <${settings.fromEmail}>
Prefixo do assunto: ${settings.subjectPrefix}

Se recebeste esta mensagem, a configuração está correta.`,
    })

    return NextResponse.json({ success: true, sentTo: destino })
  } catch (e: any) {
    console.error('[email-settings:test]', e)
    return NextResponse.json({ error: e.message ?? 'Falha no teste de envio' }, { status: 500 })
  }
}
