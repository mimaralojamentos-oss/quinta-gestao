import { normalizeText } from '@/lib/utils'

/**
 * Compras — exclusões: nem tudo o que é fatura é uma compra de materiais.
 *
 * Há três níveis, e todos acabam no mesmo sítio:
 *   · DOCUMENTO excluído (estado 'excluido') — sem linhas e sempre ignorado
 *     pela extração e pelo lote. Pode vir de uma regra automática
 *     (documento gerado pela app, despesa de pessoal, fornecedor marcado)
 *     ou de uma exclusão à mão.
 *   · FORNECEDOR marcado nos Extras → Fornecedores.
 *   · ITEM: regras por texto na descrição, geridas na página Compras.
 *
 * Quem decide se um DOCUMENTO é excluído é sempre a função
 * compras_motivo_exclusao() da base de dados — para a extração, a limpeza em
 * lote e o ecrã darem exatamente a mesma resposta. Aqui ficam só as regras
 * de ITEM (texto na descrição), que se aplicam às linhas já lidas.
 */

export interface RegraExclusao {
  id: string
  rule_type: string
  pattern: string
  pattern_normalized: string
  notes: string | null
  created_by: string | null
  created_at: string
}

export interface FornecedorExcluido {
  id: string
  supplier_name: string
  supplier_normalized: string
  notes: string | null
  created_at: string
}

/** Texto comparável de uma regra: sem acentos, minúsculas. */
export function normalizarPadrao(pattern: string): string {
  return normalizeText(pattern).trim()
}

/** A regra que exclui esta descrição, ou null se nenhuma a exclui. */
export function regraQueExclui(descricao: string, regras: RegraExclusao[]): RegraExclusao | null {
  const alvo = normalizeText(descricao)
  for (const r of regras) {
    const padrao = r.pattern_normalized || normalizarPadrao(r.pattern)
    if (padrao && alvo.includes(padrao)) return r
  }
  return null
}

/**
 * Separa as linhas que ficam das que as regras removem, e volta a numerar as
 * que ficam (a numeração tem de ser seguida: é chave na base de dados).
 */
export function filtrarLinhasExcluidas<T extends { description: string; line_number: number }>(
  linhas: T[],
  regras: RegraExclusao[],
): { mantidas: T[]; removidas: { linha: T; regra: RegraExclusao }[] } {
  const mantidas: T[] = []
  const removidas: { linha: T; regra: RegraExclusao }[] = []

  for (const linha of linhas) {
    const regra = regraQueExclui(linha.description, regras)
    if (regra) removidas.push({ linha, regra })
    else mantidas.push({ ...linha, line_number: mantidas.length + 1 })
  }

  return { mantidas, removidas }
}

/** As regras de item em vigor. */
export async function carregarRegras(supabase: any): Promise<RegraExclusao[]> {
  const { data } = await supabase
    .from('purchase_exclusion_rules')
    .select('*')
    .eq('rule_type', 'descricao')
    .order('created_at', { ascending: true })
  return data ?? []
}

/** O motivo pelo qual um documento está fora das Compras, ou null. */
export async function motivoExclusaoDocumento(supabase: any, documentId: string): Promise<string | null> {
  const { data } = await supabase.rpc('compras_motivo_exclusao', { p_document_id: documentId })
  return (data as string | null) ?? null
}

/** Exclui um documento: apaga as linhas dele e marca-o, na mesma transação. */
export async function excluirDocumento(
  supabase: any, documentId: string, motivo: string,
): Promise<{ erro?: string }> {
  const { error } = await supabase.rpc('replace_purchase_items', {
    p_document_id: documentId,
    p_items: [],
    p_status: 'excluido',
    p_motivo: motivo,
  })
  return error ? { erro: error.message } : {}
}

/** Reinclui um documento: volta a "por processar", para o lote tratar dele. */
export async function reincluirDocumento(supabase: any, documentId: string): Promise<{ erro?: string }> {
  const { error } = await supabase
    .from('documents')
    .update({ purchase_items_status: null, purchase_items_motivo: null, purchase_items_extracted_at: null })
    .eq('id', documentId)
  return error ? { erro: error.message } : {}
}

export interface ResultadoLimpeza {
  documentos_excluidos: number
  linhas_removidas_dos_documentos: number
  linhas_removidas_por_regra: number
}

/**
 * Corre todas as regras sobre o que já está na base. Pode correr-se tantas
 * vezes quantas se quiser: a segunda vez não encontra nada para fazer.
 */
export async function aplicarRegrasCompras(supabase: any): Promise<ResultadoLimpeza | { erro: string }> {
  const { data, error } = await supabase.rpc('aplicar_regras_compras')
  if (error) return { erro: error.message }
  return {
    documentos_excluidos: Number(data?.documentos_excluidos ?? 0),
    linhas_removidas_dos_documentos: Number(data?.linhas_removidas_dos_documentos ?? 0),
    linhas_removidas_por_regra: Number(data?.linhas_removidas_por_regra ?? 0),
  }
}

/** Quantas linhas do catálogo é que uma regra nova vai remover. */
export async function contarLinhasDaRegra(supabase: any, pattern: string): Promise<number> {
  const { data } = await supabase.rpc('compras_contar_linhas_da_regra', { p_pattern: pattern })
  return Number(data ?? 0)
}
