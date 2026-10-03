import type Anthropic from '@anthropic-ai/sdk'
import { carregarRegras, filtrarLinhasExcluidas, motivoExclusaoDocumento } from '@/lib/purchaseExclusions'

/**
 * Linhas de compra das faturas: leitura por IA e gravação.
 *
 * Usada por /api/process-document (fatura nova, ficheiro ainda em memória) e
 * por /api/extract-purchase-items (faturas antigas e reprocessar, ficheiro
 * lido do armazenamento). O prompt vive só aqui, para não haver duas versões
 * a divergir.
 *
 * A gravação é sempre pela função replace_purchase_items da base de dados:
 * apaga as linhas antigas do documento, grava as novas e marca o documento
 * como processado, tudo numa transação. Reprocessar substitui, nunca soma.
 */

/** 'excluido' = documento que não entra no catálogo (ver lib/purchaseExclusions). */
export type PurchaseItemsStatus = 'ok' | 'sem_linhas' | 'erro' | 'excluido'

/** Linha tal como a IA a devolve. */
export interface PurchaseLineRaw {
  description?: string | null
  unit?: string | null
  quantity?: number | string | null
  unit_price_net?: number | string | null
  total_net?: number | string | null
  vat_rate?: number | string | null
  vat_amount?: number | string | null
  total_gross?: number | string | null
}

/** Linha pronta a gravar (o formato que replace_purchase_items aceita). */
export interface PurchaseLine {
  line_number: number
  purchase_date: string | null
  supplier_name: string | null
  description: string
  unit: string | null
  quantity: number | null
  unit_price_net: number | null
  total_net: number | null
  vat_rate: number | null
  vat_amount: number | null
  total_gross: number | null
  vat_estimated: boolean
  project_id: string | null
  source: 'ia' | 'manual'
}

/** Bloco de conteúdo para a API da Anthropic — PDF como documento, imagem como imagem. */
export function faturaMediaBlock(base64: string, mediaType: string) {
  return mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } }
}

const PROMPT = `Analisa esta fatura portuguesa de compra de materiais/serviços e extrai as LINHAS DE ITENS, uma a uma.

Responde APENAS com JSON puro (sem markdown, sem \`\`\`json):

{
  "items": [
    {
      "description": "descrição do artigo tal como está na fatura, sem o código do artigo",
      "unit": "unidade: un, L, kg, m, m2, m3, saco, cx, par, h. null se não existir",
      "quantity": "quantidade faturada. Número. null se não existir",
      "unit_price_net": "preço unitário SEM IVA. Número. null se não existir",
      "total_net": "total da linha SEM IVA (depois de descontos). Número. null se não existir",
      "vat_rate": "taxa de IVA da linha em percentagem (ex: 23, 6). Número. null se não existir",
      "vat_amount": "valor do IVA da linha, se vier explícito por linha. Número. null se não vier",
      "total_gross": "total da linha COM IVA, se vier explícito por linha. Número. null se não vier"
    }
  ]
}

Regras:
- Uma entrada por linha de artigo. Mantém a ordem da fatura.
- Copia os valores COMO ESTÃO na fatura. Não recalcules nem arredondes.
- NÃO incluas linhas de totais, subtotais, resumos de IVA, portes já somados
  no total, descontos globais, "a transportar", nem texto de rodapé.
- Se a fatura tiver só um valor global sem discriminação de artigos, devolve
  "items": [].
- Se a mesma descrição aparecer em várias linhas (quantidades ou preços
  diferentes), devolve todas — são compras distintas.
- Números em formato português (1.234,56) devem vir como 1234.56.`

/** Lê as linhas da fatura. null = não foi possível ler (erro de leitura). */
export async function extractPurchaseLines(
  anthropic: Anthropic,
  mediaBlock: any,
): Promise<PurchaseLineRaw[] | null> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 8000,
    messages: [{ role: 'user', content: [mediaBlock, { type: 'text', text: PROMPT }] as any }],
  })

  const text = response.content[0]?.type === 'text' ? response.content[0].text : ''
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const jsonMatch = clean.match(/\{[\s\S]*\}/)

  try {
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : clean)
    return Array.isArray(parsed?.items) ? parsed.items : null
  } catch {
    return null
  }
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

const r2 = (v: number) => parseFloat(v.toFixed(2))

/**
 * Põe as linhas no formato de gravação. Guarda os valores como vêm na fatura;
 * o IVA só é calculado quando não vem por linha — e aí fica assinalado em
 * vat_estimated, para se saber que aquele número não estava na fatura.
 */
