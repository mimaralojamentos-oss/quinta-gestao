'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, categoryLabel, getMonthLabel } from '@/lib/utils'
import { logAccess } from '@/lib/logAccess'
import { createExpense } from '@/lib/createExpense'
import { X, Copy, AlertTriangle, Loader2 } from 'lucide-react'

const supabase = createClient()

/**
 * Copiar despesas de um mês para outro.
 *
 * Muitas despesas repetem-se todos os meses (seguros, água, internet, avenças).
 * Este ecrã mostra as do mês de origem, deixa escolher quais copiar e ajustar
 * o valor de cada uma, e só cria os registos quando o utilizador confirma.
 *
 * Nada acontece sozinho: sem carregar no botão, não se escreve nada.
 */

interface Props {
  /** Mês que está selecionado no filtro da página ('AAAA-MM'). */
  defaultTarget: string
  onClose: () => void
  onCopied: () => void
}

interface Linha {
  origem: any
  selecionada: boolean
  /** Valor editável — começa igual ao da despesa original. */
  valor: string
  /** Já existe uma despesa igual no mês de destino. */
  duplicada: boolean
}

/** Primeiro e último dia de um mês 'AAAA-MM'. */
function limitesDoMes(mes: string): { de: string; ate: string } {
  const [ano, m] = mes.split('-').map(Number)
  const ultimoDia = new Date(ano, m, 0).getDate()
  return { de: `${mes}-01`, ate: `${mes}-${String(ultimoDia).padStart(2, '0')}` }
}

/**
 * Mesma data, noutro mês. Se o dia não existir no mês de destino
 * (ex.: dia 31 em Fevereiro), usa o último dia desse mês.
 */
export function dataNoMes(dataOriginal: string, mesDestino: string): string {
  const dia = parseInt(String(dataOriginal).slice(8, 10), 10) || 1
  const [ano, m] = mesDestino.split('-').map(Number)
  const ultimoDia = new Date(ano, m, 0).getDate()
  return `${mesDestino}-${String(Math.min(dia, ultimoDia)).padStart(2, '0')}`
}

/** Chave para detetar repetições: descrição + fornecedor, ignorando maiúsculas. */
function chaveDespesa(e: any): string {
  return `${String(e.description ?? '').trim().toLowerCase()}__${String(e.supplier ?? '').trim().toLowerCase()}`
}

