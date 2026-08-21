'use client'

import { useState } from 'react'

/**
 * Estado e lógica de ordenação de uma tabela: clicar na mesma coluna
 * inverte a direção; clicar noutra muda de coluna e volta a ascendente.
 *
 * Era a mesma função, copiada à mão, em 5 páginas diferentes — cada uma
 * continua a ter o seu próprio tipo de campos (SortField) e valores
 * iniciais, só a lógica de alternar é que passa a ser uma só.
 */
export function useSort<F>(initialField: F, initialDir: 'asc' | 'desc' = 'asc') {
  const [sortField, setSortField] = useState<F>(initialField)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialDir)

  function handleSort(field: F) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  return { sortField, sortDir, handleSort }
}
