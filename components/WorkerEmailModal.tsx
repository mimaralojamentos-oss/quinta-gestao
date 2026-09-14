'use client'

import { useEffect, useRef, useState } from 'react'
import {
  X, Mail, Send, Loader2, CheckCircle, AlertTriangle, SpellCheck, Eye, Users, ShieldCheck,
} from 'lucide-react'
import { DEFAULT_SENDER_NAME, DEFAULT_SUBJECT_PREFIX } from '@/lib/emailConfig'
import { logAccess } from '@/lib/logAccess'
import { PHONE_OS_LABELS, type Worker } from '@/lib/ponto'
import {
  WORKER_EMAIL_TEMPLATES, MARCADORES, validarModelo, preVisualizarEmail,
  type WorkerEmailTemplate, type ResultadoEnvio,
} from '@/lib/workerEmails'

export type DestinatarioEmail = Pick<Worker, 'id' | 'name' | 'email' | 'phone_os' | 'active'>

interface Correction { original: string; corrected: string; reason: string }

/** Marcadores presentes num texto, para garantir que a revisão não os estraga. */
const assinaturaMarcadores = (t: string) => (t.match(/\{[^{}\s]{1,30}\}/g) ?? []).sort().join('|')

/**
 * Envio de e-mails a um ou vários trabalhadores da folha de ponto.
 *
 * Segue o fluxo do EmailComposer (texto editável → revisão ortográfica
 * obrigatória → enviar), mas o texto usa marcadores e é o servidor que os
 * preenche: cada trabalhador recebe um e-mail individual, só com os dados
 * dele. Esta janela nunca tem acesso ao link nem ao código.
 */
