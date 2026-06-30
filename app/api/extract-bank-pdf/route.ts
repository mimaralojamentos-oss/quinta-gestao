import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireRole } from '@/lib/require-role'

export async function POST(request: Request) {
  const auth = await requireRole(['admin', 'coadmin'])
  if (auth.error) return auth.error

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) return NextResponse.json({ error: 'Ficheiro não encontrado' }, { status: 400 })
    if (file.type !== 'application/pdf') return NextResponse.json({ error: 'Apenas ficheiros PDF são aceites' }, { status: 400 })

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const base64 = buffer.toString('base64')

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

    const prompt = `Analisa este documento bancário e extrai os dados em JSON puro (sem markdown, sem \`\`\`json, apenas o objeto JSON).

Extrai os seguintes campos:
{
  "bank_name": "nome do banco (ex: Caixa de Crédito Agrícola, Millennium BCP, Caixa Geral de Depósitos)",
  "holder_name": "nome completo do titular da conta",
  "iban": "IBAN completo no formato PT50... sem espaços (null se não existir)",
  "account_number": "número de conta (null se não existir)",
  "notes": "qualquer informação adicional relevante em português, máximo 150 caracteres (null se não houver)"
}

Regras:
- Se um campo não estiver presente no documento, coloca null
- O IBAN deve incluir o prefixo PT e todos os dígitos sem espaços
- O nome do banco deve ser o nome oficial completo
- Responde APENAS com o JSON, sem texto antes ou depois`

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 }
          },
          { type: 'text', text: prompt }
        ] as any
      }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

    let extracted: any = {}
    try {
      extracted = JSON.parse(clean)
    } catch {
      return NextResponse.json({ error: 'Não foi possível extrair dados do PDF' }, { status: 422 })
    }

    return NextResponse.json({ success: true, data: extracted })

  } catch (e: any) {
    console.error(e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
