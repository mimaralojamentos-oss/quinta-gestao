import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireRole } from '@/lib/require-role'

// Revisão ortográfica e gramatical em português europeu.
// Devolve o texto corrigido e a lista de alterações, para o utilizador
// ver exatamente o que mudou antes de o botão Enviar ficar disponível.
export async function POST(request: Request) {
  const auth = await requireRole(['admin', 'coadmin'])
  if (auth.error) return auth.error

  try {
    const { subject, body } = await request.json()

    if (!body || !String(body).trim()) {
      return NextResponse.json({ error: 'O corpo do e-mail está vazio' }, { status: 400 })
    }

    const prompt = `És revisor de textos em PORTUGUÊS EUROPEU (de Portugal, nunca do Brasil).
Revê o assunto e o corpo do e-mail abaixo.

Corrige APENAS:
- erros ortográficos
- erros gramaticais e de concordância
- acentuação
- pontuação claramente errada
- construções do português do Brasil, convertendo-as para português europeu

NÃO alteres:
- o sentido, o tom ou a intenção do texto
- valores, datas, nomes próprios ou números
- a estrutura dos parágrafos e as quebras de linha
- o estilo de escrita do autor (não "melhores" frases que já estão corretas)

ASSUNTO:
${subject ?? ''}

CORPO:
${body}

Responde APENAS com JSON válido, sem markdown e sem \`\`\`:
{
  "correctedSubject": "assunto corrigido",
  "correctedBody": "corpo corrigido, com as mesmas quebras de linha",
  "changes": [
    { "original": "texto errado tal como estava", "corrected": "texto corrigido", "reason": "motivo curto, ex: erro ortográfico" }
  ],
  "hasErrors": true ou false
}

Se não houver nada a corrigir, devolve o texto igual, "changes" vazio e "hasErrors": false.`

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

    let parsed: any
    try {
      parsed = JSON.parse(clean)
    } catch {
      return NextResponse.json({ error: 'Não foi possível rever o texto. Tenta novamente.' }, { status: 422 })
    }

    return NextResponse.json({
      success: true,
      correctedSubject: parsed.correctedSubject ?? subject,
      correctedBody: parsed.correctedBody ?? body,
      changes: Array.isArray(parsed.changes) ? parsed.changes : [],
      hasErrors: Boolean(parsed.hasErrors),
    })
  } catch (e: any) {
    console.error('[review-email]', e)
    return NextResponse.json({ error: e.message ?? 'Erro ao rever o e-mail' }, { status: 500 })
  }
}
