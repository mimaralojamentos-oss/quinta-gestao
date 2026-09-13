import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireRole } from '@/lib/require-role'
import { createClient } from '@supabase/supabase-js'
import { checkFileSize } from '@/lib/fileUpload'

// Extrai os dados de uma fatura de água (identificação do contador + a
// leitura/valor desta fatura em concreto), para preencher automaticamente
// tanto o "Novo Contador" como o "+ Leitura" em /agua/contadores.
// Espelha app/api/extract-edp-meter/route.ts (mesmo padrão de chamada à IA),
// mas devolve um único JSON com os dois grupos de campos — uma fatura de
// água já traz tudo isto junto, ao contrário da fatura EDP onde só se
// precisava dos dados de identificação. NÃO guarda nada — apenas devolve
// os campos para o utilizador rever e confirmar.
export async function POST(request: Request) {
  const auth = await requireRole(['admin', 'coadmin', 'electrician'])
  if (auth.error) return auth.error

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) return NextResponse.json({ error: 'Ficheiro não encontrado' }, { status: 400 })
    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Apenas ficheiros PDF são aceites' }, { status: 400 })
    }
    const sizeError = checkFileSize(file)
    if (sizeError) return sizeError

    const bytes = await file.arrayBuffer()
    const base64 = Buffer.from(bytes).toString('base64')
    const documentBlock = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

    const prompt = `Analisa esta fatura de água portuguesa (câmara municipal, empresa municipalizada ou outra entidade gestora de águas e saneamento) e extrai os dados em JSON puro (sem markdown, sem \`\`\`json, apenas o objeto JSON).

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
    // Ao testar com uma fatura real descobri que, dentro do prompt grande de
    // cima, a IA confundia sistematicamente este campo com a coluna
    // "Leitura" da tabela de consumo (que é outra coisa — ver comentário
    // acima) e respondia sempre "false", mesmo em faturas claramente
    // marcadas "Tipo de Leitura: Estimativa" — persistente mesmo depois de
    // reforçar a instrução e reordenar os campos. Isolado numa pergunta
    // curta e única, acerta sempre. Custa uma chamada extra à IA, mas o
    // upload de uma fatura não é um caminho quente — vale a pena pela
    // fiabilidade.
    const estimatedPrompt = `Nesta fatura de água, procura o campo "Tipo de Leitura" no CABEÇALHO da fatura (normalmente junto de "Tipo de Cliente" e "Tarifa" — não é a coluna "Leitura" de nenhuma tabela de consumo).
Responde só com uma palavra: "Estimada" se o campo disser Estimativa/Estimado, "Real" se disser Real/Efetiva, "Nenhuma" se esse campo não existir na fatura.`

    const [response, estimatedResponse] = await Promise.all([
      anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 800,
        messages: [{ role: 'user', content: [documentBlock, { type: 'text', text: prompt }] as any }],
      }),
      anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 10,
        messages: [{ role: 'user', content: [documentBlock, { type: 'text', text: estimatedPrompt }] as any }],
      }),
    ])

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    // Defesa extra face ao endpoint da luz: a IA por vezes escreve uma frase
    // antes/depois do JSON apesar da instrução — em vez de só tirar as
    // vedações ```, isola o primeiro bloco { ... } do texto.
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const jsonMatch = clean.match(/\{[\s\S]*\}/)

    let extracted: any = {}
    try {
      extracted = JSON.parse(jsonMatch ? jsonMatch[0] : clean)
    } catch {
      return NextResponse.json({ error: 'Não foi possível ler os dados desta fatura' }, { status: 422 })
    }

    // Normalização defensiva — nunca confiar cegamente no que a IA devolve
    // para campos numéricos/datas, que vão diretamente para inputs do formulário.
    const toNumber = (v: any): number | null => {
      if (v == null || v === '') return null
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.').replace(/[^\d.-]/g, ''))
      return Number.isFinite(n) ? n : null
    }
    const toDate = (v: any): string | null => {
      if (typeof v !== 'string') return null
      return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
    }
    const contractNumber = extracted.contract_number ? String(extracted.contract_number).replace(/\D/g, '') || null : null
    const meterNumber = extracted.meter_number != null ? String(extracted.meter_number).trim() || null : null

    const estimatedText = (estimatedResponse.content[0].type === 'text' ? estimatedResponse.content[0].text : '').toLowerCase()
    const readingEstimated = /estim|true/.test(estimatedText) ? true
      : /real|efetiv|false/.test(estimatedText) ? false
      : null

    // Avisar se já existe um contador com este contrato ou nº de contador, para não duplicar.
    let existingMeter: any = null
    if (contractNumber || meterNumber) {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      )
      const { data: meters } = await supabase.from('water_meters').select('id, name, contract_number, meter_number')
      existingMeter = (meters ?? []).find((m: any) =>
        (contractNumber && m.contract_number && String(m.contract_number).replace(/\D/g, '') === contractNumber) ||
        (meterNumber && m.meter_number && String(m.meter_number).trim() === meterNumber),
      ) ?? null
    }

    return NextResponse.json({
      success: true,
      data: {
        contract_number: contractNumber,
        meter_number: meterNumber,
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
      },
      existingMeter,
    })
  } catch (e: any) {
    console.error(e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
