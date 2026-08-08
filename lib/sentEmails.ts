import { createClient } from '@supabase/supabase-js'

/**
 * Registo dos e-mails enviados pela aplicação.
 *
 * Grava sempre no servidor, logo a seguir à tentativa de envio, para que
 * nenhum e-mail fique de fora — nem os que falham. O corpo completo fica
 * guardado, ao contrário do log de acessos, que só guardava o assunto.
 *
 * A escrita é feita com a service role porque a tabela só dá permissão de
 * LEITURA aos utilizadores. Assim ninguém consegue apagar nem forjar
 * histórico de e-mails a partir do navegador.
 */

export interface SentEmailRecord {
  toEmail: string
  toName?: string | null
  ccEmails?: string[] | null
  subject: string
  body: string
  /** Área da app que pediu o e-mail (inquilino, dívida, livre...). */
  context?: string | null
  sentById?: string | null
  sentByEmail?: string | null
  status: 'enviado' | 'erro'
  errorMessage?: string | null
}

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

/**
 * Guarda o registo. Nunca lança exceção: falhar a gravar o histórico não
 * pode fazer falhar um e-mail que já saiu.
 */
export async function recordSentEmail(record: SentEmailRecord): Promise<void> {
  try {
    const supabase = adminClient()
    const { error } = await supabase.from('sent_emails').insert({
      to_email: record.toEmail,
      to_name: record.toName ?? null,
      cc_emails: record.ccEmails?.length ? record.ccEmails.join(', ') : null,
      subject: record.subject,
      body: record.body,
      context: record.context ?? null,
      sent_by: record.sentById ?? null,
      sent_by_email: record.sentByEmail ?? null,
      status: record.status,
      error_message: record.errorMessage ?? null,
    })
    if (error) console.error('[sent_emails] não foi possível registar:', error.message)
  } catch (e) {
    console.error('[sent_emails] erro inesperado ao registar:', e)
  }
}
