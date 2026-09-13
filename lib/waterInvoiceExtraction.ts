import type Anthropic from '@anthropic-ai/sdk'
import { waterMeterReadingExists } from './waterMeterReadings'

// Lógica partilhada das faturas de água: extração por IA, correspondência com
// o contador geral e criação da leitura. Usada por /api/extract-water-meter
// (preencher formulários) e por /api/process-document (fatura carregada nos
// Documentos → leitura criada no contador). Os prompts vivem só aqui, para
// não haver duas versões a divergir.

export interface WaterInvoiceData {
  contract_number: string | null
  meter_number: string | null
  location: string | null
  holder_name: string | null
  suggested_name: string | null
  invoice_number: string | null
  invoice_date: string | null
  period_start: string | null
  period_end: string | null
  reading_value: number | null
  reading_estimated: boolean | null
  consumption_m3: number | null
  total_amount: number | null
}

/** Bloco de conteúdo para a API da Anthropic — PDF como documento, imagem como imagem. */
export function waterInvoiceMediaBlock(base64: string, mediaType: string) {
  return mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } }
}

const MAIN_PROMPT = `Analisa esta fatura de água portuguesa (câmara municipal, empresa municipalizada ou outra entidade gestora de águas e saneamento) e extrai os dados em JSON puro (sem markdown, sem \`\`\`json, apenas o objeto JSON).

{
  "contract_number": "número de cliente / conta / contrato (ex: 'Cliente / Conta'), só os dígitos principais, sem barras nem espaços. null se não existir",
  "meter_number": "número do contador físico (ex: 'Contador Nº'). null se não existir",
  "location": "morada do local de consumo tal como aparece na fatura (não a morada de correspondência do cliente, se forem diferentes). null se não existir",
  "holder_name": "nome do titular da conta. null se não existir",
  "suggested_name": "um nome curto e útil para identificar este contador, baseado na morada ou no local de consumo, máximo 40 caracteres. Exemplo: 'Contador Rua Serpa Pinto 131A'",
  "invoice_number": "número da fatura (ex: 'Fatura', 'FAC ...'), EXATAMENTE como está impresso — mantém barras, hífenes e espaços internos, não concatenes nem reformates nada. Se houver um número de documento de pagamento diferente do número da fatura, usa o número da FATURA, não o do documento de pagamento. null se não existir",
  "invoice_date": "data de emissão da fatura, formato AAAA-MM-DD. null se não existir",
  "period_start": "início do período de faturação/consumo, formato AAAA-MM-DD. null se não existir",
  "period_end": "fim do período de faturação/consumo — esta é a data em que a leitura foi feita, formato AAAA-MM-DD. null se não existir",
  "reading_value": "a leitura ATUAL/acumulada do contador em m³ — o número total que está (ou estaria) marcado no mostrador do contador nesta data, tipicamente um número grande com 3 ou mais dígitos, que só cresce fatura após fatura. Número, sem unidade. null se não existir",
  "consumption_m3": "consumo faturado NESTE período em concreto, em m³ — normalmente um número pequeno (dezenas), a diferença entre a leitura atual e a leitura anterior. Número, sem unidade. null se não existir",
  "total_amount": "valor total a pagar da fatura. Número, sem símbolo de euro. null se não existir"
}

Sobre reading_value e consumption_m3: faturas de água portuguesas costumam
ter uma tabela com colunas do género "Contador Nº | Data | Origem | Leitura |
Fator Multipl. | Consumo". Nessa tabela específica, a coluna chamada
"Leitura" contém muitas vezes só a palavra "Real" ou "Estimado" — ignora-a
para efeitos destes dois campos. O número da leitura acumulada do contador
está geralmente na coluna "Origem" dessa tabela; o consumo do período está
na coluna "Consumo". IGNORA por completo quaisquer números de "Média de
Consumo" / "Consumo médio dos últimos 12 meses" / "X m3 a cada Y dias" —
são estatísticas históricas, nunca a leitura nem o consumo desta fatura em
concreto. Se não conseguires distinguir com confiança, prefere null a
adivinhar.

Regras:
- O número de contrato tem de vir só com dígitos (remove barras, espaços e o sufixo depois de "/", ex: "1493570 / 001" → "1493570").
- Datas sempre no formato AAAA-MM-DD, nunca DD/MM/AAAA nem outro.
- Valores numéricos (reading_value, consumption_m3, total_amount) sempre com ponto decimal, nunca vírgula nem símbolo de euro.
- Se um campo não estiver presente ou não conseguires ter a certeza, coloca null — nunca inventes um valor.
- Responde APENAS com o JSON, nada de texto antes ou depois.`

