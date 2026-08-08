'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState, Fragment } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useAuth } from '@/lib/auth-context'
import { logAccess } from '@/lib/logAccess'
import {
  normalizeSupplier, buildAliasMap, groupSuppliers,
  type SupplierAlias, type SupplierGroup,
} from '@/lib/suppliers'
import { Truck, Search, ChevronLeft, ChevronDown, ChevronRight, X, Link2, Undo2 } from 'lucide-react'
import Link from 'next/link'

export default function FornecedoresPage() {
  const supabase = createClient()
  const { profile } = useAuth()
  const podeEditar = ['admin', 'coadmin'].includes(profile?.role ?? '')

  const [docs, setDocs] = useState<any[]>([])
  const [aliases, setAliases] = useState<SupplierAlias[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [pesquisa, setPesquisa] = useState('')
  const [expandido, setExpandido] = useState<string | null>(null)

  // Janela de equivalência
  const [editar, setEditar] = useState<{ raw: string; atual: string } | null>(null)
  const [nomeReal, setNomeReal] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [erroModal, setErroModal] = useState('')

  useEffect(() => { carregar() }, [])

  async function carregar() {
    setLoading(true)
    const [docsRes, aliasRes] = await Promise.all([
      supabase.from('documents')
        .select('id, supplier_name, amount, doc_date, tipo, status')
        .eq('status', 'ativo')
        .not('supplier_name', 'is', null),
      supabase.from('supplier_aliases').select('*'),
    ])
    if (docsRes.error) setErro(docsRes.error.message)
    if (aliasRes.error) setErro(aliasRes.error.message)
    setDocs(docsRes.data ?? [])
    setAliases(aliasRes.data ?? [])
    setLoading(false)
  }

  const aliasMap = buildAliasMap(aliases)
  const grupos = groupSuppliers(docs, aliasMap)

  const q = pesquisa.trim().toLowerCase()
  const visiveis: SupplierGroup[] = grupos.filter(g =>
    !q || g.name.toLowerCase().includes(q) || g.variants.some(v => v.raw.toLowerCase().includes(q))
  )

  const totalGeral = visiveis.reduce((s, g) => s + g.total, 0)
  const porAgrupar = grupos.filter(g => g.variants.length > 1).length

  function abrirEquivalencia(raw: string, nomeAtual: string) {
    setEditar({ raw, atual: nomeAtual })
    setNomeReal(nomeAtual)
    setErroModal('')
  }

  async function guardarEquivalencia() {
    if (!editar) return
    const nome = nomeReal.trim()
    if (!nome) { setErroModal('Indica o nome real do fornecedor'); return }

    setGuardando(true); setErroModal('')
    const normalizado = normalizeSupplier(editar.raw)

    // upsert pela chave achatada: definir duas vezes a mesma variante
    // substitui, em vez de criar linhas repetidas.
    const { error } = await supabase.from('supplier_aliases').upsert({
      alias: editar.raw,
      alias_normalized: normalizado,
      canonical_name: nome,
    }, { onConflict: 'alias_normalized' })

    setGuardando(false)
    if (error) { setErroModal(error.message); return }

    await logAccess({
      action: 'editar',
      page: '/extras/fornecedores',
      details: `Definiu "${editar.raw}" como sendo o fornecedor "${nome}"`,
    })

    setEditar(null)
    await carregar()
  }

  async function removerEquivalencia(raw: string) {
    if (!confirm(`Deixar de agrupar "${raw}"?\n\nPassa a aparecer como fornecedor próprio, com o nome que vem das faturas.`)) return
    const { error } = await supabase
      .from('supplier_aliases')
      .delete()
      .eq('alias_normalized', normalizeSupplier(raw))
    if (error) { alert(`Não foi possível remover: ${error.message}`); return }
    await logAccess({
      action: 'apagar', page: '/extras/fornecedores',
      details: `Removeu a equivalência de fornecedor de "${raw}"`,
    })
    await carregar()
  }

  // Nomes já usados, para sugerir no campo de escrita
  const sugestoes = [...new Set(grupos.map(g => g.name))].sort()

  return (
    <AppLayout>
      <Link href="/extras" prefetch={false}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-emerald-600 mb-3 transition-colors">
        <ChevronLeft className="w-4 h-4" /> Extras
      </Link>

      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Fornecedores</h1>
        <p className="text-gray-500 text-sm mt-1">
          Retirado das faturas carregadas. Quando a mesma empresa aparece com nomes diferentes,
          define aqui qual é o nome real e as faturas passam a contar todas juntas.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5 max-w-xl">
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-xs text-gray-500 mb-1">Fornecedores</p>
          <p className="font-semibold text-gray-900">{visiveis.length}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-xs text-gray-500 mb-1">Total faturado</p>
          <p className="font-semibold text-gray-900">{formatCurrency(totalGeral)}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-xs text-gray-500 mb-1">Com variantes</p>
          <p className="font-semibold text-gray-900">{porAgrupar}</p>
        </div>
      </div>

      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input className="input pl-9" placeholder="Pesquisar fornecedor..."
          value={pesquisa} onChange={e => setPesquisa(e.target.value)} />
      </div>

      {erro && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">
          Não foi possível carregar: {erro}
        </p>
      )}

      {loading ? (
        <p className="text-gray-500">A carregar...</p>
      ) : visiveis.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-xl p-10 text-center">
          <Truck className="w-8 h-8 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">
            {docs.length === 0
              ? 'Ainda não há faturas com fornecedor identificado.'
              : 'Nenhum fornecedor corresponde a esta pesquisa.'}
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase">
                <th className="px-4 py-2.5">Fornecedor</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">Faturas</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">Total</th>
                <th className="px-4 py-2.5 whitespace-nowrap">Primeira</th>
                <th className="px-4 py-2.5 whitespace-nowrap">Última</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {visiveis.map(g => {
                const aberto = expandido === g.name
                return (
                  <Fragment key={g.name}>
                    <tr onClick={() => setExpandido(aberto ? null : g.name)}
                      className="cursor-pointer hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {aberto ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                                  : <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />}
                          <span className="font-medium text-gray-900">{g.name}</span>
                          {g.variants.length > 1 && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium whitespace-nowrap">
                              {g.variants.length} nomes
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{g.docs}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-900 whitespace-nowrap">{formatCurrency(g.total)}</td>
                      <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{g.firstDate ? formatDate(g.firstDate) : '—'}</td>
                      <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{g.lastDate ? formatDate(g.lastDate) : '—'}</td>
                    </tr>

                    {aberto && (
                      <tr>
                        <td colSpan={5} className="px-4 pb-3 pt-0 bg-gray-50/60">
                          <p className="text-xs text-gray-500 mb-2 mt-2">
                            Como aparece nas faturas:
                          </p>
                          <div className="space-y-1.5">
                            {g.variants.map(v => (
                              <div key={v.raw}
                                className="flex items-center gap-3 bg-white border border-gray-100 rounded-lg px-3 py-2">
                                <span className="text-xs text-gray-700 flex-1 truncate" title={v.raw}>{v.raw}</span>
                                <span className="text-xs text-gray-400 whitespace-nowrap">{v.docs} fatura(s)</span>
                                <span className="text-xs font-medium text-gray-600 whitespace-nowrap w-20 text-right">{formatCurrency(v.total)}</span>
                                {v.mapped && (
                                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium whitespace-nowrap">
                                    agrupado
                                  </span>
                                )}
                                {podeEditar && (
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    <button onClick={() => abrirEquivalencia(v.raw, g.name)}
                                      className="text-xs text-emerald-700 hover:underline inline-flex items-center gap-1">
                                      <Link2 className="w-3 h-3" /> {v.mapped ? 'Alterar' : 'Definir nome real'}
                                    </button>
                                    {v.mapped && (
                                      <button onClick={() => removerEquivalencia(v.raw)}
                                        className="text-xs text-gray-400 hover:text-red-500 inline-flex items-center gap-1 ml-2"
                                        title="Deixar de agrupar">
                                        <Undo2 className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                          {!podeEditar && (
                            <p className="text-xs text-gray-400 mt-2">
                              Só administradores podem alterar as equivalências.
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editar && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Nome real do fornecedor</h2>
              <button onClick={() => setEditar(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">Como aparece nas faturas</p>
                <p className="text-sm text-gray-800 bg-gray-50 rounded-lg px-3 py-2 break-words">{editar.raw}</p>
              </div>

              <div>
                <label className="label">Nome real *</label>
                <input className="input" list="fornecedores-existentes" value={nomeReal}
                  onChange={e => setNomeReal(e.target.value)}
                  placeholder="ex: EDP Comercial" autoFocus />
                <datalist id="fornecedores-existentes">
                  {sugestoes.map(s => <option key={s} value={s} />)}
                </datalist>
                <p className="text-xs text-gray-500 mt-1.5">
                  Escreve o mesmo nome nas várias formas de escrever a empresa e elas passam a
                  contar como um único fornecedor. A lista sugere os nomes que já existem.
                </p>
              </div>

              {erroModal && (
                <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{erroModal}</p>
              )}
            </div>

            <div className="flex justify-end gap-3 p-4 border-t border-gray-100">
              <button className="btn-secondary" onClick={() => setEditar(null)}>Cancelar</button>
              <button className="btn-primary" onClick={guardarEquivalencia} disabled={guardando}>
                {guardando ? 'A guardar...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
