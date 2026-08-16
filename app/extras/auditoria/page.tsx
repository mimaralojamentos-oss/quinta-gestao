'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatDateTime, normalizeText } from '@/lib/utils'
import { useAuth } from '@/lib/auth-context'
import { ShieldCheck, Search, ChevronLeft, X, Loader2, Plus, Pencil, Trash2 } from 'lucide-react'
import Link from 'next/link'

const supabase = createClient()

/**
 * Trilho de auditoria — todas as alterações feitas aos dados.
 *
 * Ao contrário do "Log de Acessos", que é escrito pela aplicação e podia ser
 * contornado, isto é escrito pela própria base de dados a cada alteração.
 * Ninguém consegue mexer nos dados sem aparecer aqui, e ninguém consegue
 * apagar estas linhas — nem os administradores.
 */

interface Linha {
  id: number
  ocorrido_em: string
  utilizador: string | null
  email: string | null
  tabela: string
  operacao: 'INSERT' | 'UPDATE' | 'DELETE'
  registo_id: string | null
  antes: Record<string, any> | null
  depois: Record<string, any> | null
}

const NOMES_TABELAS: Record<string, string> = {
  expenses: 'Despesas',
  rent_payments: 'Pagamentos de renda',
  electricity_charges: 'Cobranças de eletricidade',
  electricity_readings: 'Leituras de contador',
  debts: 'Dívidas',
  debt_payments: 'Pagamentos de dívidas',
  cash_fund_movements: 'Fundo de maneio',
  bank_transactions: 'Movimentos bancários',
  income_records: 'Receitas',
  documents: 'Documentos',
  leases: 'Contratos',
  tenants: 'Inquilinos',
  spaces: 'Espaços',
  lease_rent_history: 'Histórico de rendas',
  profiles: 'Utilizadores',
  workers: 'Trabalhadores',
  work_entries: 'Horas trabalhadas',
  worker_payments: 'Pagamentos a trabalhadores',
  supplier_aliases: 'Fornecedores',
  email_settings: 'Definições de e-mail',
}

/** Campos que não vale a pena mostrar nas diferenças. */
const IGNORAR = new Set(['id', 'created_at', 'updated_at'])

/** Campos que nunca devem aparecer no ecrã, por serem segredos. */
const SEGREDOS = new Set(['pin', 'access_token', 'smtp_password', 'password'])

function diferencas(antes: any, depois: any): { campo: string; de: string; para: string }[] {
  const chaves = new Set([...Object.keys(antes ?? {}), ...Object.keys(depois ?? {})])
  const saida: { campo: string; de: string; para: string }[] = []
  for (const k of chaves) {
    if (IGNORAR.has(k)) continue
    const a = antes?.[k]
    const b = depois?.[k]
    if (JSON.stringify(a) === JSON.stringify(b)) continue
    const esconder = SEGREDOS.has(k)
    saida.push({
      campo: k,
      de: esconder ? '•••' : a === null || a === undefined ? '—' : String(a),
      para: esconder ? '•••' : b === null || b === undefined ? '—' : String(b),
    })
  }
  return saida
}

