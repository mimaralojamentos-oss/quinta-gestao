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
  /** Instruções livres do utilizador para a IA. */
  extraNotes?: string | null
}
