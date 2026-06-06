'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatDate } from '@/lib/utils'
import { BarChart3, TrendingUp, Home, FileText, Calendar, ChevronDown } from 'lucide-react'

interface MonthOption { label: string; value: string }

function getLastMonths(n: number): MonthOption[] {
  const result: MonthOption[] = []
  const now = new Date()
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = d.toISOString().slice(0, 7)
    const label = d.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' })
    result.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) })
  }
  return result
}

const MONTHS = getLastMonths(12)

export default function RelatoriosPage() {
  const supabase = createClient()
  const [activeReport, setActiveReport] = useState('rendas')
  const [selectedMonth, setSelectedMonth] = useState(MONTHS[0].value)
  const [loading, setLoading] = useState(false)

  const [rendas, setRendas] = useState<any>(null)
  const [ocupacao, setOcupacao] = useState<any>(null)
  const [financeiro, setFinanceiro] = useState<any>(null)
  const [contratos, setContratos] = useState<any>(null)

  useEffect(() => {
    if (activeReport === 'rendas') fetchRendas()
    if (activeReport === 'ocupacao') fetchOcupacao()
    if (activeReport === 'financeiro') fetchFinanceiro()
    if (activeReport === 'contratos') fetchContratos()
  }, [activeReport, selectedMonth])

  async function fetchRendas() {
    setLoading(true)
    const startDate = `${selectedMonth}-01`
    const endDate = `${selectedMonth}-28` // usar gte/lte para garantir filtro correto

    const { data: leases } = await supabase
      .from('leases')
      .select('id, monthly_rent, space:spaces(ref), tenant:tenants(name)')
      .eq('status', 'ativo')

    const { data: payments } = await supabase
      .from('rent_payments')
      .select('*')
      .gte('reference_month', startDate)
      .lte('reference_month', endDate)

    const totalEsperado = (leases ?? []).reduce((s: number, l: any) => s + (l.monthly_rent ?? 0), 0)
    const totalRecebido = (payments ?? []).reduce((s: number, p: any) => s + (p.amount ?? 0), 0)

    const pagosIds = new Set((payments ?? []).map((p: any) => p.lease_id))
    const emFalta = (leases ?? []).filter((l: any) => !pagosIds.has(l.id))
    const pagos = (leases ?? []).filter((l: any) => pagosIds.has(l.id))

    setRendas({ totalEsperado, totalRecebido, emFalta, pagos, leases, payments })
    setLoading(false)
  }

  async function fetchOcupacao() {
    setLoading(true)
    const { data: spaces } = await supabase
      .from('spaces')
      .select('id, ref, status, leases(id, status, tenant:tenants(name))')
      .order('ref')

    const total = (spaces ?? []).length
    const ocupados = (spaces ?? []).filter((s: any) =>
      (s.leases ?? []).some((l: any) => l.status === 'ativo')
    ).length
    const livres = total - ocupados

    setOcupacao({ spaces, total, ocupados, livres, taxa: total > 0 ? Math.round((ocupados / total) * 100) : 0 })
    setLoading(false)
  }

  async function fetchFinanceiro() {
    setLoading(true)
    const startDate = `${selectedMonth}-01`
    const endDate = `${selectedMonth}-28`

    const { data: payments } = await supabase
      .from('rent_payments')
      .select('amount')
      .gte('reference_month', startDate)
      .lte('reference_month', endDate)

    const { data: despesas } = await supabase
      .from('expenses')
      .select('amount, category')
      .gte('expense_date', startDate)
      .lte('expense_date', `${selectedMonth}-31`)

    const receitas = (payments ?? []).reduce((s: number, p: any) => s + (p.amount ?? 0), 0)
    const totalDespesas = (despesas ?? []).reduce((s: number, e: any) => s + (e.amount ?? 0), 0)
    const saldo = receitas - totalDespesas

    const porCategoria: Record<string, number> = {}
    ;(despesas ?? []).forEach((e: any) => {
      const cat = e.category ?? 'Outros'
      porCategoria[cat] = (porCategoria[cat] ?? 0) + e.amount
    })

    setFinanceiro({ receitas, totalDespesas, saldo, porCategoria, despesas })
    setLoading(false)
  }

  async function fetchContratos() {
    setLoading(true)
    const hoje = new Date()
    const em6meses = new Date(hoje.getFullYear(), hoje.getMonth() + 6, hoje.getDate())
      .toISOString().slice(0, 10)

    const { data } = await supabase
      .from('leases')
      .select('id, end_date, monthly_rent, space:spaces(ref), tenant:tenants(name)')
      .eq('status', 'ativo')
      .not('end_date', 'is', null)
      .lte('end_date', em6meses)
      .order('end_date', { ascending: true })

    setContratos(data ?? [])
    setLoading(false)
  }

  function fmt(v: number) {
    return v.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })
  }

  function diasAteExpirar(dateStr: string) {
    const diff = new Date(dateStr).getTime() - new Date().getTime()
    return Math.ceil(diff / (1000 * 60 * 60 * 24))
  }

  const REPORTS = [
    { key: 'rendas', label: 'Rendas do Mês', icon: FileText, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { key: 'ocupacao', label: 'Ocupação', icon: Home, color: 'text-blue-600', bg: 'bg-blue-50' },
    { key: 'financeiro', label: 'Financeiro', icon: TrendingUp, color: 'text-purple-600', bg: 'bg-purple-50' },
    { key: 'contratos', label: 'Contratos a Expirar', icon: Calendar, color: 'text-orange-600', bg: 'bg-orange-50' },
  ]

  const showMonthPicker = activeReport === 'rendas' || activeReport === 'financeiro'

  return (
    <AppLayout>
      <div className="p-8">
        <div className="flex items-center gap-3 mb-6">
          <BarChart3 className="w-6 h-6 text-emerald-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Relatórios</h1>
            <p className="text-sm text-gray-500 mt-0.5">Resumos e análises da quinta</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {REPORTS.map(r => (
            <button key={r.key} onClick={() => setActiveReport(r.key)}
              className={`flex items-center gap-3 p-4 rounded-xl border text-left transition-all ${activeReport === r.key ? 'border-emerald-500 bg-emerald-50 shadow-sm' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
              <div className={`w-9 h-9 rounded-lg ${activeReport === r.key ? r.bg : 'bg-gray-100'} flex items-center justify-center flex-shrink-0`}>
                <r.icon className={`w-4 h-4 ${activeReport === r.key ? r.color : 'text-gray-400'}`} />
              </div>
              <span className={`text-sm font-medium ${activeReport === r.key ? 'text-gray-900' : 'text-gray-600'}`}>
                {r.label}
              </span>
            </button>
          ))}
        </div>

        {showMonthPicker && (
          <div className="flex items-center gap-3 mb-5">
            <label className="text-sm font-medium text-gray-600">Mês:</label>
            <div className="relative">
              <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
                className="appearance-none bg-white border border-gray-200 rounded-lg px-3 py-2 pr-8 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500">
                {MONTHS.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
          </div>
        ) : (
          <div>

            {/* RENDAS */}
            {activeReport === 'rendas' && rendas && (
              <div className="space-y-5">
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Valor Esperado</p>
                    <p className="text-2xl font-bold text-gray-900">{fmt(rendas.totalEsperado)}</p>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Recebido</p>
                    <p className="text-2xl font-bold text-emerald-600">{fmt(rendas.totalRecebido)}</p>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Em Falta</p>
                    <p className="text-2xl font-bold text-red-500">{fmt(Math.max(0, rendas.totalEsperado - rendas.totalRecebido))}</p>
                  </div>
                </div>

                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-600 font-medium">Taxa de cobrança</span>
                    <span className="font-bold text-gray-900">
                      {rendas.totalEsperado > 0 ? Math.round((rendas.totalRecebido / rendas.totalEsperado) * 100) : 0}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-3">
                    <div className="bg-emerald-500 h-3 rounded-full transition-all"
                      style={{ width: `${rendas.totalEsperado > 0 ? Math.min(100, Math.round((rendas.totalRecebido / rendas.totalEsperado) * 100)) : 0}%` }} />
                  </div>
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>{rendas.pagos.length} pagos</span>
                    <span>{rendas.emFalta.length} em falta</span>
                  </div>
                </div>

                {rendas.emFalta.length > 0 && (
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">⚠️ Rendas em falta</h3>
                    <div className="space-y-2">
                      {rendas.emFalta.map((l: any) => (
                        <div key={l.id} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                          <div>
                            <p className="text-sm font-medium text-gray-800">{l.tenant?.name ?? '—'}</p>
                            <p className="text-xs text-gray-400">{l.space?.ref}</p>
                          </div>
                          <span className="text-sm font-semibold text-red-500">{fmt(l.monthly_rent ?? 0)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {rendas.pagos.length > 0 && (
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">✅ Rendas pagas</h3>
                    <div className="space-y-2">
                      {rendas.pagos.map((l: any) => {
                        const p = rendas.payments.find((pay: any) => pay.lease_id === l.id)
                        return (
                          <div key={l.id} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                            <div>
                              <p className="text-sm font-medium text-gray-800">{l.tenant?.name ?? '—'}</p>
                              <p className="text-xs text-gray-400">{l.space?.ref} · {p?.payment_method === 'dinheiro' ? '💵 Dinheiro' : '🏦 Banco'}</p>
                            </div>
                            <span className="text-sm font-semibold text-emerald-600">{fmt(p?.amount ?? 0)}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* OCUPAÇÃO */}
            {activeReport === 'ocupacao' && ocupacao && (
              <div className="space-y-5">
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Total de Espaços</p>
                    <p className="text-2xl font-bold text-gray-900">{ocupacao.total}</p>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Ocupados</p>
                    <p className="text-2xl font-bold text-emerald-600">{ocupacao.ocupados}</p>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Livres</p>
                    <p className="text-2xl font-bold text-orange-500">{ocupacao.livres}</p>
                  </div>
                </div>

                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-600 font-medium">Taxa de ocupação</span>
                    <span className="font-bold text-gray-900">{ocupacao.taxa}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-3">
                    <div className="bg-blue-500 h-3 rounded-full transition-all" style={{ width: `${ocupacao.taxa}%` }} />
                  </div>
                </div>

                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Todos os espaços</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {ocupacao.spaces.map((s: any) => {
                      const activeLease = (s.leases ?? []).find((l: any) => l.status === 'ativo')
                      return (
                        <div key={s.id} className={`flex items-center gap-2 p-2.5 rounded-lg border ${activeLease ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'}`}>
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${activeLease ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-gray-800">{s.ref}</p>
                            <p className="text-xs text-gray-400 truncate">{activeLease?.tenant?.name ?? 'Livre'}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* FINANCEIRO */}
            {activeReport === 'financeiro' && financeiro && (
              <div className="space-y-5">
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Receitas</p>
                    <p className="text-2xl font-bold text-emerald-600">{fmt(financeiro.receitas)}</p>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Despesas</p>
                    <p className="text-2xl font-bold text-red-500">{fmt(financeiro.totalDespesas)}</p>
                  </div>
                  <div className={`border rounded-xl p-4 ${financeiro.saldo >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                    <p className="text-xs text-gray-500 mb-1">Saldo</p>
                    <p className={`text-2xl font-bold ${financeiro.saldo >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmt(financeiro.saldo)}</p>
                  </div>
                </div>

                {Object.keys(financeiro.porCategoria).length > 0 && (
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Despesas por categoria</h3>
                    <div className="space-y-3">
                      {Object.entries(financeiro.porCategoria)
                        .sort(([, a]: any, [, b]: any) => b - a)
                        .map(([cat, val]: any) => (
                          <div key={cat}>
                            <div className="flex justify-between text-sm mb-1">
                              <span className="text-gray-600">{cat}</span>
                              <span className="font-medium text-gray-800">{fmt(val)}</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-2">
                              <div className="bg-purple-400 h-2 rounded-full"
                                style={{ width: `${financeiro.totalDespesas > 0 ? Math.round((val / financeiro.totalDespesas) * 100) : 0}%` }} />
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {financeiro.despesas?.length === 0 && (
                  <div className="text-center py-8 text-gray-400 text-sm">Sem despesas registadas neste mês.</div>
                )}
              </div>
            )}

            {/* CONTRATOS */}
            {activeReport === 'contratos' && (
              <div className="space-y-5">
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-1">Contratos a expirar nos próximos 6 meses</h3>
                  <p className="text-xs text-gray-400 mb-4">Apenas contratos com data de fim definida</p>

                  {!contratos || contratos.length === 0 ? (
                    <div className="text-center py-8 text-gray-400">
                      <p className="text-sm">✅ Nenhum contrato a expirar nos próximos 6 meses.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {contratos.map((c: any) => {
                        const dias = diasAteExpirar(c.end_date)
                        const urgente = dias <= 30
                        const aviso = dias <= 60
                        return (
                          <div key={c.id} className={`flex items-center justify-between p-3 rounded-lg border ${urgente ? 'bg-red-50 border-red-200' : aviso ? 'bg-yellow-50 border-yellow-200' : 'bg-gray-50 border-gray-200'}`}>
                            <div>
                              <p className="text-sm font-semibold text-gray-800">{c.tenant?.name ?? '—'}</p>
                              <p className="text-xs text-gray-500">{c.space?.ref} · Fim: {formatDate(c.end_date)}</p>
                            </div>
                            <div className="text-right">
                              <p className={`text-sm font-bold ${urgente ? 'text-red-600' : aviso ? 'text-yellow-600' : 'text-gray-600'}`}>
                                {dias} dias
                              </p>
                              <p className="text-xs text-gray-400">{fmt(c.monthly_rent ?? 0)}/mês</p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </AppLayout>
  )
}
