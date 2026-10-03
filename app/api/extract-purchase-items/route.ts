import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { requireRole } from '@/lib/require-role'
import { buildAliasMap, resolveSupplier } from '@/lib/suppliers'
import { extrairLinhasDaFatura, mediaTypeDoFicheiro } from '@/lib/purchaseItemsExtraction'
import { excluirDocumento, motivoExclusaoDocumento } from '@/lib/purchaseExclusions'

/**
 * Extrai as linhas de itens de UMA fatura já guardada nos Documentos.
 *
 * Serve o botão "Processar faturas antigas" (a página chama esta rota uma vez
 * por fatura, para dar progresso e não esgotar o tempo do servidor) e o
 * "Reprocessar" de cada documento. A gravação é a substituição em bloco da
 * base de dados, por isso repetir não duplica.
 *
 * As faturas de luz e de água ficam de fora: são consumos, não compras de
 * itens.
 */
export async function POST(request: Request) {
  const auth = await requireRole(['admin', 'coadmin'])
  if (auth.error) return auth.error

  try {
    const body = await request.json().catch(() => ({}))
    const documentId = String(body?.document_id ?? '')
    if (!documentId) return NextResponse.json({ error: 'Falta indicar o documento.' }, { status: 400 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data: doc, error: erroDoc } = await supabase
      .from('documents')
      .select('id, file_path, tipo, status, doc_date, supplier_name, expense_id')
      .eq('id', documentId)
      .maybeSingle()

    if (erroDoc) return NextResponse.json({ error: erroDoc.message }, { status: 500 })
    if (!doc) return NextResponse.json({ error: 'Documento não encontrado.' }, { status: 404 })
    if (doc.tipo !== 'fatura') {
      return NextResponse.json({ error: 'Só as faturas de compras têm linhas de itens (as de luz e água são consumos).' }, { status: 400 })
    }
    if (!doc.file_path) {
      return NextResponse.json({ error: 'Este documento não tem ficheiro guardado.' }, { status: 400 })
    }

    // Documento fora das Compras: marca-o e vai-se embora, sem descarregar o
    // ficheiro nem gastar uma leitura de IA.
    const motivo = await motivoExclusaoDocumento(supabase, doc.id)
    if (motivo) {
      const r = await excluirDocumento(supabase, doc.id, motivo)
      if (r.erro) return NextResponse.json({ error: r.erro }, { status: 500 })
      return NextResponse.json({ success: true, status: 'excluido', linhas: 0, motivo })
    }

    const mediaType = mediaTypeDoFicheiro(doc.file_path)
    if (!mediaType) {
      return NextResponse.json({ error: 'Formato de ficheiro não suportado para leitura.' }, { status: 400 })
    }

    const { data: blob, error: erroFicheiro } = await supabase.storage.from('documents').download(doc.file_path)
    if (erroFicheiro || !blob) {
      return NextResponse.json({ error: `Não foi possível ler o ficheiro: ${erroFicheiro?.message ?? 'erro desconhecido'}` }, { status: 500 })
    }
    const base64 = Buffer.from(await blob.arrayBuffer()).toString('base64')

    // Fornecedor com o nome normalizado das equivalências dos Extras.
    const { data: aliases } = await supabase.from('supplier_aliases').select('*')
    const supplierName = doc.supplier_name ? resolveSupplier(doc.supplier_name, buildAliasMap(aliases ?? [])) : null

    // O projeto vem da despesa do documento (documents não tem projeto próprio).
    let projectId: string | null = null
    if (doc.expense_id) {
      const { data: despesa } = await supabase.from('expenses').select('project_id').eq('id', doc.expense_id).maybeSingle()
      projectId = despesa?.project_id ?? null
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
    const resultado = await extrairLinhasDaFatura(anthropic, supabase, {
      documentId: doc.id,
      base64,
      mediaType,
      purchaseDate: doc.doc_date ?? null,
      supplierName,
      projectId,
    })

    return NextResponse.json({ success: true, ...resultado })
  } catch (e: any) {
    console.error('[extract-purchase-items]', e)
    return NextResponse.json({ error: e.message ?? 'Erro ao extrair as linhas' }, { status: 500 })
  }
}
