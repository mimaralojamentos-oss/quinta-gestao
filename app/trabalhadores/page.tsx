'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, matchesSearch } from '@/lib/utils'
import { formatarHoras, calcularConta, gerarToken, gerarPin, type Worker } from '@/lib/ponto'
import { useAuth } from '@/lib/auth-context'
import { logAccess } from '@/lib/logAccess'
import { HardHat, Plus, Search, X, ChevronRight, Users } from 'lucide-react'
import Link from 'next/link'

/**
 * Folha de ponto — visão geral de todos os trabalhadores.
 *
 * Cada trabalhador tem o seu link secreto para registar horas pelo telemóvel.
 * Aqui o gestor vê tudo junto: horas, quanto já pagou e quanto falta pagar.
 */

interface LinhaTrabalhador extends Worker {
  horas: number
  ganho: number
  pago: number
  saldo: number
}

export default function TrabalhadoresPage() {
  const supabase = createClient()
  const { isAdmin, isCoAdmin } = useAuth()
  const podeEditar = isAdmin || isCoAdmin

  const [linhas, setLinhas] = useState<LinhaTrabalhador[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [pesquisa, setPesquisa] = useState('')
  const [mostrarInativos, setMostrarInativos] = useState(false)

  const [novoAberto, setNovoAberto] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [erroNovo, setErroNovo] = useState('')
  const [novo, setNovo] = useState({
    name: '', phone: '', nif: '',
    hourly_rate: '', hourly_rate_holiday: '', notes: '',
  })

  useEffect(() => { carregar() }, [])

  async function carregar(silencioso = false) {
    if (!silencioso) setLoading(true)
    const [wRes, eRes, pRes] = await Promise.all([
      supabase.from('workers').select('id, name, phone, hourly_rate, hourly_rate_holiday, active').order('name'),
      supabase.from('work_entries').select('worker_id, work_date, start_time, amount, hours'),
      supabase.from('worker_payments').select('worker_id, amount'),
    ])

    if (wRes.error) { setErro(wRes.error.message); setLoading(false); return }
    setErro('')

    const linhas = (wRes.data ?? []).map((w: any) => {
      const entradas = (eRes.data ?? []).filter((e: any) => e.worker_id === w.id)
      const pagamentos = (pRes.data ?? []).filter((p: any) => p.worker_id === w.id)
      const conta = calcularConta(entradas as any, pagamentos as any)
      return {
        ...w,
        horas: conta.totalHoras,
        ganho: conta.totalGanho,
        pago: conta.totalPago,
        saldo: conta.saldo,
      }
    })

    setLinhas(linhas)
    setLoading(false)
  }

  async function criar() {
    if (!novo.name.trim()) { setErroNovo('O nome é obrigatório'); return }
    const tarifa = parseFloat(novo.hourly_rate)
    if (!tarifa || tarifa <= 0) { setErroNovo('Indica o preço por hora'); return }

    setGuardando(true); setErroNovo('')
    const { error } = await supabase.from('workers').insert({
      name: novo.name.trim(),
      phone: novo.phone.trim() || null,
      nif: novo.nif.trim() || null,
      notes: novo.notes.trim() || null,
      hourly_rate: tarifa,
      hourly_rate_holiday: novo.hourly_rate_holiday ? parseFloat(novo.hourly_rate_holiday) : null,
      access_token: gerarToken(),
      pin: gerarPin(),
      active: true,
    })
    setGuardando(false)
    if (error) { setErroNovo(error.message); return }

    await logAccess({ action: 'criar', page: '/trabalhadores', details: `Criou o trabalhador "${novo.name.trim()}"` })
    setNovoAberto(false)
    setNovo({ name: '', phone: '', nif: '', hourly_rate: '', hourly_rate_holiday: '', notes: '' })
    await carregar(true)
  }

  const visiveis = linhas
    .filter(l => mostrarInativos || l.active)
    .filter(l => matchesSearch(l.name, pesquisa))

  const totalEmDivida = visiveis.reduce((s, l) => s + Math.max(0, l.saldo), 0)
  const totalHoras = visiveis.reduce((s, l) => s + l.horas, 0)

  return (
    <AppLayout>
      <div className="p-4 md:p-8">
        <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Folha de Ponto</h1>
            <p className="text-sm text-gray-500 mt-1">
              Horas dos trabalhadores temporários e valores por pagar
            </p>
          </div>
          {podeEditar && (
            <button className="btn-primary" onClick={() => { setNovoAberto(true); setErroNovo('') }}>
              <Plus className="w-4 h-4" /> Novo Trabalhador
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div className="bg-white rounded-lg border border-gray-100 px-4 py-2.5">
            <p className="text-xs text-gray-500">Trabalhadores ativos</p>
            <p className="text-lg font-bold text-gray-900">{linhas.filter(l => l.active).length}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-100 px-4 py-2.5">
            <p className="text-xs text-gray-500">Horas registadas</p>
            <p className="text-lg font-bold text-gray-900">{formatarHoras(totalHoras)}</p>
          </div>
          <div className={`rounded-lg border px-4 py-2.5 ${totalEmDivida > 0 ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
            <p className="text-xs text-gray-500">Por pagar</p>
            <p className={`text-lg font-bold ${totalEmDivida > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
              {formatCurrency(totalEmDivida)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9" placeholder="Procurar trabalhador..."
              value={pesquisa} onChange={e => setPesquisa(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" className="accent-emerald-600 w-4 h-4"
              checked={mostrarInativos} onChange={e => setMostrarInativos(e.target.checked)} />
            Mostrar inativos
          </label>
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
            <Users className="w-8 h-8 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">
              {linhas.length === 0
                ? 'Ainda não há trabalhadores. Cria o primeiro para gerar o link da folha de ponto.'
                : 'Nenhum trabalhador corresponde a esta pesquisa.'}
            </p>
          </div>
        ) : (
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase">
                  <th className="table-header">Trabalhador</th>
                  <th className="table-header">Preço/hora</th>
                  <th className="table-header text-right">Horas</th>
                  <th className="table-header text-right">Ganho</th>
                  <th className="table-header text-right">Pago</th>
                  <th className="table-header text-right">Por pagar</th>
                  <th className="table-header"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {visiveis.map(l => (
                  <tr key={l.id} className="hover:bg-gray-50 transition-colors">
                    <td className="table-cell">
                      <Link href={`/trabalhadores/${l.id}`} prefetch={false}
                        className="font-medium text-gray-900 hover:text-emerald-600 transition-colors">
                        {l.name}
                      </Link>
                      {!l.active && <span className="ml-2 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">inativo</span>}
                      {l.phone && <p className="text-xs text-gray-400 mt-0.5">{l.phone}</p>}
                    </td>
                    <td className="table-cell text-xs text-gray-600">
                      {formatCurrency(l.hourly_rate)}
                      {l.hourly_rate_holiday
                        ? <span className="text-amber-600"> · {formatCurrency(l.hourly_rate_holiday)} fds/feriado</span>
                        : <span className="text-gray-400"> · igual ao fds</span>}
                    </td>
                    <td className="table-cell text-right text-gray-700">{formatarHoras(l.horas)}</td>
                    <td className="table-cell text-right text-gray-700">{formatCurrency(l.ganho)}</td>
                    <td className="table-cell text-right text-gray-500">{formatCurrency(l.pago)}</td>
                    <td className="table-cell text-right">
                      <span className={`font-semibold ${l.saldo > 0.005 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {l.saldo > 0.005 ? formatCurrency(l.saldo) : '✓ em dia'}
                      </span>
                    </td>
                    <td className="table-cell">
                      <Link href={`/trabalhadores/${l.id}`} prefetch={false}
                        className="text-gray-300 hover:text-emerald-600 transition-colors inline-flex">
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {novoAberto && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="font-semibold text-lg text-gray-900">
                <HardHat className="w-5 h-5 inline mr-2 text-emerald-600" />Novo Trabalhador
              </h2>
              <button onClick={() => setNovoAberto(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>

            <div className="p-5 space-y-3">
              <div>
                <label className="label">Nome *</label>
                <input className="input" value={novo.name} onChange={e => setNovo(f => ({ ...f, name: e.target.value }))} autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Telefone</label>
                  <input className="input" value={novo.phone} onChange={e => setNovo(f => ({ ...f, phone: e.target.value }))} />
                </div>
                <div>
                  <label className="label">NIF</label>
                  <input className="input" value={novo.nif} onChange={e => setNovo(f => ({ ...f, nif: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Preço/hora (€) *</label>
                  <input className="input" type="number" step="0.01" placeholder="0.00"
                    value={novo.hourly_rate} onChange={e => setNovo(f => ({ ...f, hourly_rate: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Fim de semana e feriados (€)</label>
                  <input className="input" type="number" step="0.01" placeholder="igual ao normal"
                    value={novo.hourly_rate_holiday} onChange={e => setNovo(f => ({ ...f, hourly_rate_holiday: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="label">Notas</label>
                <input className="input" value={novo.notes} onChange={e => setNovo(f => ({ ...f, notes: e.target.value }))} />
              </div>

              <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                Ao guardar é criado automaticamente o link secreto e o código de 4 dígitos
                para este trabalhador registar as horas pelo telemóvel.
              </p>

              {erroNovo && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{erroNovo}</p>}
            </div>

            <div className="flex justify-end gap-3 p-4 border-t border-gray-100">
              <button className="btn-secondary" onClick={() => setNovoAberto(false)}>Cancelar</button>
              <button className="btn-primary" onClick={criar} disabled={guardando}>
                {guardando ? 'A criar...' : 'Criar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
