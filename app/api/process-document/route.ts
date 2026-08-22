import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'crypto'
import { requireRole } from '@/lib/require-role'
import { checkFileSize } from '@/lib/fileUpload'
import { meterReadingExists } from '@/lib/meterReadings'

const CASH_FUND_START_DATE = '2026-06-01'

export async function POST(request: Request) {
  const auth = await requireRole(['admin', 'coadmin', 'electrician'])
  if (auth.error) return auth.error

  // Esta rota usa a service role, que ignora as regras de segurança da base de
  // dados (RLS). Por isso as permissões têm de ser aplicadas AQUI à mão.
  // O eletricista pode carregar faturas de luz, mas não pode criar despesas,
  // receitas nem mexer no fundo de maneio — isso é exclusivo de admin/coadmin.
  const role = auth.profile?.role
  const canWriteFinance = role === 'admin' || role === 'coadmin'

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    let tipo = formData.get('tipo') as string ?? 'fatura'
    const tipoCustom = formData.get('tipo_custom') as string ?? null
    const force = formData.get('force') === 'true'
    // Um eletricista nunca gera despesas/receitas, independentemente do que peça.
    const skipExpense = formData.get('skip_expense') === 'true' || !canWriteFinance
    const createIncome = formData.get('create_income') === 'true' && canWriteFinance

    if (!file) return NextResponse.json({ error: 'Ficheiro não encontrado' }, { status: 400 })
    const sizeError = checkFileSize(file)
    if (sizeError) return sizeError

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

ATENÇÃO CRÍTICA — dinheiro a entrar vs. dinheiro a sair:
Nem toda a fatura de eletricidade é uma despesa. Existem dois casos opostos:
 (a) COMPRA de energia — o titular consome e paga ao comercializador (EDP Comercial, Galp, Iberdrola...). É DESPESA → doc_type "fatura_luz".
 (b) VENDA/PRODUÇÃO de energia — o titular tem painéis solares e VENDE a energia produzida. O comercializador (frequentemente "SU Eletricidade", que é o comprador de último recurso) emite uma AUTOFATURA em nome do produtor. É RECEITA → doc_type "receita".
Sinais de (b): as palavras "autofatura", "auto-faturação", "produção", "energia produzida", "venda de energia", "UPAC", "produtor"; o titular aparece como FORNECEDOR e não como cliente; o documento indica energia injetada na rede.
Se for o caso (b), usa doc_type "receita" e mete "is_venda_energia": true.

{
  "doc_type": "um de: fatura, fatura_luz, fatura_agua, receita, registo_predial, carta, transferencia_interna, outro",
  "is_venda_energia": true se for autofatura de venda/produção de energia (dinheiro a ENTRAR), false caso contrário,
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

        const promptEdp = jsonOnlyInstruction + `Extrai os seguintes dados desta fatura EDP em JSON (sem markdown, só JSON puro).

IMPORTANTE sobre o valor ("amount"):
- Muitas faturas EDP são do plano "Conta Certa" (prestações mensais fixas). Nessas, o destaque "Quanto tenho a pagar?" mostra 0 € porque o débito direto já foi cobrado, e existe uma linha "Valor já pago" negativa. NÃO uses esses valores.
- Nesse caso, o valor correto é o total da fatura, que aparece na secção "Prestações" como "Valor: X €" e corresponde à mensalidade com IVA incluído (ex: mensalidade 530,90 € + IVA 122,10 € = 653,00 €).
- Regra geral: "amount" é sempre o valor total da fatura com IVA, positivo, mesmo que já tenha sido pago.

{
  "doc_number": "número da fatura",
  "supplier_name": "nome do fornecedor",
  "supplier_nif": "NIF do fornecedor (só números)",
  "buyer_name": "nome do comprador",
  "buyer_nif": "NIF do comprador (só números)",
  "amount": valor total da fatura com IVA (número positivo sem símbolo),
  "doc_date": "data de emissão no formato YYYY-MM-DD",
  "items_summary": "resumo em português, máximo 200 caracteres",
  "category": "edp",
  "edp_contract_number": "código de contrato EDP (ex: 160807307528), null se não existir",
  "edp_cpe": "CPE tal como aparece no documento, ex: PT0002000003480097WQ (pode vir com espaços)",
  "edp_meter_number": "número do contador",
  "edp_reading_value": valor numérico da leitura actual do contador (null se a fatura não tiver leitura, como nas de prestação),
  "edp_reading_date": "data da leitura no formato YYYY-MM-DD (null se não existir)",
  "edp_kwh_consumed": número total de kWh consumidos faturados (null se não existir),
  "edp_is_prestacao": true se for fatura de prestação/mensalidade do plano Conta Certa, false caso contrário
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

        // Rede de segurança: mesmo que a IA falhe a distinção, estas
        // expressões só aparecem em documentos de VENDA de energia, nunca
        // numa fatura de consumo. Um erro aqui criaria uma despesa a partir
        // de dinheiro que na verdade entrou.
        const textoParaAnalise = [
          file.name, extracted.items_summary, extracted.supplier_name,
        ].filter(Boolean).join(' ').toLowerCase()

        const sinaisDeVenda = [
          'autofatura', 'auto-fatura', 'autofaturação', 'auto-faturação',
          'produção de energia', 'energia produzida', 'venda de energia',
          'upac', 'energia injetada',
        ]

        if (extracted.is_venda_energia === true || sinaisDeVenda.some(s => textoParaAnalise.includes(s))) {
          tipo = 'receita'
          extracted.category = 'energia_solar'
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

    // ── FATURA LUZ: ligar ao quadro elétrico correspondente ──
    //
    // Notas sobre o matching (aprendido com as faturas reais):
    //  - O CPE vem frequentemente com espaços no PDF ("PT 0002 000 067 478 355 HS")
    //    mas está gravado sem espaços na tabela meters. Por isso comparamos
    //    sempre as versões normalizadas (sem espaços, maiúsculas).
    //  - As faturas de prestação (Conta Certa) NÃO trazem leitura de contador.
    //    Nesses casos usamos a data do documento e deixamos a leitura vazia,
    //    para que a fatura fique na mesma associada ao quadro.
    const normalizeCode = (v: any) => String(v ?? '').replace(/[\s.\-]/g, '').toUpperCase()

    let meterReadingCreated = false
    let meterMatchReason: string | null = null

    if (tipo === 'fatura_luz') {
      let meter: any = null
      const { data: allMeters } = await supabase.from('meters').select('id, name, contract_number, cpe')
      const meters = allMeters ?? []

      // 1. Nº de contrato EDP (comparação normalizada)
      if (extracted.edp_contract_number) {
        const target = normalizeCode(extracted.edp_contract_number)
        meter = meters.find((m: any) => m.contract_number && normalizeCode(m.contract_number) === target) ?? null
        if (meter) meterMatchReason = 'contrato'
      }

      // 2. CPE (comparação normalizada — resolve o caso dos espaços)
      if (!meter && extracted.edp_cpe) {
        const target = normalizeCode(extracted.edp_cpe)
        meter = meters.find((m: any) => m.cpe && normalizeCode(m.cpe) === target) ?? null
        if (meter) meterMatchReason = 'CPE'
      }

      // 3. Nome do quadro no nome do ficheiro (ex: "EDP 9005" → "Quadro 9005 - painéis")
      if (!meter) {
        const fileNorm = file.name.toLowerCase().replace(/\s+/g, '')
        for (const m of meters) {
          const nameNorm = m.name.toLowerCase().replace(/^quadro/, '').replace(/\s+/g, '')
          if (nameNorm && fileNorm.includes(nameNorm)) { meter = m; meterMatchReason = 'nome do ficheiro'; break }
        }
      }

      // 4. Só o número do quadro no nome do ficheiro (ex: "9005")
      if (!meter) {
        const fileNorm = file.name.toLowerCase().replace(/\s+/g, '')
        for (const m of meters) {
          const num = m.name.match(/\d{3,}/)?.[0]
          if (num && new RegExp(`edp.{0,3}${num}`).test(fileNorm)) { meter = m; meterMatchReason = 'número do quadro'; break }
        }
      }

      if (meter) {
        // Faturas de prestação não têm leitura: usamos a data do documento.
        const readingDate = extracted.edp_reading_date ?? extracted.doc_date ?? null

        if (readingDate) {
          const jaExiste = await meterReadingExists(supabase, meter.id, readingDate, extracted.doc_number)

          if (!jaExiste) {
            await supabase.from('meter_readings').insert({
              meter_id: meter.id,
              reading_date: readingDate,
              reading_value: extracted.edp_reading_value ?? null,
              invoice_amount: extracted.amount ?? null,
              invoice_number: extracted.doc_number ?? null,
              notes: extracted.edp_reading_date
                ? `Importado automaticamente do documento ${file.name}`
                : `Fatura de prestação (sem leitura) — ${file.name}`,
            })
            meterReadingCreated = true
          }
        }
      }
    }

    // ── TRANSFERÊNCIA INTERNA: criar movimento de saída no Fundo de Maneio ──
    // Só admin/coadmin mexem no fundo de maneio.
    let cashMovementCreated = false
    if (canWriteFinance && tipo === 'transferencia_interna' && doc && extracted.amount && extracted.doc_date) {
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

    if (!skipExpense && isFatura && doc && extracted.amount && extracted.doc_date) {
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

    // ── CRIAR RECEITA automaticamente para documentos do tipo receita ──
    // Quando a venda de energia é detetada automaticamente, a receita é criada
    // sem esperar pela opção do formulário — o utilizador pediu uma fatura e o
    // que existe é dinheiro a entrar, seria estranho não ficar registado.
    let autoIncome = false
    const criarReceita = tipo === 'receita' && (createIncome || extracted.is_venda_energia === true || extracted.category === 'energia_solar')

    if (criarReceita && doc && extracted.amount && extracted.doc_date && canWriteFinance) {
      const { data: newIncome } = await supabase.from('income_records').insert({
        description: extracted.items_summary ?? extracted.supplier_name ?? 'Receita',
        amount: Math.abs(extracted.amount),
        income_date: extracted.doc_date,
        category: extracted.category ?? 'energia_solar',
        document_id: doc.id,
        notes: extracted.doc_number ? `Documento nº ${extracted.doc_number}` : null,
      }).select().single()
      if (newIncome) autoIncome = true
    }

    return NextResponse.json({ success: true, document: doc, autoExpense, autoIncome, duplicate: false, expenseId, meterReadingCreated, meterMatchReason, cashMovementCreated, detectedTipo: tipo })

  } catch (e: any) {
    console.error(e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// https://quinta-gestao.vercel.app/documentos
