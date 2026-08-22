'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, categoryLabel, getMonthLabel } from '@/lib/utils'
import { logAccess } from '@/lib/logAccess'
import { createExpense } from '@/lib/createExpense'
import { findSimilarExpenses, type ExpenseCandidate } from '@/lib/expenseDuplicates'
import { X, Copy, AlertTriangle, Loader2, ArrowLeft } from 'lucide-react'

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
}

/** Uma linha selecionada que parece já existir no mês de destino (mesmo valor, data próxima). */
interface DuplicataRevisao {
  linhaId: string
  descricao: string
  similares: ExpenseCandidate[]
  /** Copiar mesmo assim — false por omissão, para não duplicar sem dar por isso. */
  manter: boolean
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
  const [verificando, setVerificando] = useState(false)
  const [erro, setErro] = useState('')
  /** Não-nulo enquanto a janela de revisão de duplicados está aberta. */
  const [revisaoDuplicados, setRevisaoDuplicados] = useState<DuplicataRevisao[] | null>(null)

  const meses = opcoesDeMes()
  const mesmoMes = origem === destino

  async function carregar() {
    setCarregando(true); setErro('')

    const o = limitesDoMes(origem)

    const origemRes = await supabase.from('expenses').select('*')
      .gte('expense_date', o.de).lte('expense_date', o.ate)
      .order('expense_date', { ascending: true })

    if (origemRes.error) {
      setErro(origemRes.error.message)
      setCarregando(false)
      return
    }

    setLinhas((origemRes.data ?? []).map(e => ({
      origem: e,
      selecionada: true,
      valor: String(e.amount ?? ''),
    })))
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

  /**
   * Verifica duplicados (mesmo valor, data próxima — a mesma verificação
   * usada no resto da app) entre as linhas selecionadas e o que já existe no
   * mês de destino. Se encontrar alguma coisa suspeita, mostra UMA janela de
   * revisão em vez de criar logo — sem fila de popups, uma decisão só.
   */
  async function iniciarCopia() {
    if (mesmoMes || selecionadas.length === 0) return
    setErro(''); setVerificando(true)

    const revisao: DuplicataRevisao[] = []
    for (const linha of selecionadas) {
      const valor = parseFloat(linha.valor)
      if (!valor || valor <= 0) continue
      const dataNova = dataNoMes(linha.origem.expense_date, destino)
      const similares = await findSimilarExpenses(supabase, parseFloat(valor.toFixed(2)), dataNova)
      if (similares.length > 0) {
        revisao.push({ linhaId: linha.origem.id, descricao: linha.origem.description, similares, manter: false })
      }
    }

    setVerificando(false)

    if (revisao.length > 0) {
      setRevisaoDuplicados(revisao)
      return
    }

    await copiar(selecionadas.map(l => l.origem.id))
  }

  function alternarManterDuplicado(linhaId: string) {
    setRevisaoDuplicados(prev => prev?.map(r => r.linhaId === linhaId ? { ...r, manter: !r.manter } : r) ?? null)
  }

  async function confirmarComRevisao() {
    if (!revisaoDuplicados) return
    const excluidas = new Set(revisaoDuplicados.filter(r => !r.manter).map(r => r.linhaId))
    const idsParaCopiar = selecionadas.map(l => l.origem.id).filter(id => !excluidas.has(id))
    setRevisaoDuplicados(null)
    if (idsParaCopiar.length > 0) await copiar(idsParaCopiar)
  }

  async function copiar(idsParaCopiar: string[]) {
    setCopiando(true); setErro('')

    let criadas = 0
    let totalCriado = 0

    for (const id of idsParaCopiar) {
      const linha = linhas.find(l => l.origem.id === id)
      if (!linha) continue
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
      totalCriado += valor
    }

    await logAccess({
      action: 'criar',
      page: '/despesas',
      details: `Copiou ${criadas} despesa(s) de ${getMonthLabel(origem)} para ${getMonthLabel(destino)} — total ${formatCurrency(totalCriado)}`,
    })

    setCopiando(false)
    onCopied()
  }

  useEffect(() => { carregar() }, [origem, destino])

  if (revisaoDuplicados) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">

          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <div>
              <h2 className="font-semibold text-lg text-gray-900">⚠️ Possíveis despesas repetidas</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Estas despesas parecem já existir em {getMonthLabel(destino)} (mesmo valor, data próxima). Vêm desmarcadas — marca as que queres copiar mesmo assim.
              </p>
            </div>
            <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-3">
            {revisaoDuplicados.map(r => (
              <label key={r.linhaId} className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 accent-emerald-600 cursor-pointer mt-0.5"
                  checked={r.manter} onChange={() => alternarManterDuplicado(r.linhaId)} />
                <div className="text-sm">
                  <p className="font-medium text-gray-800">{r.descricao}</p>
                  {r.similares.map(s => (
                    <p key={s.id} className="text-xs text-amber-700 mt-0.5">
                      Já existe: {s.description} — {formatCurrency(s.amount)} em {s.expense_date}
                    </p>
                  ))}
                </div>
              </label>
            ))}
          </div>

          <div className="border-t border-gray-100 p-4 flex items-center justify-end gap-3">
            <button className="btn-secondary" onClick={() => setRevisaoDuplicados(null)} disabled={copiando}>
              <ArrowLeft className="w-4 h-4" /> Voltar
            </button>
            <button className="btn-primary" onClick={confirmarComRevisao} disabled={copiando}>
              {copiando
                ? <><Loader2 className="w-4 h-4 animate-spin" /> A copiar...</>
                : <><Copy className="w-4 h-4" /> Confirmar e copiar</>}
            </button>
          </div>

        </div>
      </div>
    )
  }

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
                    <tr key={l.origem.id} className="hover:bg-gray-50 transition-colors">
                      <td className="table-cell">
                        <input type="checkbox" className="w-4 h-4 accent-emerald-600 cursor-pointer"
                          checked={l.selecionada} onChange={() => alternar(l.origem.id)} />
                      </td>
                      <td className="table-cell">
                        <p className="font-medium text-gray-800">{l.origem.description}</p>
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
            <button className="btn-secondary" onClick={onClose} disabled={copiando || verificando}>Cancelar</button>
            <button className="btn-primary" onClick={iniciarCopia}
              disabled={copiando || verificando || mesmoMes || selecionadas.length === 0}>
              {copiando
                ? <><Loader2 className="w-4 h-4 animate-spin" /> A copiar...</>
                : verificando
                ? <><Loader2 className="w-4 h-4 animate-spin" /> A verificar...</>
                : <><Copy className="w-4 h-4" /> Copiar {selecionadas.length} despesa(s)</>}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
