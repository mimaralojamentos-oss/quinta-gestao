'use client'

import { useEffect, useState, use } from 'react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { formatarHoras, motivoDiaEspecial, calcularHoras } from '@/lib/ponto'
import { Clock, Loader2, CheckCircle, Plus, LogOut, Smartphone, X } from 'lucide-react'

/**
 * Folha de ponto do trabalhador.
 *
 * Página independente do resto da aplicação: quem entra por aqui não vê
 * inquilinos, contas, nem sequer o menu. Vê apenas as suas horas e o que
 * tem a receber.
 *
 * O código de 4 dígitos fica guardado no telemóvel, por isso só é pedido
 * na primeira vez.
 */

/**
 * Escolha de horas com duas listas em vez da janela de relógio do Android.
 *
 * A janela nativa fica cortada em alguns telemóveis — o botão de confirmar
 * desaparece para lá da margem do ecrã. Além disso, como as horas contam
 * sempre por quartos de hora, faz sentido só oferecer 00, 15, 30 e 45.
 */
const HORAS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTOS = ['00', '15', '30', '45']

function EscolherHora({ valor, onChange, etiqueta }: {
  valor: string
  onChange: (v: string) => void
  etiqueta: string
}) {
  const [h, m] = (valor || '08:00').split(':')
  // Se vier um minuto fora dos quartos (registo antigo), encosta ao mais próximo
  const minutoValido = MINUTOS.includes(m) ? m : MINUTOS.reduce(
    (melhor, atual) => Math.abs(Number(atual) - Number(m)) < Math.abs(Number(melhor) - Number(m)) ? atual : melhor,
    '00'
  )

  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{etiqueta}</label>
      <div className="flex items-center gap-1">
        <select
          className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-2.5 text-base bg-white"
          value={h}
          onChange={e => onChange(`${e.target.value}:${minutoValido}`)}>
          {HORAS.map(x => <option key={x} value={x}>{x}</option>)}
        </select>
        <span className="text-gray-400 font-bold">:</span>
        <select
          className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-2.5 text-base bg-white"
          value={minutoValido}
          onChange={e => onChange(`${h}:${e.target.value}`)}>
          {MINUTOS.map(x => <option key={x} value={x}>{x}</option>)}
        </select>
      </div>
    </div>
  )
}

interface Dados {
  worker: { name: string; hourly_rate: number; hourly_rate_holiday: number | null }
  totalGanho: number
  totalPago: number
  saldo: number
  totalHoras: number
  entradas: any[]
  pagamentos: any[]
}

