import { consumeAdvances, linkAdvancesToCharge, type AdvanceTargetType } from '@/lib/advanceCredit'

/**
 * Contador partilhado: um espaço "titular" tem o contador e as leituras, e a
 * cobrança de cada leitura divide-se por percentagem pelos espaços do grupo
 * (ex.: apartamento 7 da Serpa Pinto — A07-A e A07-B, 50/50).
 *
 * Configuração em meter_shares: uma linha por espaço do grupo, INCLUINDO o
 * titular, por serviço (luz e água em separado). Espaço sem linhas = sem
 * partilha = tudo exatamente como antes.
 *
 * Regras:
 *   - O mínimo de cobrança e os acumulados aplicam-se ao TOTAL do contador;
 *     só depois se divide.
 *   - As partes dos outros espaços arredondam para baixo ao cêntimo; a
 *     diferença fica no titular.
 *   - Cada parte é uma cobrança normal no contrato ativo do seu espaço, ligada
 *     à mesma leitura (reading_id) e com nota a explicar a divisão. Conta
 *     corrente, motor de alocação e relatórios tratam-na como qualquer outra.
 *   - A divisão fica gravada na leitura (share_split). A parte de um espaço
 *     sem contrato ativo fica lá como "por cobrar" — visível, com botão para
 *     cobrar quando houver contrato — em vez de desaparecer.
 *
 * As funções de base de dados recebem o cliente Supabase, para poderem ser
 * testadas com um cliente simulado.
 */

export type ServicoPartilha = 'luz' | 'agua'

export interface ServicoContador {
  service: ServicoPartilha
  readingsTable: 'electricity_readings' | 'water_readings'
  chargesTable: 'electricity_charges' | 'water_charges'
  unitsField: 'kwh_consumed' | 'm3_consumed'
  unidade: string
  /** Nome para os textos: "contador de luz", "contador de água". */
  nome: string
  advanceTarget: AdvanceTargetType
}

export const SERVICOS: Record<ServicoPartilha, ServicoContador> = {
  luz: {
    service: 'luz', readingsTable: 'electricity_readings', chargesTable: 'electricity_charges',
    unitsField: 'kwh_consumed', unidade: 'kWh', nome: 'luz', advanceTarget: 'eletricidade',
  },
  agua: {
    service: 'agua', readingsTable: 'water_readings', chargesTable: 'water_charges',
    unitsField: 'm3_consumed', unidade: 'm³', nome: 'água', advanceTarget: 'agua',
  },
}

export interface MeterShare {
  id?: string
  service: ServicoPartilha
  owner_space_id: string
  space_id: string
  percentage: number
}

export interface ContratoAtivo {
  id: string
  tenant_name: string | null
}

/** Uma parte da divisão, tal como fica gravada em share_split. */
export interface ParteDivisao {
  space_id: string
  ref: string
  percentage: number
  amount: number
  units: number | null
  lease_id: string | null
  tenant_name: string | null
  charge_id: string | null
}

export interface LinhaPartilha {
  space_id: string
  percentage: number
}

// ---------------------------------------------------------------- consulta

/** Linhas do grupo cujo titular é ownerId (vazio = sem partilha). Titular primeiro. */
export function grupoDoTitular(shares: MeterShare[], ownerId: string): MeterShare[] {
  return shares
    .filter(s => s.owner_space_id === ownerId)
    .sort((a, b) => (a.space_id === ownerId ? -1 : b.space_id === ownerId ? 1 : 0))
}

/** Se o espaço participa no contador de OUTRO espaço, devolve essa linha. */
export function titularDoParticipante(shares: MeterShare[], spaceId: string): MeterShare | null {
  return shares.find(s => s.space_id === spaceId && s.owner_space_id !== spaceId) ?? null
}

// ---------------------------------------------------------------- cálculo

const emCentimos = (v: number) => Math.round(Number(v) * 100)

export function formatPct(p: number): string {
  return Number(p).toLocaleString('pt-PT', { maximumFractionDigits: 2 })
}

