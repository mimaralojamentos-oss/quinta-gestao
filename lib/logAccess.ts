import { createClient } from './supabase-client'

interface LogAccessParams {
  action: string
  page: string
  details?: string
}

// Regista uma ação do utilizador na tabela access_logs.
// Falhas de log não devem interromper o fluxo principal da aplicação.
export async function logAccess({ action, page, details }: LogAccessParams): Promise<void> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { error } = await supabase.from('access_logs').insert({
    user_id: user.id,
    user_email: user.email ?? null,
    action,
    page,
    details: details ?? null,
  })

  if (error) console.error('Erro ao registar log de acesso:', error)
}
