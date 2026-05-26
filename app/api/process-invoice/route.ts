import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    const owner = formData.get('owner') as string

    if (!file) return NextResponse.json({ error: 'Ficheiro não encontrado' }, { status: 400 })

    // Converter PDF para base64
    const bytes = await file.arrayBuffer()
    const base64 = Buffer.from(bytes).toString('base64')

    // Usar Claude para extrair dados da fatura
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 }
          },
          {
            type: 'text',
            text: `Extrai os seguintes dados desta fatura em JSON (sem markdown, só JSON puro):
{
  "invoice_number": "número da fatura",
  "supplier_name": "nome do fornecedor",
  "supplier_nif": "NIF do fornecedor",
  "buyer_name": "nome do comprador",
  "buyer_nif": "NIF do comprador",
  "amount": valor numérico total sem símbolo,
  "invoice_date": "data no formato YYYY-MM-DD",
  "items_summary": "resumo dos produtos/serviços em português, máximo 200 caracteres",
  "category": "uma de: obras, edp, pessoal, contabilidade, manutencao, outros"
}`
          }
        ]
      }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const extracted = JSON.parse(text)

    // Guardar PDF no Supabase Storage
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const fileName = `${Date.now()}_${file.name}`
    await supabase.storage.from('invoices').upload(fileName, bytes, {
      contentType: 'application/pdf'
    })

    // Guardar na base de dados
    const { data, error } = await supabase.from('invoices').insert({
      file_path: fileName,
      invoice_number: extracted.invoice_number,
      supplier_name: extracted.supplier_name,
      supplier_nif: extracted.supplier_nif,
      buyer_name: extracted.buyer_name,
      buyer_nif: extracted.buyer_nif,
      amount: extracted.amount,
      invoice_date: extracted.invoice_date,
      items_summary: extracted.items_summary,
      category: extracted.category,
      owner: owner,
      status: 'por_categorizar',
    }).select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ success: true, invoice: data })
  } catch (e: any) {
    console.error(e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
