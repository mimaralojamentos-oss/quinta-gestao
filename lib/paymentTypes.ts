// Lista única dos tipos de pagamento de renda (Renda, Caução, Extra, Luz,
// Adiantamento). Antes estava copiada em app/pagamentos/PaymentModal.tsx
// (duas vezes dentro do mesmo ficheiro: tipoConfig para os botões de escolha,
// tipoLabels para o texto/registos) e em app/pagamentos/page.tsx.

export interface PaymentTypeInfo {
  value: string
  /** Rótulo curto — usado em etiquetas, registos de auditoria e descrições. */
  label: string
  /** Rótulo do botão de escolha do tipo, no formulário de pagamento (pode ser mais longo). */
  buttonLabel: string
  /** Classes Tailwind do botão quando este tipo está selecionado. */
  color: string
}

export const PAYMENT_TYPES: PaymentTypeInfo[] = [
  { value: 'renda', label: '🏠 Renda', buttonLabel: '🏠 Renda', color: 'bg-emerald-600 text-white border-emerald-600' },
  { value: 'caucao', label: '🔒 Caução', buttonLabel: '🔒 Caução / Sinal', color: 'bg-blue-600 text-white border-blue-600' },
  { value: 'extra', label: '➕ Extra', buttonLabel: '➕ Extra', color: 'bg-orange-500 text-white border-orange-500' },
  { value: 'luz', label: '⚡ Luz', buttonLabel: '⚡ Luz', color: 'bg-yellow-500 text-white border-yellow-500' },
  { value: 'adiantamento', label: '💰 Adiantamento', buttonLabel: '💰 Adiantamento', color: 'bg-purple-600 text-white border-purple-600' },
]

export const PAYMENT_TYPE_LABELS: Record<string, string> = Object.fromEntries(PAYMENT_TYPES.map(t => [t.value, t.label]))
