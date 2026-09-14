'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { logAccess } from '@/lib/logAccess'
import {
  validarDadosTrabalhador, dadosDoTrabalhador, gerarToken, gerarPin,
  DADOS_TRABALHADOR_VAZIOS, type Worker,
} from '@/lib/ponto'
import { HardHat, X } from 'lucide-react'

const supabase = createClient()

/**
 * Janela para criar ou editar um trabalhador da folha de ponto.
 *
 * Sem `worker` cria um novo (e só aí gera o link secreto e o código).
 * Com `worker` edita os dados: o update envia apenas os campos do
 * formulário, por isso o link e o código que o trabalhador já tem no
 * telemóvel continuam a funcionar.
 */
export default function WorkerFormModal({ worker, onClose, onSaved }: {
  worker?: Worker
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const editar = !!worker
  const [form, setForm] = useState(() => worker ? dadosDoTrabalhador(worker) : DADOS_TRABALHADOR_VAZIOS)
  const [guardando, setGuardando] = useState(false)
  const [erro, setErro] = useState('')

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

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
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
          <div>
            <label className="label">NIF</label>
            <input className="input" value={form.nif} onChange={campo('nif')} />
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
              ? 'Alterar o preço por hora só afeta os registos novos: os dias já registados mantêm o preço com que foram registados, mesmo que sejam corrigidos. O link e o código de acesso do trabalhador não mudam.'
              : 'Ao guardar é criado automaticamente o link secreto e o código de 4 dígitos para este trabalhador registar as horas pelo telemóvel.'}
          </p>

          {erro && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{erro}</p>}
        </div>

        <div className="flex justify-end gap-3 p-4 border-t border-gray-100">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={guardar} disabled={guardando}>
            {guardando ? 'A guardar...' : editar ? 'Guardar' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  )
}
