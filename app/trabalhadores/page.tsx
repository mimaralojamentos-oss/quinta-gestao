'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, matchesSearch } from '@/lib/utils'
import { formatarHoras, calcularConta, type Worker } from '@/lib/ponto'
import { useAuth } from '@/lib/auth-context'
import WorkerFormModal from '@/components/WorkerFormModal'
import WorkerEmailModal, { type DestinatarioEmail } from '@/components/WorkerEmailModal'
import { Plus, Search, ChevronRight, Users, Pencil, Mail, Send } from 'lucide-react'
import Link from 'next/link'

const supabase = createClient()

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
  const { isAdmin, isCoAdmin } = useAuth()
  const podeEditar = isAdmin || isCoAdmin

  const [linhas, setLinhas] = useState<LinhaTrabalhador[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [pesquisa, setPesquisa] = useState('')
  const [mostrarInativos, setMostrarInativos] = useState(false)

  const [novoAberto, setNovoAberto] = useState(false)
  // Trabalhador em edição. A lista nunca carrega o link nem o código de acesso.
  const [aEditar, setAEditar] = useState<Worker | null>(null)
  // E-mails: só se selecionam trabalhadores com e-mail preenchido.
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [emailPara, setEmailPara] = useState<DestinatarioEmail[] | null>(null)

  useEffect(() => { carregar() }, [])

  async function carregar(silencioso = false) {
    if (!silencioso) setLoading(true)
    const [wRes, eRes, pRes] = await Promise.all([
      supabase.from('workers').select('id, name, phone, email, phone_os, nif, notes, hourly_rate, hourly_rate_holiday, active').order('name'),
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

  const visiveis = linhas
    .filter(l => mostrarInativos || l.active)
    .filter(l => matchesSearch(l.name, pesquisa))

  const totalEmDivida = visiveis.reduce((s, l) => s + Math.max(0, l.saldo), 0)
  const totalHoras = visiveis.reduce((s, l) => s + l.horas, 0)

  const elegiveis = visiveis.filter(l => l.email)
  const escolhidos = elegiveis.filter(l => selecionados.has(l.id))
  const todosEscolhidos = elegiveis.length > 0 && escolhidos.length === elegiveis.length

  function alternar(id: string) {
    setSelecionados(s => {
      const novo = new Set(s)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })
  }
  function alternarTodos() {
    setSelecionados(todosEscolhidos ? new Set() : new Set(elegiveis.map(l => l.id)))
  }

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
            <button className="btn-primary" onClick={() => setNovoAberto(true)}>
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
          {podeEditar && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs text-gray-400 hidden sm:inline">Só trabalhadores com e-mail podem ser selecionados</span>
              <button className="btn-secondary text-sm" disabled={escolhidos.length === 0}
                onClick={() => setEmailPara(escolhidos)}>
                <Send className="w-4 h-4" /> Enviar e-mail aos selecionados ({escolhidos.length})
              </button>
            </div>
          )}
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
                  {podeEditar && (
                    <th className="table-header w-8">
                      <input type="checkbox" className="accent-emerald-600 w-4 h-4 align-middle"
                        title={elegiveis.length === 0 ? 'Nenhum trabalhador visível tem e-mail' : 'Selecionar todos os que têm e-mail'}
                        disabled={elegiveis.length === 0} checked={todosEscolhidos} onChange={alternarTodos} />
                    </th>
                  )}
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
                    {podeEditar && (
                      <td className="table-cell w-8">
                        <input type="checkbox" className="accent-emerald-600 w-4 h-4 align-middle disabled:opacity-40"
                          title={l.email ? `Selecionar ${l.name}` : 'Sem e-mail — edita o trabalhador para o acrescentar'}
                          disabled={!l.email} checked={!!l.email && selecionados.has(l.id)} onChange={() => alternar(l.id)} />
                      </td>
                    )}
                    <td className="table-cell">
                      <Link href={`/trabalhadores/${l.id}`} prefetch={false}
                        className="font-medium text-gray-900 hover:text-emerald-600 transition-colors">
                        {l.name}
                      </Link>
                      {!l.active && <span className="ml-2 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">inativo</span>}
                      {(l.phone || l.email) && (
                        <p className="text-xs text-gray-400 mt-0.5 break-all">
                          {[l.phone, l.email].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {podeEditar && !l.email && (
                        <p className="text-xs text-gray-400 italic mt-0.5">sem e-mail — não pode receber e-mails</p>
                      )}
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
                      <div className="flex items-center justify-end gap-3">
                        {podeEditar && (
                          <button onClick={() => setEmailPara([l])} disabled={!l.email}
                            title={l.email ? `Enviar e-mail a ${l.name}` : 'Sem e-mail — edita o trabalhador para o acrescentar'}
                            className="text-gray-300 hover:text-emerald-600 disabled:hover:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex">
                            <Mail className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {podeEditar && (
                          <button onClick={() => setAEditar(l)} title="Editar dados"
                            className="text-gray-300 hover:text-blue-500 transition-colors inline-flex">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <Link href={`/trabalhadores/${l.id}`} prefetch={false}
                          className="text-gray-300 hover:text-emerald-600 transition-colors inline-flex">
                          <ChevronRight className="w-4 h-4" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {novoAberto && (
        <WorkerFormModal
          onClose={() => setNovoAberto(false)}
          onSaved={async () => { setNovoAberto(false); await carregar(true) }}
        />
      )}

      {aEditar && (
        <WorkerFormModal
          worker={aEditar}
          onClose={() => setAEditar(null)}
          onSaved={async () => { setAEditar(null); await carregar(true) }}
        />
      )}

      {emailPara && (
        <WorkerEmailModal destinatarios={emailPara} onClose={() => setEmailPara(null)} />
      )}
    </AppLayout>
  )
}
