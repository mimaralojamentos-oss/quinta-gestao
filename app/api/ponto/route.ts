import { NextRequest, NextResponse } from 'next/server'
import { enviarAlertaImediato } from '@/lib/timesheetAlertSender'
import { createClient } from '@supabase/supabase-js'
import {
  calcularHoras, calcularConta, tarifaDoDia, ehDiaEspecial, podeTrabalhadorCorrigir,
  type Worker,
} from '@/lib/ponto'
import {
  lerCasa, podeRegistarNaCasa, casasDisponiveis, crossConfigurada,
  nomeCasaLocal, nomeCasaCruzada, juntarContas, type Casa,
} from '@/lib/casaCruzada'
import { crossClient } from '@/lib/casaCruzadaServer'

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
 *
 * DUAS CASAS: quem trabalha para as duas tem aqui uma segunda ligação, à base
 * da outra casa, e escolhe em cada registo para quem trabalhou. O que vem do
 * telemóvel é só uma sugestão: antes de gravar confirma-se aqui que o
 * trabalhador TEM mapeamento (`cross_worker_id`) e lê-se a ficha dele na
 * outra casa, de onde sai a tarifa. Sem as variáveis de ambiente da segunda
 * ligação, nada disto existe e a app é a de sempre.
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

/** Validações comuns ao registar e ao corrigir: dia não futuro e horário plausível. */
function validarHorario(work_date: string, start_time: string, end_time: string): { erro: string } | { horas: number } {
  const hoje = new Date()
  const hojeISO = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`
  if (work_date > hojeISO) return { erro: 'Não é possível registar horas de um dia que ainda não chegou.' }

  const horas = calcularHoras(start_time, end_time)
  if (horas <= 0) return { erro: 'A hora de saída tem de ser depois da hora de entrada.' }
  if (horas > 16) return { erro: 'Mais de 16 horas seguidas? Confirma as horas, deve haver engano.' }
  return { horas }
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
    const casa = lerCasa(body.casa)

    if (!work_date || !start_time || !end_time) {
      return NextResponse.json({ error: 'Indica a data, a hora de entrada e a hora de saída.' }, { status: 400 })
    }

    // A casa é decidida AQUI. O telemóvel só sugere.
    const permissao = podeRegistarNaCasa(worker as any, casa)
    if (!permissao.ok) return NextResponse.json({ error: permissao.erro }, { status: 403 })

    // Dia não futuro e horário plausível — evita enganos na data.
    const validacao = validarHorario(String(work_date), String(start_time), String(end_time))
    if ('erro' in validacao) return NextResponse.json({ error: validacao.erro }, { status: 400 })
    const { horas } = validacao

    // Onde se grava e com que ficha. Na outra casa, a tarifa é a de LÁ: lê-se
    // a ficha dessa base, e se ela não existir não se inventa nada.
    const destino = casa === 'cruzada' ? crossClient() : supabase
    if (!destino) return NextResponse.json({ error: 'Esta app não está ligada à outra casa.' }, { status: 503 })

    let fichaDaCasa: Worker = worker
    let idNaCasa = worker.id
    if (casa === 'cruzada') {
      const { data: la } = await destino.from('workers')
        .select('id, name, hourly_rate, hourly_rate_holiday, active')
        .eq('id', (worker as any).cross_worker_id)
        .maybeSingle()
      if (!la) {
        return NextResponse.json(
          { error: 'A tua ficha na outra casa não foi encontrada. Fala com o gestor.' }, { status: 409 })
      }
      if (!la.active) {
        return NextResponse.json({ error: 'O teu acesso à outra casa está desativado.' }, { status: 403 })
      }
      fichaDaCasa = la as Worker
      idNaCasa = la.id
    }

    // A tarifa é decidida aqui, com base no dia e na casa. Nunca vem do telemóvel.
    const tarifa = tarifaDoDia(fichaDaCasa, String(work_date))
    const especial = ehDiaEspecial(String(work_date))
    const valor = parseFloat((horas * tarifa).toFixed(2))

    const { data: criada, error } = await destino.from('work_entries').insert({
      worker_id: idNaCasa,
      work_date,
      start_time,
      end_time,
      hours: horas,
      is_holiday: especial,
      hourly_rate: tarifa,
      amount: valor,
      description: description ? String(description).slice(0, 500) : null,
      created_by: 'trabalhador',
      // Pelo link só se registam horas. Os registos de valor fixo são
      // lançados pelo gestor no backoffice.
      entry_type: 'horas',
    }).select('id, work_date, start_time, end_time, hours, amount, description, entry_type, is_holiday').maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Alerta imediato a quem o pediu, com a configuração da casa onde o
    // registo ficou: destinatários, definições de e-mail e histórico saem
    // todos dessa base. Nunca faz falhar nem atrasa o registo.
    if (criada) {
      await enviarAlertaImediato(destino, {
        entrada: criada as any,
        trabalhador: fichaDaCasa.name,
        quemRegistou: `o próprio trabalhador (${worker.name})`,
      })
    }

    // O rasto fica nas duas casas: na que recebeu o registo e na do link.
    const ondeTrabalhou = casa === 'cruzada' ? ` para ${nomeCasaCruzada()}` : ''
    await registarAcesso(destino, fichaDaCasa.name, 'criar',
      `Trabalhador registou ${horas}h em ${work_date} (${start_time}-${end_time}) — ${valor.toFixed(2)} EUR`)
    if (casa === 'cruzada') {
      await registarAcesso(supabase, worker.name, 'criar',
        `Trabalhador registou ${horas}h em ${work_date} (${start_time}-${end_time})${ondeTrabalhou}`
        + ` — ${valor.toFixed(2)} EUR (gravado na outra casa)`)
    }
  }

  // ------------------------------------------------- corrigir / apagar
  //
  // O ecrã do telemóvel já esconde o que não se pode mexer, mas quem manda é
  // esta verificação: o link é um acesso público com código. Confirma-se aqui
  // que o registo é DESTE trabalhador, que está por pagar e que ainda está
  // dentro do prazo de 12 horas desde que foi criado.
  if (acao === 'editar' || acao === 'apagar') {
    const entryId = String(body.entry_id ?? '')
    if (!entryId) return NextResponse.json({ error: 'Falta indicar o registo.' }, { status: 400 })

    // A correção vai à base da casa onde o registo vive. A permissão é a
    // mesma de sempre e é verificada contra ESSA base.
    const casa = lerCasa(body.casa)
    const permissao = podeRegistarNaCasa(worker as any, casa)
    if (!permissao.ok) return NextResponse.json({ error: permissao.erro }, { status: 403 })

    const destino = casa === 'cruzada' ? crossClient() : supabase
    if (!destino) return NextResponse.json({ error: 'Esta app não está ligada à outra casa.' }, { status: 503 })
    const idNaCasa = casa === 'cruzada' ? String((worker as any).cross_worker_id) : worker.id

    const [{ data: registos }, { data: pagos }] = await Promise.all([
      destino.from('work_entries').select('*').eq('worker_id', idNaCasa),
      destino.from('worker_payments').select('id, payment_date, amount').eq('worker_id', idNaCasa),
    ])

    // A conta é feita só com os registos deste trabalhador: um id de outra
    // pessoa simplesmente não aparece na lista.
    const conta = calcularConta(registos ?? [], (pagos ?? []) as any)
    const alvo = conta.entradas.find(e => e.id === entryId)
    if (!alvo) return NextResponse.json({ error: 'Esse registo não existe ou não é teu.' }, { status: 404 })

    const podeMexer = podeTrabalhadorCorrigir(alvo)
    if (!podeMexer.pode) return NextResponse.json({ error: podeMexer.motivo }, { status: 403 })

    const horario = `${String(alvo.start_time).slice(0, 5)}-${String(alvo.end_time).slice(0, 5)}`

    if (acao === 'apagar') {
      // O filtro entry_type repete a regra no proprio pedido: um registo de
      // valor fixo nunca é apagado por aqui, mesmo que algo falhe acima.
      const { error } = await destino.from('work_entries')
        .delete().eq('id', entryId).eq('worker_id', idNaCasa).eq('entry_type', 'horas')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      await registarAcesso(destino, worker.name, 'apagar',
        `Trabalhador apagou pelo link o registo de ${alvo.work_date} (${horario}) — ${Number(alvo.amount).toFixed(2)} EUR`)
    } else {
      const { work_date, start_time, end_time, description } = body
      if (!work_date || !start_time || !end_time) {
        return NextResponse.json({ error: 'Indica a data, a hora de entrada e a hora de saída.' }, { status: 400 })
      }

      const validacao = validarHorario(String(work_date), String(start_time), String(end_time))
      if ('erro' in validacao) return NextResponse.json({ error: validacao.erro }, { status: 400 })
      const { horas } = validacao

      // A tarifa é a que o registo já tem gravada — corrigir as horas nunca
      // muda o preço nem a marca de fds/feriado com que foi registado.
      const tarifa = Number(alvo.hourly_rate)
      const valor = parseFloat((horas * tarifa).toFixed(2))

      const { error } = await destino.from('work_entries').update({
        work_date,
        start_time,
        end_time,
        hours: horas,
        amount: valor,
        description: description ? String(description).slice(0, 500) : null,
      }).eq('id', entryId).eq('worker_id', idNaCasa).eq('entry_type', 'horas')

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      await registarAcesso(destino, worker.name, 'editar',
        `Trabalhador corrigiu pelo link o registo de ${alvo.work_date} (${horario}) para ${work_date} ` +
        `(${String(start_time).slice(0, 5)}-${String(end_time).slice(0, 5)}) — ${horas}h, ${valor.toFixed(2)} EUR`)
    }
  }

  // ---------------------------------------------------------- devolver
  //
  // Cada casa é lida e contada SEPARADAMENTE: é assim que os pagamentos de
  // uma casa nunca pagam as horas da outra. Só depois se somam os totais.
  const casas = casasDisponiveis(worker as any)
  const cross = casas.length > 0 ? crossClient() : null

  async function lerCasaDados(cliente: any, idNaCasa: string) {
    const [entriesRes, paymentsRes] = await Promise.all([
      cliente.from('work_entries').select('*').eq('worker_id', idNaCasa),
      cliente.from('worker_payments')
        .select('id, payment_date, amount, payment_method, notes').eq('worker_id', idNaCasa),
    ])
    return {
      conta: calcularConta(entriesRes.data ?? [], (paymentsRes.data ?? []) as any),
      pagamentos: paymentsRes.data ?? [],
    }
  }

  const aqui = await lerCasaDados(supabase, worker.id)

  // Uma casa só: a resposta é exatamente a de sempre.
  if (!cross) {
    return NextResponse.json({
      worker: {
        name: worker.name,
        hourly_rate: worker.hourly_rate,
        hourly_rate_holiday: worker.hourly_rate_holiday,
      },
      ...aqui.conta,
      pagamentos: aqui.pagamentos.sort((a: any, b: any) =>
        String(b.payment_date).localeCompare(String(a.payment_date))),
    })
  }

  // Duas casas. Se a outra falhar, mostra-se esta e diz-se o que faltou —
  // mais vale meia folha do que um ecrã de erro.
  let la: { conta: ReturnType<typeof calcularConta>; pagamentos: any[] } | null = null
  let avisoCasa: string | null = null
  try {
    la = await lerCasaDados(cross, String((worker as any).cross_worker_id))
  } catch (e: any) {
    console.error('[ponto] outra casa', e?.message ?? e)
    avisoCasa = `Não foi possível ler os registos de ${nomeCasaCruzada()} agora.`
  }

  const juntas = juntarContas([
    { casa: 'local' as Casa, nome: nomeCasaLocal(), conta: aqui.conta },
    ...(la ? [{ casa: 'cruzada' as Casa, nome: nomeCasaCruzada(), conta: la.conta }] : []),
  ])

  const pagamentos = [
    ...aqui.pagamentos.map((p: any) => ({ ...p, casa: 'local', casaNome: nomeCasaLocal() })),
    ...(la?.pagamentos ?? []).map((p: any) => ({ ...p, casa: 'cruzada', casaNome: nomeCasaCruzada() })),
  ].sort((a: any, b: any) => String(b.payment_date).localeCompare(String(a.payment_date)))

  return NextResponse.json({
    worker: {
      name: worker.name,
      hourly_rate: worker.hourly_rate,
      hourly_rate_holiday: worker.hourly_rate_holiday,
    },
    // Os totais somados, com os mesmos nomes de sempre.
    totalGanho: juntas.totalGanho,
    totalPago: juntas.totalPago,
    saldo: juntas.saldo,
    totalHoras: juntas.totalHoras,
    entradas: juntas.entradas,
    pagamentos,
    // O que é novo: as casas para escolher e a conta de cada uma.
    casas,
    porCasa: juntas.porCasa,
    avisoCasa,
  })
}
