/**
 * Requisitos mínimos das palavras-passe da aplicação.
 *
 * Estas contas veem extratos bancários, rendas, dívidas e dados pessoais de
 * inquilinos. O mínimo anterior — 6 caracteres, sem mais nenhuma exigência —
 * era demasiado fraco para isso.
 */

export const REGRA_PASSWORD = 'Pelo menos 10 caracteres, com letras e números.'

export function passwordAceitavel(password: unknown): boolean {
  const p = String(password ?? '')
  return p.length >= 10 && /[a-zA-Z]/.test(p) && /[0-9]/.test(p)
}