export default function WorkerEmailModal({ destinatarios, onClose }: {
  destinatarios: DestinatarioEmail[]
  onClose: () => void
}) {
  const [template, setTemplate] = useState<WorkerEmailTemplate>('acesso')
  const [subject, setSubject] = useState(WORKER_EMAIL_TEMPLATES.acesso.subject)
  const [body, setBody] = useState(WORKER_EMAIL_TEMPLATES.acesso.body)
  const [previewId, setPreviewId] = useState(destinatarios[0]?.id ?? '')

  const [reviewed, setReviewed] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [reviewNote, setReviewNote] = useState('')
  const [pending, setPending] = useState<{ subject: string; body: string; changes: Correction[] } | null>(null)

  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [resultados, setResultados] = useState<ResultadoEnvio[] | null>(null)

  const [adminEmails, setAdminEmails] = useState<string[]>([])
  const [subjectPrefix, setSubjectPrefix] = useState(DEFAULT_SUBJECT_PREFIX)
  const [configured, setConfigured] = useState(true)
  const [serverAllowsSend, setServerAllowsSend] = useState(true)

  const bodyRef = useRef<HTMLTextAreaElement>(null)

  // CC dos administradores, prefixo e permissões — o mesmo pedido do EmailComposer.
  useEffect(() => {
    async function carregar() {
      try {
        const res = await fetch('/api/send-email')
        if (!res.ok) return
        const data = await res.json()
        setAdminEmails(data.adminEmails ?? [])
        if (data.subjectPrefix) setSubjectPrefix(data.subjectPrefix)
        setConfigured(Boolean(data.configured))
        setServerAllowsSend(data.canSend !== false)
      } catch { /* não impede escrever o e-mail */ }
    }
    carregar()
  }, [])

  function invalidarRevisao() {
    setReviewed(false); setReviewNote(''); setPending(null); setError('')
  }

  function mudarTemplate(t: WorkerEmailTemplate) {
    if (t === template) return
    const original = WORKER_EMAIL_TEMPLATES[template]
    const editado = subject !== original.subject || body !== original.body
    if (editado && !confirm('Mudar de modelo substitui o texto que escreveste. Continuar?')) return
    setTemplate(t)
    setSubject(WORKER_EMAIL_TEMPLATES[t].subject)
    setBody(WORKER_EMAIL_TEMPLATES[t].body)
    invalidarRevisao()
  }

  function inserirMarcador(chave: string) {
    const el = bodyRef.current
    const ini = el?.selectionStart ?? body.length
    const fim = el?.selectionEnd ?? body.length
    setBody(body.slice(0, ini) + chave + body.slice(fim))
    invalidarRevisao()
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(ini + chave.length, ini + chave.length)
    })
  }

  const erroModelo = validarModelo(template, subject, body)
  const inativos = template === 'acesso' ? destinatarios.filter(d => !d.active) : []
  const aEnviar = destinatarios.length - inativos.length
  const destinoPreview = destinatarios.find(d => d.id === previewId) ?? destinatarios[0]
  const preview = destinoPreview
    ? preVisualizarEmail({ template, subject, body, worker: destinoPreview, senderName: DEFAULT_SENDER_NAME, subjectPrefix })
    : null
  const podeEnviar = serverAllowsSend && reviewed && !erroModelo && aEnviar > 0 && !pending

  async function rever() {
    if (erroModelo) { setError(erroModelo); return }
    setReviewing(true); setError(''); setReviewNote(''); setPending(null)
    try {
      const res = await fetch('/api/review-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setError(data.error ?? 'Erro ao rever o e-mail'); return }

      const changes: Correction[] = data.changes ?? []
      if (!data.hasErrors || changes.length === 0) {
        setReviewed(true); setReviewNote('Revisto — não foram encontrados erros.')
        return
      }
      const cs = String(data.correctedSubject ?? subject)
      const cb = String(data.correctedBody ?? body)
      if (assinaturaMarcadores(`${cs}\n${cb}`) !== assinaturaMarcadores(`${subject}\n${body}`)) {
        // A correção mexia nos marcadores — não se aplica, para não partir o envio.
        setReviewed(true)
        setReviewNote('A revisão sugeriu alterações que mexiam nos marcadores ({nome}, {link}…), por isso ficou o teu texto. Confirma a ortografia a olho.')
        return
      }
      setPending({ subject: cs, body: cb, changes })
    } catch {
      setError('Erro de ligação ao rever o e-mail.')
    } finally {
      setReviewing(false)
    }
  }

  function aplicarCorrecoes() {
    if (!pending) return
    setSubject(pending.subject); setBody(pending.body)
    setPending(null); setReviewed(true); setReviewNote('Revisto — correções aplicadas.')
  }
  function manterTexto() {
    setPending(null); setReviewed(true); setReviewNote('Revisto — mantiveste o teu texto.')
  }

  async function enviar() {
    if (!serverAllowsSend) { setError('O teu nível de acesso não permite enviar e-mails.'); return }
    if (erroModelo) { setError(erroModelo); return }
    if (!reviewed) { setError('É preciso rever a ortografia antes de enviar.'); return }
    if (!confirm(`Vão ser enviados ${aEnviar} e-mail(s) individuais — um por trabalhador, cada um só com os seus dados.\n\nContinuar?`)) return

    setSending(true); setError('')
    try {
      const res = await fetch('/api/send-worker-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerIds: destinatarios.map(d => d.id), template, subject, body }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setError(data.error ?? 'Erro ao enviar'); return }

      const r: ResultadoEnvio[] = data.resultados ?? []
      setResultados(r)
      const enviados = r.filter(x => x.status === 'enviado')
      await logAccess({
        action: 'email',
        page: '/trabalhadores',
        details: `Folha de ponto — "${WORKER_EMAIL_TEMPLATES[template].label}" enviado a ${enviados.length} de ${r.length} trabalhador(es)${enviados.length ? `: ${enviados.map(x => x.name).join(', ')}` : ''}`,
      })
    } catch {
      setError('Erro de ligação ao enviar.')
    } finally {
      setSending(false)
    }
  }

  // ── Resultado ──
  if (resultados) {
    const ok = resultados.filter(r => r.status === 'enviado').length
    return (
      <Shell onClose={onClose} title="Resultado do envio">
        <p className="text-sm text-gray-600 mb-3">
          {ok} de {resultados.length} e-mail(s) enviado(s). Ficaram todos no registo de e-mails enviados.
        </p>
        <div className="border border-gray-100 rounded-lg divide-y divide-gray-50 mb-5">
          {resultados.map(r => (
            <div key={r.workerId} className="flex items-start gap-2 px-3 py-2 text-sm">
              {r.status === 'enviado'
                ? <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                : <AlertTriangle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${r.status === 'erro' ? 'text-red-500' : 'text-amber-500'}`} />}
              <div className="min-w-0">
                <p className="text-gray-900">{r.name} <span className="text-gray-400">{r.email ? `<${r.email}>` : ''}</span></p>
                {r.status !== 'enviado' && (
                  <p className={`text-xs ${r.status === 'erro' ? 'text-red-600' : 'text-amber-600'}`}>
                    {r.status === 'erro' ? 'Falhou' : 'Não enviado'}: {r.motivo}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <button className="btn-primary" onClick={onClose}>Fechar</button>
        </div>
      </Shell>
    )
  }

  // ── Redação ──
  return (
    <Shell onClose={onClose} title="Enviar e-mail aos trabalhadores">
      {!serverAllowsSend && (
        <div className="mb-4 flex items-start gap-2 text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
          <Eye className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span><strong>Modo leitura.</strong> Podes redigir e rever, mas o teu nível de acesso não permite enviar.</span>
        </div>
      )}
      {serverAllowsSend && !configured && (
        <div className="mb-4 flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>O envio de e-mail ainda não está configurado no servidor. Podes escrever e rever, mas o envio vai falhar.</span>
        </div>
      )}

      {/* Modelo */}
      <div className="flex gap-2 mb-4">
        {(Object.keys(WORKER_EMAIL_TEMPLATES) as WorkerEmailTemplate[]).map(t => (
          <button key={t} onClick={() => mudarTemplate(t)}
            className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
              template === t ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}>
            {WORKER_EMAIL_TEMPLATES[t].label}
          </button>
        ))}
      </div>

      {/* Destinatários */}
      <div className="mb-4 text-sm space-y-1.5">
        <div className="flex gap-2">
          <span className="text-gray-400 w-10 flex-shrink-0">Para</span>
          <div className="min-w-0">
            <div className="flex flex-wrap gap-1.5">
              {destinatarios.map(d => {
                const fora = template === 'acesso' && !d.active
                return (
                  <span key={d.id} title={fora ? 'Inativo — o acesso dele está desligado, não recebe dados de acesso' : undefined}
                    className={`text-xs px-2 py-0.5 rounded-full border ${fora ? 'bg-gray-50 text-gray-400 border-gray-200 line-through' : 'bg-emerald-50 text-emerald-800 border-emerald-200'}`}>
                    {d.name} &lt;{d.email}&gt;
                    {template === 'acesso' && (
                      <span className="text-gray-400"> · {d.phone_os ? PHONE_OS_LABELS[d.phone_os] : 'sistema por definir'}</span>
                    )}
                  </span>
                )
              })}
            </div>
            <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Um e-mail individual por trabalhador — ninguém vê os outros destinatários.
            </p>
            {inativos.length > 0 && (
              <p className="text-xs text-amber-600 mt-0.5">
                {inativos.length} inativo(s) não recebe(m) os dados de acesso — o acesso deles está desligado.
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <span className="text-gray-400 w-10 flex-shrink-0">Cc</span>
          <span className="text-gray-600 flex items-center gap-1 flex-wrap text-xs">
            {template === 'acesso'
              ? 'Sem cópia — o link e o código são pessoais.'
              : <><Users className="w-3.5 h-3.5 text-gray-400" />{adminEmails.length > 0 ? adminEmails.join(', ') : 'administradores da aplicação'}</>}
          </span>
        </div>
      </div>

      {/* Assunto */}
      <div className="mb-3">
        <label className="label">Assunto</label>
        <div className="flex items-stretch">
          <span className="flex items-center px-2.5 bg-gray-100 border border-r-0 border-gray-200 rounded-l-lg text-xs font-medium text-gray-500 whitespace-nowrap">
            {subjectPrefix.trim()}
          </span>
          <input className="input rounded-l-none" value={subject} placeholder="Assunto do e-mail"
            onChange={e => { setSubject(e.target.value); invalidarRevisao() }} />
        </div>
      </div>

      {/* Corpo */}
      <div className="mb-2">
        <label className="label">Mensagem</label>
        <textarea ref={bodyRef} className="input font-normal" rows={12} value={body}
          placeholder="Escreve aqui a mensagem."
          onChange={e => { setBody(e.target.value); invalidarRevisao() }} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mb-3 text-xs">
        <span className="text-gray-400">Inserir:</span>
        {MARCADORES.filter(m => template === 'acesso' || !m.soAcesso).map(m => (
          <button key={m.chave} type="button" onClick={() => inserirMarcador(m.chave)} title={m.descricao}
            className="font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-emerald-100 hover:text-emerald-700">
            {m.chave}
          </button>
        ))}
        <span className="text-gray-400">— preenchidos com os dados de cada trabalhador no envio.</span>
      </div>

      {erroModelo && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">{erroModelo}</p>
      )}

      {/* Revisão */}
      {pending ? (
        <div className="mb-4 border border-amber-200 bg-amber-50 rounded-lg p-3">
          <p className="text-sm text-amber-900 mb-2">A revisão encontrou {pending.changes.length} correção(ões):</p>
          <div className="space-y-1.5 max-h-40 overflow-y-auto mb-3">
            {pending.changes.map((c, i) => (
              <div key={i} className="text-xs bg-white border border-amber-100 rounded px-2 py-1.5">
                <span className="text-red-600 line-through">{c.original}</span>{' → '}
                <span className="text-emerald-700 font-medium">{c.corrected}</span>
                <span className="text-gray-400"> · {c.reason}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary py-1 px-2.5 text-xs" onClick={manterTexto}>Manter o meu texto</button>
            <button className="btn-primary py-1 px-2.5 text-xs" onClick={aplicarCorrecoes}>Aplicar correções</button>
          </div>
        </div>
      ) : (
        <div className={`mb-4 flex items-center gap-2 text-xs rounded-lg px-3 py-2 ${
          reviewed ? 'text-emerald-800 bg-emerald-50 border border-emerald-200' : 'text-amber-800 bg-amber-50 border border-amber-200'
        }`}>
          {reviewed ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <SpellCheck className="w-4 h-4 flex-shrink-0" />}
          <span className="flex-1">
            {reviewed ? reviewNote : 'É preciso rever a ortografia antes de enviar. Qualquer alteração ao texto obriga a nova revisão.'}
          </span>
          {!reviewed && (
            <button className="btn-secondary py-1 px-2.5 text-xs flex-shrink-0" onClick={rever}
              disabled={reviewing || !!erroModelo}>
              {reviewing ? <><Loader2 className="w-3 h-3 animate-spin" /> A rever...</> : <><SpellCheck className="w-3 h-3" /> Rever</>}
            </button>
          )}
        </div>
      )}

      {/* Pré-visualização */}
      {preview && (
        <div className="mb-4">
          <div className="flex items-center justify-between gap-3 mb-1.5 flex-wrap">
            <label className="label mb-0 flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> Pré-visualização</label>
            {destinatarios.length > 1 && (
              <select className="input text-xs py-1" style={{ width: 'auto' }}
                value={destinoPreview?.id} onChange={e => setPreviewId(e.target.value)}>
                {destinatarios.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
          </div>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 text-xs text-gray-600 border-b border-gray-100 space-y-0.5">
              <p><span className="text-gray-400">Para:</span> {destinoPreview?.name} &lt;{preview.to}&gt;</p>
              <p className="truncate"><span className="text-gray-400">Assunto:</span> {preview.subject}</p>
            </div>
            <div className="p-4 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
              {preview.body}
            </div>
          </div>
          {template === 'acesso' && (
            <p className="text-xs text-gray-400 mt-1">
              Aqui o link e o código aparecem entre [ ]. Cada e-mail leva os verdadeiros do próprio trabalhador, preenchidos no servidor.
            </p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg mb-3">{error}</p>}

      <div className="flex justify-between">
        <button className="btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" onClick={enviar} disabled={!podeEnviar || sending}
          title={!serverAllowsSend ? 'O teu nível de acesso não permite enviar e-mails' : undefined}>
          {sending
            ? <><Loader2 className="w-4 h-4 animate-spin" /> A enviar...</>
            : <><Send className="w-4 h-4" /> Enviar {aEnviar} e-mail{aEnviar === 1 ? '' : 's'}</>}
        </button>
      </div>
    </Shell>
  )
}

function Shell({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-lg text-gray-900 flex items-center gap-2">
            <Mail className="w-5 h-5 text-emerald-600" /> {title}
          </h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
