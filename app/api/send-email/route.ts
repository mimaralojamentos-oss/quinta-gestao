import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'

export async function POST(request: NextRequest) {
  try {
    const { to, subject, body, replyTo, senderName, footerNote } = await request.json()

    if (!to || !subject || !body) {
      return NextResponse.json({ error: 'Campos obrigatórios: to, subject, body' }, { status: 400 })
    }

    const gmailUser = process.env.GMAIL_USER
    const gmailPass = process.env.GMAIL_APP_PASSWORD

    if (!gmailUser || !gmailPass) {
      return NextResponse.json({ error: 'Credenciais Gmail não configuradas no servidor' }, { status: 500 })
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPass },
    })

    const appName = process.env.NEXT_PUBLIC_APP_NAME ?? 'Gestão de Alojamentos'
    const appLocation = process.env.NEXT_PUBLIC_APP_LOCATION ?? 'Évora'
    const displayName = senderName ?? appName
    const footer = footerNote ? `${footerNote} · ${appLocation}` : `${appName} · ${appLocation}`

    const htmlBody = `
<!DOCTYPE html>
<html lang="pt">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Arial,sans-serif">
  <div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08)">
    <div style="background:#059669;padding:24px 32px">
      <h1 style="margin:0;color:#ffffff;font-size:18px;font-weight:700">${displayName}</h1>
      <p style="margin:4px 0 0;color:#a7f3d0;font-size:13px">${appLocation}</p>
    </div>
    <div style="padding:32px;color:#374151;font-size:15px;line-height:1.7">
      ${body.replace(/\n/g, '<br>')}
    </div>
    <div style="padding:16px 32px;background:#f3f4f6;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af">
      ${footer}
    </div>
  </div>
</body>
</html>`

    await transporter.sendMail({
      from: `"${displayName}" <${gmailUser}>`,
      to,
      subject,
      html: htmlBody,
      text: body,
      replyTo: replyTo ?? gmailUser,
    })

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('[send-email]', e)
    return NextResponse.json({ error: e.message ?? 'Erro ao enviar e-mail' }, { status: 500 })
  }
}
