'use client'

import { formatCurrency } from '@/lib/utils'
import {
  planearDivisao, validarPartilha, formatPct,
  type ContratoAtivo, type LinhaPartilha, type ParteDivisao,
} from '@/lib/meterShares'

/** Pré-visualização da divisão antes de cobrar (modais de leitura). */
export function SharePreview({ total, units, ownerId, linhas, refs, contratos }: {
  total: number
  units: number | null
  ownerId: string
  linhas: LinhaPartilha[]
  refs: Record<string, string>
  contratos: Record<string, ContratoAtivo | undefined>
}) {
  const erro = validarPartilha(ownerId, linhas)
  if (erro) {
    return (
      <p className="text-xs text-red-600 font-medium mt-2">
        ⚠ Partilha do contador mal configurada: {erro} Não é cobrado nada até ser corrigida.
      </p>
    )
  }

  const partes = planearDivisao({ total, units, ownerId, linhas, refs, contratos })
  const comValor = partes.filter(p => p.amount > 0)
  const nenhumContrato = comValor.length > 0 && comValor.every(p => !p.lease_id)

  return (
    <div className="mt-2 pt-2 border-t border-blue-100 space-y-0.5 text-xs">
      <p className="font-medium text-blue-800">Divisão do contador partilhado:</p>
      {partes.map(p => (
        <p key={p.space_id} className={p.lease_id ? 'text-blue-700' : 'text-amber-700'}>
          {p.ref} · {formatPct(p.percentage)}% → <strong>{formatCurrency(p.amount)}</strong>
          {p.lease_id ? ` · ${p.tenant_name ?? 'contrato ativo'}` : ' · sem contrato ativo — fica por cobrar'}
        </p>
      ))}
      {nenhumContrato && (
        <p className="text-amber-700 font-medium">Nenhum espaço tem contrato ativo — ao cobrar, a leitura fica acumulada.</p>
      )}
    </div>
  )
}

/** Detalhe da divisão de uma leitura já cobrada (linha do histórico). */
export function ShareSplitDetails({ split, podeCobrar, aCobrar, onCobrarParte }: {
  split: ParteDivisao[]
  podeCobrar: boolean
  aCobrar: boolean
  onCobrarParte: (parte: ParteDivisao) => void
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
      <span className="text-gray-400">Divisão:</span>
      {split.map(p => {
        const pendente = !p.charge_id && p.amount > 0
        return (
          <span key={p.space_id} className={pendente ? 'text-amber-700 font-medium' : 'text-gray-600'}>
            {p.ref} {formatPct(p.percentage)}% · {formatCurrency(p.amount)} ·{' '}
            {p.charge_id
              ? `cobrado${p.tenant_name ? ` a ${p.tenant_name}` : ''}`
              : p.amount <= 0
                ? 'sem valor'
                : p.lease_id ? 'por cobrar (a cobrança falhou)' : 'por cobrar — sem contrato ativo'}
            {pendente && podeCobrar && (
              <button type="button" onClick={() => onCobrarParte(p)} disabled={aCobrar}
                className="ml-1.5 text-blue-600 hover:underline disabled:opacity-50">
                cobrar parte
              </button>
            )}
          </span>
        )
      })}
    </div>
  )
}
