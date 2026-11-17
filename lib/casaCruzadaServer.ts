import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { crossConfigurada } from './casaCruzada'

/**
 * A ligação à base de dados da outra casa. SÓ SERVIDOR.
 *
 * A chave é a service role da outra casa e vive em `CROSS_SUPABASE_SERVICE_KEY`
 * — sem `NEXT_PUBLIC_`, por isso o Next nunca a inclui no pacote do browser.
 * Nenhuma resposta da API a devolve, nem devolve o URL: o telemóvel só vê
 * nomes de casas e os seus próprios registos.
 *
 * Devolve null quando a ligação não está configurada, e é isso que desliga a
 * funcionalidade toda sem mais nenhuma condição espalhada pelo código.
 */
export function crossClient(): SupabaseClient | null {
  if (!crossConfigurada()) return null
  return createClient(
    process.env.CROSS_SUPABASE_URL!,
    process.env.CROSS_SUPABASE_SERVICE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}