function euros(v: number): string {
  return Number(v).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })
}

/** Devolve a mensagem de erro, ou null se a partilha for válida. */
export function validarPartilha(ownerId: string, linhas: LinhaPartilha[]): string | null {
  if (linhas.length < 2) return 'A partilha precisa de pelo menos dois espaços (o titular e mais um).'
  if (linhas.some(l => !l.space_id)) return 'Escolhe o espaço de cada linha.'
  if (!linhas.some(l => l.space_id === ownerId)) return 'O espaço titular tem de fazer parte da partilha.'
  if (new Set(linhas.map(l => l.space_id)).size !== linhas.length) return 'O mesmo espaço aparece duas vezes.'
  for (const l of linhas) {
    const p = Number(l.percentage)
    if (!(p > 0) || p > 100) return 'Cada percentagem tem de ser maior que 0 e no máximo 100.'
    if (Math.abs(emCentimos(p) - p * 100) > 1e-6) return 'As percentagens só podem ter até duas casas decimais.'
  }
  const soma = linhas.reduce((s, l) => s + emCentimos(l.percentage), 0)
  if (soma !== 10000) return `As percentagens somam ${formatPct(soma / 100)}% — têm de somar 100%.`
  return null
}

/**
 * Divide um valor pelas percentagens. Os outros espaços arredondam para baixo
 * ao cêntimo; o titular fica com o resto, para a soma dar sempre o total.
 */
export function dividirValor(total: number, linhas: LinhaPartilha[], ownerId: string): { space_id: string; percentage: number; amount: number }[] {
  const totalCent = emCentimos(total)
  const partes = linhas.map(l => ({
    space_id: l.space_id,
    percentage: Number(l.percentage),
    cent: l.space_id === ownerId ? 0 : Math.floor((totalCent * emCentimos(l.percentage)) / 10000),
  }))
  const dosOutros = partes.reduce((s, p) => s + p.cent, 0)
  for (const p of partes) if (p.space_id === ownerId) p.cent = totalCent - dosOutros
  return partes.map(p => ({ space_id: p.space_id, percentage: p.percentage, amount: p.cent / 100 }))
}

export function planearDivisao({ total, units, ownerId, linhas, refs, contratos }: {
  total: number
  units: number | null
  ownerId: string
  linhas: LinhaPartilha[]
  refs: Record<string, string>
  contratos: Record<string, ContratoAtivo | undefined>
}): ParteDivisao[] {
  return dividirValor(total, linhas, ownerId).map(p => ({
    space_id: p.space_id,
    ref: refs[p.space_id] ?? '?',
    percentage: p.percentage,
    amount: p.amount,
    units: units == null ? null : parseFloat(((Number(units) * p.percentage) / 100).toFixed(2)),
    lease_id: contratos[p.space_id]?.id ?? null,
    tenant_name: contratos[p.space_id]?.tenant_name ?? null,
    charge_id: null,
  }))
}

/** Nota da cobrança: "50% do consumo do contador de luz do A07-A". */
export function notaParte(cfg: ServicoContador, percentage: number, ownerRef: string): string {
  return `${formatPct(percentage)}% do consumo do contador de ${cfg.nome} do ${ownerRef}`
}

/** Partes com valor que ainda não geraram cobrança. */
export function partesPorCobrar(split: ParteDivisao[] | null | undefined): ParteDivisao[] {
  return (split ?? []).filter(p => !p.charge_id && p.amount > 0)
}

/** Quanto de uma leitura cobrada foi efetivamente cobrado. Sem partilha: o valor da leitura. */
export function valorCobradoDaLeitura(r: { amount_calculated: number | null; share_split?: ParteDivisao[] | null }): number {
  if (!r.share_split) return r.amount_calculated ?? 0
  return r.share_split.filter(p => p.charge_id).reduce((s, p) => s + p.amount, 0)
}

// ---------------------------------------------------------------- base de dados

