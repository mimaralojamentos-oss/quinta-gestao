'use client'

import { formatCurrency } from '@/lib/utils'
import type { ManualPlanItem } from '@/lib/rentPaymentPlan'

const ICONS: Record<ManualPlanItem['type'], string> = {
  renda: '🏠', caucao: '🔒', eletricidade: '⚡', agua: '💧', divida: '📋',
}

/**
 * Editor da distribuição manual (destino "Manual" em DestinoPagamentoPicker).
 * Vive num componente próprio pelo mesmo motivo do próprio picker — os três
 * sítios onde se recebe dinheiro (banco, ficha do inquilino, /pagamentos)
 * ficam iguais.
 *
 * Só mostra e valida — quem decide o que gravar é sempre
 * lib/rentPaymentPlan.ts (buildPlanFromManualItems + applyRentPaymentPlan).
 */
export default function ManualAllocationEditor({
  items,
  values,
  onChange,
  amount,
  loading = false,
}: {
  items: ManualPlanItem[]
  values: Record<string, number>
  onChange: (key: string, value: number) => void
  amount: number
  loading?: boolean
}) {
  if (loading) {
    return <p className="text-xs text-gray-400">A carregar rubricas em aberto...</p>
  }
  if (items.length === 0) {
    return <p className="text-xs text-gray-400">Sem rubricas em aberto para este inquilino.</p>
  }

  const distribuido = parseFloat(items.reduce((s, it) => s + (values[it.key] ?? 0), 0).toFixed(2))
  const excedente = parseFloat(Math.max(0, amount - distribuido).toFixed(2))
  const excesso = distribuido > amount + 0.01

  return (
    <div className="border border-indigo-200 rounded-lg overflow-hidden">
      <div className="bg-indigo-100 px-3 py-2 text-xs font-semibold text-indigo-800">
        ✏️ Distribuição manual — indica quanto vai para cada rubrica
      </div>
      <div className="divide-y divide-indigo-50">
        {items.map(it => {
          const v = values[it.key] ?? 0
          const excedeMax = v > it.max + 0.01
          return (
            <div key={it.key} className="flex items-center gap-2 px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-700 truncate" title={it.label}>{ICONS[it.type]} {it.label}</p>
                <p className="text-[11px] text-gray-400 truncate">
                  em falta {formatCurrency(it.max)}
                  {it.type === 'renda' && (it.creditApplied ?? 0) > 0 && (
                    <span className="text-purple-500"> · crédito {formatCurrency(it.creditApplied!)} já aplicado</span>
                  )}
                </p>
              </div>
              {/* Não usa a classe partilhada "input" — esta é `width:100%` em
                  CSS não encapsulado em @layer, que no Tailwind v4 ganha
                  sempre a classes utilitárias como w-24, por mais tarde que
                  estas apareçam. A largura fixa tem de vir por estilo em
                  linha para garantir que não é sobreposta pela cascata. */}
              <input
                type="number" step="0.01" min="0" max={it.max}
                value={v === 0 ? '' : v}
                onChange={e => onChange(it.key, parseFloat(e.target.value) || 0)}
                placeholder="0,00"
                style={{ width: '6rem' }}
                className={`flex-shrink-0 border rounded-lg px-2 py-1.5 text-xs text-right outline-none ${excedeMax ? 'border-red-400 text-red-700' : 'border-gray-200'}`}
              />
            </div>
          )
        })}
        <div className={`flex justify-between items-center px-3 py-2 ${excesso ? 'bg-red-50' : 'bg-purple-50'}`}>
          <span className={`text-xs ${excesso ? 'text-red-700 font-semibold' : 'text-purple-700'}`}>
            {excesso ? '⚠️ A soma excede o valor recebido' : '💰 Excedente (não distribuído) → adiantamento'}
          </span>
          <span className={`text-xs font-semibold ${excesso ? 'text-red-700' : 'text-purple-700'}`}>
            {excesso ? `+${formatCurrency(parseFloat((distribuido - amount).toFixed(2)))}` : formatCurrency(excedente)}
          </span>
        </div>
      </div>
    </div>
  )
}
