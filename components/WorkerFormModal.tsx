'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { logAccess } from '@/lib/logAccess'
import { useAuth } from '@/lib/auth-context'
import {
  validarDadosTrabalhador, dadosDoTrabalhador, gerarToken, gerarPin,
  DADOS_TRABALHADOR_VAZIOS, type Worker, type DadosTrabalhadorForm,
} from '@/lib/ponto'
import {
  regenerarAcesso, confirmacaoRegeneracao, detalheLogRegeneracao, type TipoRegeneracao,
} from '@/lib/workerAccess'
import WorkerEmailModal from '@/components/WorkerEmailModal'
import { HardHat, X, KeyRound, Link2, Loader2, CheckCircle, Copy, Check, Mail } from 'lucide-react'

const supabase = createClient()

/**
 * Janela para criar ou editar um trabalhador da folha de ponto.
 *
 * Sem `worker` cria um novo (e só aí gera o link secreto e o código).
 * Com `worker` edita os dados: o update envia apenas os campos do
 * formulário, por isso o link e o código que o trabalhador já tem no
 * telemóvel continuam a funcionar.
 *
 * Regenerar o código ou o link são ações à parte, na zona "Acesso", com
 * confirmação explícita — gravam logo, independentemente do botão Guardar.
 */
export default function WorkerFormModal({ worker, onClose, onSaved, onAccessChanged }: {
  worker?: Worker
  onClose: () => void
  onSaved: () => void | Promise<void>
  /** Chamado depois de regenerar o código ou o link. */
  onAccessChanged?: () => void | Promise<void>
}) {
  const { isAdmin, isCoAdmin } = useAuth()
  const editar = !!worker
  const [form, setForm] = useState(() => worker ? dadosDoTrabalhador(worker) : DADOS_TRABALHADOR_VAZIOS)
  const [guardando, setGuardando] = useState(false)
  const [erro, setErro] = useState('')

  // Regeneração do acesso
  const [regenerando, setRegenerando] = useState<TipoRegeneracao | null>(null)
  const [erroAcesso, setErroAcesso] = useState('')
  const [novoAcesso, setNovoAcesso] = useState<{ tipo: TipoRegeneracao; access_token: string; pin: string } | null>(null)
  const [copiado, setCopiado] = useState<'link' | 'pin' | null>(null)
  const [emailAberto, setEmailAberto] = useState(false)

  const campo = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  async function guardar() {
    const v = validarDadosTrabalhador(form)
    if ('erro' in v) { setErro(v.erro); return }

    setGuardando(true); setErro('')
    const { error } = worker
      ? await supabase.from('workers').update(v.campos).eq('id', worker.id)
      : await supabase.from('workers').insert({ ...v.campos, access_token: gerarToken(), pin: gerarPin() })
    setGuardando(false)
    if (error) { setErro(`Não foi possível guardar: ${error.message}`); return }

    await logAccess({
      action: editar ? 'editar' : 'criar',
      page: '/trabalhadores',
      details: `${editar ? 'Editou' : 'Criou'} o trabalhador "${v.campos.name}"`,
    })
    await onSaved()
  }

  async function regenerar(tipo: TipoRegeneracao) {
    if (!worker) return
    if (!confirm(confirmacaoRegeneracao(tipo, worker.name))) return

    setRegenerando(tipo); setErroAcesso(''); setNovoAcesso(null)
    const r = await regenerarAcesso(supabase, worker.id, tipo)
    setRegenerando(null)
    if ('erro' in r) { setErroAcesso(`Não foi possível regenerar: ${r.erro}`); return }

    await logAccess({ action: 'editar', page: '/trabalhadores', details: detalheLogRegeneracao(tipo, worker.name) })
    setNovoAcesso({ tipo, ...r.acesso })
    await onAccessChanged?.()
  }

  async function copiar(texto: string, qual: 'link' | 'pin') {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(qual)
      setTimeout(() => setCopiado(null), 2000)
    } catch {
      alert('Não foi possível copiar. Seleciona o texto e copia à mão.')
    }
  }

  const linkNovo = novoAcesso && typeof window !== 'undefined'
    ? `${window.location.origin}/ponto/${novoAcesso.access_token}`
    : ''

  return (
    <>
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[92vh] overflow-y-auto">
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <h2 className="font-semibold text-lg text-gray-900">
              <HardHat className="w-5 h-5 inline mr-2 text-emerald-600" />
              {editar ? 'Editar trabalhador' : 'Novo Trabalhador'}
            </h2>
            <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
          </div>

          <div className="p-5 space-y-3">
            <div>
              <label className="label">Nome *</label>
              <input className="input" value={form.name} onChange={campo('name')} autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Telefone</label>
                <input className="input" type="tel" value={form.phone} onChange={campo('phone')} />
              </div>
              <div>
                <label className="label">E-mail</label>
                <input className="input" type="email" placeholder="opcional" value={form.email} onChange={campo('email')} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">NIF</label>
                <input className="input" value={form.nif} onChange={campo('nif')} />
              </div>
              <div>
                <label className="label">Telemóvel (sistema)</label>
                <select className="input" value={form.phone_os}
                  onChange={e => setForm(f => ({ ...f, phone_os: e.target.value as DadosTrabalhadorForm['phone_os'] }))}>
                  <option value="">— (por definir)</option>
                  <option value="iphone">iPhone</option>
                  <option value="android">Android</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Preço/hora (€) *</label>
                <input className="input" type="number" step="0.01" placeholder="0.00"
                  value={form.hourly_rate} onChange={campo('hourly_rate')} />
              </div>
              <div>
                <label className="label">Fim de semana e feriados (€)</label>
                <input className="input" type="number" step="0.01" placeholder="igual ao normal"
                  value={form.hourly_rate_holiday} onChange={campo('hourly_rate_holiday')} />
              </div>
            </div>
            <div>
              <label className="label">Notas</label>
              <input className="input" value={form.notes} onChange={campo('notes')} />
            </div>

            {editar && (
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer pt-1">
                <input type="checkbox" className="accent-emerald-600 w-4 h-4"
                  checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
                Trabalhador ativo
              </label>
            )}

            <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              {editar
                ? 'Alterar o preço por hora só afeta os registos novos: os dias já registados mantêm o preço com que foram registados, mesmo que sejam corrigidos. Guardar os dados não muda o link nem o código de acesso.'
                : 'Ao guardar é criado automaticamente o link secreto e o código de 4 dígitos para este trabalhador registar as horas pelo telemóvel.'}
            </p>

            {erro && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{erro}</p>}

            {/* Acesso — ações separadas e explícitas, só admin/coadmin */}
            {editar && worker && (isAdmin || isCoAdmin) && (
              <div className="border border-gray-200 rounded-lg p-3 space-y-2">
                <p className="text-sm font-semibold text-gray-900">Acesso</p>
                <p className="text-xs text-gray-500">
                  Gravam logo, sem precisar de Guardar. Usa-as se o código ou o link tiverem chegado a quem não devia.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className="btn-secondary text-sm justify-center" disabled={!!regenerando}
                    onClick={() => regenerar('codigo')}>
                    {regenerando === 'codigo' ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                    Regenerar código
                  </button>
                  <button type="button" className="btn-secondary text-sm justify-center" disabled={!!regenerando}
                    onClick={() => regenerar('link')}>
                    {regenerando === 'link' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                    Regenerar link secreto
                  </button>
                </div>

                {erroAcesso && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{erroAcesso}</p>}

                {novoAcesso && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 space-y-2">
                    <p className="text-sm text-emerald-800 font-medium flex items-center gap-1.5">
                      <CheckCircle className="w-4 h-4" />
                      {novoAcesso.tipo === 'codigo' ? 'Código novo gravado.' : 'Link novo gravado.'}
                      {' '}O antigo já não funciona.
                    </p>

                    {worker.email ? (
                      <>
                        <p className="text-xs text-emerald-800">
                          Envia os dados novos a {worker.name} &lt;{worker.email}&gt;.
                          {!worker.active && ' Atenção: está inativo, e os dados de acesso não são enviados a inativos.'}
                        </p>
                        <button type="button" className="btn-primary text-sm" onClick={() => setEmailAberto(true)}>
                          <Mail className="w-4 h-4" /> Enviar dados de acesso por e-mail
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-emerald-800">
                          Sem e-mail registado — passa-lhe os dados novos por outra via (WhatsApp, SMS...):
                        </p>
                        <div className="flex gap-2">
                          <input readOnly className="input text-xs font-mono flex-1 min-w-0" value={linkNovo} onFocus={e => e.target.select()} />
                          <button type="button" onClick={() => copiar(linkNovo, 'link')} className="btn-secondary px-3 flex-shrink-0" title="Copiar link">
                            {copiado === 'link' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                          </button>
                        </div>
                        <div className="flex gap-2 items-center">
                          <span className="text-xs text-gray-500">Código</span>
                          <input readOnly className="input text-lg font-bold tracking-widest text-center" style={{ width: '7rem' }} value={novoAcesso.pin} />
                          <button type="button" onClick={() => copiar(novoAcesso.pin, 'pin')} className="btn-secondary px-3" title="Copiar código">
                            {copiado === 'pin' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 p-4 border-t border-gray-100">
            <button className="btn-secondary" onClick={onClose}>{novoAcesso ? 'Fechar' : 'Cancelar'}</button>
            <button className="btn-primary" onClick={guardar} disabled={guardando}>
              {guardando ? 'A guardar...' : editar ? 'Guardar' : 'Criar'}
            </button>
          </div>
        </div>
      </div>

      {emailAberto && worker && (
        <WorkerEmailModal
          destinatarios={[{ id: worker.id, name: worker.name, email: worker.email, phone_os: worker.phone_os, active: worker.active }]}
          onClose={() => setEmailAberto(false)}
        />
      )}
    </>
  )
}