export async function carregarContratosAtivos(supabase: any, spaceIds: string[]): Promise<Record<string, ContratoAtivo>> {
  const mapa: Record<string, ContratoAtivo> = {}
  if (spaceIds.length === 0) return mapa
  const { data } = await supabase
    .from('leases').select('id, space_id, tenant:tenants(name)')
    .eq('status', 'ativo').in('space_id', spaceIds)
  for (const l of data ?? []) {
    if (l.space_id && !mapa[l.space_id]) mapa[l.space_id] = { id: l.id, tenant_name: l.tenant?.name ?? null }
  }
  return mapa
}

async function criarCobrancaParte(supabase: any, cfg: ServicoContador, { parte, reading, ownerRef, aplicarAdiantamentos }: {
  parte: ParteDivisao
  reading: { id: string; reading_date: string }
  ownerRef: string
  aplicarAdiantamentos: boolean
}): Promise<{ chargeId: string } | { erro: string }> {
  let aplicado = 0
  let consumidos: string[] = []
  if (aplicarAdiantamentos && parte.lease_id) {
    const r = await consumeAdvances(supabase, {
      leaseId: parte.lease_id, amountNeeded: parte.amount, target: { type: cfg.advanceTarget },
    })
    if (r.error) return { erro: `adiantamento de ${parte.ref}: ${r.error}` }
    aplicado = r.applied
    consumidos = r.consumedIds
  }

  const valor = parseFloat((parte.amount - aplicado).toFixed(2))
  const { data, error } = await supabase.from(cfg.chargesTable).insert({
    lease_id: parte.lease_id,
    reading_id: reading.id,
    charge_date: reading.reading_date,
    reference_month: reading.reading_date.slice(0, 7) + '-01',
    units: parte.units,
    amount: valor,
    paid: valor === 0,
    payment_date: valor === 0 ? new Date().toISOString().slice(0, 10) : null,
    payment_method: null,
    notes: notaParte(cfg, parte.percentage, ownerRef) + (aplicado > 0 ? ` · Adiantamento de ${euros(aplicado)} aplicado` : ''),
  }).select('id').single()

  if (error || !data) return { erro: `cobrança de ${parte.ref}: ${error?.message ?? 'erro desconhecido'}` }
  if (consumidos.length > 0) await linkAdvancesToCharge(supabase, consumidos, data.id)
  return { chargeId: data.id }
}

/**
 * Cria as cobranças de uma leitura do titular, uma por espaço com contrato
 * ativo. Não mexe na leitura: quem chama marca-a como cobrada (com o
 * share_split devolvido) se `cobradas > 0`; se nenhum espaço tiver contrato,
 * a leitura fica como estava (acumulada), tal como hoje sem inquilino.
 */
export async function cobrarLeituraPartilhada(supabase: any, cfg: ServicoContador, { reading, total, ownerId, ownerRef, linhas, refs, aplicarAdiantamentos }: {
  reading: { id: string; reading_date: string; units: number | null }
  total: number
  ownerId: string
  ownerRef: string
  linhas: LinhaPartilha[]
  refs: Record<string, string>
  aplicarAdiantamentos: boolean
}): Promise<{ erro: string } | { split: ParteDivisao[]; cobradas: number; erros: string[] }> {
  const invalida = validarPartilha(ownerId, linhas)
  if (invalida) return { erro: `A partilha do contador de ${cfg.nome} do ${ownerRef} está mal configurada: ${invalida}` }

  const contratos = await carregarContratosAtivos(supabase, linhas.map(l => l.space_id))
  const split = planearDivisao({ total, units: reading.units, ownerId, linhas, refs, contratos })

  let cobradas = 0
  const erros: string[] = []
  for (const parte of split) {
    if (!parte.lease_id || parte.amount <= 0) continue
    const r = await criarCobrancaParte(supabase, cfg, { parte, reading, ownerRef, aplicarAdiantamentos })
    if ('erro' in r) erros.push(r.erro)
    else { parte.charge_id = r.chargeId; cobradas++ }
  }
  return { split, cobradas, erros }
}

