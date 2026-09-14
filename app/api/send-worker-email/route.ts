import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { createClient } from '@supabase/supabase-js'
import { requireRole } from '@/lib/require-role'
import { getAdminEmails } from '@/lib/adminEmails'
import { getEmailSettings } from '@/lib/emailSettings'
import { recordSentEmail } from '@/lib/sentEmails'
import { buildAppEmailHtml } from '@/lib/appEmailHtml'
import { DEFAULT_SENDER_NAME } from '@/lib/emailConfig'
import {
  enviarEmailsTrabalhadores, validarModelo,
  type ResultadoEnvio, type WorkerEmailRecipient, type WorkerEmailTemplate,
} from '@/lib/workerEmails'

/**
 * Envio de e-mails aos trabalhadores da folha de ponto.
 *
 * O navegador manda apenas os ids, o modelo e o texto com marcadores. Os
 * dados secretos (link e código) são lidos AQUI e preenchidos trabalhador a
 * trabalhador — um e-mail individual para cada um, sem nunca juntar
 * destinatários. As regras vivem em lib/workerEmails.ts.
 *
 * Usa as mesmas definições SMTP, prefixo de assunto, moldura HTML e registo
 * de e-mails enviados que /api/send-email.
 */
export async function POST(request: NextRequest) {
  // Mesmas permissões de /api/send-email: o Super Leitor não envia.
  const auth = await requireRole(['admin', 'coadmin'])
  if (auth.error) return auth.error

  try {
    const payload = await request.json().catch(() => null)
    const workerIds: unknown = payload?.workerIds
    const template = payload?.template as WorkerEmailTemplate
    const subject = String(payload?.subject ?? '')
    const body = String(payload?.body ?? '')

    if (!Array.isArray(workerIds) || workerIds.length === 0 || workerIds.length > 200
      || !workerIds.every(id => typeof id === 'string' && id)) {
      return NextResponse.json({ error: 'Escolhe pelo menos um trabalhador.' }, { status: 400 })
    }
    if (template !== 'acesso' && template !== 'livre') {
      return NextResponse.json({ error: 'Modelo de e-mail desconhecido.' }, { status: 400 })
    }
    const erroModelo = validarModelo(template, subject, body)
    if (erroModelo) return NextResponse.json({ error: erroModelo }, { status: 400 })

    const settings = await getEmailSettings()
    if (!settings.smtpUser || !settings.smtpPassword) {
      return NextResponse.json({
        error: 'O envio de e-mail ainda não está configurado. Vai a Administração → Definições de E-mail.',
      }, { status: 500 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const ids = [...new Set(workerIds as string[])]
    const { data, error } = await supabase
      .from('workers')
      .select('id, name, email, access_token, pin, phone_os, active')
      .in('id', ids)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const porId = new Map((data ?? []).map(w => [w.id, w as WorkerEmailRecipient]))
    const workers = ids.map(id => porId.get(id)).filter((w): w is WorkerEmailRecipient => !!w)

    const senderName = DEFAULT_SENDER_NAME
    const transporter = nodemailer.createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort,
      secure: settings.smtpPort === 465,
      auth: { user: settings.smtpUser, pass: settings.smtpPassword },
    })

    const resultados: ResultadoEnvio[] = await enviarEmailsTrabalhadores({
      workers, template, subject, body,
      origin: request.nextUrl.origin,
      senderName,
      subjectPrefix: settings.subjectPrefix,
    }, {
      // Só a mensagem livre leva os administradores em CC.
      adminEmails: template === 'livre' ? await getAdminEmails() : [],
      send: async m => {
        await transporter.sendMail({
          from: `"${senderName}" <${settings.fromEmail}>`,
          to: m.to,
          cc: m.cc.length > 0 ? m.cc.join(', ') : undefined,
          subject: m.subject,
          html: buildAppEmailHtml({ displayName: senderName, body: m.body, fromName: settings.fromName }),
          text: m.body,
          replyTo: settings.replyTo ?? settings.fromEmail,
        })
      },
      record: r => recordSentEmail({
        ...r,
        sentById: auth.user?.id ?? null,
        sentByEmail: auth.user?.email ?? null,
      }),
    })

    for (const id of ids.filter(id => !porId.has(id))) {
      resultados.push({ workerId: id, name: '—', email: null, status: 'ignorado', motivo: 'trabalhador não encontrado' })
    }

    return NextResponse.json({ success: true, resultados })
  } catch (e: any) {
    console.error('[send-worker-email]', e)
    return NextResponse.json({ error: e.message ?? 'Erro ao enviar os e-mails' }, { status: 500 })
  }
}