export function prepararLinhas(
  raw: PurchaseLineRaw[],
  contexto: { purchaseDate: string | null; supplierName: string | null; projectId: string | null },
): PurchaseLine[] {
  const linhas: PurchaseLine[] = []

  for (const item of raw) {
    const description = String(item?.description ?? '').trim()
    if (!description) continue

    const quantity = num(item?.quantity)
    const unitPrice = num(item?.unit_price_net)
    let totalNet = num(item?.total_net)
    if (totalNet === null && quantity !== null && unitPrice !== null) totalNet = r2(quantity * unitPrice)

    // A taxa vem em percentagem (23) e guarda-se como fração (0.23).
    const rateRaw = num(item?.vat_rate)
    const vatRate = rateRaw === null ? null : (rateRaw > 1 ? r2(rateRaw / 100) : rateRaw)

    let vatAmount = num(item?.vat_amount)
    let vatEstimated = false
    if (vatAmount === null && vatRate !== null && totalNet !== null) {
      vatAmount = r2(totalNet * vatRate)
      vatEstimated = true
    }

    let totalGross = num(item?.total_gross)
    if (totalGross === null && totalNet !== null) totalGross = r2(totalNet + (vatAmount ?? 0))

    linhas.push({
      line_number: linhas.length + 1,
      purchase_date: contexto.purchaseDate,
      supplier_name: contexto.supplierName,
      description,
      unit: item?.unit ? String(item.unit).trim().slice(0, 20) : null,
      quantity,
      unit_price_net: unitPrice,
      total_net: totalNet,
      vat_rate: vatRate,
      vat_amount: vatAmount,
      total_gross: totalGross,
      vat_estimated: vatEstimated,
      project_id: contexto.projectId,
      source: 'ia',
    })
  }

  return linhas
}

/** Substituição em bloco (apaga as antigas + grava as novas + marca o documento). */
export async function guardarLinhasCompra(
  supabase: any,
  { documentId, linhas, status, motivo }: {
    documentId: string; linhas: PurchaseLine[]; status: PurchaseItemsStatus; motivo?: string | null
  },
): Promise<{ linhas: number } | { erro: string }> {
  const { data, error } = await supabase.rpc('replace_purchase_items', {
    p_document_id: documentId,
    p_items: linhas,
    p_status: status,
    p_motivo: motivo ?? null,
  })
  if (error) return { erro: error.message }
  return { linhas: Number(data ?? 0) }
}

export interface ResultadoExtracao {
  status: PurchaseItemsStatus
  linhas: number
  erro?: string
  /** Porque é que o documento ficou fora do catálogo. */
  motivo?: string
  /** Linhas que as regras de item removeram nesta leitura. */
  removidasPorRegra?: number
}

/**
 * Lê e grava as linhas de uma fatura.
 *
 * Antes de gastar uma leitura, pergunta à base de dados se o documento está
 * excluído das Compras (documento gerado pela app, despesa de pessoal,
 * fornecedor marcado, ou exclusão à mão): se estiver, marca-o e não lê nada.
 *
 * Depois de ler, tira as linhas que as regras de item apanham.
 *
 * Uma fatura que a IA não consiga ler fica marcada como 'erro' e não volta a
 * aparecer no lote — mas pode sempre ser reprocessada à mão.
 */
export async function extrairLinhasDaFatura(
  anthropic: Anthropic,
  supabase: any,
  params: {
    documentId: string
    base64: string
    mediaType: string
    purchaseDate: string | null
    supplierName: string | null
    projectId: string | null
  },
): Promise<ResultadoExtracao> {
  // 1. Regras do documento — a decisão é sempre da base de dados, para a
  //    extração, a limpeza em lote e o ecrã concordarem entre si.
  const motivo = await motivoExclusaoDocumento(supabase, params.documentId)
  if (motivo) {
    const gravado = await guardarLinhasCompra(supabase, {
      documentId: params.documentId, linhas: [], status: 'excluido', motivo,
    })
    if ('erro' in gravado) return { status: 'erro', linhas: 0, erro: gravado.erro }
    return { status: 'excluido', linhas: 0, motivo }
  }

  // 2. Leitura
  let raw: PurchaseLineRaw[] | null = null
  let erroLeitura: string | null = null

  try {
    raw = await extractPurchaseLines(anthropic, faturaMediaBlock(params.base64, params.mediaType))
  } catch (e: any) {
    erroLeitura = e?.message ?? 'erro desconhecido na leitura'
  }

  const lidas = raw ? prepararLinhas(raw, {
    purchaseDate: params.purchaseDate,
    supplierName: params.supplierName,
    projectId: params.projectId,
  }) : []

  // 3. Regras de item (texto na descrição)
  const regras = await carregarRegras(supabase)
  const { mantidas, removidas } = filtrarLinhasExcluidas(lidas, regras)

  const status: PurchaseItemsStatus = (!raw || erroLeitura)
    ? 'erro'
    : mantidas.length > 0 ? 'ok' : 'sem_linhas'

  const gravado = await guardarLinhasCompra(supabase, { documentId: params.documentId, linhas: mantidas, status })
  if ('erro' in gravado) return { status: 'erro', linhas: 0, erro: gravado.erro }

  return {
    status,
    linhas: gravado.linhas,
    erro: erroLeitura ?? undefined,
    removidasPorRegra: removidas.length || undefined,
  }
}

/** Tipo de conteúdo a partir do nome do ficheiro guardado. */
export function mediaTypeDoFicheiro(path: string): string | null {
  const p = path.toLowerCase()
  if (p.endsWith('.pdf')) return 'application/pdf'
  if (p.endsWith('.png')) return 'image/png'
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg'
  if (p.endsWith('.webp')) return 'image/webp'
  return null
}
