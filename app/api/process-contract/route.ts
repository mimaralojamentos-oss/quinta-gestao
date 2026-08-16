import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireRole } from '@/lib/require-role'
import { checkFileSize } from '@/lib/fileUpload'

export async function POST(request: Request) {
  const auth = await requireRole(['admin', 'coadmin'])
  if (auth.error) return auth.error

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    if (!file) return NextResponse.json({ error: 'Ficheiro não encontrado' }, { status: 400 })
    const sizeError = checkFileSize(file)
    if (sizeError) return sizeError

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
            text: `Extrai os seguintes dados deste contrato de arrendamento em JSON (sem markdown, só JSON puro).
Se não encontrares um campo, coloca null.
{
  "tenant_name": "nome completo do inquilino/arrendatário",
  "tenant_nif": "NIF do inquilino (só números, sem espaços)",
  "tenant_phone": "telefone do inquilino",
  "tenant_email": "email do inquilino",
  "monthly_rent": valor numérico mensal em euros sem símbolo,
  "deposit": valor numérico da caução em euros sem símbolo,
  "start_date": "data de início no formato YYYY-MM-DD",
  "end_date": "data de fim no formato YYYY-MM-DD",
  "notes": "resumo de cláusulas importantes, máximo 300 caracteres"
}`
          }
        ]
      }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const extracted = JSON.parse(clean)

    return NextResponse.json({ success: true, data: extracted })

  } catch (e: any) {
    console.error(e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