/** Mês anterior a 'AAAA-MM'. */
function mesAnterior(mes: string): string {
  const [ano, m] = mes.split('-').map(Number)
  const d = new Date(ano, m - 1, 1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Últimos 24 meses, para os dois seletores. */
function opcoesDeMes(): { val: string; label: string }[] {
  const opts: { val: string; label: string }[] = []
  const d = new Date()
  for (let i = 0; i < 24; i++) {
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    opts.push({ val, label: getMonthLabel(val) })
    d.setMonth(d.getMonth() - 1)
  }
  return opts
}

export default function CopiarDespesasModal({ defaultTarget, onClose, onCopied }: Props) {

  const destinoInicial = defaultTarget && defaultTarget !== 'all'
    ? defaultTarget
    : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`

  const [origem, setOrigem] = useState(mesAnterior(destinoInicial))
  const [destino, setDestino] = useState(destinoInicial)
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [carregando, setCarregando] = useState(true)
  const [copiando, setCopiando] = useState(false)
  const [erro, setErro] = useState('')

  const meses = opcoesDeMes()
  const mesmoMes = origem === destino

  async function carregar() {
    setCarregando(true); setErro('')

    const o = limitesDoMes(origem)
    const d = limitesDoMes(destino)

    const [origemRes, destinoRes] = await Promise.all([
      supabase.from('expenses').select('*')
        .gte('expense_date', o.de).lte('expense_date', o.ate)
        .order('expense_date', { ascending: true }),
      supabase.from('expenses').select('description, supplier')
        .gte('expense_date', d.de).lte('expense_date', d.ate),
    ])

    if (origemRes.error || destinoRes.error) {
      setErro(origemRes.error?.message ?? destinoRes.error?.message ?? 'Erro ao carregar')
      setCarregando(false)
      return
    }

    const jaExistem = new Set((destinoRes.data ?? []).map(chaveDespesa))

    setLinhas((origemRes.data ?? []).map(e => {
      const duplicada = jaExistem.has(chaveDespesa(e))
      return {
        origem: e,
        // As repetidas vêm desmarcadas, para não duplicar sem dar por isso.
        selecionada: !duplicada,
        valor: String(e.amount ?? ''),
        duplicada,
      }
    }))
    setCarregando(false)
  }

  function alternar(id: string) {
    setLinhas(prev => prev.map(l => l.origem.id === id ? { ...l, selecionada: !l.selecionada } : l))
  }

  function alterarValor(id: string, valor: string) {
    setLinhas(prev => prev.map(l => l.origem.id === id ? { ...l, valor } : l))
  }

  const selecionadas = linhas.filter(l => l.selecionada)
  const todasMarcadas = linhas.length > 0 && selecionadas.length === linhas.length

  function marcarTodas() {
    const novo = !todasMarcadas
    setLinhas(prev => prev.map(l => ({ ...l, selecionada: novo })))
  }

  const totalSelecionado = selecionadas.reduce((s, l) => s + (parseFloat(l.valor) || 0), 0)

  async function copiar() {
    if (mesmoMes || selecionadas.length === 0) return
    setCopiando(true); setErro('')

    let criadas = 0

    for (const linha of selecionadas) {
      const e = linha.origem
      const valor = parseFloat(linha.valor)
      if (!valor || valor <= 0) continue

      const dataNova = dataNoMes(e.expense_date, destino)

      // De propósito: faturas e documentos NÃO são copiados.
      const { error } = await createExpense(supabase, {
        expense_date: dataNova,
        category: e.category,
        type: e.type,
        description: e.description,
        amount: parseFloat(valor.toFixed(2)),
        payment_method: e.payment_method as 'dinheiro' | 'banco',
        supplier: e.supplier ?? null,
        notes: e.notes ?? null,
        project_id: e.project_id ?? null,
      })

      if (error) { setErro(`Erro ao copiar "${e.description}": ${error}`); setCopiando(false); return }

      criadas += 1
    }

    await logAccess({
      action: 'criar',
      page: '/despesas',
      details: `Copiou ${criadas} despesa(s) de ${getMonthLabel(origem)} para ${getMonthLabel(destino)} — total ${formatCurrency(totalSelecionado)}`,
    })

    setCopiando(false)
    onCopied()
  }

  useEffect(() => { carregar() }, [origem, destino])

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">

        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="font-semibold text-lg text-gray-900">Copiar despesas de outro mês</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Escolhe o mês de origem, confirma quais queres copiar e ajusta os valores se for preciso.
            </p>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="p-5 border-b border-gray-100">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Copiar de</label>
              <select className="input" value={origem} onChange={e => setOrigem(e.target.value)}>
                {meses.map(m => <option key={m.val} value={m.val}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Para</label>
              <select className="input" value={destino} onChange={e => setDestino(e.target.value)}>
                {meses.map(m => <option key={m.val} value={m.val}>{m.label}</option>)}
              </select>
            </div>
          </div>

          {mesmoMes && (
            <div className="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">
                A origem e o destino são o mesmo mês. Escolhe meses diferentes para poder copiar.
              </p>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {erro && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 m-5 mb-0">{erro}</p>
          )}

          {carregando ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 text-emerald-600 animate-spin" />
            </div>
          ) : linhas.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-12">
              Não há despesas em {getMonthLabel(origem)}.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between px-5 py-2.5">
                <button onClick={marcarTodas} className="text-xs text-emerald-600 hover:underline font-medium">
                  {todasMarcadas ? 'Desmarcar todas' : 'Marcar todas'}
                </button>
                <p className="text-xs text-gray-400">{linhas.length} despesa(s) em {getMonthLabel(origem)}</p>
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase">
                    <th className="table-header w-10"></th>
                    <th className="table-header">Descrição</th>
                    <th className="table-header">Categoria</th>
                    <th className="table-header">Fornecedor</th>
                    <th className="table-header">Pagamento</th>
                    <th className="table-header text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {linhas.map(l => (
                    <tr key={l.origem.id} className={l.duplicada ? 'bg-amber-50/50' : 'hover:bg-gray-50 transition-colors'}>
                      <td className="table-cell">
                        <input type="checkbox" className="w-4 h-4 accent-emerald-600 cursor-pointer"
                          checked={l.selecionada} onChange={() => alternar(l.origem.id)} />
                      </td>
                      <td className="table-cell">
                        <p className="font-medium text-gray-800">{l.origem.description}</p>
                        {l.duplicada && (
                          <p className="text-xs text-amber-700 font-medium mt-0.5">
                            ⚠️ Já existe em {getMonthLabel(destino)}
                          </p>
                        )}
                      </td>
                      <td className="table-cell text-xs text-gray-600">{categoryLabel(l.origem.category)}</td>
                      <td className="table-cell text-xs text-gray-600">{l.origem.supplier ?? '—'}</td>
                      <td className="table-cell">
                        <span className={`text-xs px-2 py-1 rounded-full ${l.origem.payment_method === 'dinheiro' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                          {l.origem.payment_method === 'dinheiro' ? '💵 Dinheiro' : '🏦 Banco'}
                        </span>
                      </td>
                      <td className="table-cell text-right">
                        <input type="number" step="0.01"
                          className="input text-sm text-right w-28 py-1.5"
                          value={l.valor}
                          onChange={e => alterarValor(l.origem.id, e.target.value)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        <div className="border-t border-gray-100 p-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="text-sm">
            <span className="text-gray-500">{selecionadas.length} de {linhas.length} selecionadas</span>
            {selecionadas.length > 0 && (
              <span className="ml-3 font-semibold text-gray-900">{formatCurrency(totalSelecionado)}</span>
            )}
          </div>
          <div className="flex gap-3">
            <button className="btn-secondary" onClick={onClose} disabled={copiando}>Cancelar</button>
            <button className="btn-primary" onClick={copiar}
              disabled={copiando || mesmoMes || selecionadas.length === 0}>
              {copiando
                ? <><Loader2 className="w-4 h-4 animate-spin" /> A copiar...</>
                : <><Copy className="w-4 h-4" /> Copiar {selecionadas.length} despesa(s)</>}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
