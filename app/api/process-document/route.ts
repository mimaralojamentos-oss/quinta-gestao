import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'crypto'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    const tipo = formData.get('tipo') as string ?? 'fatura'
    const tipoCustom = formData.get('tipo_custom') as string ?? null

    if (!file) return NextResponse.json({ error: 'Ficheiro não encontrado' }, { status: 400 })

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // Calcular hash SHA-256 para detetar duplicados
    const fileHash = createHash('sha256').update(buffer).digest('hex')

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Verificar duplicado
    const { data: existing } = await supabase
      .from('documents')
      .select('id, file_path, supplier_name, doc_date, amount, tipo')
      .eq('file_hash', fileHash)
      .single()

    if (existing) {
      return NextResponse.json({
        duplicate: true,
        existing,
        message: 'Este ficheiro já foi carregado anteriormente'
      })
    }

    // OCR com Claude AI (apenas PDFs e imagens)
    let extracted: any = {}
    const isPdf = file.type === 'application/pdf'
    const isImage = file.type.startsWith('image/')

    if (isPdf || isImage) {
      try {
        const base64 = buffer.toString('base64')
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

        const mediaType = isPdf ? 'application/pdf' : file.type as any
        const contentType = isPdf ? 'document' : 'image'

        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-5',
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: [
              isPdf ? {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: base64 }
              } : {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64 }
              },
              {
                type: 'text',
                text: `Extrai os seguintes dados deste documento em JSON (sem markdown, só JSON puro):
{
  "doc_number": "número do documento/fatura se existir",
  "supplier_name": "nome do fornecedor/entidade emissora",
  "supplier_nif": "NIF do fornecedor (só números, null se não existir)",
  "buyer_name": "nome do comprador/destinatário",
  "buyer_nif": "NIF do comprador (só números, null se não existir)",
  "amount": valor numérico total sem símbolo (null se não existir),
  "doc_date": "data no formato YYYY-MM-DD (null se não existir)",
  "items_summary": "resumo do conteúdo em português, máximo 200 caracteres",
  "category": "uma de: obras, edp, pessoal, contabilidade, manutencao, outros"
}`
              }
            ] as any
          }]
        })

        const text = response.content[0].type === 'text' ? response.content[0].text : ''
        const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
        extracted = JSON.parse(clean)
      } catch (e) {
        console.error('OCR falhou:', e)
        extracted = {}
      }
    }

    // Procurar proprietário pelo NIF do comprador
    let ownerName = 'N/D'
    if (extracted.buyer_nif) {
      const { data: ownerData } = await supabase
        .from('owners')
        .select('name')
        .eq('nif', extracted.buyer_nif)
        .single()
      if (ownerData?.name) ownerName = ownerData.name
    }

    // Guardar ficheiro no bucket documents
    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const fileName = `${tipo}/${Date.now()}_${cleanName}`
    const { error: uploadErr } = await supabase.storage
      .from('documents')
      .upload(fileName, buffer, { contentType: file.type })

    if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 400 })

    // Guardar na tabela documents
    const { data: doc, error } = await supabase.from('documents').insert({
      file_path: fileName,
      file_hash: fileHash,
      original_name: file.name,
      tipo,
      tipo_custom: tipoCustom,
      supplier_name: extracted.supplier_name ?? null,
      supplier_nif: extracted.supplier_nif ?? null,
      buyer_name: extracted.buyer_name ?? null,
      buyer_nif: extracted.buyer_nif ?? null,
      amount: extracted.amount ?? null,
      doc_date: extracted.doc_date ?? null,
      doc_number: extracted.doc_number ?? null,
      items_summary: extracted.items_summary ?? null,
      category: extracted.category ?? 'outros',
      owner: ownerName,
      ocr_done: (isPdf || isImage),
      status: 'ativo',
    }).select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    // Criar despesa automaticamente para faturas
    const isFatura = ['fatura', 'fatura_luz', 'fatura_agua'].includes(tipo)
    let autoExpense = false

    if (isFatura && doc && extracted.amount) {
      const { data: newExpense } = await supabase.from('expenses').insert({
        expense_date: extracted.doc_date ?? new Date().toISOString().slice(0, 10),
        category: extracted.category ?? 'outros',
        type: 'pontual',
        description: extracted.items_summary ?? extracted.supplier_name ?? 'Fatura',
        amount: extracted.amount,
        payment_method: 'banco',
        supplier: extracted.supplier_name ?? null,
        notes: `Criado automaticamente a partir do documento ${extracted.doc_number ?? ''}`.trim(),
      }).select().single()

      if (newExpense) {
        await supabase.from('documents').update({
          expense_id: newExpense.id
        }).eq('id', doc.id)
        autoExpense = true
      }
    }

    return NextResponse.json({ success: true, document: doc, autoExpense, duplicate: false })

  } catch (e: any) {
    console.error(e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
