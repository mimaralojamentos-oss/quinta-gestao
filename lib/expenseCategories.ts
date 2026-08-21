// Lista única das categorias de despesa. Antes estava escrita à mão em 4
// ficheiros diferentes, e uma delas ("administracao") tinha 10 despesas
// reais na base de dados mas estava em falta em pelo menos um sítio — por
// isso deixava de aparecer no filtro e na cor da etiqueta da página
// principal de Despesas. Agora há só uma lista, e o tipo ExpenseCategory
// (lib/types.ts) é derivado dela, para nunca mais desalinhar.

export interface ExpenseCategoryInfo {
  value: string
  /** Rótulo completo, usado nos formulários de criar/editar despesa. */
  label: string
  /** Rótulo curto com emoji, usado no filtro da página de Despesas. */
  filterLabel: string
  /** Classes Tailwind da etiqueta colorida. */
  color: string
}

export const EXPENSE_CATEGORIES = [
  { value: 'administracao', label: 'Administração', filterLabel: '📋 Administração', color: 'bg-slate-100 text-slate-700' },
  { value: 'obras', label: 'Obras', filterLabel: '🏗️ Obras', color: 'bg-orange-100 text-orange-700' },
  { value: 'edp', label: 'Eletricidade (EDP)', filterLabel: '⚡ Eletricidade', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'pessoal', label: 'Pessoal', filterLabel: '👤 Pessoal', color: 'bg-blue-100 text-blue-700' },
  { value: 'contabilidade', label: 'Contabilidade', filterLabel: '📊 Contabilidade', color: 'bg-purple-100 text-purple-700' },
  { value: 'manutencao', label: 'Manutenção', filterLabel: '🔧 Manutenção', color: 'bg-cyan-100 text-cyan-700' },
  { value: 'outros', label: 'Outros', filterLabel: '📦 Outros', color: 'bg-gray-100 text-gray-700' },
] as const satisfies readonly ExpenseCategoryInfo[]

export type ExpenseCategoryValue = typeof EXPENSE_CATEGORIES[number]['value']
