'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, formatDate, matchesSearch } from '@/lib/utils'
import {
  ScrollText, Download, AlertTriangle, CheckCircle,
  Clock, Search, Filter, ExternalLink,
} from 'lucide-react'
import Link from 'next/link'

interface ContractRow {
  id: string
  space_ref: string
  space_type: string
  tenant_name: string
  tenant_phone: string | null
  tenant_email: string | null
  monthly_rent: number
  deposit: number | null
  start_date: string
  end_date: string | null
  status: string
  contract_file_path: string | null
  lease_id: string
  notes: string | null
}

// Calcula a próxima data de renovação do contrato.
// Se o contrato ainda não expirou, a próxima renovação é a data de fim.
// Se já expirou (e não foi cancelado), renova pelo mesmo período indefinidamente.
function calcNextRenewal(startDate: string, endDate: string | null): Date | null {
  if (!endDate) return null
  const start = new Date(startDate)
  const end = new Date(endDate)
  const today = new Date()
  if (end > today) return end // ainda não expirou

  // Duração em anos (arredondada ao inteiro mais próximo)
  const durationYears = Math.max(1, Math.round(
    (end.getFullYear() - start.getFullYear()) +
    (end.getMonth() - start.getMonth()) / 12
  ))

  // Avança pela duração até obter uma data futura
  let renewal = new Date(end)
  while (renewal <= today) {
    renewal = new Date(renewal)
    renewal.setFullYear(renewal.getFullYear() + durationYears)
  }
  return renewal
}

