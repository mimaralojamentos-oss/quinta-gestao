'use client'

import { DESTINOS, type DestinoPagamento } from '@/lib/rentPaymentPlan'

/**
 * Seletor de "Aplicar a" — para onde vai o dinheiro recebido.
 *
 * Vive num componente próprio para os três sítios onde se recebe dinheiro
 * ficarem iguais: identificação de movimentos bancários, recebimento na ficha
 * do inquilino e registo de pagamentos. Se um dia mudarem as opções, mudam
 * nos três de uma vez.
 */
export default function DestinoPagamentoPicker({
  valor,
  onChange,
  etiqueta = 'Aplicar a',
  compacto = false,
}: {
  valor: DestinoPagamento
  onChange: (d: DestinoPagamento) => void
  etiqueta?: string
  /** Versão sem descrições, para caber em janelas apertadas. */
  compacto?: boolean
}) {
  return (
    <div>
      <label className="label">{etiqueta}</label>
      <div className="grid grid-cols-2 gap-2">
        {DESTINOS.map(d => {
          const ativo = valor === d.valor
          return (
            <button key={d.valor} type="button" onClick={() => onChange(d.valor)}
              className={`text-left px-3 py-2 rounded-lg border transition-colors ${
                ativo
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              }`}>
              <span className={`block font-medium ${compacto ? 'text-xs' : 'text-sm'}`}>{d.label}</span>
              {!compacto && (
                <span className={`block text-xs ${ativo ? 'text-emerald-100' : 'text-gray-400'}`}>
                  {d.descricao}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
