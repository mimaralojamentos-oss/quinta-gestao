'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { logAccess } from '@/lib/logAccess'
import {
  SERVICOS, formatPct, guardarPartilha, removerPartilha, validarPartilha,
  type MeterShare, type ServicoPartilha,
} from '@/lib/meterShares'
import { X, Plus, Trash2, Share2 } from 'lucide-react'

const supabase = createClient()

/**
 * Configuração da partilha do contador de um espaço titular, por serviço.
 * "Este contador de luz/água é partilhado com: <espaço(s)> e percentagem."
 * Só admin/coadmin (a RLS de meter_shares também o garante).
 */
export default function MeterShareModal({ service, owner, spaces, shares, onClose, onSaved }: {
  service: ServicoPartilha
  owner: { id: string; ref: string }
  /** Espaços que podem entrar na partilha (os desta página). */
  spaces: { id: string; ref: string; tenantName: string }[]
  /** Todas as partilhas deste serviço. */
  shares: MeterShare[]
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const cfg = SERVICOS[service]
  const existentes = shares
    .filter(s => s.owner_space_id === owner.id)
    .sort((a, b) => (a.space_id === owner.id ? -1 : b.space_id === owner.id ? 1 : 0))

  const [linhas, setLinhas] = useState<{ space_id: string; percentage: string }[]>(() =>
    existentes.length > 0
      ? existentes.map(s => ({ space_id: s.space_id, percentage: String(Number(s.percentage)) }))
      : [{ space_id: owner.id, percentage: '50' }, { space_id: '', percentage: '50' }])
  const [guardando, setGuardando] = useState(false)
  const [erro, setErro] = useState('')

  // Um espaço só pode estar num grupo por serviço.
  const ocupados = new Set(shares.filter(s => s.owner_space_id !== owner.id).map(s => s.space_id))
  const numericas = linhas.map(l => ({ space_id: l.space_id, percentage: parseFloat(l.percentage.replace(',', '.')) }))
  const soma = numericas.reduce((s, l) => s + (isNaN(l.percentage) ? 0 : l.percentage), 0)
  const erroValidacao = validarPartilha(owner.id, numericas)
  const refDe = (id: string) => spaces.find(s => s.id === id)?.ref ?? '?'

  function atualizar(i: number, campo: 'space_id' | 'percentage', valor: string) {
    setLinhas(ls => ls.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)))
    setErro('')
  }

  function partesIguais() {
    const n = linhas.length
    const cada = Math.floor(10000 / n)
    const titular = 10000 - cada * (n - 1)
    setLinhas(ls => ls.map(l => ({ ...l, percentage: String((l.space_id === owner.id ? titular : cada) / 100) })))
  }

  async function guardar() {
    if (erroValidacao) { setErro(erroValidacao); return }
    setGuardando(true); setErro('')
    const e = await guardarPartilha(supabase, service, owner.id, numericas)
    setGuardando(false)
    if (e) { setErro(`Não foi possível guardar: ${e}`); return }
    await logAccess({
      action: 'editar',
      page: service === 'luz' ? '/eletricidade/espacos' : '/agua/espacos',
      details: `Configurou a partilha do contador de ${cfg.nome} do ${owner.ref}: ` +
        numericas.map(l => `${refDe(l.space_id)} ${formatPct(l.percentage)}%`).join(' · '),
    })
    await onSaved()
  }

  async function remover() {
    if (!confirm(
      `Remover a partilha do contador de ${cfg.nome} do ${owner.ref}?\n\n` +
      `As próximas leituras voltam a ser cobradas só ao ${owner.ref}. As cobranças já feitas não mudam.`
    )) return
    setGuardando(true)
    const e = await removerPartilha(supabase, service, owner.id)
    setGuardando(false)
    if (e) { setErro(`Não foi possível remover: ${e}`); return }
    await logAccess({
      action: 'editar',
      page: service === 'luz' ? '/eletricidade/espacos' : '/agua/espacos',
      details: `Removeu a partilha do contador de ${cfg.nome} do ${owner.ref}`,
    })
    await onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg text-gray-900 flex items-center gap-2">
            <Share2 className="w-5 h-5 text-indigo-600" /> Partilha do contador de {cfg.nome} — {owner.ref}
          </h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <p className="text-sm text-gray-500 mb-4">
          O contador, as leituras e o fecho de contas ficam no <strong>{owner.ref}</strong>. Ao cobrar uma leitura,
          nasce uma cobrança separada no contrato ativo de cada espaço, com a sua percentagem. A diferença de
          cêntimos fica no {owner.ref}. Mudar a partilha não altera leituras já cobradas.
        </p>

        <div className="space-y-2 mb-3">
          {linhas.map((l, i) => {
            const titular = l.space_id === owner.id
            const escolhidosNoutras = new Set(linhas.filter((_, j) => j !== i).map(x => x.space_id))
            const opcoes = spaces
              .filter(s => s.id !== owner.id && !ocupados.has(s.id) && (!escolhidosNoutras.has(s.id) || s.id === l.space_id))
              .sort((a, b) => a.ref.localeCompare(b.ref, 'pt', { numeric: true }))
            return (
              <div key={i} className="flex items-center gap-2">
                {titular ? (
                  <div className="input flex-1 bg-gray-50 text-sm">
                    <strong>{owner.ref}</strong> <span className="text-gray-400">(titular do contador)</span>
                  </div>
                ) : (
                  <select className="input flex-1 text-sm" value={l.space_id} onChange={e => atualizar(i, 'space_id', e.target.value)}>
                    <option value="">Escolher espaço...</option>
                    {opcoes.map(s => (
                      <option key={s.id} value={s.id}>{s.ref}{s.tenantName ? ` — ${s.tenantName}` : ' — sem inquilino'}</option>
                    ))}
                  </select>
                )}
                <div className="flex items-center gap-1">
                  <input className="input text-sm text-right" style={{ width: '5.5rem' }} inputMode="decimal"
                    value={l.percentage} onChange={e => atualizar(i, 'percentage', e.target.value)} />
                  <span className="text-sm text-gray-500">%</span>
                </div>
                {!titular && (
                  <button type="button" onClick={() => setLinhas(ls => ls.filter((_, j) => j !== i))}
                    className="text-gray-300 hover:text-red-500" title="Tirar da partilha">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                {titular && <span className="w-4" />}
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap text-xs">
          <div className="flex gap-3">
            <button type="button" className="text-blue-600 hover:underline inline-flex items-center gap-1"
              onClick={() => setLinhas(ls => [...ls, { space_id: '', percentage: '0' }])}>
              <Plus className="w-3.5 h-3.5" /> Adicionar espaço
            </button>
            <button type="button" className="text-blue-600 hover:underline" onClick={partesIguais}>
              Dividir em partes iguais
            </button>
          </div>
          <span className={`font-medium ${Math.round(soma * 100) === 10000 ? 'text-emerald-600' : 'text-amber-600'}`}>
            Soma: {formatPct(soma)}%
          </span>
        </div>

        {(erro || erroValidacao) && (
          <p className={`text-sm px-3 py-2 rounded-lg mb-3 ${erro ? 'text-red-600 bg-red-50' : 'text-amber-800 bg-amber-50'}`}>
            {erro || erroValidacao}
          </p>
        )}

        <div className="flex justify-between gap-3">
          {existentes.length > 0 ? (
            <button className="text-sm text-red-500 hover:text-red-700" onClick={remover} disabled={guardando}>
              Remover partilha
            </button>
          ) : <span />}
          <div className="flex gap-3">
            <button className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button className="btn-primary" onClick={guardar} disabled={guardando || !!erroValidacao}>
              {guardando ? 'A guardar...' : 'Guardar partilha'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
