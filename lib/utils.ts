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
/**
 * Data em DD/MM/AAAA, sempre.
 *
 * Não usa toLocaleDateString nem constrói um Date a partir de "2026-08-01":
 *  - toLocaleDateString depende dos dados de idioma do dispositivo; num
 *    telemóvel configurado em inglês saía 8/1/2026.
 *  - new Date('2026-08-01') é interpretado como meia-noite UTC, por isso em
 *    fusos atrás de Greenwich a data recuava um dia (mostrava 31/07/2026).
 *
 * Aceita 'YYYY-MM-DD', ISO com hora, ou um Date.
 */
export function formatDate(dateString: string | Date | null | undefined): string {
  if (!dateString) return '—'

  if (dateString instanceof Date) {
    if (isNaN(dateString.getTime())) return '—'
    const d = String(dateString.getDate()).padStart(2, '0')
    const m = String(dateString.getMonth() + 1).padStart(2, '0')
    return `${d}/${m}/${dateString.getFullYear()}`
  }

  const texto = String(dateString).trim()

  // Caso normal: o que vem da base de dados começa por AAAA-MM-DD
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const [, ano, mes, dia] = iso
    return `${dia}/${mes}/${ano}`
  }

  // Já está em DD/MM/AAAA
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(texto)) return texto

  const d = new Date(texto)
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

/** Data e hora em DD/MM/AAAA HH:MM. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return '—'
  const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${formatDate(d)} ${hora}`
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
