import { createClient } from '@supabase/supabase-js'

/**
 * Devolve os endereços de e-mail de todos os administradores da aplicação.
 *
 * Os e-mails vivem em auth.users (não em profiles), por isso é preciso o
 * service role. Usado para pôr todos os administradores em CC em qualquer
 * e-mail enviado pela aplicação.
 */
export async function getAdminEmails(): Promise<string[]> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, role')
      .eq('role', 'admin')

    if (!profiles || profiles.length === 0) return []

    const adminIds = new Set(profiles.map(p => p.id))
    const { data, error } = await supabase.auth.admin.listUsers()
    if (error || !data) return []

    return data.users
      .filter(u => adminIds.has(u.id) && u.email)
      .map(u => u.email as string)
  } catch (e) {
    console.error('getAdminEmails falhou:', e)
    return []
  }
}
