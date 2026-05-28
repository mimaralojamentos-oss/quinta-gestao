import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    if (!file) return NextResponse.json({ error: 'Ficheiro não encontrado' }, { status: 400 })

    const bytes = await file.arrayBuffer()
    const base64 = Buffer.from(bytes).toString('base64')

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
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
  "supplier_nif": "NIF do fornecedor (só números)",
  "buyer_name": "nome do comprador",
  "buyer_nif": "NIF do comprador (só números)",
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
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const extracted = JSON.parse(clean)

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

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

    // Guardar PDF no Supabase Storage
    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const fileName = `${Date.now()}_${cleanName}`
    await supabase.storage.from('invoices').upload(fileName, bytes, {
      contentType: 'application/pdf'
    })

    // Guardar fatura na base de dados
    const { data: invoice, error } = await supabase.from('invoices').insert({
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
      owner: ownerName,
      status: 'por_categorizar',
    }).select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    // A partir de Junho 2026 — criar despesa automaticamente
    const invoiceDate = extracted.invoice_date ? new Date(extracted.invoice_date) : null
    const junhoStart = new Date('2026-06-01')
    const isJuneOrLater = invoiceDate && invoiceDate >= junhoStart

    if (isJuneOrLater && invoice) {
      const { data: newExpense } = await supabase.from('expenses').insert({
        expense_date: extracted.invoice_date,
        category: extracted.category ?? 'outros',
        type: 'pontual',
        description: extracted.items_summary ?? extracted.supplier_name ?? 'Fatura',
        amount: extracted.amount ?? 0,
        payment_method: 'banco', // default banco — pode editar depois
        supplier: extracted.supplier_name ?? null,
        notes: `Criado automaticamente a partir da fatura ${extracted.invoice_number ?? ''}`.trim(),
        invoice_id: invoice.id,
      }).select().single()

      // Atualizar fatura com referência à despesa
      if (newExpense) {
        await supabase.from('invoices').update({
          expense_id: newExpense.id,
          status: 'categorizada',
        }).eq('id', invoice.id)
      }
    }

    return NextResponse.json({ success: true, invoice, autoExpense: isJuneOrLater })

  } catch (e: any) {
    console.error(e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
