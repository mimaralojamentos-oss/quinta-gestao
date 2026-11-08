'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { logAccess } from '@/lib/logAccess'
import { useAuth } from '@/lib/auth-context'
import { emailValido } from '@/lib/ponto'
import { PERIODICIDADES, type AlertRecipient, type Periodicidade } from '@/lib/timesheetAlerts'
import { X, Plus, Trash2, Bell, Loader2 } from 'lucide-react'

const supabase = createClient()

/**
 * Quem é avisado por e-mail das entradas da Folha de Ponto, e com que
 * frequência. Só admin/coadmin, como o resto do backoffice da folha.
 *
 * A lista vive em timesheet_alert_recipients. Enquanto a migração não
 * estiver aplicada nas duas bases, a janela diz-o em vez de dar um erro
 * seco de base de dados.
 */
export default function TimesheetAlertsModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth()
  const [lista, setLista] = useState<AlertRecipient[]>([])
  const [carregando, setCarregando] = useState(true)
  const [semTabela, setSemTabela] = useState(false)
  const [erro, setErro] = useState('')
  const [guardando, setGuardando] = useState(false)

  const [novoEmail, setNovoEmail] = useState('')
  const [novasPeriodicidades, setNovasPeriodicidades] = useState<Periodicidade[]>(['diario'])

  async function carregar() {
    setCarregando(true)
    const { data, error } = await supabase
      .from('timesheet_alert_recipients')
      .select('id, email, imediato, diario, semanal, mensal, active')
      .order('email')

    if (error) {
      // 42P01 / PGRST205: a tabela ainda não existe nesta base.
      setSemTabela(error.code === '42P01' || error.code === 'PGRST205' || /does not exist/i.test(error.message))
      if (!(error.code === '42P01' || error.code === 'PGRST205')) setErro(error.message)
    } else {
      setLista(data ?? [])
      setSemTabela(false)
    }
    setCarregando(false)
  }

  useEffect(() => { carregar() }, [])

  function alternarNova(p: Periodicidade) {
    setNovasPeriodicidades(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])
  }

  async function adicionar() {
    const email = novoEmail.trim().toLowerCase()
    if (!emailValido(email)) { setErro('Escreve um e-mail válido.'); return }
    if (novasPeriodicidades.length === 0) { setErro('Escolhe pelo menos uma periodicidade.'); return }

    setGuardando(true); setErro('')
    const { error } = await supabase.from('timesheet_alert_recipients').insert({
      email,
      imediato: novasPeriodicidades.includes('imediato'),
      diario: novasPeriodicidades.includes('diario'),
      semanal: novasPeriodicidades.includes('semanal'),
      mensal: novasPeriodicidades.includes('mensal'),
      created_by: user?.email ?? null,
    })
    setGuardando(false)

    if (error) {
      setErro(error.message.includes('duplicate') || error.message.includes('_email_key')
        ? 'Este e-mail já está na lista.'
        : error.message)
      return
    }

    await logAccess({
      action: 'criar', page: '/trabalhadores',
      details: `Juntou ${email} aos alertas da Folha de Ponto (${novasPeriodicidades.join(', ')})`,
    })
    setNovoEmail(''); setNovasPeriodicidades(['diario'])
    await carregar()
  }

  async function alternarPeriodicidade(r: AlertRecipient, p: Periodicidade) {
    const novo = { ...r, [p]: !r[p] } as AlertRecipient
    if (!novo.imediato && !novo.diario && !novo.semanal && !novo.mensal) {
      setErro('Cada destinatário tem de ter pelo menos uma periodicidade. Para o calar, desativa-o.')
      return
    }
    setErro('')
    const { error } = await supabase.from('timesheet_alert_recipients').update({ [p]: novo[p] }).eq('id', r.id)
    if (error) { setErro(error.message); return }
    await logAccess({
      action: 'editar', page: '/trabalhadores',
      details: `${novo[p] ? 'Ligou' : 'Desligou'} o alerta ${p} de ${r.email} na Folha de Ponto`,
    })
    await carregar()
  }

  async function alternarAtivo(r: AlertRecipient) {
    const { error } = await supabase.from('timesheet_alert_recipients').update({ active: !r.active }).eq('id', r.id)
    if (error) { setErro(error.message); return }
    await logAccess({
      action: 'editar', page: '/trabalhadores',
      details: `${r.active ? 'Desativou' : 'Reativou'} os alertas da Folha de Ponto de ${r.email}`,
    })
    await carregar()
  }

  async function remover(r: AlertRecipient) {
    if (!confirm(`Remover ${r.email} dos alertas da Folha de Ponto?\n\nDeixa de receber qualquer aviso. O histórico de e-mails enviados fica.`)) return
    const { error } = await supabase.from('timesheet_alert_recipients').delete().eq('id', r.id)
    if (error) { setErro(error.message); return }
    await logAccess({
      action: 'apagar', page: '/trabalhadores',
      details: `Removeu ${r.email} dos alertas da Folha de Ponto`,
    })
    await carregar()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="font-semibold text-lg text-gray-900 flex items-center gap-2">
              <Bell className="w-5 h-5 text-amber-500" /> Alertas da Folha de Ponto
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Quem é avisado por e-mail dos registos de horas, e com que frequência
            </p>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="p-5 space-y-5">
          {semTabela ? (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-4 py-3">
              As tabelas dos alertas ainda não existem nesta base de dados. Corre o
              <strong> supabase-timesheet-alerts.sql</strong> e volta a abrir esta janela.
            </p>
          ) : (
            <>
              {/* Juntar destinatário */}
              <div className="bg-gray-50 border border-gray-100 rounded-lg p-4 space-y-3">
                <p className="text-sm font-medium text-gray-800">Juntar destinatário</p>
                <input className="input" type="email" placeholder="email@exemplo.com"
                  value={novoEmail} onChange={e => setNovoEmail(e.target.value)} />
                <div className="space-y-1.5">
                  {PERIODICIDADES.map(p => (
                    <label key={p.valor} className="flex items-start gap-2 cursor-pointer">
                      <input type="checkbox" className="accent-emerald-600 w-3.5 h-3.5 mt-0.5 flex-shrink-0"
                        checked={novasPeriodicidades.includes(p.valor)}
                        onChange={() => alternarNova(p.valor)} />
                      <span className="text-sm text-gray-700">
                        {p.label}
                        <span className="block text-xs text-gray-400">{p.descricao}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <button className="btn-primary text-sm" onClick={adicionar} disabled={guardando || !novoEmail.trim()}>
                  {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Juntar
                </button>
              </div>

              {/* Lista */}
              {carregando ? (
                <p className="text-sm text-gray-500">A carregar...</p>
              ) : lista.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-6">
                  Ninguém está a ser avisado. Junta um e-mail acima.
                </p>
              ) : (
                <div className="border border-gray-100 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase">
                        <th className="px-3 py-2">E-mail</th>
                        {PERIODICIDADES.map(p => (
                          <th key={p.valor} className="px-2 py-2 text-center" title={p.descricao}>
                            {p.label.replace('mente', '.')}
                          </th>
                        ))}
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {lista.map(r => (
                        <tr key={r.id} className={r.active ? '' : 'bg-gray-50/60 text-gray-400'}>
                          <td className="px-3 py-2">
                            <span className={r.active ? 'text-gray-800' : 'line-through'}>{r.email}</span>
                            {!r.active && <span className="block text-[11px] text-gray-400">desativado</span>}
                          </td>
                          {PERIODICIDADES.map(p => (
                            <td key={p.valor} className="px-2 py-2 text-center">
                              <input type="checkbox" className="accent-emerald-600 w-4 h-4 cursor-pointer"
                                checked={!!r[p.valor]} disabled={!r.active}
                                onChange={() => alternarPeriodicidade(r, p.valor)} />
                            </td>
                          ))}
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            <button onClick={() => alternarAtivo(r)}
                              className="text-xs text-gray-500 hover:text-emerald-600 mr-2">
                              {r.active ? 'desativar' : 'reativar'}
                            </button>
                            <button onClick={() => remover(r)} className="text-gray-300 hover:text-red-500"
                              title="Remover da lista">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="text-xs text-gray-400">
                Sem registos no período não há e-mail — em nenhuma das periodicidades.
                Os resumos saem às 9h (dia anterior), sexta às 20h (semana) e no último
                dia do mês às 20h (mês). As horas são do fuso do servidor (UTC), por isso
                no verão saem uma hora mais tarde.
              </p>
            </>
          )}

          {erro && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{erro}</p>}
        </div>

        <div className="flex justify-end p-4 border-t border-gray-100">
          <button className="btn-secondary" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  )
}
