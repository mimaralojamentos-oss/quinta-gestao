'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useAuth } from '@/lib/auth-context'
import { logAccess } from '@/lib/logAccess'
import {
  calcularLinha, calcularTotais, escreverCoeficiente, htmlEstudoRevisao, lerCoeficiente,
  nasceSemAumento, ordenarLinhas,
  type EstudoRevisao, type ItemRevisao,
} from '@/lib/rentReview'
import { TrendingUp, Plus, Printer, RefreshCw, Loader2, AlertTriangle, Save } from 'lucide-react'

const supabase = createClient()

/**
 * Revisão de Rendas — o estudo anual de atualização dos preços.
 *
 * É SÓ UM ESTUDO: esta página nunca escreve em leases, rent_payments, spaces
 * ou tenants. Lê os contratos ativos uma vez, quando o estudo é criado, e
 * guarda essa fotografia nas suas próprias tabelas.
 */
export default function RevisaoRendasPage() {
  const { isAdmin, isCoAdmin, user } = useAuth()
  const podeVer = isAdmin || isCoAdmin

  const [estudos, setEstudos] = useState<EstudoRevisao[]>([])
  const [estudo, setEstudo] = useState<EstudoRevisao | null>(null)
  const [itens, setItens] = useState<ItemRevisao[]>([])
  const [ativos, setAtivos] = useState<Set<string>>(new Set())
  const [carregando, setCarregando] = useState(true)
  const [semTabelas, setSemTabelas] = useState(false)
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)

  // O coeficiente escrito à mão, como está no campo (pode ser "1,0256" ou "2,56%").
  const [coefTexto, setCoefTexto] = useState('')
  const [coefGuardado, setCoefGuardado] = useState(true)

  async function carregar(anoPreferido?: number) {
    setCarregando(true); setErro('')

    const { data: lista, error } = await supabase
      .from('rent_review_studies').select('*').order('ano', { ascending: false })

    if (error) {
      const faltaTabela = error.code === '42P01' || error.code === 'PGRST205' || /does not exist/i.test(error.message)
      setSemTabelas(faltaTabela)
      if (!faltaTabela) setErro(error.message)
      setCarregando(false)
      return
    }

    setSemTabelas(false)
    setEstudos(lista ?? [])
    const escolhido = (lista ?? []).find(e => e.ano === anoPreferido) ?? (lista ?? [])[0] ?? null
    setEstudo(escolhido)
    setCoefTexto(escolhido ? String(escolhido.coeficiente).replace('.', ',') : '')
    setCoefGuardado(true)

    if (escolhido) {
      const [{ data: linhas }, { data: contratos }] = await Promise.all([
        supabase.from('rent_review_items').select('*').eq('study_id', escolhido.id),
        supabase.from('leases').select('space_id').eq('status', 'ativo'),
      ])
      setItens(linhas ?? [])
      setAtivos(new Set((contratos ?? []).map((l: any) => l.space_id)))
    } else {
      setItens([])
    }
    setCarregando(false)
  }

  useEffect(() => { if (podeVer) carregar() }, [podeVer])

  const coefLido = lerCoeficiente(coefTexto)
  const coeficiente = coefLido?.coeficiente ?? estudo?.coeficiente ?? 1
  const linhas = ordenarLinhas(itens.map(i => calcularLinha(i, coeficiente, ativos)))
  const totais = calcularTotais(linhas)
  const anoNovo = estudos.length > 0 ? Math.max(...estudos.map(e => e.ano)) + 1 : 2027

  // ------------------------------------------------------------- criar

  /** Cria o estudo de um ano a partir dos contratos ATIVOS neste momento. */
  async function criarEstudo(ano: number) {
    if (!confirm(`Criar o estudo de ${ano}?\n\nVai tirar uma fotografia dos contratos ativos neste momento: cada fração entra com a renda que tem hoje. Os contratos não são alterados.`)) return

    setOcupado(true); setErro('')
    const { data: contratos, error: erroContratos } = await supabase
      .from('leases')
      .select('id, space_id, monthly_rent, start_date, space:spaces(ref), tenant:tenants(name)')
      .eq('status', 'ativo')

    if (erroContratos) { setErro(erroContratos.message); setOcupado(false); return }
    if (!contratos || contratos.length === 0) {
      setErro('Não há contratos ativos para estudar.')
      setOcupado(false); return
    }

    const { data: novo, error: erroEstudo } = await supabase
      .from('rent_review_studies')
      .insert({ ano, coeficiente: 1, created_by: user?.email ?? null })
      .select().single()

    if (erroEstudo || !novo) {
      setErro(erroEstudo?.message.includes('duplicate') || erroEstudo?.message.includes('_ano_key')
        ? `Já existe um estudo para ${ano}.`
        : (erroEstudo?.message ?? 'Não foi possível criar o estudo.'))
      setOcupado(false); return
    }

    const novasLinhas = contratos.map((l: any) => ({
      study_id: novo.id,
      space_id: l.space_id,
      space_ref: l.space?.ref ?? '—',
      tenant_name: l.tenant?.name ?? null,
      valor_atual: Number(l.monthly_rent ?? 0),
      lease_id: l.id,
      lease_start_date: l.start_date ?? null,
      // Quem entrou há menos de 12 meses nasce sem aumento (alterável à mão).
      com_aumento: !nasceSemAumento(l.start_date, ano),
      valor_a_pedir: null,
    }))

    const { error: erroLinhas } = await supabase.from('rent_review_items').insert(novasLinhas)
    if (erroLinhas) { setErro(erroLinhas.message); setOcupado(false); return }

    await logAccess({
      action: 'criar', page: '/revisao-rendas',
      details: `Criou o estudo de revisão de rendas de ${ano} com ${novasLinhas.length} fração(ões)`,
    })
    setOcupado(false)
    await carregar(ano)
  }

  // --------------------------------------------------------- coeficiente

  async function guardarCoeficiente() {
    if (!estudo || !coefLido) return
    setOcupado(true)
    const { error } = await supabase.from('rent_review_studies')
      .update({ coeficiente: coefLido.coeficiente, updated_at: new Date().toISOString() })
      .eq('id', estudo.id)
    setOcupado(false)
    if (error) { setErro(error.message); return }

    await logAccess({
      action: 'editar', page: '/revisao-rendas',
      details: `Pôs o coeficiente ${escreverCoeficiente(coefLido.coeficiente)} no estudo de ${estudo.ano}`,
    })
    setEstudo({ ...estudo, coeficiente: coefLido.coeficiente })
    setCoefGuardado(true)
  }

  // --------------------------------------------------------------- linhas

  /**
   * Marcar/desmarcar o aumento. Sem aumento, o recomendado e o valor a pedir
   * passam a ser o atual e a edição desliga-se; ao voltar a marcar com
   * aumento, a edição regressa e os dois voltam ao valor calculado.
   */
  async function alternarAumento(item: ItemRevisao) {
    const comAumento = !item.com_aumento
    setItens(prev => prev.map(i => i.id === item.id
      ? { ...i, com_aumento: comAumento, valor_a_pedir: comAumento ? null : null } : i))

    const { error } = await supabase.from('rent_review_items')
      .update({ com_aumento: comAumento, valor_a_pedir: null, updated_at: new Date().toISOString() })
      .eq('id', item.id)
    if (error) { setErro(error.message); await carregar(estudo?.ano); return }

    await logAccess({
      action: 'editar', page: '/revisao-rendas',
      details: `${comAumento ? 'Pôs' : 'Tirou'} a fração ${item.space_ref} ${comAumento ? 'no' : 'do'} aumento do estudo de ${estudo?.ano}`,
    })
  }

  async function guardarValorAPedir(item: ItemRevisao, texto: string) {
    const limpo = texto.trim().replace(',', '.')
    const valor = limpo === '' ? null : parseFloat(limpo)
    if (valor !== null && (!Number.isFinite(valor) || valor < 0)) return

    setItens(prev => prev.map(i => i.id === item.id ? { ...i, valor_a_pedir: valor } : i))
    const { error } = await supabase.from('rent_review_items')
      .update({ valor_a_pedir: valor, updated_at: new Date().toISOString() })
      .eq('id', item.id)
    if (error) setErro(error.message)
  }

  /** Refresca a fotografia dos valores atuais, sem tocar no resto. */
  async function atualizarValoresAtuais() {
    if (!estudo) return
    if (!confirm('Atualizar os valores atuais a partir dos contratos?\n\nAtualiza só a coluna "Valor atual" e o nome do inquilino. As marcas de aumento e os valores a pedir que já definiste ficam como estão.')) return

    setOcupado(true); setErro('')
    const { data: contratos, error } = await supabase
      .from('leases')
      .select('id, space_id, monthly_rent, start_date, tenant:tenants(name)')
      .eq('status', 'ativo')
    if (error) { setErro(error.message); setOcupado(false); return }

    const porEspaco = new Map((contratos ?? []).map((l: any) => [l.space_id, l]))
    let mexidas = 0
    for (const item of itens) {
      const atual = porEspaco.get(item.space_id)
      if (!atual) continue
      const novoValor = Number(atual.monthly_rent ?? 0)
      const novoNome = atual.tenant?.name ?? null
      if (novoValor === Number(item.valor_atual) && novoNome === item.tenant_name) continue

      const { error: erroLinha } = await supabase.from('rent_review_items').update({
        valor_atual: novoValor,
        tenant_name: novoNome,
        lease_id: atual.id,
        lease_start_date: atual.start_date ?? null,
        updated_at: new Date().toISOString(),
      }).eq('id', item.id)
      if (erroLinha) { setErro(erroLinha.message); break }
      mexidas++
    }

    await logAccess({
      action: 'editar', page: '/revisao-rendas',
      details: `Atualizou os valores atuais do estudo de ${estudo.ano} (${mexidas} fração(ões) mudaram)`,
    })
    setOcupado(false)
    await carregar(estudo.ano)
    alert(mexidas === 0
      ? 'Nada mudou: os valores atuais já estavam iguais aos dos contratos.'
      : `${mexidas} fração(ões) atualizada(s).`)
  }

  function imprimir() {
    if (!estudo) return
    const janela = window.open('', '_blank')
    if (!janela) { alert('O browser bloqueou a janela de impressão.\n\nPermite janelas novas para este site e tenta outra vez.'); return }
    janela.document.write(htmlEstudoRevisao({
      estudo: { ...estudo, coeficiente },
      linhas,
      appName: process.env.NEXT_PUBLIC_APP_NAME,
      appLocation: process.env.NEXT_PUBLIC_APP_LOCATION,
    }))
    janela.document.close()
  }

  if (!podeVer) {
    return (
      <AppLayout>
        <div className="p-8">
          <p className="text-gray-500">Esta página é só para administradores.</p>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="p-4 md:p-8">
        <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-emerald-600" /> Revisão de Rendas
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Estudo anual de atualização dos preços. Não altera contratos nem rendas.
            </p>
          </div>

          <div className="flex gap-2 flex-wrap">
            {estudos.length > 0 && (
              <select className="input text-sm" value={estudo?.ano ?? ''}
                onChange={e => carregar(Number(e.target.value))} style={{ width: 'auto' }}>
                {estudos.map(e => <option key={e.id} value={e.ano}>Estudo de {e.ano}</option>)}
              </select>
            )}
            {!semTabelas && (
              <button className="btn-secondary" onClick={() => criarEstudo(anoNovo)} disabled={ocupado}>
                <Plus className="w-4 h-4" /> Criar estudo de {anoNovo}
              </button>
            )}
            {estudo && (
              <button className="btn-primary" onClick={imprimir}>
                <Printer className="w-4 h-4" /> Imprimir
              </button>
            )}
          </div>
        </div>

        {semTabelas ? (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-4 py-3">
            As tabelas da revisão de rendas ainda não existem nesta base de dados. Corre o
            <strong> supabase-rent-review.sql</strong> e recarrega a página.
          </p>
        ) : carregando ? (
          <p className="text-gray-500">A carregar...</p>
        ) : !estudo ? (
          <div className="bg-white border border-gray-100 rounded-xl p-10 text-center">
            <TrendingUp className="w-8 h-8 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">
              Ainda não há nenhum estudo. Cria o de {anoNovo} para começar: cada fração com
              contrato ativo entra com a renda que tem hoje.
            </p>
          </div>
        ) : (
          <>
            {/* Cabeçalho do estudo */}
            <div className="bg-white border border-gray-100 rounded-xl p-4 mb-4 flex flex-wrap items-end gap-4">
              <div>
                <label className="label">Coeficiente / IPC</label>
                <div className="flex gap-2">
                  <input className="input" value={coefTexto} style={{ width: '140px' }}
                    placeholder="1,0256 ou 2,56%"
                    onChange={e => { setCoefTexto(e.target.value); setCoefGuardado(false) }} />
                  <button className="btn-secondary" onClick={guardarCoeficiente}
                    disabled={!coefLido || coefGuardado || ocupado}>
                    {ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {coefLido
                    ? <>É <strong>{escreverCoeficiente(coefLido.coeficiente)}</strong>
                      {!coefGuardado && <span className="text-amber-600"> — por guardar</span>}</>
                    : <span className="text-red-600">Escreve 1,0256 ou 2,56%</span>}
                </p>
              </div>

              <div className="flex-1" />

              <button className="btn-secondary" onClick={atualizarValoresAtuais} disabled={ocupado}
                title="Volta a ler as rendas dos contratos, sem mexer nas marcas nem nos valores a pedir">
                <RefreshCw className="w-4 h-4" /> Atualizar valores atuais
              </button>
            </div>

            {/* Totais */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="bg-white rounded-lg border border-gray-100 px-4 py-2.5">
                <p className="text-xs text-gray-500">Frações</p>
                <p className="text-lg font-bold text-gray-900">{totais.frações}</p>
                <p className="text-[11px] text-gray-400">{totais.semAumento} sem aumento</p>
              </div>
              <div className="bg-white rounded-lg border border-gray-100 px-4 py-2.5">
                <p className="text-xs text-gray-500">Renda atual / mês</p>
                <p className="text-lg font-bold text-gray-900">{formatCurrency(totais.atual)}</p>
              </div>
              <div className="bg-white rounded-lg border border-gray-100 px-4 py-2.5">
                <p className="text-xs text-gray-500">A pedir / mês</p>
                <p className="text-lg font-bold text-gray-900">{formatCurrency(totais.aPedir)}</p>
                <p className="text-[11px] text-gray-400">recomendado {formatCurrency(totais.recomendado)}</p>
              </div>
              <div className={`rounded-lg border px-4 py-2.5 ${totais.diferenca > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'}`}>
                <p className="text-xs text-gray-500">Diferença / mês</p>
                <p className={`text-lg font-bold ${totais.diferenca > 0 ? 'text-emerald-700' : 'text-gray-700'}`}>
                  {totais.diferenca > 0 ? '+' : ''}{formatCurrency(totais.diferenca)}
                </p>
                <p className="text-[11px] text-gray-400">
                  {totais.diferenca !== 0 && `${formatCurrency(totais.diferenca * 12)} /ano`}
                </p>
              </div>
            </div>

            {/* Tabela */}
            <div className="bg-white border border-gray-100 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase">
                    <th className="px-3 py-2.5">Fração</th>
                    <th className="px-3 py-2.5">Inquilino</th>
                    <th className="px-3 py-2.5">Aumento</th>
                    <th className="px-3 py-2.5 text-right">Valor atual</th>
                    <th className="px-3 py-2.5 text-right">Recomendado</th>
                    <th className="px-3 py-2.5 text-right">A pedir</th>
                    <th className="px-3 py-2.5 text-right">Diferença</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {linhas.map(l => (
                    <tr key={l.id} className={l.com_aumento ? 'hover:bg-gray-50' : 'bg-gray-100/70 text-gray-400'}>
                      <td className="px-3 py-2 font-medium whitespace-nowrap">
                        {l.space_ref}
                        {l.contratoTerminado && (
                          <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full whitespace-nowrap"
                            title="O contrato que foi capturado já não está ativo">
                            contrato terminado
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">{l.tenant_name ?? '—'}</td>
                      <td className="px-3 py-2">
                        <select className="text-xs border rounded-lg px-2 py-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          value={l.com_aumento ? 'sim' : 'nao'}
                          onChange={() => alternarAumento(l)}>
                          <option value="sim">Com aumento</option>
                          <option value="nao">Sem aumento</option>
                        </select>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{formatCurrency(Number(l.valor_atual))}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {l.com_aumento ? formatCurrency(l.recomendado) : (
                          <span title={`Sem aumento: fica igual ao valor atual. Com o coeficiente daria ${formatCurrency(l.recomendadoCalculado)}.`}>
                            {formatCurrency(l.recomendado)}
                            <span className="block text-[10px] text-gray-400 leading-tight">
                              c/ aumento: {formatCurrency(l.recomendadoCalculado)}
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {l.com_aumento ? (
                          <input type="number" step="0.01" min="0"
                            className="text-sm border rounded-lg px-2 py-1 text-right focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            style={{ width: '96px' }}
                            defaultValue={l.valor_a_pedir ?? l.recomendado}
                            key={`${l.id}-${l.recomendado}-${l.valor_a_pedir ?? 'auto'}`}
                            onBlur={e => guardarValorAPedir(l, e.target.value)} />
                        ) : (
                          <span title="Sem aumento: fica igual ao valor atual">{formatCurrency(l.aPedir)}</span>
                        )}
                      </td>
                      <td className={`px-3 py-2 text-right whitespace-nowrap ${l.diferenca > 0 ? 'text-emerald-700 font-medium' : ''}`}>
                        {l.diferenca === 0 ? '—' : `+${formatCurrency(l.diferenca)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 font-semibold text-gray-900">
                    <td className="px-3 py-2.5" colSpan={3}>
                      {totais.frações} fração(ões) · {totais.semAumento} sem aumento
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">{formatCurrency(totais.atual)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">{formatCurrency(totais.recomendado)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">{formatCurrency(totais.aPedir)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap text-emerald-700">
                      {totais.diferenca > 0 ? '+' : ''}{formatCurrency(totais.diferenca)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <p className="text-xs text-gray-400 mt-3">
              Os valores atuais são a fotografia tirada quando o estudo foi criado
              {estudo.created_at ? ` (${formatDate(estudo.created_at.slice(0, 10))})` : ''}.
              Nas linhas sem aumento, o recomendado, o valor a pedir e os totais ficam no
              valor atual; em baixo, em letra pequena, fica o que o coeficiente daria.
              Nada nesta página altera contratos, rendas ou pagamentos.
            </p>

            {linhas.some(l => l.contratoTerminado) && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-2 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                Há frações cujo contrato já não está ativo desde que o estudo foi criado.
                Ficam no estudo, assinaladas — decide se continuam a fazer parte da conversa.
              </p>
            )}
          </>
        )}

        {erro && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg mt-3">{erro}</p>}
      </div>
    </AppLayout>
  )
}