/** Cobra, mais tarde, a parte de um espaço que não tinha contrato ativo. */
export async function cobrarParteEmFalta(supabase: any, cfg: ServicoContador, { reading, spaceId, ownerRef }: {
  reading: { id: string; reading_date: string; share_split: ParteDivisao[] | null }
  spaceId: string
  ownerRef: string
}): Promise<{ erro: string } | { parte: ParteDivisao }> {
  const split = (reading.share_split ?? []).map(p => ({ ...p }))
  const parte = split.find(p => p.space_id === spaceId)
  if (!parte) return { erro: 'Esta parte não existe na divisão da leitura.' }
  if (parte.charge_id) return { erro: `A parte de ${parte.ref} já está cobrada.` }

  const contrato = (await carregarContratosAtivos(supabase, [spaceId]))[spaceId]
  if (!contrato) return { erro: `${parte.ref} continua sem contrato ativo — cria primeiro o contrato.` }
  parte.lease_id = contrato.id
  parte.tenant_name = contrato.tenant_name

  const r = await criarCobrancaParte(supabase, cfg, { parte, reading, ownerRef, aplicarAdiantamentos: true })
  if ('erro' in r) return r
  parte.charge_id = r.chargeId

  const { error } = await supabase.from(cfg.readingsTable).update({ share_split: split }).eq('id', reading.id)
  if (error) return { erro: `A cobrança foi criada, mas não foi possível atualizar a leitura: ${error.message}` }
  return { parte }
}

/**
 * Cobranças de uma leitura. Com partilha: todas as ligadas à leitura. Sem
 * partilha: exatamente a procura de sempre (uma só, pela ligação ou pela data).
 */
export async function encontrarCobrancasDaLeitura(supabase: any, cfg: ServicoContador, reading: {
  id: string; space_id: string; reading_date: string; share_split?: ParteDivisao[] | null
}): Promise<any[]> {
  const campos = 'id, amount, amount_paid, paid, payment_date'
  if (reading.share_split) {
    const { data } = await supabase.from(cfg.chargesTable).select(campos).eq('reading_id', reading.id)
    return data ?? []
  }

  const { data: porLigacao } = await supabase
    .from(cfg.chargesTable).select(campos).eq('reading_id', reading.id).maybeSingle()
  if (porLigacao) return [porLigacao]

  const { data: lease } = await supabase
    .from('leases').select('id').eq('space_id', reading.space_id).eq('status', 'ativo').maybeSingle()
  if (!lease) return []

  const { data: porData } = await supabase
    .from(cfg.chargesTable).select(campos).eq('lease_id', lease.id).eq('charge_date', reading.reading_date).maybeSingle()
  return porData ? [porData] : []
}

/** Grava a configuração de um grupo (substitui a anterior). Devolve erro ou null. */
export async function guardarPartilha(supabase: any, service: ServicoPartilha, ownerId: string, linhas: LinhaPartilha[]): Promise<string | null> {
  const invalida = validarPartilha(ownerId, linhas)
  if (invalida) return invalida

  const ids = linhas.map(l => l.space_id)
  const { data: atuais, error: erroLer } = await supabase
    .from('meter_shares').select('id, space_id').eq('service', service).eq('owner_space_id', ownerId)
  if (erroLer) return erroLer.message

  const remover = (atuais ?? []).filter((a: any) => !ids.includes(a.space_id)).map((a: any) => a.id)
  if (remover.length > 0) {
    const { error } = await supabase.from('meter_shares').delete().in('id', remover)
    if (error) return error.message
  }

  const agora = new Date().toISOString()
  const { error } = await supabase.from('meter_shares').upsert(
    linhas.map(l => ({ service, owner_space_id: ownerId, space_id: l.space_id, percentage: Number(l.percentage), updated_at: agora })),
    { onConflict: 'service,space_id' },
  )
  return error ? error.message : null
}

export async function removerPartilha(supabase: any, service: ServicoPartilha, ownerId: string): Promise<string | null> {
  const { error } = await supabase.from('meter_shares').delete().eq('service', service).eq('owner_space_id', ownerId)
  return error ? error.message : null
}
