'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { formatCurrency, formatDate } from '@/lib/utils'
import { ehValorFixo, formatarHoras, motivoDiaEspecial, type EntradaComEstado } from '@/lib/ponto'
import {
  semanasDoMes, isoDeHoje, mesDeslocado, rotuloDoMes, DIAS_DA_SEMANA,
  coresPorTrabalhador, COR_DESCONHECIDA, nomeCurto, etiquetaEntrada,
  entradasDoMes, agruparPorDia, totaisDoMes,
} from '@/lib/pontoCalendario'
import { ChevronLeft, ChevronRight, X, CalendarDays, ChevronRight as Seta } from 'lucide-react'

/**
 * Mapa de utilização dos trabalhadores, mês a mês.
 *
 * SÓ LEITURA. Não grava nem altera nada: as entradas chegam já com as contas
 * feitas pelo `calcularConta` (o mesmo da lista e da ficha) e aqui só se
 * mostram agrupadas por dia. Para corrigir um registo, o detalhe do dia leva à
 * ficha do trabalhador, onde a edição já existe.
 *
 * Em ecrã largo é uma grelha de segunda a domingo; em ecrã estreito, onde sete
 * colunas não se leem, é uma agenda com os dias que têm registos.
 */
export default function TimesheetCalendar({ entradas, workers }: {
  entradas: EntradaComEstado[]
  workers: { id: string; name: string; active?: boolean }[]
}) {
  const hoje = isoDeHoje()
  const [ano, setAno] = useState(Number(hoje.slice(0, 4)))
  const [mes, setMes] = useState(Number(hoje.slice(5, 7)))
  /** null = todos os trabalhadores; um id = só aquele. */
  const [isolado, setIsolado] = useState<string | null>(null)
  const [diaAberto, setDiaAberto] = useState<string | null>(null)

  const nomes = useMemo(
    () => new Map((workers ?? []).map(w => [w.id, w.name])),
    [workers])
  const cores = useMemo(
    () => coresPorTrabalhador((workers ?? []).map(w => w.id)),
    [workers])
  const corDe = (id: string) => cores.get(id) ?? COR_DESCONHECIDA

  // Do mês, e depois do filtro: a grelha e o rodapé mostram sempre o mesmo.
  const doMes = useMemo(() => entradasDoMes(entradas, ano, mes), [entradas, ano, mes])
  const visiveis = useMemo(
    () => isolado ? doMes.filter(e => e.worker_id === isolado) : doMes,
    [doMes, isolado])

  const porDia = useMemo(() => agruparPorDia(visiveis), [visiveis])
  const semanas = useMemo(() => semanasDoMes(ano, mes), [ano, mes])
  const totais = useMemo(() => totaisDoMes(visiveis, nomes), [visiveis, nomes])
  // A legenda mostra quem trabalhou no mês — sem o filtro, senão desaparecia
  // tudo menos o próprio e não havia como voltar atrás.
  const naLegenda = useMemo(() => totaisDoMes(doMes, nomes).porTrabalhador, [doMes, nomes])

  const diasDaAgenda = useMemo(
    () => [...porDia.keys()].sort(),
    [porDia])

  function andar(passos: number) {
    const { ano: a, mes: m } = mesDeslocado(ano, mes, passos)
    setAno(a); setMes(m); setDiaAberto(null)
  }
  function irParaHoje() {
    setAno(Number(hoje.slice(0, 4))); setMes(Number(hoje.slice(5, 7))); setDiaAberto(null)
  }

  const noMesDeHoje = hoje.slice(0, 7) === `${ano}-${String(mes).padStart(2, '0')}`
  const entradasDoDiaAberto = diaAberto ? (porDia.get(diaAberto) ?? []) : []

  return (
    <div className="space-y-3">
      {/* Navegação do mês */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <button className="btn-secondary px-2" onClick={() => andar(-1)} title="Mês anterior">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button className="btn-secondary px-2" onClick={() => andar(1)} title="Mês seguinte">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <h2 className="font-semibold text-gray-900 first-letter:uppercase min-w-[11rem]">{rotuloDoMes(ano, mes)}</h2>
        <button className="btn-secondary text-sm" onClick={irParaHoje} disabled={noMesDeHoje}
          title={noMesDeHoje ? 'Já estás no mês de hoje' : 'Voltar ao mês de hoje'}>
          Hoje
        </button>
        <span className="text-xs text-gray-400 ml-auto">
          {totais.registos === 0 ? 'Sem registos neste mês'
            : `${totais.registos} registo(s) · ${formatarHoras(totais.horas)} · ${formatCurrency(totais.ganho)}`}
        </span>
      </div>

      {/* Legenda, que é também o filtro */}
      {naLegenda.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => setIsolado(null)}
            className={`text-xs px-2 py-1 rounded-full border transition-colors ${
              isolado === null ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
            Todos
          </button>
          {naLegenda.map(t => {
            const ligado = isolado === t.workerId
            const cor = corDe(t.workerId)
            return (
              <button key={t.workerId}
                onClick={() => setIsolado(ligado ? null : t.workerId)}
                title={ligado ? 'Mostrar todos outra vez' : `Ver só ${t.nome}`}
                className={`text-xs px-2 py-1 rounded-full border transition-colors inline-flex items-center gap-1.5 ${
                  ligado ? cor.legenda : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
                <span className={`w-2 h-2 rounded-full ${ligado ? 'bg-white/80' : cor.ponto}`} />
                {nomeCurto(t.nome)}
              </button>
            )
          })}
        </div>
      )}

      {/* ---------------------------------------------- grelha (ecrã largo) */}
      <div className="hidden md:block bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-100">
          {DIAS_DA_SEMANA.map((d, i) => (
            <div key={d} className={`px-2 py-2 text-xs uppercase tracking-wide text-center ${
              i >= 5 ? 'text-gray-400' : 'text-gray-500'}`}>{d}</div>
          ))}
        </div>
        {semanas.map((semana, i) => (
          <div key={i} className="grid grid-cols-7 border-b border-gray-100 last:border-b-0">
            {semana.map(d => {
              const doDia = porDia.get(d.iso) ?? []
              const ehHoje = d.iso === hoje
              const fundo = !d.noMes ? 'bg-gray-50/60'
                : d.feriado ? 'bg-amber-50/60'
                : d.fimDeSemana ? 'bg-gray-50'
                : 'bg-white'
              return (
                <div key={d.iso}
                  onClick={() => doDia.length > 0 && setDiaAberto(d.iso)}
                  className={`min-h-[5.5rem] border-r border-gray-100 last:border-r-0 p-1.5 align-top ${fundo} ${
                    doDia.length > 0 ? 'cursor-pointer hover:bg-emerald-50/60' : ''} ${
                    ehHoje ? 'ring-2 ring-inset ring-emerald-500' : ''}`}>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className={`text-xs ${
                      !d.noMes ? 'text-gray-300'
                      : ehHoje ? 'font-bold text-emerald-700'
                      : d.fimDeSemana || d.feriado ? 'text-gray-400'
                      : 'text-gray-500'}`}>{d.dia}</span>
                    {d.noMes && doDia.length > 2 && (
                      <span className="text-[10px] text-gray-400">{doDia.length}</span>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    {doDia.slice(0, 3).map(e => (
                      <div key={e.id}
                        title={`${nomes.get(e.worker_id) ?? '—'} · ${formatCurrency(e.amount)}${
                          ehValorFixo(e) ? ' (valor fixo)' : ` · ${String(e.start_time).slice(0, 5)}–${String(e.end_time).slice(0, 5)}`}`}
                        className={`text-[11px] leading-tight px-1.5 py-0.5 rounded border truncate ${corDe(e.worker_id).chip}`}>
                        {etiquetaEntrada(e, nomes.get(e.worker_id))}
                      </div>
                    ))}
                    {doDia.length > 3 && (
                      <div className="text-[10px] text-gray-400 px-1.5">+{doDia.length - 3} mais</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* --------------------------------------------- agenda (ecrã estreito) */}
      <div className="md:hidden space-y-2">
        {diasDaAgenda.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-xl p-8 text-center">
            <CalendarDays className="w-7 h-7 text-gray-200 mx-auto mb-2" />
            <p className="text-sm text-gray-400">Nenhum registo em {rotuloDoMes(ano, mes)}.</p>
          </div>
        ) : diasDaAgenda.map(iso => {
          const doDia = porDia.get(iso) ?? []
          const ehHoje = iso === hoje
          const motivo = motivoDiaEspecial(iso)
          return (
            <button key={iso} onClick={() => setDiaAberto(iso)}
              className={`w-full text-left bg-white border rounded-xl p-3 ${
                ehHoje ? 'border-emerald-300 ring-1 ring-emerald-200' : 'border-gray-100'}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-gray-900">
                  {formatDate(iso)}
                  {ehHoje && <span className="ml-2 text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">hoje</span>}
                  {motivo && <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">{motivo}</span>}
                </span>
                <span className="text-xs text-gray-400">
                  {formatCurrency(doDia.reduce((s, e) => s + Number(e.amount ?? 0), 0))}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {doDia.map(e => (
                  <span key={e.id} className={`text-[11px] px-1.5 py-0.5 rounded border ${corDe(e.worker_id).chip}`}>
                    {etiquetaEntrada(e, nomes.get(e.worker_id))}
                  </span>
                ))}
              </div>
            </button>
          )
        })}
      </div>

      {/* ------------------------------------------------- totais do mês */}
      {totais.porTrabalhador.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase">
                <th className="table-header">{rotuloDoMes(ano, mes)}</th>
                <th className="table-header text-right">Registos</th>
                <th className="table-header text-right">Horas</th>
                <th className="table-header text-right">Ganho</th>
                <th className="table-header text-right">Por pagar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {totais.porTrabalhador.map(t => (
                <tr key={t.workerId} className="hover:bg-gray-50">
                  <td className="table-cell">
                    <span className="inline-flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${corDe(t.workerId).ponto}`} />
                      <Link href={`/trabalhadores/${t.workerId}`} prefetch={false}
                        className="font-medium text-gray-900 hover:text-emerald-600 transition-colors">
                        {t.nome}
                      </Link>
                    </span>
                  </td>
                  <td className="table-cell text-right text-gray-500">{t.registos}</td>
                  <td className="table-cell text-right text-gray-700">{formatarHoras(t.horas)}</td>
                  <td className="table-cell text-right text-gray-700">{formatCurrency(t.ganho)}</td>
                  <td className="table-cell text-right">
                    <span className={t.porPagar > 0.005 ? 'font-semibold text-red-600' : 'text-emerald-600'}>
                      {t.porPagar > 0.005 ? formatCurrency(t.porPagar) : '✓'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-semibold text-gray-900">
                <td className="px-3 py-2.5">
                  Total{isolado ? ' (filtrado)' : ''}
                </td>
                <td className="px-3 py-2.5 text-right">{totais.registos}</td>
                <td className="px-3 py-2.5 text-right">{formatarHoras(totais.horas)}</td>
                <td className="px-3 py-2.5 text-right">{formatCurrency(totais.ganho)}</td>
                <td className="px-3 py-2.5 text-right">
                  <span className={totais.porPagar > 0.005 ? 'text-red-600' : 'text-emerald-600'}>
                    {formatCurrency(totais.porPagar)}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400">
        Os registos de valor fixo aparecem com a marca <strong>VF</strong> e não contam horas.
        O &quot;por pagar&quot; é o que falta receber destes registos, pela mesma distribuição de
        pagamentos da ficha de cada trabalhador. Esta vista não altera nada.
      </p>

      {/* --------------------------------------------- detalhe de um dia */}
      {diaAberto && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setDiaAberto(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h3 className="font-semibold text-gray-900">{formatDate(diaAberto)}</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {entradasDoDiaAberto.length} registo(s)
                  {motivoDiaEspecial(diaAberto) ? ` · ${motivoDiaEspecial(diaAberto)}` : ''}
                  {' · '}
                  {formatCurrency(entradasDoDiaAberto.reduce((s, e) => s + Number(e.amount ?? 0), 0))}
                </p>
              </div>
              <button onClick={() => setDiaAberto(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="divide-y divide-gray-50">
              {entradasDoDiaAberto.map(e => (
                <div key={e.id} className="p-4 flex items-start gap-3">
                  <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${corDe(e.worker_id).ponto}`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900">{nomes.get(e.worker_id) ?? '—'}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {ehValorFixo(e)
                        ? <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full">valor fixo</span>
                        : <>{String(e.start_time).slice(0, 5)} — {String(e.end_time).slice(0, 5)} · {formatarHoras(e.hours)} · {formatCurrency(e.hourly_rate)}/h</>}
                      {e.is_holiday && <span className="ml-1.5 bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">fds/feriado</span>}
                    </p>
                    <p className="text-sm text-gray-600 mt-1">{e.description || <span className="text-gray-300">sem descrição</span>}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-semibold text-gray-900">{formatCurrency(e.amount)}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      e.estado === 'pago' ? 'bg-emerald-100 text-emerald-700'
                      : e.estado === 'parcial' ? 'bg-amber-100 text-amber-700'
                      : 'bg-gray-100 text-gray-600'}`}>
                      {e.estado === 'pago' ? '✓ pago'
                        : e.estado === 'parcial' ? `falta ${formatCurrency(e.emFalta)}`
                        : 'por pagar'}
                    </span>
                    <Link href={`/trabalhadores/${e.worker_id}`} prefetch={false}
                      className="text-xs text-emerald-600 hover:text-emerald-700 mt-1.5 inline-flex items-center gap-0.5">
                      ficha <Seta className="w-3 h-3" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-gray-100 bg-gray-50 text-xs text-gray-500">
              Para corrigir ou apagar um registo, abre a ficha do trabalhador.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
