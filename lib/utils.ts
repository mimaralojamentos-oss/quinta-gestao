import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-PT', {
    style: 'currency',
    currency: 'EUR',
  }).format(value)
}
export function formatDate(dateString: string): string {
  if (!dateString) return '—'
  return new Date(dateString).toLocaleDateString('pt-PT')
}
export function formatMonth(dateString: string): string {
  if (!dateString) return '—'
  return new Date(dateString).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' })
}
export function getCurrentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}
export function getMonthLabel(dateString: string): string {
  const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
  const d = new Date(dateString)
  return `${months[d.getMonth()]} ${d.getFullYear()}`
}
export function spaceTypeLabel(type: string): string {
  const map: Record<string, string> = {
    pavilhao: 'Pavilhão',
    habitacao: 'Habitação',
    casa: 'Casa',
    loja: 'Loja',
  }
  return map[type] ?? type
}
export function categoryLabel(cat: string): string {
  const map: Record<string, string> = {
    obras: 'Obras',
    edp: 'Eletricidade (EDP)',
    pessoal: 'Pessoal',
    contabilidade: 'Contabilidade',
    manutencao: 'Manutenção',
    outros: 'Outros',
  }
  return map[cat] ?? cat
}
