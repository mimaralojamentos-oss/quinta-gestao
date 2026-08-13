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

/** Trava simples contra tentativas às cegas do código de 4 dígitos. */
const tentativas = new Map<string, { contador: number; ate: number }>()

function bloqueado(token: string): boolean {
  const t = tentativas.get(token)
  if (!t) return false
  if (Date.now() > t.ate) { tentativas.delete(token); return false }
  return t.contador >= 5
}

function registarFalha(token: string) {
  const agora = Date.now()
  const t = tentativas.get(token)
  if (!t || agora > t.ate) {
    tentativas.set(token, { contador: 1, ate: agora + 15 * 60 * 1000 })
  } else {
    t.contador += 1
  }
}

async function autenticar(token: string, pin: string) {
  if (!token || !pin) return { erro: 'Faltam dados de acesso.' as const }
  if (bloqueado(token)) {
    return { erro: 'Demasiadas tentativas erradas. Tenta daqui a 15 minutos.' as const }
  }

  const supabase = adminClient()
  const { data: worker } = await supabase
    .from('workers')
    .select('*')
    .eq('access_token', token)
    .maybeSingle()

  if (!worker) { registarFalha(token); return { erro: 'Link inválido.' as const } }
  if (String(worker.pin) !== String(pin)) {
    registarFalha(token)
    return { erro: 'Código errado.' as const }
  }
  if (!worker.active) return { erro: 'Este acesso foi desativado. Fala com o gestor.' as const }

  tentativas.delete(token)
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
