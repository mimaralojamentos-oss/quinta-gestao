import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireRole } from '@/lib/require-role'
import { EMAIL_CONTEXT_LABELS, type EmailContextData } from '@/lib/emailConfig'
import { formatCurrency } from '@/lib/utils'

// Redige o corpo e o assunto de um e-mail a partir do contexto da área
// onde foi pedido (renda em atraso, eletricidade, dívida, etc.).
// Não envia nada — devolve o texto para o utilizador ler, editar e validar.
export async function POST(request: Request) {
  // O Super Leitor pode redigir e ver o e-mail, mas não o envia (ver /api/send-email).
  const auth = await requireRole(['admin', 'coadmin', 'super_reader'])
  if (auth.error) return auth.error

  try {
    const data = (await request.json()) as EmailContextData & { senderName?: string }

    if (!data?.tenantName) {
      return NextResponse.json({ error: 'Falta o nome do inquilino' }, { status: 400 })
    }

    const contextLabel = EMAIL_CONTEXT_LABELS[data.context] ?? 'Assunto geral'

    const detalhe = (data.items ?? []).length > 0
      ? `\nDetalhe das rubricas (usa-as TODAS no e-mail, uma por linha, com o respetivo valor):\n` +
        (data.items ?? []).map(i => `- [${i.grupo}] ${i.descricao}: ${formatCurrency(i.valor)}`).join('\n')
      : ''

    const factos = [
      `Destinatário: ${data.tenantName}`,
      data.spaceRef ? `Espaço arrendado: ${data.spaceRef}` : null,
      data.amount != null ? `Valor total: ${formatCurrency(data.amount)}` : null,
      data.periods && data.periods.length > 0 ? `Períodos em causa: ${data.periods.join(', ')}` : null,
      data.date ? `Data relevante: ${data.date}` : null,
      data.extraNotes ? `Instruções adicionais do remetente: ${data.extraNotes}` : null,
    ].filter(Boolean).join('\n') + detalhe

    // Três abordagens para a mesma informação. A escolha é do utilizador.
    const abordagens: Record<string, string> = {
      divida_atraso: `ABORDAGEM: DÍVIDA EM ATRASO (firme mas educada).
- Informa que existem valores em atraso e pede a regularização.
- Discrimina TODAS as rubricas listadas acima, uma por linha, com o valor de cada uma.
- Apresenta o total no fim.
- Sê claro e direto, sem ameaças, sem prazos inventados e sem falar em consequências legais.`,

      valores_pagar: `ABORDAGEM: VALORES A PAGAR (cordial e leve).
- NUNCA uses as palavras "dívida", "atraso", "em falta", "devedor", "regularizar" ou "incumprimento".
- Apresenta simplesmente os valores que estão por pagar, como um resumo de conta.
- Discrimina TODAS as rubricas listadas acima, uma por linha, com o valor de cada uma.
- Apresenta o total no fim.
- Pede o pagamento "quando lhe for possível" ou "assim que puder". Tom compreensivo e sem pressão.
- Termina com disponibilidade para combinar a melhor forma de pagamento.`,

      informativo: `ABORDAGEM: INFORMATIVA (neutra).
- É apenas um ponto de situação da conta. NÃO peças pagamento nem uses linguagem de cobrança.
- Lista TODAS as rubricas em aberto, uma por linha, com o valor de cada uma, e o total.
- Termina dizendo que é apenas para conhecimento e que ficas disponível para esclarecer qualquer questão.`,
    }

    const instrucaoTom = abordagens[data.tone ?? 'divida_atraso'] ?? abordagens.divida_atraso

    const prompt = `És assistente de um senhorio em Évora, Portugal, que gere alojamentos para arrendamento.
Escreve um e-mail em PORTUGUÊS EUROPEU (de Portugal, nunca do Brasil) para enviar a um inquilino.

Tipo de e-mail: ${contextLabel}

${instrucaoTom}

Factos reais a usar (não inventes nada além disto):
${factos}

Regras de redação:
- Tom profissional, cordial e direto. Trata o inquilino por "Caro/a" seguido do nome.
- Nunca inventes valores, datas, moradas ou factos que não estejam na lista acima.
- Se um dado não foi fornecido, não o menciones nem uses marcadores como [valor] ou XXX.
- Não incluas assinatura no final — a assinatura é acrescentada automaticamente pela aplicação.
- Não incluas saudação de fecho do tipo "Com os melhores cumprimentos" — também é acrescentada.
- Quando houver rubricas a discriminar, escreve cada uma na sua linha, no formato
  "• Descrição — valor €", e o total numa linha própria a seguir.
- Sem rubricas, mantém entre 4 e 10 linhas. Parágrafos curtos separados por linha em branco.
- Ortografia e gramática impecáveis em português europeu.
- Se for um aviso de pagamento, sê firme mas educado, sem ameaças.

Responde APENAS com um objeto JSON válido, sem markdown e sem \`\`\`:
{
  "subject": "assunto curto e claro, SEM prefixos entre parênteses retos, máximo 60 caracteres",
  "body": "corpo do e-mail com quebras de linha reais"
}`

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

    let parsed: any
    try {
      parsed = JSON.parse(clean)
    } catch {
      return NextResponse.json({ error: 'Não foi possível gerar o e-mail. Tenta novamente.' }, { status: 422 })
    }

    if (!parsed.subject || !parsed.body) {
      return NextResponse.json({ error: 'Resposta incompleta da IA' }, { status: 422 })
    }

    return NextResponse.json({ success: true, subject: parsed.subject, body: parsed.body })
  } catch (e: any) {
    console.error('[compose-email]', e)
    return NextResponse.json({ error: e.message ?? 'Erro ao gerar o e-mail' }, { status: 500 })
  }
}
