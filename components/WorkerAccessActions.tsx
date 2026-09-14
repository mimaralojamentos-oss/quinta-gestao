'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { logAccess } from '@/lib/logAccess'
import { useAuth } from '@/lib/auth-context'
import type { Worker } from '@/lib/ponto'
import {
  regenerarAcesso, confirmacaoRegeneracao, detalheLogRegeneracao, type TipoRegeneracao,
} from '@/lib/workerAccess'
import WorkerEmailModal from '@/components/WorkerEmailModal'
import { KeyRound, Link2, Loader2, CheckCircle, Copy, Check, Mail } from 'lucide-react'

const supabase = createClient()

/**
 * Único caminho para regenerar o acesso de um trabalhador à folha de ponto:
 * "Regenerar código" e "Regenerar link secreto", cada um com confirmação do
 * efeito real (ver lib/workerAccess.ts). Usado na janela de edição e na ficha.
 *
 * Depois de regenerar oferece o envio dos dados por e-mail; sem e-mail,
 * mostra o link e o código novos para passar por outra via.
 * Só aparece a admin/coadmin.
 */
export default function WorkerAccessActions({ worker, onChanged }: {
  worker: Pick<Worker, 'id' | 'name' | 'email' | 'phone_os' | 'active'>
  /** Chamado depois de regenerar (ex.: recarregar a ficha). */
  onChanged?: () => void | Promise<void>
}) {
  const { isAdmin, isCoAdmin } = useAuth()
  const [regenerando, setRegenerando] = useState<TipoRegeneracao | null>(null)
  const [erro, setErro] = useState('')
  const [novoAcesso, setNovoAcesso] = useState<{ tipo: TipoRegeneracao; access_token: string; pin: string } | null>(null)
  const [copiado, setCopiado] = useState<'link' | 'pin' | null>(null)
  const [emailAberto, setEmailAberto] = useState(false)

  if (!isAdmin && !isCoAdmin) return null

  async function regenerar(tipo: TipoRegeneracao) {
    if (!confirm(confirmacaoRegeneracao(tipo, worker.name))) return

    setRegenerando(tipo); setErro(''); setNovoAcesso(null)
    const r = await regenerarAcesso(supabase, worker.id, tipo)
    setRegenerando(null)
    if ('erro' in r) { setErro(`Não foi possível regenerar: ${r.erro}`); return }

    await logAccess({ action: 'editar', page: '/trabalhadores', details: detalheLogRegeneracao(tipo, worker.name) })
    setNovoAcesso({ tipo, ...r.acesso })
    await onChanged?.()
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
    <div className="space-y-2">
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

      {erro && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{erro}</p>}

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

      {emailAberto && (
        <WorkerEmailModal
          destinatarios={[{ id: worker.id, name: worker.name, email: worker.email, phone_os: worker.phone_os, active: worker.active }]}
          onClose={() => setEmailAberto(false)}
        />
      )}
    </div>
  )
}
