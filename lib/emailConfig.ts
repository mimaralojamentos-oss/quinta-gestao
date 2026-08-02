// Configuração central de e-mail.
//
// A mesma base de código serve duas propriedades. O prefixo do assunto muda
// conforme a propriedade, para o inquilino perceber logo de que imóvel se trata:
//   Quinta da Bela Vista → "[QdBV Severino] - "
//   Serpa Pinto 131A     → "[Serpa Pinto 131-A] - "
//
// Definido em NEXT_PUBLIC_EMAIL_SUBJECT_PREFIX. Se não estiver definido,
// cai para o prefixo da Quinta (comportamento histórico).

export const DEFAULT_SUBJECT_PREFIX = '[QdBV Severino] - '

export function getSubjectPrefix(): string {
  return process.env.NEXT_PUBLIC_EMAIL_SUBJECT_PREFIX ?? DEFAULT_SUBJECT_PREFIX
}

/**
 * Aplica o prefixo obrigatório ao assunto, sem o duplicar se já lá estiver.
 * Todos os e-mails saídos da aplicação passam por aqui.
 */
export function applySubjectPrefix(subject: string, prefix = getSubjectPrefix()): string {
  const clean = (subject ?? '').trim()
  if (!clean) return prefix.trim()
  if (clean.startsWith(prefix.trim())) return clean
  return `${prefix}${clean}`
}

/** Contextos onde a aplicação pode gerar e-mails. */
export type EmailContext =
  | 'renda_atraso'
  | 'eletricidade_pendente'
  | 'divida'
  | 'contrato_renovacao'
  | 'recibo'
  | 'geral'

export const EMAIL_CONTEXT_LABELS: Record<EmailContext, string> = {
  renda_atraso: '🏠 Renda em atraso',
  eletricidade_pendente: '⚡ Eletricidade por pagar',
  divida: '💰 Dívida em aberto',
  contrato_renovacao: '📄 Renovação de contrato',
  recibo: '🧾 Envio de recibo',
  geral: '📋 Assunto geral',
}

/**
 * Abordagem do e-mail de cobrança. A mesma informação, três registos
 * diferentes — escolhidos pelo utilizador antes de o texto ser escrito.
 */
export type EmailTone = 'divida_atraso' | 'valores_pagar' | 'informativo'

export const EMAIL_TONES: { value: EmailTone; label: string; descricao: string; emoji: string }[] = [
  {
    value: 'divida_atraso',
    label: 'Dívida em atraso',
    emoji: '⚠️',
    descricao: 'Firme e direto. Trata os valores como dívida em atraso e pede regularização, com o detalhe mês a mês.',
  },
  {
    value: 'valores_pagar',
    label: 'Valores a pagar',
    emoji: '🤝',
    descricao: 'Cordial. Nunca fala em dívida nem em atraso — apresenta os valores a pagar e pede o pagamento quando for possível.',
  },
  {
    value: 'informativo',
    label: 'Informativo',
    emoji: 'ℹ️',
    descricao: 'Neutro. Informa das rubricas em aberto, sem pedir pagamento nem pressionar.',
  },
]

/** Uma linha do detalhe (renda de um mês, uma fatura de luz, etc.). */
export interface EmailItem {
  grupo: string
  descricao: string
  valor: number
}

/** Dados que a IA recebe para redigir o e-mail. */
export interface EmailContextData {
  context: EmailContext
  tenantName: string
  spaceRef?: string | null
  /** Valor em dívida, renda mensal, ou o valor relevante para o contexto. */
  amount?: number | null
  /** Meses/períodos em causa, ex: ['Junho 2026', 'Julho 2026'] */
  periods?: string[]
  /** Data relevante (ex: data de renovação do contrato). */
  date?: string | null
  /** Detalhe parcela a parcela, para o e-mail poder discriminar os valores. */
  items?: EmailItem[]
  /** Abordagem escolhida pelo utilizador. */
  tone?: EmailTone
  /** Instruções livres do utilizador para a IA. */
  extraNotes?: string | null
}
