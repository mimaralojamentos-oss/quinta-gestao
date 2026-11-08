import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireRole } from '@/lib/require-role'
import { enviarAlertaImediato } from '@/lib/timesheetAlertSender'

/**
 * Alerta imediato de uma entrada da Folha de Ponto, pedido pelo ecrã do
 * gestor depois de gravar um registo.
 *
 * O ecrã só manda o id da entrada: os dados do e-mail são lidos aqui, no
 * servidor. As entradas que o trabalhador grava pelo link não passam por
 * aqui — essas são tratadas dentro do próprio /api/ponto, que já corre com
 * a service role.
 *
 * Responde sempre 200 com o que aconteceu: quem chamou já gravou a entrada
 * e um alerta falhado não pode parecer um erro de gravação.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin', 'coadmin'])
  if (auth.error) return auth.error

  const body = await request.json().catch(() => ({}))
  const entryId = String(body?.entryId ?? '')
  if (!entryId) return NextResponse.json({ error: 'Falta indicar a entrada.' }, { status: 400 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const { data: entrada } = await supabase
    .from('work_entries')
    .select('id, work_date, start_time, end_time, hours, amount, description, entry_type, is_holiday, worker:workers(name)')
    .eq('id', entryId)
    .maybeSingle()

  if (!entrada) return NextResponse.json({ error: 'Entrada não encontrada.' }, { status: 404 })

  const resultado = await enviarAlertaImediato(supabase, {
    entrada: entrada as any,
    trabalhador: (entrada as any).worker?.name ?? '(trabalhador)',
    quemRegistou: auth.user?.email ?? 'o gestor',
  })

  return NextResponse.json({ success: true, ...resultado })
}
