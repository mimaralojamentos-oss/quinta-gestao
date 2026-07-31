import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { requireAdmin } from '@/lib/require-admin'
import { getEmailSettings, getEmailSettingsPublic, saveEmailSettings } from '@/lib/emailSettings'
import { applySubjectPrefix } from '@/lib/emailConfig'

// Gestão das definições de envio de e-mail. Só administradores.
// A palavra-passe nunca sai daqui para o navegador.

function isEmail(value: unknown): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim())
}

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

    // O utilizador SMTP NÃO é necessariamente um endereço de e-mail:
    //   Resend  → "resend"
    //   Mailgun → "postmaster@dominio.pt"
    //   Gmail   → "conta@gmail.com"
    // Por isso só se exige que não venha vazio.
    if (values.smtpUser !== undefined && !String(values.smtpUser).trim()) {
      return NextResponse.json({ error: 'O utilizador SMTP não pode ficar vazio' }, { status: 400 })
    }

    // Estes dois são endereços de e-mail a sério e valem a validação.
    if (values.fromEmail && !isEmail(values.fromEmail)) {
      return NextResponse.json({ error: 'O endereço de remetente é inválido' }, { status: 400 })
    }
    if (values.replyTo && !isEmail(values.replyTo)) {
      return NextResponse.json({ error: 'O endereço de resposta é inválido' }, { status: 400 })
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