export default function PontoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const chaveGuardada = `ponto_pin_${token}`

  const [pin, setPin] = useState('')
  const [autenticado, setAutenticado] = useState(false)
  const [dados, setDados] = useState<Dados | null>(null)
  const [erro, setErro] = useState('')
  const [aCarregar, setACarregar] = useState(true)

  // Dica de instalação: só faz sentido enquanto isto correr dentro do
  // navegador. Quem já instalou não precisa de a ver.
  const [dicaFechada, setDicaFechada] = useState(false)
  const [emNavegador, setEmNavegador] = useState(false)
  useEffect(() => {
    // Fora do caminho síncrono do efeito, para não desencadear novo desenho
    // imediato do ecrã.
    const t = setTimeout(() => {
      const instalada = window.matchMedia?.('(display-mode: standalone)').matches
        || (window.navigator as any).standalone === true
      setEmNavegador(!instalada)
    }, 0)
    return () => clearTimeout(t)
  }, [])
  const podeInstalar = autenticado && emNavegador && !dicaFechada

  const [mostrarForm, setMostrarForm] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [sucesso, setSucesso] = useState(false)

  const hojeISO = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({
    work_date: hojeISO,
    start_time: '08:00',
    end_time: '17:00',
    description: '',
  })

  // Tenta entrar sozinho com o código guardado no telemóvel
  useEffect(() => {
    async function entrarAutomaticamente() {
      const guardado = typeof window !== 'undefined' ? window.localStorage.getItem(chaveGuardada) : null
      if (guardado) {
        setPin(guardado)
        await carregar(guardado)
      } else {
        setACarregar(false)
      }
    }
    entrarAutomaticamente()
  }, [])

  async function carregar(codigo: string, acao?: 'registar') {
    setErro('')
    if (acao !== 'registar') setACarregar(true)
    try {
      const res = await fetch('/api/ponto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          acao === 'registar' ? { token, pin: codigo, acao, ...form } : { token, pin: codigo }
        ),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        setErro(json.error ?? 'Não foi possível carregar.')
        if (res.status === 401) {
          setAutenticado(false)
          window.localStorage.removeItem(chaveGuardada)
        }
        return false
      }
      setDados(json)
      setAutenticado(true)
      window.localStorage.setItem(chaveGuardada, codigo)
      return true
    } catch {
      setErro('Sem ligação. Verifica a internet e tenta outra vez.')
      return false
    } finally {
      setACarregar(false)
    }
  }

  async function registar() {
    if (!form.work_date || !form.start_time || !form.end_time) {
      setErro('Preenche a data e as horas.')
      return
    }
    setGuardando(true)
    const ok = await carregar(pin, 'registar')
    setGuardando(false)
    if (ok) {
      setMostrarForm(false)
      setSucesso(true)
      setForm(f => ({ ...f, description: '' }))
      setTimeout(() => setSucesso(false), 4000)
    }
  }

  function sair() {
    window.localStorage.removeItem(chaveGuardada)
    setAutenticado(false)
    setPin('')
    setDados(null)
  }

  // ------------------------------------------------------------ código
  if (!autenticado) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="w-full max-w-xs text-center">
          <div className="w-14 h-14 bg-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Clock className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-1">Folha de Ponto</h1>
          <p className="text-sm text-gray-500 mb-6">Escreve o teu código de 4 dígitos</p>

          <input
            className="w-full text-center text-3xl tracking-[0.5em] font-bold border-2 border-gray-200 rounded-xl py-3 focus:border-emerald-500 focus:outline-none"
            type="tel"
            inputMode="numeric"
            maxLength={4}
            placeholder="••••"
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            onKeyDown={e => { if (e.key === 'Enter' && pin.length === 4) carregar(pin) }}
            autoFocus
          />

          {erro && <p className="text-sm text-red-600 mt-3">{erro}</p>}

          <button
            onClick={() => carregar(pin)}
            disabled={pin.length !== 4 || aCarregar}
            className="w-full mt-5 py-3 rounded-xl bg-emerald-600 text-white font-semibold disabled:opacity-40 transition-opacity">
            {aCarregar ? 'A entrar...' : 'Entrar'}
          </button>

          <p className="text-xs text-gray-400 mt-6">
            Se não sabes o código, fala com o gestor.
          </p>
        </div>
      </div>
    )
  }

  // ------------------------------------------------------------ ponto
  return (
    <div className="min-h-screen bg-gray-50 pb-28 overflow-x-hidden">
      <div className="bg-emerald-600 text-white px-5 pt-6 pb-8">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-emerald-100 text-xs">Folha de ponto</p>
            <h1 className="text-xl font-bold">{dados?.worker.name}</h1>
          </div>
          <button onClick={sair} className="text-emerald-100 p-1" title="Sair">
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-5 bg-white/10 rounded-xl p-4">
          <p className="text-emerald-100 text-xs mb-1">Tens a receber</p>
          <p className="text-3xl font-bold">{formatCurrency(dados?.saldo ?? 0)}</p>
          <div className="flex gap-4 mt-3 text-xs text-emerald-100">
            <span>{formatarHoras(dados?.totalHoras ?? 0)} trabalhadas</span>
            <span>Já recebeste {formatCurrency(dados?.totalPago ?? 0)}</span>
          </div>
        </div>
      </div>

      <div className="px-4 -mt-4">
        {sucesso && (
          <div className="bg-white border border-emerald-200 rounded-xl p-3 mb-3 flex items-center gap-2 shadow-sm">
            <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <p className="text-sm text-emerald-700 font-medium">Horas registadas.</p>
          </div>
        )}

        {erro && (
          <div className="bg-white border border-red-200 rounded-xl p-3 mb-3 shadow-sm">
            <p className="text-sm text-red-600">{erro}</p>
          </div>
        )}

        {mostrarForm && (
          <div className="bg-white border border-gray-100 rounded-xl p-4 mb-3 shadow-sm space-y-3">
            <h2 className="font-semibold text-gray-900">Registar horas</h2>

            <div>
              <label className="text-xs text-gray-500 block mb-1">Dia</label>
              <input type="date" max={hojeISO} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-base"
                value={form.work_date} onChange={e => setForm(f => ({ ...f, work_date: e.target.value }))} />
              {motivoDiaEspecial(form.work_date) && (
                <p className="text-xs text-amber-600 mt-1 font-medium">
                  É {motivoDiaEspecial(form.work_date)} — paga a tarifa mais alta
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <EscolherHora etiqueta="Entrada" valor={form.start_time}
                onChange={v => setForm(f => ({ ...f, start_time: v }))} />
              <EscolherHora etiqueta="Saída" valor={form.end_time}
                onChange={v => setForm(f => ({ ...f, end_time: v }))} />
            </div>

            <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm text-center">
              <span className="text-gray-500">Dá </span>
              <strong className="text-gray-900">{formatarHoras(calcularHoras(form.start_time, form.end_time))}</strong>
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">O que fizeste</label>
              <textarea rows={3} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-base"
                placeholder="ex: pintura da fachada norte"
                value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>

            <div className="flex gap-2 pt-1">
              <button className="flex-1 py-2.5 rounded-lg border border-gray-200 text-gray-600 font-medium"
                onClick={() => { setMostrarForm(false); setErro('') }}>
                Cancelar
              </button>
              <button className="flex-1 py-2.5 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-50"
                onClick={registar} disabled={guardando}>
                {guardando ? 'A guardar...' : 'Guardar'}
              </button>
            </div>
          </div>
        )}

        <h2 className="text-sm font-semibold text-gray-700 mb-2 mt-4 px-1">Os teus dias</h2>

        {aCarregar ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 text-emerald-600 animate-spin" /></div>
        ) : (dados?.entradas.length ?? 0) === 0 ? (
          <div className="bg-white border border-gray-100 rounded-xl p-8 text-center">
            <p className="text-sm text-gray-400">Ainda não registaste horas nenhumas.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {dados!.entradas.map(e => (
              <div key={e.id} className="bg-white border border-gray-100 rounded-xl p-3.5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 text-sm">
                      {formatDate(e.work_date)}
                      {e.is_holiday && <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">tarifa alta</span>}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {String(e.start_time).slice(0, 5)} às {String(e.end_time).slice(0, 5)} · {formatarHoras(e.hours)}
                    </p>
                    {e.description && <p className="text-xs text-gray-600 mt-1">{e.description}</p>}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-semibold text-gray-900 text-sm">{formatCurrency(e.amount)}</p>
                    <p className={`text-xs mt-0.5 font-medium ${
                      e.estado === 'pago' ? 'text-emerald-600'
                      : e.estado === 'parcial' ? 'text-amber-600'
                      : 'text-gray-400'
                    }`}>
                      {e.estado === 'pago' ? '✓ pago'
                        : e.estado === 'parcial' ? `falta ${formatCurrency(e.emFalta)}`
                        : 'por pagar'}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {(dados?.pagamentos.length ?? 0) > 0 && (
          <>
            <h2 className="text-sm font-semibold text-gray-700 mb-2 mt-6 px-1">O que já recebeste</h2>
            <div className="space-y-2">
              {dados!.pagamentos.map(p => (
                <div key={p.id} className="bg-white border border-gray-100 rounded-xl p-3.5 shadow-sm flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-900">{formatDate(p.payment_date)}</p>
                    {p.notes && <p className="text-xs text-gray-500 mt-0.5">{p.notes}</p>}
                  </div>
                  <p className="font-semibold text-emerald-600 text-sm">{formatCurrency(p.amount)}</p>
                </div>
              ))}
            </div>
          </>
        )}

        {podeInstalar && (
          <div className="bg-white border border-emerald-100 rounded-xl p-3.5 mt-6 shadow-sm">
            <div className="flex items-start gap-3">
              <Smartphone className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900">Põe isto no ecrã do telemóvel</p>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                  Assim entras com um toque, sem procurar o link.<br />
                  <strong>Android:</strong> menu ⋮ do Chrome → <em>Instale e crie um atalho</em>.<br />
                  <strong>iPhone:</strong> no Safari, botão de partilha → <em>Adicionar ao ecrã principal</em>.
                </p>
              </div>
              <button onClick={() => setDicaFechada(true)} className="text-gray-300 p-1 flex-shrink-0" title="Fechar">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <p className="text-xs text-gray-400 text-center mt-8 px-4">
          Para corrigir ou apagar um registo, fala com o gestor.
        </p>
      </div>

      {!mostrarForm && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-gray-50 via-gray-50">
          <button onClick={() => { setMostrarForm(true); setErro(''); setSucesso(false) }}
            className="w-full py-3.5 rounded-xl bg-emerald-600 text-white font-semibold shadow-lg flex items-center justify-center gap-2">
            <Plus className="w-5 h-5" /> Registar horas
          </button>
        </div>
      )}
    </div>
  )
}
