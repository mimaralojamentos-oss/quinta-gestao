import { createClient } from '@supabase/supabase-js'
import { DEFAULT_SUBJECT_PREFIX } from '@/lib/emailConfig'

// Definições de envio de e-mail.
//
// Vivem na base de dados (tabela email_settings) para poderem ser alteradas
// dentro da aplicação, sem mexer nas variáveis do Vercel.
//
// A tabela tem RLS ativo e NENHUMA política, por isso é inacessível a partir
// do navegador — nem para administradores. Só este código, que corre no
// servidor com a service role, lhe consegue aceder.
//
// Se a tabela ainda não estiver preenchida, usa as variáveis de ambiente
// (comportamento anterior), para a migração ser indolor.

export interface EmailSettings {
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPassword: string
  fromEmail: string
  fromName: string
  replyTo: string | null
  subjectPrefix: string
  /** De onde vieram as definições — útil para mostrar no ecrã. */
  source: 'base de dados' | 'variáveis de ambiente' | 'não configurado'
}

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function getEmailSettings(): Promise<EmailSettings> {
  const envPrefix = process.env.NEXT_PUBLIC_EMAIL_SUBJECT_PREFIX ?? DEFAULT_SUBJECT_PREFIX
  const envUser = process.env.GMAIL_USER ?? ''
  const envPass = process.env.GMAIL_APP_PASSWORD ?? ''

  let row: any = null
  try {
    const { data } = await adminClient()
      .from('email_settings').select('*').eq('id', 1).maybeSingle()
    row = data
  } catch {
    // Tabela ainda não criada — segue para as variáveis de ambiente.
  }

  const hasDbConfig = Boolean(row?.smtp_user && row?.smtp_password)

  if (hasDbConfig) {
    return {
      smtpHost: row.smtp_host || 'smtp.gmail.com',
      smtpPort: row.smtp_port ?? 587,
      smtpUser: row.smtp_user,
      smtpPassword: row.smtp_password,
      fromEmail: row.from_email || row.smtp_user,
      fromName: row.from_name || (process.env.NEXT_PUBLIC_APP_NAME ?? 'Gestão de Alojamentos'),
      replyTo: row.reply_to || null,
      subjectPrefix: row.subject_prefix || envPrefix,
      source: 'base de dados',
    }
  }

  if (envUser && envPass) {
    return {
      smtpHost: 'smtp.gmail.com',
      smtpPort: 587,
      smtpUser: envUser,
      smtpPassword: envPass,
      fromEmail: envUser,
      fromName: process.env.NEXT_PUBLIC_APP_NAME ?? 'Gestão de Alojamentos',
      replyTo: null,
      subjectPrefix: row?.subject_prefix || envPrefix,
      source: 'variáveis de ambiente',
    }
  }

  return {
    smtpHost: '', smtpPort: 587, smtpUser: '', smtpPassword: '',
    fromEmail: '', fromName: '', replyTo: null,
    subjectPrefix: row?.subject_prefix || envPrefix,
    source: 'não configurado',
  }
}

/** Versão segura para mostrar no ecrã — nunca inclui a palavra-passe. */
export async function getEmailSettingsPublic() {
  const s = await getEmailSettings()
  return {
    smtpHost: s.smtpHost,
    smtpPort: s.smtpPort,
    smtpUser: s.smtpUser,
    fromEmail: s.fromEmail,
    fromName: s.fromName,
    replyTo: s.replyTo,
    subjectPrefix: s.subjectPrefix,
    passwordSet: Boolean(s.smtpPassword),
    source: s.source,
    configured: Boolean(s.smtpUser && s.smtpPassword),
  }
}

export async function saveEmailSettings(values: Record<string, any>, userId?: string) {
  const update: Record<string, any> = {
    id: 1,
    smtp_host: values.smtpHost || null,
    smtp_port: values.smtpPort ? Number(values.smtpPort) : 587,
    smtp_user: values.smtpUser || null,
    from_email: values.fromEmail || null,
    from_name: values.fromName || null,
    reply_to: values.replyTo || null,
    subject_prefix: values.subjectPrefix || null,
    updated_at: new Date().toISOString(),
    updated_by: userId ?? null,
  }

  // A palavra-passe só é substituída se o utilizador escrever uma nova.
  // Assim pode editar os outros campos sem a voltar a escrever.
  if (values.smtpPassword) update.smtp_password = values.smtpPassword

  const { error } = await adminClient().from('email_settings').upsert(update, { onConflict: 'id' })
  return error
}
