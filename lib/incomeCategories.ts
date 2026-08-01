// Origens de receita.
//
// Decisão de desenho: em vez de encher o seletor de "Tipo" da transação
// bancária com uma opção por cada origem (energia solar, juros, subsídios...),
// existe UM tipo "Receita" e a origem é um campo secundário.
//
// A lista abaixo são as origens conhecidas. Novas origens podem ser escritas
// à mão e passam a aparecer automaticamente nas sugestões seguintes, porque
// a lista mostrada é a junção destas com as que já existem na base de dados.
// Assim cresce sozinha, sem alterações ao código nem tabelas novas.

export interface IncomeCategory {
  value: string
  label: string
}

export const INCOME_CATEGORIES: IncomeCategory[] = [
  { value: 'energia_solar', label: '☀️ Energia Solar' },
  { value: 'juros_bancarios', label: '🏦 Juros Bancários' },
  { value: 'arrendamento_comercial', label: '🏢 Arrendamento Comercial' },
  { value: 'subsidio', label: '💶 Subsídio / Apoio' },
  { value: 'indemnizacao', label: '⚖️ Indemnização' },
  { value: 'venda_ativo', label: '📦 Venda de Ativo' },
  { value: 'reembolso', label: '↩️ Reembolso' },
  { value: 'outros', label: '💰 Outros' },
]

/** Transforma "juros_bancarios" em "Juros bancarios", para origens novas. */
export function prettifyCategory(value: string): string {
  const clean = String(value ?? '').trim()
  if (!clean) return 'Outros'
  return clean.charAt(0).toUpperCase() + clean.slice(1).replace(/_/g, ' ')
}

export function incomeCategoryLabel(value: string): string {
  return INCOME_CATEGORIES.find(c => c.value === value)?.label ?? prettifyCategory(value)
}

/** Normaliza texto livre para um valor guardável: "Juros Bancários" → "juros_bancarios". */
export function normalizeCategory(input: string): string {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Junta as origens conhecidas com as que já existem nos registos,
 * para que uma origem criada uma vez fique disponível daí em diante.
 */
export function mergeCategories(existing: (string | null | undefined)[]): IncomeCategory[] {
  const known = new Set(INCOME_CATEGORIES.map(c => c.value))
  const extras: IncomeCategory[] = []
  for (const v of existing) {
    const val = String(v ?? '').trim()
    if (!val || known.has(val)) continue
    known.add(val)
    extras.push({ value: val, label: prettifyCategory(val) })
  }
  return [...INCOME_CATEGORIES, ...extras.sort((a, b) => a.label.localeCompare(b.label))]
}
