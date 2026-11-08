import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cronAutorizado, hojeEmLisboa, periodicidadesDoFimDoDia } from '@/lib/timesheetAlerts'
import { enviarResumos, type ResultadoAlertas } from '@/lib/timesheetAlertSender'

/**
 * Os resumos agendados da Folha de Ponto.
 *
 * Chamada pelos Cron Jobs do Vercel (ver vercel.json), dois por dia:
 *   09:00 UTC  ?tipo=diario      → resumo do dia anterior
 *   20:00 UTC  ?tipo=fim-do-dia  → semanal se for sexta, mensal se for o
 *                                  último dia do mês (podem coincidir, e aí
 *                                  saem os dois e-mails)
 *
 * Os crons do Vercel correm em UTC; no horário de verão os envios caem uma
 * hora mais tarde em Lisboa, o que é aceitável. Já a DECISÃO de que dia é
 * hoje (sexta? último do mês?) é feita no fuso de Lisboa, para não enviar o
 * resumo do mês no dia errado.
 *
 * Protegida pelo CRON_SECRET: sem o header correto responde 401. É
 * idempotente — cada envio deixa marca e a segunda corrida do mesmo dia não
 * repete nada (ver lib/timesheetAlertSender).
 */
export async function GET(request: NextRequest) {
  if (!cronAutorizado(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const tipo = request.nextUrl.searchParams.get('tipo') ?? 'diario'
  // Permite ensaiar um dia concreto sem esperar pelo calendário.
  const hoje = request.nextUrl.searchParams.get('dia') ?? hojeEmLisboa()

  const quais: ('diario' | 'semanal' | 'mensal')[] = tipo === 'fim-do-dia'
    ? periodicidadesDoFimDoDia(hoje)
    : ['diario']

  const resultados: Record<string, ResultadoAlertas> = {}
  for (const periodicidade of quais) {
    resultados[periodicidade] = await enviarResumos(supabase, { periodicidade, hojeISO: hoje })
  }

  return NextResponse.json({
    success: true,
    dia: hoje,
    tipo,
    periodicidades: quais,
    resultados,
  })
}
