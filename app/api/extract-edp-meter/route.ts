import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireRole } from '@/lib/require-role'
import { createClient } from '@supabase/supabase-js'
import { checkFileSize } from '@/lib/fileUpload'

// Extrai os dados de identificação de um quadro elétrico a partir de uma
// fatura EDP, para preencher automaticamente o formulário "Novo Quadro".
// NÃO guarda nada — apenas devolve os campos para o utilizador confirmar.
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

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

    const prompt = `Analisa esta fatura de eletricidade (EDP ou outro comercializador) e extrai os dados de identificação do ponto de fornecimento em JSON puro (sem markdown, sem \`\`\`json, apenas o objeto JSON).

{
  "contract_number": "número de contrato / conta contrato (só dígitos, sem espaços). Se não existir, usa o número de mandato de débito direto. null se não houver nenhum",
  "cpe": "Código do Ponto de Entrega, SEM espaços, formato PTxxxxxxxxxxxxxxxxxxxx (ex: PT0002000003480097WQ). null se não existir",
  "location": "morada do local de fornecimento tal como aparece na fatura (não a morada de correspondência do cliente). null se não existir",
  "holder_name": "nome do titular do contrato. null se não existir",
  "power_kva": "potência contratada como texto, ex: 20,7 kVA. null se não existir",
  "suggested_name": "um nome curto e útil para identificar este quadro, baseado na morada ou no local de fornecimento, máximo 40 caracteres. Exemplos: 'Quadro Serpa Pinto 131A', 'Quadro Quinta Bela Vista'"
}

Regras:
- O CPE tem de vir sempre SEM espaços nem hífenes.
- O número de contrato tem de vir só com dígitos.
- Se um campo não estiver presente, coloca null.
- Responde APENAS com o JSON.`

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: prompt },
        ] as any,
      }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

    let extracted: any = {}
    try {
      extracted = JSON.parse(clean)
    } catch {
      return NextResponse.json({ error: 'Não foi possível ler os dados desta fatura' }, { status: 422 })
    }

    // Normalização defensiva — a IA às vezes devolve com espaços apesar da instrução
    const normalize = (v: any) => (v == null ? null : String(v).replace(/[\s.\-]/g, '').toUpperCase())
    const contractNumber = extracted.contract_number ? String(extracted.contract_number).replace(/\D/g, '') : null
    const cpe = normalize(extracted.cpe)

    // Avisar se já existe um quadro com este contrato ou CPE, para não duplicar
    let existingMeter: any = null
    if (contractNumber || cpe) {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      )
      const { data: meters } = await supabase.from('meters').select('id, name, contract_number, cpe')
      existingMeter = (meters ?? []).find((m: any) =>
        (contractNumber && m.contract_number && String(m.contract_number).replace(/\D/g, '') === contractNumber) ||
        (cpe && m.cpe && normalize(m.cpe) === cpe),
      ) ?? null
    }

    return NextResponse.json({
      success: true,
      data: {
        contract_number: contractNumber,
        cpe,
        location: extracted.location ?? null,
        holder_name: extracted.holder_name ?? null,
        power_kva: extracted.power_kva ?? null,
        suggested_name: extracted.suggested_name ?? null,
      },
      existingMeter,
    })
  } catch (e: any) {
    console.error(e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