function daysUntilRenewal(startDate: string, endDate: string | null): number | null {
  if (!endDate) return null
  const renewal = calcNextRenewal(startDate, endDate)
  if (!renewal) return null
  return Math.ceil((renewal.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

function expiryBadge(days: number | null) {
  if (days === null)
    return <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Sem prazo</span>
  if (days < 0)
    return <span className="text-xs bg-red-100 text-red-700 font-semibold px-2 py-0.5 rounded-full">⛔ Expirado</span>
  if (days <= 30)
    return <span className="text-xs bg-red-100 text-red-700 font-semibold px-2 py-0.5 rounded-full">🔴 {days}d</span>
  if (days <= 90)
    return <span className="text-xs bg-orange-100 text-orange-700 font-semibold px-2 py-0.5 rounded-full">🟠 {days}d</span>
  if (days <= 180)
    return <span className="text-xs bg-yellow-100 text-yellow-700 font-semibold px-2 py-0.5 rounded-full">🟡 {days}d</span>
  return <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">✅ {days}d</span>
}

function rowBg(days: number | null) {
  if (days === null) return ''
  if (days < 0) return 'bg-red-50'
  if (days <= 30) return 'bg-red-50'
  if (days <= 90) return 'bg-orange-50'
  if (days <= 180) return 'bg-yellow-50'
  return ''
}

export default function ContratosPage() {
  const supabase = createClient()
  const [rows, setRows] = useState<ContractRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'todos' | 'a_expirar' | 'ok' | 'sem_prazo'>('todos')

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data } = await supabase
      .from('leases')
      .select('*, space:spaces(ref, type), tenant:tenants(name, phone, email)')
      .eq('status', 'ativo')
      .order('end_date', { ascending: true, nullsFirst: false })

    const mapped: ContractRow[] = (data ?? []).map((l: any) => ({
      id: l.id,
      lease_id: l.id,
      space_ref: l.space?.ref ?? '—',
      space_type: l.space?.type ?? '—',
      tenant_name: l.tenant?.name ?? '—',
      tenant_phone: l.tenant?.phone ?? null,
      tenant_email: l.tenant?.email ?? null,
      monthly_rent: l.monthly_rent,
      deposit: l.deposit,
      start_date: l.start_date,
      end_date: l.end_date,
      status: l.status,
      contract_file_path: l.contract_file_path,
      notes: l.notes,
    }))

    setRows(mapped)
    setLoading(false)
  }

  async function downloadContract(path: string) {
    const { data } = await supabase.storage.from('documents').createSignedUrl(path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const filtered = rows.filter(r => {
    const days = daysUntilRenewal(r.start_date, r.end_date)
    const matchSearch =
      !search || matchesSearch(r.tenant_name, search) || matchesSearch(r.space_ref, search)
    const matchFilter =
      filter === 'todos' ||
      (filter === 'a_expirar' && days !== null && days <= 180) ||
      (filter === 'ok' && (days === null || days > 180)) ||
      (filter === 'sem_prazo' && days === null)
    return matchSearch && matchFilter
  })

  // Resumo
  const total = rows.length
  const expirando = rows.filter(r => { const d = daysUntilRenewal(r.start_date, r.end_date); return d !== null && d <= 180 }).length
  const expirado = rows.filter(r => { const d = daysUntilRenewal(r.start_date, r.end_date); return d !== null && d < 0 }).length
  const semPrazo = rows.filter(r => r.end_date === null).length
  const totalRenda = rows.reduce((s, r) => s + r.monthly_rent, 0)

  return (
    <AppLayout>
      <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <ScrollText className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Contratos de Arrendamento</h1>
              <p className="text-sm text-gray-500">{total} contrato(s) ativo(s) · {formatCurrency(totalRenda)}/mês</p>
            </div>
          </div>
          <Link href="/alertas" prefetch={false}
            className="flex items-center gap-2 text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 px-3 py-2 rounded-lg hover:bg-yellow-100 transition-colors">
            <AlertTriangle className="w-4 h-4" />
            Ver alertas de contratos
          </Link>
        </div>

        {/* Cards resumo */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="card border-l-4 border-l-blue-500">
            <p className="text-xs text-gray-500 mb-1">Total ativos</p>
            <p className="text-2xl font-bold text-gray-900">{total}</p>
          </div>
          <div className="card border-l-4 border-l-yellow-500 cursor-pointer hover:bg-yellow-50 transition-colors"
            onClick={() => setFilter('a_expirar')}>
            <p className="text-xs text-gray-500 mb-1">A expirar (&lt;6 meses)</p>
            <p className="text-2xl font-bold text-yellow-600">{expirando}</p>
            {expirado > 0 && <p className="text-xs text-red-600 mt-1">{expirado} já expirado(s)</p>}
          </div>
          <div className="card border-l-4 border-l-gray-300 cursor-pointer hover:bg-gray-50 transition-colors"
            onClick={() => setFilter('sem_prazo')}>
            <p className="text-xs text-gray-500 mb-1">Sem data de fim</p>
            <p className="text-2xl font-bold text-gray-600">{semPrazo}</p>
          </div>
          <div className="card border-l-4 border-l-emerald-500">
            <p className="text-xs text-gray-500 mb-1">Receita mensal</p>
            <p className="text-2xl font-bold text-emerald-600">{formatCurrency(totalRenda)}</p>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              className="input pl-9 w-full"
              placeholder="Pesquisar inquilino ou espaço..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {(['todos', 'a_expirar', 'ok', 'sem_prazo'] as const).map(f => (
              <button key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors font-medium ${
                  filter === f
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                }`}>
                {f === 'todos' && 'Todos'}
                {f === 'a_expirar' && '⚠️ A expirar'}
                {f === 'ok' && '✅ OK'}
                {f === 'sem_prazo' && 'Sem prazo'}
              </button>
            ))}
          </div>
        </div>

        {/* Tabela */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <ScrollText className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Nenhum contrato encontrado</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="table-header text-left">Espaço</th>
                  <th className="table-header text-left">Inquilino</th>
                  <th className="table-header text-right">Renda</th>
                  <th className="table-header text-right">Caução</th>
                  <th className="table-header text-left">Início</th>
                  <th className="table-header text-left">Fim</th>
                  <th className="table-header text-left">Próx. Renovação</th>
                  <th className="table-header text-left">Prazo</th>
                  <th className="table-header text-center">Contrato</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const days = daysUntilRenewal(r.start_date, r.end_date)
                  return (
                    <tr key={r.id}
                      className={`border-b border-gray-100 hover:brightness-95 transition-all ${rowBg(days)}`}>
                      <td className="table-cell">
                        <span className="font-semibold text-gray-900">{r.space_ref}</span>
                        <span className="text-xs text-gray-400 ml-1">({r.space_type})</span>
                      </td>
                      <td className="table-cell">
                        <p className="font-medium text-gray-900">{r.tenant_name}</p>
                        {r.tenant_phone && (
                          <p className="text-xs text-gray-400">{r.tenant_phone}</p>
                        )}
                      </td>
                      <td className="table-cell text-right font-semibold text-gray-900">
                        {formatCurrency(r.monthly_rent)}
                      </td>
                      <td className="table-cell text-right text-gray-500">
                        {r.deposit ? formatCurrency(r.deposit) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="table-cell text-gray-600 whitespace-nowrap">
                        {formatDate(r.start_date)}
                      </td>
                      <td className="table-cell text-gray-600 whitespace-nowrap">
                        {r.end_date ? formatDate(r.end_date) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="table-cell whitespace-nowrap">
                        {r.end_date ? (() => {
                          const renewal = calcNextRenewal(r.start_date, r.end_date)
                          const isRenewed = renewal && new Date(r.end_date) < new Date()
                          return renewal ? (
                            <span className={isRenewed ? 'text-blue-600 font-medium text-xs' : 'text-gray-600 text-xs'}>
                              {isRenewed && '🔄 '}{formatDate(renewal)}
                            </span>
                          ) : <span className="text-gray-300">—</span>
                        })() : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="table-cell">
                        {expiryBadge(days)}
                      </td>
                      <td className="table-cell text-center">
                        {r.contract_file_path ? (
                          <button
                            onClick={() => downloadContract(r.contract_file_path!)}
                            title="Ver contrato"
                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline">
                            <Download className="w-3.5 h-3.5" />
                            PDF
                          </button>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Legenda */}
        <div className="flex flex-wrap gap-4 text-xs text-gray-500 pt-2">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block" /> Expirado ou &lt; 30 dias</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-orange-400 inline-block" /> 30–90 dias</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-yellow-400 inline-block" /> 90–180 dias</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" /> Mais de 6 meses</span>
        </div>
      </div>
    </AppLayout>
  )
}