export default function AuditoriaPage() {
  const { profile } = useAuth()
  const podeVer = profile?.role === 'admin'

  const [linhas, setLinhas] = useState<Linha[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [pesquisa, setPesquisa] = useState('')
  const [filtroTabela, setFiltroTabela] = useState('all')
  const [filtroOperacao, setFiltroOperacao] = useState<'all' | 'INSERT' | 'UPDATE' | 'DELETE'>('all')
  const [aberto, setAberto] = useState<Linha | null>(null)

  useEffect(() => {
    async function carregar() {
      if (!podeVer) { setLoading(false); return }
      const { data, error } = await supabase
        .from('audit_log')
        .select('*')
        .order('ocorrido_em', { ascending: false })
        .limit(1000)
      if (error) setErro(error.message)
      setLinhas((data ?? []) as Linha[])
      setLoading(false)
    }
    carregar()
  }, [podeVer])

  if (!podeVer) {
    return (
      <AppLayout>
        <div className="p-8">
          <p className="text-gray-500">Só os administradores podem consultar o trilho de auditoria.</p>
        </div>
      </AppLayout>
    )
  }

  const q = normalizeText(pesquisa)
  const visiveis = linhas
    .filter(l => filtroTabela === 'all' || l.tabela === filtroTabela)
    .filter(l => filtroOperacao === 'all' || l.operacao === filtroOperacao)
    .filter(l => !q ||
      normalizeText(l.email).includes(q) ||
      normalizeText(NOMES_TABELAS[l.tabela] ?? l.tabela).includes(q) ||
      normalizeText(JSON.stringify(l.depois ?? l.antes ?? {})).includes(q))

  const tabelasPresentes = [...new Set(linhas.map(l => l.tabela))].sort()
  const totalApagados = linhas.filter(l => l.operacao === 'DELETE').length

  return (
    <AppLayout>
      <div className="p-4 md:p-8">
        <Link href="/extras" prefetch={false}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-emerald-600 mb-3 transition-colors">
          <ChevronLeft className="w-4 h-4" /> Extras
        </Link>

        <div className="mb-5">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-emerald-600" /> Registo de Alterações
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Tudo o que foi criado, alterado ou apagado nos dados, com o antes e o depois.
            Este registo é escrito pela base de dados e não pode ser adulterado.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div className="bg-white rounded-lg border border-gray-100 px-4 py-2.5">
            <p className="text-xs text-gray-500">Alterações registadas</p>
            <p className="text-lg font-bold text-gray-900">{linhas.length}{linhas.length >= 1000 ? '+' : ''}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-100 px-4 py-2.5">
            <p className="text-xs text-gray-500">Tabelas afetadas</p>
            <p className="text-lg font-bold text-gray-900">{tabelasPresentes.length}</p>
          </div>
          <div className={`rounded-lg border px-4 py-2.5 ${totalApagados > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100'}`}>
            <p className="text-xs text-gray-500">Registos apagados</p>
            <p className={`text-lg font-bold ${totalApagados > 0 ? 'text-red-600' : 'text-gray-900'}`}>{totalApagados}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9" placeholder="Procurar por utilizador, área ou conteúdo..."
              value={pesquisa} onChange={e => setPesquisa(e.target.value)} />
          </div>
          <select className="input w-52" value={filtroTabela} onChange={e => setFiltroTabela(e.target.value)}>
            <option value="all">Todas as áreas</option>
            {tabelasPresentes.map(t => <option key={t} value={t}>{NOMES_TABELAS[t] ?? t}</option>)}
          </select>
          <div className="flex gap-1">
            {(['all', 'INSERT', 'UPDATE', 'DELETE'] as const).map(op => (
              <button key={op} onClick={() => setFiltroOperacao(op)}
                className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                  filtroOperacao === op ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}>
                {op === 'all' ? 'Tudo' : op === 'INSERT' ? 'Criados' : op === 'UPDATE' ? 'Alterados' : 'Apagados'}
              </button>
            ))}
          </div>
        </div>

        {erro && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
            <p className="text-sm text-red-700 font-medium">Não foi possível carregar</p>
            <p className="text-sm text-red-600 mt-1">{erro}</p>
            <p className="text-xs text-red-600 mt-2">
              Se diz que a tabela não existe, falta correr a Parte 2 do ficheiro SQL da auditoria.
            </p>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 text-emerald-600 animate-spin" /></div>
        ) : visiveis.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-xl p-10 text-center">
            <p className="text-gray-500 text-sm">
              {linhas.length === 0
                ? 'Ainda não há alterações registadas. A partir do momento em que o SQL correr, tudo o que mexer nos dados aparece aqui.'
                : 'Nada corresponde a estes filtros.'}
            </p>
          </div>
        ) : (
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <div className="divide-y divide-gray-50">
              {visiveis.slice(0, 300).map(l => (
                <button key={l.id} onClick={() => setAberto(l)}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-start gap-3">
                  <div className="mt-0.5 flex-shrink-0">
                    {l.operacao === 'DELETE' ? <Trash2 className="w-4 h-4 text-red-500" />
                      : l.operacao === 'INSERT' ? <Plus className="w-4 h-4 text-emerald-600" />
                      : <Pencil className="w-4 h-4 text-blue-500" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">
                      {NOMES_TABELAS[l.tabela] ?? l.tabela}
                      <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full font-medium ${
                        l.operacao === 'DELETE' ? 'bg-red-100 text-red-700'
                        : l.operacao === 'INSERT' ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-blue-100 text-blue-700'
                      }`}>
                        {l.operacao === 'DELETE' ? 'apagado' : l.operacao === 'INSERT' ? 'criado' : 'alterado'}
                      </span>
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">
                      {l.email ?? 'sistema'}
                      {l.operacao === 'UPDATE' && (
                        <span> · {diferencas(l.antes, l.depois).length} campo(s) alterado(s)</span>
                      )}
                    </p>
                  </div>
                  <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">{formatDateTime(l.ocorrido_em)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {visiveis.length > 300 && (
          <p className="text-xs text-gray-400 mt-2">A mostrar 300 de {visiveis.length} — usa os filtros para reduzir</p>
        )}
      </div>

      {aberto && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-start justify-between gap-4 p-5 border-b border-gray-100">
              <div>
                <h2 className="font-semibold text-gray-900">
                  {NOMES_TABELAS[aberto.tabela] ?? aberto.tabela} — {
                    aberto.operacao === 'DELETE' ? 'registo apagado'
                    : aberto.operacao === 'INSERT' ? 'registo criado' : 'registo alterado'}
                </h2>
                <p className="text-xs text-gray-500 mt-1">
                  {formatDateTime(aberto.ocorrido_em)} · por {aberto.email ?? 'sistema'}
                </p>
              </div>
              <button onClick={() => setAberto(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>

            <div className="p-5 overflow-y-auto">
              {aberto.operacao === 'UPDATE' ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-gray-500 border-b border-gray-100">
                      <th className="py-2">Campo</th>
                      <th className="py-2">Antes</th>
                      <th className="py-2">Depois</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {diferencas(aberto.antes, aberto.depois).map(d => (
                      <tr key={d.campo}>
                        <td className="py-2 pr-3 font-medium text-gray-700 align-top">{d.campo}</td>
                        <td className="py-2 pr-3 text-red-600 line-through align-top break-all">{d.de}</td>
                        <td className="py-2 text-emerald-700 align-top break-all">{d.para}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="space-y-1.5">
                  {Object.entries(aberto.depois ?? aberto.antes ?? {})
                    .filter(([k]) => !IGNORAR.has(k))
                    .map(([k, v]) => (
                      <div key={k} className="flex gap-3 text-sm">
                        <span className="text-gray-500 w-44 flex-shrink-0">{k}</span>
                        <span className="text-gray-900 break-all">
                          {SEGREDOS.has(k) ? '•••' : v === null || v === undefined ? '—' : String(v)}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-100 flex justify-end">
              <button className="btn-secondary" onClick={() => setAberto(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
