import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/require-role'

export async function POST(req: NextRequest) {
  const auth = await requireRole(['admin', 'coadmin'])
  if (auth.error) return auth.error

  try {
    const { message, recipients } = await req.json()

    if (!message || !recipients || recipients.length === 0) {
      return NextResponse.json({ error: 'Mensagem e destinatários são obrigatórios' }, { status: 400 })
    }

    // Validar destinatários contra os números ativos em gate_phones
    const { data: validPhones } = await auth.supabase
      .from('gate_phones')
      .select('phone')
      .eq('active', true)

    const validPhoneSet = new Set((validPhones ?? []).map(p => p.phone))
    const recipientsToSend = recipients.filter((r: any) => validPhoneSet.has(r.phone))

    if (recipientsToSend.length === 0) {
      return NextResponse.json({ error: 'Nenhum destinatário válido encontrado em Portão' }, { status: 400 })
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const authToken = process.env.TWILIO_AUTH_TOKEN
    const fromNumber = process.env.TWILIO_PHONE_NUMBER

    if (!accountSid || !authToken || !fromNumber) {
      return NextResponse.json({ error: 'Configuração Twilio em falta' }, { status: 500 })
    }

    const results = []
    const errors = []

    for (const recipient of recipientsToSend) {
      try {
        // Formatar número para formato internacional
        let phone = recipient.phone.replace(/\s/g, '')
        if (!phone.startsWith('+')) {
          phone = '+351' + phone
        }

        const response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
          {
            method: 'POST',
            headers: {
              'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              From: fromNumber,
              To: phone,
              Body: message,
            }),
          }
        )

        const data = await response.json()

        if (data.error_code) {
          errors.push({ phone: recipient.phone, name: recipient.name, error: data.message })
        } else {
          results.push({ phone: recipient.phone, name: recipient.name, sid: data.sid })
        }
      } catch (e: any) {
        errors.push({ phone: recipient.phone, name: recipient.name, error: e.message })
      }
    }

    // Guardar log no Supabase
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    await supabase.from('sms_log').insert({
      message,
      recipients: recipientsToSend,
      sent_by: auth.user.email ?? auth.user.id,
      status: errors.length === 0 ? 'success' : errors.length === recipientsToSend.length ? 'failed' : 'partial',
    })

    return NextResponse.json({
      sent: results.length,
      errors: errors.length,
      details: { results, errors }
    })

  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
