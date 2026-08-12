'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatDateTime, normalizeText } from '@/lib/utils'
import { useAuth } from '@/lib/auth-context'
import { Mail, Search, X, ChevronLeft, AlertTriangle, CheckCircle } from 'lucide-react'
import Link from 'next/link'

interface SentEmail {
  id: string
  sent_at: string
  sent_by_email: string | null
  to_email: string
  to_name: string | null
  cc_emails: string | null
  subject: string
  body: string
  context: string | null
  status: string
  error_message: string | null
}

type Filtro = 'todos' | 'enviado' | 'erro'

export default function EmailsEnviadosPage() {
  const supabase = createClient()
  const { profile } = useAuth()
  const podeVer = ['admin', 'coadmin', 'super_reader'].includes(profile?.role ?? '')

  const [emails, setEmails] = useState<SentEmail[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [pesquisa, setPesquisa] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [aberto, setAberto] = useState<SentEmail | null>(null)

  useEffect(() => {
    async function carregar() {
      if (!podeVer) { setLoading(false); return }
      const { data, error } = await supabase
        .from('sent_emails')
        .select('*')
        .order('sent_at', { ascending: false })
        .limit(500)
      if (error) setErro(error.message)
      setEmails(data ?? [])
      setLoading(false)
    }
    carregar()
  }, [podeVer])

  const q = normalizeText(pesquisa)
  const visiveis = emails
    .filter(e => filtro === 'todos' || e.status === filtro)
    .filter(e => !q ||
      normalizeText(e.subject).includes(q) ||
      normalizeText(e.to_email).includes(q) ||
      normalizeText(e.to_name).includes(q) ||
      normalizeText(e.body).includes(q))

  const totalErros = emails.filter(e => e.status === 'erro').length

  if (!podeVer) {
    return (
      <AppLayout>
        <p className="text-gray-500">Não tens permissão para ver o histórico de e-mails.</p>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <Link href="/extras" prefetch={false}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-emerald-600 mb-3 transition-colors">
        <ChevronLeft className="w-4 h-4" /> Extras
      </Link>

      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">E-mails Enviados</h1>
          <p className="text-gray-500 text-sm mt-1">
            Tudo o que a aplicação enviou, com o texto original. Clica numa linha para ler.
          </p>
        </div>
        <div className="flex gap-2">
          {(['todos', 'enviado', 'erro'] as Filtro[]).map(f => (
            <button key={f} onClick={() => setFiltro(f)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                filtro === f ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}>
              {f === 'todos' ? 'Todos' : f === 'enviado' ? 'Enviados' : `Com erro${totalErros > 0 ? ` (${totalErros})` : ''}`}
            </button>
          ))}
        </div>
      </div>

      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input className="input pl-9" placeholder="Pesquisar por assunto, destinatário ou texto..."
          value={pesquisa} onChange={e => setPesquisa(e.target.value)} />
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
          <Mail className="w-8 h-8 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">
            {emails.length === 0
              ? 'Ainda não há e-mails registados. A partir de agora, todos os que enviares aparecem aqui.'
              : 'Nenhum e-mail corresponde a esta pesquisa.'}
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="divide-y divide-gray-50">
            {visiveis.map(e => (
              <button key={e.id} onClick={() => setAberto(e)}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-start gap-3">
                <div className="mt-0.5 flex-shrink-0">
                  {e.status === 'erro'
                    ? <AlertTriangle className="w-4 h-4 text-red-500" />
                    : <CheckCircle className="w-4 h-4 text-emerald-500" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{e.subject}</p>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    Para {e.to_name ? `${e.to_name} <${e.to_email}>` : e.to_email}
                    {e.sent_by_email ? ` · enviado por ${e.sent_by_email}` : ''}
                  </p>
                  {e.status === 'erro' && e.error_message && (
                    <p className="text-xs text-red-600 mt-0.5 truncate">Falhou: {e.error_message}</p>
                  )}
                </div>
                <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">{formatDateTime(e.sent_at)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {visiveis.length > 0 && (
        <p className="text-xs text-gray-400 mt-2">
          A mostrar {visiveis.length} de {emails.length} e-mail(s) — os 500 mais recentes
        </p>
      )}

      {aberto && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-start justify-between gap-4 p-5 border-b border-gray-100">
              <div className="min-w-0">
                <h2 className="font-semibold text-gray-900">{aberto.subject}</h2>
                <p className="text-xs text-gray-500 mt-1">{formatDateTime(aberto.sent_at)}</p>
              </div>
              <button onClick={() => setAberto(null)} className="flex-shrink-0">
                <X className="w-5 h-5 text-gray-400 hover:text-gray-600" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-3">
              <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                <p><span className="text-gray-500">Para:</span> {aberto.to_name ? `${aberto.to_name} <${aberto.to_email}>` : aberto.to_email}</p>
                {aberto.cc_emails && <p><span className="text-gray-500">CC:</span> {aberto.cc_emails}</p>}
                {aberto.sent_by_email && <p><span className="text-gray-500">Enviado por:</span> {aberto.sent_by_email}</p>}
                <p>
                  <span className="text-gray-500">Estado:</span>{' '}
                  {aberto.status === 'erro'
                    ? <span className="text-red-600 font-medium">Falhou — {aberto.error_message}</span>
                    : <span className="text-emerald-600 font-medium">Enviado</span>}
                </p>
              </div>

              <div className="border border-gray-100 rounded-lg p-4">
                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{aberto.body}</p>
              </div>
            </div>

            <div className="p-4 border-t border-gray-100 flex justify-end">
              <button className="btn-secondary" onClick={() => setAberto(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