// reading_estimated vai numa chamada à parte, dedicada só a este campo.
// Ao testar com uma fatura real, dentro do prompt grande a IA confundia
// sistematicamente este campo com a coluna "Leitura" da tabela de consumo e
// respondia sempre "false", mesmo em faturas marcadas "Tipo de Leitura:
// Estimativa" — persistente mesmo depois de reforçar a instrução e reordenar
// os campos. Isolado numa pergunta curta, acerta sempre.
const ESTIMATED_PROMPT = `Nesta fatura de água, procura o campo "Tipo de Leitura" no CABEÇALHO da fatura (normalmente junto de "Tipo de Cliente" e "Tarifa" — não é a coluna "Leitura" de nenhuma tabela de consumo).
Responde só com uma palavra: "Estimada" se o campo disser Estimativa/Estimado, "Real" se disser Real/Efetiva, "Nenhuma" se esse campo não existir na fatura.`

const toNumber = (v: any): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

const toDate = (v: any): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

const digits = (v: any): string | null => (v == null ? null : String(v).replace(/\D/g, '') || null)

/** Extrai os campos de uma fatura de água. Devolve null se a IA não devolver JSON legível. */
export async function extractWaterInvoice(anthropic: Anthropic, mediaBlock: ReturnType<typeof waterInvoiceMediaBlock>): Promise<WaterInvoiceData | null> {
  const [response, estimatedResponse] = await Promise.all([
    anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 800,
      messages: [{ role: 'user', content: [mediaBlock, { type: 'text', text: MAIN_PROMPT }] as any }],
    }),
    anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 10,
      messages: [{ role: 'user', content: [mediaBlock, { type: 'text', text: ESTIMATED_PROMPT }] as any }],
    }),
  ])

  const text = response.content[0]?.type === 'text' ? response.content[0].text : ''
  // A IA por vezes escreve uma frase antes/depois do JSON apesar da
  // instrução — isola o primeiro bloco { ... } do texto.
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const jsonMatch = clean.match(/\{[\s\S]*\}/)

  let extracted: any
  try {
    extracted = JSON.parse(jsonMatch ? jsonMatch[0] : clean)
  } catch {
    return null
  }

  const estimatedText = (estimatedResponse.content[0]?.type === 'text' ? estimatedResponse.content[0].text : '').toLowerCase()
  const readingEstimated = /estim|true/.test(estimatedText) ? true
    : /real|efetiv|false/.test(estimatedText) ? false
    : null

  return {
    contract_number: digits(extracted.contract_number),
    meter_number: extracted.meter_number != null ? String(extracted.meter_number).trim() || null : null,
    location: extracted.location ?? null,
    holder_name: extracted.holder_name ?? null,
    suggested_name: extracted.suggested_name ?? null,
    invoice_number: extracted.invoice_number ? String(extracted.invoice_number).trim() : null,
    invoice_date: toDate(extracted.invoice_date),
    period_start: toDate(extracted.period_start),
    period_end: toDate(extracted.period_end),
    reading_value: toNumber(extracted.reading_value),
    reading_estimated: readingEstimated,
    consumption_m3: toNumber(extracted.consumption_m3),
    total_amount: toNumber(extracted.total_amount),
  }
}

export interface WaterMeterLike {
  id: string
  name: string
  contract_number: string | null
  meter_number: string | null
  active?: boolean | null
}

export type WaterMeterMatchReason = 'contrato' | 'nº do contador' | 'único contador ativo'

