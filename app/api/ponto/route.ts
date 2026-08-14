import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  calcularHoras, calcularConta, tarifaDoDia, ehDiaEspecial,
  type Worker,
} from '@/lib/ponto'

/**
 * Porta de entrada da folha de ponto para os trabalhadores.
 *
 * O trabalhador não tem conta no site nem sessão. Entra por um link secreto
 * e escreve um código de 4 dígitos. Toda a validação é feita AQUI, no
 * servidor — o telemóvel dele nunca fala diretamente com a base de dados.
 *
 * Por isso:
 *   - O preço/hora é decidido pelo servidor, nunca vem do telemóvel.
 *     Se viesse, qualquer pessoa podia inflacionar o que tem a receber.
 *   - Só devolve os dados do próprio trabalhador. Nunca a lista de todos,
 *     nem nada do resto da aplicação.
 */

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

const MAX_TENTATIVAS = 5
const MINUTOS_BLOQUEIO = 15

/**
 * Comparação que demora sempre o mesmo tempo, independentemente de onde
 * os valores diferem. Evita que se descubra o código medindo o tempo
 * de resposta do servidor.
 */
function iguaisEmTempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diferenca = 0
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diferenca === 0
}

/** Deixa rasto dos acessos à folha de ponto no registo geral da aplicação. */
async function registarAcesso(supabase: any, nome: string, acao: string, detalhes: string) {
  try {
    await supabase.from('access_logs').insert({
      user_id: null,
      user_email: `ponto:${nome}`,
      action: acao,
      page: '/ponto',
      details: detalhes,
    })
  } catch { /* nunca impedir o trabalhador de trabalhar por causa do registo */ }
}

/**
 * Valida o link secreto e o código de 4 dígitos.
 *
 * O travão de tentativas vive na base de dados, não na memória do servidor.
 * Em memória não servia de nada: o Vercel arranca instâncias novas a toda a
 * hora e o contador voltava a zero, deixando tentar o código à vontade —
 * são só 10 mil combinações.
 */
async function autenticar(token: string, pin: string) {
  if (!token || !pin) return { erro: 'Faltam dados de acesso.' as const }

  const supabase = adminClient()
  const { data: worker } = await supabase
    .from('workers')
    .select('*')
    .eq('access_token', token)
    .maybeSingle()

  // Resposta igual para link inexistente e código errado, para não confirmar
  // a quem tenta às cegas que encontrou um link válido.
  if (!worker) return { erro: 'Link ou código inválidos.' as const }

  if (worker.locked_until && new Date(worker.locked_until) > new Date()) {
    const minutos = Math.ceil((new Date(worker.locked_until).getTime() - Date.now()) / 60000)
    return { erro: `Demasiadas tentativas erradas. Tenta daqui a ${minutos} minuto(s).` as const }
  }

  if (!iguaisEmTempoConstante(String(worker.pin), String(pin))) {
    const falhas = (worker.failed_attempts ?? 0) + 1
    const bloquear = falhas >= MAX_TENTATIVAS
    await supabase.from('workers').update({
      failed_attempts: bloquear ? 0 : falhas,
      locked_until: bloquear ? new Date(Date.now() + MINUTOS_BLOQUEIO * 60000).toISOString() : null,
    }).eq('id', worker.id)

    if (bloquear) {
      await registarAcesso(supabase, worker.name, 'login',
        `Acesso à folha de ponto bloqueado após ${MAX_TENTATIVAS} códigos errados`)
      return { erro: `Demasiadas tentativas erradas. Tenta daqui a ${MINUTOS_BLOQUEIO} minutos.` as const }
    }
    return { erro: 'Link ou código inválidos.' as const }
  }

  if (!worker.active) return { erro: 'Este acesso foi desativado. Fala com o gestor.' as const }

  // Código certo: limpa o contador de falhas
  if (worker.failed_attempts || worker.locked_until) {
    await supabase.from('workers').update({ failed_attempts: 0, locked_until: null }).eq('id', worker.id)
  }

  return { worker: worker as Worker, supabase }
}

/** Dados do trabalhador: registos, pagamentos e saldo. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { token, pin, acao } = body

  const auth = await autenticar(String(token ?? ''), String(pin ?? ''))
  if ('erro' in auth) return NextResponse.json({ error: auth.erro }, { status: 401 })

  const { worker, supabase } = auth

  // ---------------------------------------------------------- registar
  if (acao === 'registar') {
    const { work_date, start_time, end_time, description } = body

    if (!work_date || !start_time || !end_time) {
      return NextResponse.json({ error: 'Indica a data, a hora de entrada e a hora de saída.' }, { status: 400 })
    }

    // Não deixar registar dias futuros — evita enganos na data.
    const hoje = new Date()
    const hojeISO = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`
    if (String(work_date) > hojeISO) {
      return NextResponse.json({ error: 'Não é possível registar horas de um dia que ainda não chegou.' }, { status: 400 })
    }

    const horas = calcularHoras(String(start_time), String(end_time))
    if (horas <= 0) {
      return NextResponse.json({ error: 'A hora de saída tem de ser depois da hora de entrada.' }, { status: 400 })
    }
    if (horas > 16) {
      return NextResponse.json({ error: 'Mais de 16 horas seguidas? Confirma as horas, deve haver engano.' }, { status: 400 })
    }

    // A tarifa é decidida aqui, com base no dia. Nunca vem do telemóvel.
    const tarifa = tarifaDoDia(worker, String(work_date))
    const especial = ehDiaEspecial(String(work_date))
    const valor = parseFloat((horas * tarifa).toFixed(2))

    const { error } = await supabase.from('work_entries').insert({
      worker_id: worker.id,
      work_date,
      start_time,
      end_time,
      hours: horas,
      is_holiday: especial,
      hourly_rate: tarifa,
      amount: valor,
      description: description ? String(description).slice(0, 500) : null,
      created_by: 'trabalhador',
    })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await registarAcesso(supabase, worker.name, 'criar',
      `Trabalhador registou ${horas}h em ${work_date} (${start_time}-${end_time}) — ${valor.toFixed(2)} EUR`)
  }

  // ---------------------------------------------------------- devolver
  const [entriesRes, paymentsRes] = await Promise.all([
    supabase.from('work_entries').select('*').eq('worker_id', worker.id),
    supabase.from('worker_payments').select('id, payment_date, amount, payment_method, notes').eq('worker_id', worker.id),
  ])

  const conta = calcularConta(entriesRes.data ?? [], (paymentsRes.data ?? []) as any)

  return NextResponse.json({
    worker: {
      name: worker.name,
      hourly_rate: worker.hourly_rate,
      hourly_rate_holiday: worker.hourly_rate_holiday,
    },
    ...conta,
    pagamentos: (paymentsRes.data ?? []).sort((a: any, b: any) =>
      String(b.payment_date).localeCompare(String(a.payment_date))),
  })
}
