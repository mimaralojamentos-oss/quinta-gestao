import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'crypto'

const CASH_FUND_START_DATE = '2026-06-01'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    let tipo = formData.get('tipo') as string ?? 'fatura'
    const tipoCustom = formData.get('tipo_custom') as string ?? null
    const force = formData.get('force') === 'true'

    if (!file) return NextResponse.json({ error: 'Ficheiro não encontrado' }, { status: 400 })

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const fileHash = createHash('sha256').update(buffer).digest('hex')

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Verificar duplicado
    if (!force) {
      const { data: existing } = await supabase
        .from('documents')
        .select('id, file_path, supplier_name, doc_date, amount, tipo')
        .eq('file_hash', fileHash)
        .single()
      if (existing) {
        return NextResponse.json({ duplicate: true, existing, message: 'Este ficheiro já foi carregado anteriormente' })
      }
    }

    // Detetar método de pagamento pelo nome do ficheiro
    function detectPaymentMethod(fileName: string): string {
      const upper = fileName.toUpperCase()
      if (upper.includes('(D)') || upper.includes('(D).PDF')) return 'dinheiro'
      if (upper.includes('(B)') || upper.includes('(B).PDF')) return 'banco'
      return 'banco'
    }

    // OCR com Claude AI
    let extracted: any = {}
    const isPdf = file.type === 'application/pdf'
    const isImage = file.type.startsWith('image/')
    const isAutomatic = tipo === 'automatico'

    if (isPdf || isImage) {
      try {
        const base64 = buffer.toString('base64')
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

        const jsonOnlyInstruction = 'Responde APENAS com um objeto JSON válido. Não incluas markdown, não incluas ```json, não incluas nenhum texto antes ou depois do JSON.\n\n'

        const promptAuto = jsonOnlyInstruction + `Analisa este documento e extrai os dados em JSON (sem markdown, só JSON puro).
Primeiro identifica o tipo de documento e depois extrai os campos correspondentes.

Atenção especial ao tipo "transferencia_interna": usa este tipo quando o documento for um comprovativo/recibo emitido por um banco (ex: Crédito Agrícola) referente a um depósito em numerário, entrega de valores ao banco ou transferência entre contas próprias. Estes documentos tipicamente têm termos como "Dep. Numerário", "Entrega para Depósito" ou "Total Depositado", indicam um valor depositado em euros e o nome do depositante.

{
  "doc_type": "um de: fatura, fatura_luz, fatura_agua, registo_predial, carta, transferencia_interna, outro",
  "doc_number": "número do documento/fatura se existir",
  "supplier_name": "nome do fornecedor/entidade emissora",
  "supplier_nif": "NIF do fornecedor (só números, null se não existir)",
  "buyer_name": "nome do comprador/destinatário",
  "buyer_nif": "NIF do comprador (só números, null se não existir)",
  "amount": valor numérico total sem símbolo (null se não existir),
  "doc_date": "data no formato YYYY-MM-DD (null se não existir)",
  "items_summary": "resumo do conteúdo em português, máximo 200 caracteres",
  "category": "uma de: obras, edp, pessoal, contabilidade, manutencao, outros",
  "edp_contract_number": "código de contrato EDP se for fatura de luz (ex: 160807307528), null caso contrário",
  "edp_reading_value": valor numérico da leitura do contador se for fatura de luz (null caso contrário),
  "edp_reading_date": "data da leitura se for fatura de luz no formato YYYY-MM-DD (null caso contrário)",
  "edp_kwh_consumed": número de kWh consumidos se for fatura de luz (null caso contrário)
}`

        const promptEdp = jsonOnlyInstruction + `Extrai os seguintes dados desta fatura EDP em JSON (sem markdown, só JSON puro):
{
  "doc_number": "número da fatura",
  "supplier_name": "nome do fornecedor",
  "supplier_nif": "NIF do fornecedor (só números)",
  "buyer_name": "nome do comprador",
  "buyer_nif": "NIF do comprador (só números)",
  "amount": valor total a pagar (número sem símbolo),
  "doc_date": "data de emissão no formato YYYY-MM-DD",
  "items_summary": "resumo em português, máximo 200 caracteres",
  "category": "edp",
  "edp_contract_number": "código de contrato EDP (ex: 160807307528)",
  "edp_cpe": "CPE (ex: PT0002000003480097WQ)",
  "edp_meter_number": "número do contador",
  "edp_reading_value": valor numérico da leitura actual do contador,
  "edp_reading_date": "data da leitura no formato YYYY-MM-DD",
  "edp_kwh_consumed": número total de kWh consumidos faturados
}`

        const promptNormal = jsonOnlyInstruction + `Extrai os seguintes dados deste documento em JSON (sem markdown, só JSON puro):
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

        const promptTransferenciaInterna = jsonOnlyInstruction + `Extrai os seguintes dados deste documento de transferência interna (do Fundo de Maneio para o banco) em JSON (sem markdown, só JSON puro):
{
  "amount": valor numérico da transferência sem símbolo (null se não existir),
  "doc_date": "data da transferência no formato YYYY-MM-DD (null se não existir)",
  "items_summary": "descrição breve da transferência em português, ex: Transferência para banco (máximo 200 caracteres)"
}`

        const prompt = isAutomatic ? promptAuto : (tipo === 'fatura_luz' ? promptEdp : tipo === 'transferencia_interna' ? promptTransferenciaInterna : promptNormal)

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
                source: { type: 'base64', media_type: file.type as any, data: base64 }
              },
              { type: 'text', text: prompt }
            ] as any
          }]
        })

        const text = response.content[0].type === 'text' ? response.content[0].text : ''
        const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

        try {
          extracted = JSON.parse(clean)
        } catch {
          throw new Error(`Resposta da IA não é JSON válido: ${clean.slice(0, 300)}`)
        }

        // Se for automático, usar o tipo detetado pela IA
        if (isAutomatic && extracted.doc_type) {
          tipo = extracted.doc_type
        }

      } catch (e) {
        console.error('OCR falhou:', e)
        extracted = {}
        if (isAutomatic) tipo = 'fatura'
      }
    } else {
      if (isAutomatic) tipo = 'fatura'
    }

    // Procurar proprietário pelo NIF
    let ownerName = 'N/D'
    if (extracted.buyer_nif) {
      const { data: ownerData } = await supabase.from('owners').select('name').eq('nif', extracted.buyer_nif).single()
      if (ownerData?.name) ownerName = ownerData.name
    }

    // Guardar ficheiro no bucket
    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const fileName = `${tipo}/${Date.now()}_${cleanName}`
    const { error: uploadErr } = await supabase.storage.from('documents').upload(fileName, buffer, { contentType: file.type })
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

    // ── FATURA LUZ: criar leitura no quadro correspondente ──
    let meterReadingCreated = false
    if (tipo === 'fatura_luz' && extracted.edp_contract_number) {
      const { data: meter } = await supabase.from('meters').select('id, name').eq('contract_number', extracted.edp_contract_number).single()
      if (meter && extracted.edp_reading_date) {
        const { data: existingReading } = await supabase.from('meter_readings').select('id').eq('meter_id', meter.id).eq('reading_date', extracted.edp_reading_date).single()
        if (!existingReading) {
          await supabase.from('meter_readings').insert({
            meter_id: meter.id,
            reading_date: extracted.edp_reading_date,
            reading_value: extracted.edp_reading_value ?? null,
            invoice_amount: extracted.amount ?? null,
            invoice_number: extracted.doc_number ?? null,
            notes: `Importado automaticamente do documento ${file.name}`,
          })
          meterReadingCreated = true
        }
      }
    }

    // ── TRANSFERÊNCIA INTERNA: criar movimento de saída no Fundo de Maneio ──
    let cashMovementCreated = false
    if (tipo === 'transferencia_interna' && doc && extracted.amount && extracted.doc_date) {
      await supabase.from('cash_fund_movements').insert({
        movement_date: extracted.doc_date,
        description: `Transferência para banco - ${extracted.doc_date}`,
        amount: -Math.abs(extracted.amount),
        type: 'saida',
        source: 'documento',
        source_id: doc.id,
        notes: 'Criado automaticamente a partir de documento de transferência interna',
      })
      cashMovementCreated = true
    }

    // ── CRIAR DESPESA automaticamente para faturas ──
    const isFatura = ['fatura', 'fatura_luz', 'fatura_agua'].includes(tipo)
    let autoExpense = false
    let expenseId = null

    if (isFatura && doc && extracted.amount && extracted.doc_date) {
      const paymentMethod = detectPaymentMethod(file.name)

      const dateFrom = new Date(extracted.doc_date); dateFrom.setDate(dateFrom.getDate() - 1)
      const dateTo = new Date(extracted.doc_date); dateTo.setDate(dateTo.getDate() + 1)

      const { data: existingExpense } = await supabase.from('expenses').select('id')
        .eq('amount', extracted.amount)
        .gte('expense_date', dateFrom.toISOString().slice(0, 10))
        .lte('expense_date', dateTo.toISOString().slice(0, 10))
        .is('invoice_id', null)
        .limit(1).single()

      if (existingExpense) {
        await supabase.from('expenses').update({ payment_method: paymentMethod }).eq('id', existingExpense.id)
        await supabase.from('documents').update({ expense_id: existingExpense.id }).eq('id', doc.id)
        expenseId = existingExpense.id
      } else {
        const { data: newExpense } = await supabase.from('expenses').insert({
          expense_date: extracted.doc_date,
          category: extracted.category ?? 'outros',
          type: 'pontual',
          description: extracted.items_summary ?? extracted.supplier_name ?? 'Fatura',
          amount: extracted.amount,
          payment_method: paymentMethod,
          supplier: extracted.supplier_name ?? null,
          notes: `Criado automaticamente a partir do documento ${extracted.doc_number ?? ''}`.trim(),
        }).select().single()

        if (newExpense) {
          await supabase.from('documents').update({ expense_id: newExpense.id }).eq('id', doc.id)
          expenseId = newExpense.id
          autoExpense = true

          if (paymentMethod === 'dinheiro' && extracted.doc_date >= CASH_FUND_START_DATE) {
            await supabase.from('cash_fund_movements').insert({
              movement_date: extracted.doc_date,
              description: `💸 ${extracted.items_summary ?? extracted.supplier_name ?? 'Fatura'}`,
              amount: -Math.abs(extracted.amount),
              type: 'saida',
              source: 'despesa',
              source_id: newExpense.id,
            })
          }
        }
      }
    }

    return NextResponse.json({ success: true, document: doc, autoExpense, duplicate: false, expenseId, meterReadingCreated, cashMovementCreated, detectedTipo: tipo })

  } catch (e: any) {
    console.error(e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// https://quinta-gestao.vercel.app/documentos