/**
 * Encontra o contador geral a que a fatura pertence: primeiro pelo nº de
 * contrato, depois pelo nº do contador físico. Com allowSingleActiveFallback,
 * se nenhum bater mas só existir um contador ativo, usa esse.
 */
export function findWaterMeter<M extends WaterMeterLike>(
  meters: M[],
  data: Pick<WaterInvoiceData, 'contract_number' | 'meter_number'>,
  { allowSingleActiveFallback = false } = {},
): { meter: M; reason: WaterMeterMatchReason } | null {
  const contract = digits(data.contract_number)
  if (contract) {
    const meter = meters.find(m => digits(m.contract_number) === contract)
    if (meter) return { meter, reason: 'contrato' }
  }

  const meterNumber = data.meter_number?.trim()
  if (meterNumber) {
    const meter = meters.find(m => m.meter_number?.trim() === meterNumber)
    if (meter) return { meter, reason: 'nº do contador' }
  }

  if (allowSingleActiveFallback) {
    const active = meters.filter(m => m.active !== false)
    if (active.length === 1) return { meter: active[0], reason: 'único contador ativo' }
  }

  return null
}

export interface WaterReadingImportResult {
  status: 'created' | 'duplicate' | 'no_meter' | 'no_date' | 'error'
  meterName?: string
  matchReason?: WaterMeterMatchReason
  reading?: any
  error?: string
}

/**
 * Cria a leitura no contador geral de água a partir de uma fatura já
 * arquivada nos Documentos. A "associação" ao documento é, tal como na luz,
 * o nº da fatura da leitura igual ao doc_number do documento — por isso usa
 * sempre o doc_number que ficou gravado no documento, e se este vier vazio
 * preenche-o com o nº extraído aqui, para os dois baterem certo.
 */
export async function importWaterInvoiceReading(
  supabase: any,
  params: {
    data: WaterInvoiceData
    documentId: string
    docNumber: string | null
    docDate: string | null
    amount: number | null
    fileName: string
  },
): Promise<WaterReadingImportResult> {
  const { data, documentId, docNumber, docDate, amount, fileName } = params

  // Só contadores ativos — um inativo não aparece em /agua/contadores, e a
  // leitura ficaria invisível.
  const { data: meters, error: metersError } = await supabase
    .from('water_meters').select('id, name, contract_number, meter_number, active').eq('active', true)
  if (metersError) return { status: 'error', error: metersError.message }

  const match = findWaterMeter(meters ?? [], data, { allowSingleActiveFallback: true })
  if (!match) return { status: 'no_meter' }

  const base = { meterName: match.meter.name, matchReason: match.reason }

  const readingDate = data.period_end ?? data.invoice_date ?? docDate
  if (!readingDate) return { status: 'no_date', ...base }

  const invoiceNumber = docNumber ?? data.invoice_number
  if (!docNumber && data.invoice_number) {
    await supabase.from('documents').update({ doc_number: data.invoice_number }).eq('id', documentId)
  }

  if (await waterMeterReadingExists(supabase, match.meter.id, readingDate, invoiceNumber)) {
    return { status: 'duplicate', ...base }
  }

  const notes = [
    `Importado automaticamente do documento ${fileName}`,
    data.reading_estimated === true ? 'leitura estimada' : data.reading_estimated === false ? 'leitura real' : null,
    data.consumption_m3 != null ? `consumo ${data.consumption_m3} m³` : null,
    data.reading_value == null ? 'fatura sem leitura do contador' : null,
  ].filter(Boolean).join(' · ')

  const { data: reading, error } = await supabase.from('water_meter_readings').insert({
    meter_id: match.meter.id,
    reading_date: readingDate,
    // reading_value é NOT NULL — sem leitura na fatura fica 0, que a página
    // mostra como "—" (mesma convenção da importação de faturas da luz).
    reading_value: data.reading_value ?? 0,
    invoice_amount: amount ?? data.total_amount,
    invoice_number: invoiceNumber,
    notes,
  }).select().single()

  if (error) return { status: 'error', ...base, error: error.message }
  return { status: 'created', ...base, reading }
}
