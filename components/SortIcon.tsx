'use client'

import { ArrowUpDown, ArrowUp, ArrowDown, ChevronsUpDown, ChevronUp, ChevronDown } from 'lucide-react'

interface SortIconProps<T extends string | null> {
  field: T
  sortField: T
  sortDir: 'asc' | 'desc'
  /** 'arrow' (por omissão) ou 'chevron' — só muda o conjunto de ícones. */
  variant?: 'arrow' | 'chevron'
}

/** Ícone de ordenação para cabeçalhos de tabela clicáveis. */
export default function SortIcon<T extends string | null>({ field, sortField, sortDir, variant = 'arrow' }: SortIconProps<T>) {
  const active = sortField === field

  if (variant === 'chevron') {
    if (!active) return <ChevronsUpDown className="w-3 h-3 ml-1 text-gray-400 inline" />
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 ml-1 text-emerald-600 inline" />
      : <ChevronDown className="w-3 h-3 ml-1 text-emerald-600 inline" />
  }

  if (!active) return <ArrowUpDown className="w-3 h-3 text-gray-300 ml-1 inline" />
  return sortDir === 'asc'
    ? <ArrowUp className="w-3 h-3 text-emerald-600 ml-1 inline" />
    : <ArrowDown className="w-3 h-3 text-emerald-600 ml-1 inline" />
}
