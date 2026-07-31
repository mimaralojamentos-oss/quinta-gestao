'use client'

import { useEffect, useState } from 'react'
import {
  X, Mail, Send, Loader2, CheckCircle, Eye, ArrowLeft, Sparkles,
  AlertTriangle, SpellCheck, Users,
} from 'lucide-react'
import {
  EMAIL_CONTEXT_LABELS, applySubjectPrefix, DEFAULT_SUBJECT_PREFIX,
  type EmailContext, type EmailContextData,
} from '@/lib/emailConfig'
import { logAccess } from '@/lib/logAccess'

interface Correction {
  original: string
  corrected: string
  reason: string
}

export interface EmailComposerProps {
  /** Área da app que pediu o e-mail — determina o texto que a IA vai escrever. */
  context: EmailContext
  tenantName: string
  tenantEmail: string | null | undefined
  spaceRef?: string | null
  amount?: number | null
  periods?: string[]
  date?: string | null
  /** Nome que aparece como remetente e na assinatura. */
  senderName?: string
  onClose: () => void
  onSent?: () => void
}

type Step = 'compose' | 'review' | 'preview' | 'sent'

/**
 * Módulo único de envio de e-mails da aplicação.
 *
 * Fluxo obrigatório:
 *   1. A IA redige o e-mail com base no contexto da área que o pediu.
 *   2. O utilizador lê e pode editar.
 *   3. Qualquer edição invalida a revisão — é preciso rever de novo.
 *   4. Só depois de a revisão ortográfica estar feita é que "Enviar" fica ativo.
 *
 * TO  = inquilino.
 * CC  = todos os administradores (obtidos no servidor, não editáveis aqui).
 * Assunto = prefixo obrigatório da propriedade + assunto.
 */
export default function EmailComposer({
  context, tenantName, tenantEmail, spaceRef, amount, periods, date,
  senderName = 'Miguel Severino', onClose, onSent,
}: EmailComposerProps) {
  const [step, setStep] = useState<Step>('compose')

  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [extraNotes, setExtraNotes] = useState('')

  const [generating, setGenerating] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  // Estado da revisão: só com reviewed=true é que se pode enviar.
  const [reviewed, setReviewed] = useState(false)
  const [corrections, setCorrections] = useState<Correction[]>([])
  const [noErrorsFound, setNoErrorsFound] = useState(false)

  const [adminEmails, setAdminEmails] = useState<string[]>([])
  const [subjectPrefix, setSubjectPrefix] = useState(DEFAULT_SUBJECT_PREFIX)
  const [gmailConfigured, setGmailConfigured] = useState(true)

  // Carrega quem vai em CC e o prefixo da propriedade
  useEffect(() => {
    async function loadRecipients() {
      try {
        const res = await fetch('/api/send-email')
        if (!res.ok) return
        const data = await res.json()
        setAdminEmails(data.adminEmails ?? [])
        if (data.subjectPrefix) setSubjectPrefix(data.subjectPrefix)
        setGmailConfigured(Boolean(data.configured))
      } catch { /* silencioso — não impede escrever o e-mail */ }
    }
    loadRecipients()
  }, [])

  // Gera o e-mail assim que o modal abre
  useEffect(() => { generate() }, [])

  async function generate(notes?: string) {
    setGenerating(true); setError('')
    setReviewed(false); setCorrections([]); setNoErrorsFound(false)
    try {
      const payload: EmailContextData & { senderName: string } = {
        context, tenantName, spaceRef, amount, periods, date,
        extraNotes: notes ?? null,
        senderName,
      }
      const res = await fetch('/api/compose-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setError(data.error ?? 'Erro ao gerar o e-mail'); return }
      setSubject(data.subject)
      setBody(data.body)
    } catch {
      setError('Erro de ligação ao gerar o e-mail.')
    } finally {
      setGenerating(false)
    }
  }

  // Qualquer alteração ao texto obriga a nova revisão antes de enviar.
  function handleSubjectChange(v: string) {
    setSubject(v); setReviewed(false); setNoErrorsFound(false)
  }
  function handleBodyChange(v: string) {
    setBody(v); setReviewed(false); setNoErrorsFound(false)
  }

  async function runReview() {
    setReviewing(true); setError('')
    try {
      const res = await fetch('/api/review-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setError(data.error ?? 'Erro ao rever o e-mail'); return }

      setCorrections(data.changes ?? [])
      setNoErrorsFound(!data.hasErrors || (data.changes ?? []).length === 0)

      if (data.hasErrors && (data.changes ?? []).length > 0) {
        // Mostra as correções para o utilizador aceitar
        setStep('review')
        // Guarda o texto corrigido para aplicar se aceitar
        setPendingCorrection({ subject: data.correctedSubject, body: data.correctedBody })
      } else {
        // Sem erros — fica revisto e pronto a enviar
        setReviewed(true)
      }
    } catch {
      setError('Erro de ligação ao rever o e-mail.')
    } finally {
      setReviewing(false)
    }
  }

  const [pendingCorrection, setPendingCorrection] = useState<{ subject: string; body: string } | null>(null)

  function acceptCorrections() {
    if (pendingCorrection) {
      setSubject(pendingCorrection.subject)
      setBody(pendingCorrection.body)
    }
    setPendingCorrection(null)
    setReviewed(true)
    setStep('compose')
  }

  function rejectCorrections() {
    // O utilizador prefere manter o texto dele — considera-se revisto na mesma,
    // porque a verificação foi feita e ele tomou uma decisão informada.
    setPendingCorrection(null)
    setReviewed(true)
    setStep('compose')
  }

  async function handleSend() {
    if (!tenantEmail) { setError('Este inquilino não tem e-mail registado.'); return }
    if (!reviewed) { setError('É preciso rever a ortografia antes de enviar.'); return }
    setSending(true); setError('')
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: tenantEmail,
          subject,               // o prefixo é aplicado no servidor
          body: `${body}\n\nCom os melhores cumprimentos,\n${senderName}`,
          senderName,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setError(data.error ?? 'Erro ao enviar'); return }

      await logAccess({
        action: 'email',
        page: '/email',
        details: `E-mail "${data.subject}" enviado a ${tenantName} <${tenantEmail}>`,
      })

      setStep('sent')
      onSent?.()
    } catch {
      setError('Erro de ligação ao enviar o e-mail.')
    } finally {
      setSending(false)
    }
  }

  const finalSubject = applySubjectPrefix(subject, subjectPrefix)
  const canSend = reviewed && !!tenantEmail && !!body.trim() && !!subject.trim()

  // ── Ecrã: enviado ──
  if (step === 'sent') {
    return (
      <Shell onClose={onClose} title="E-mail enviado">
        <div className="text-center py-8">
          <CheckCircle className="w-14 h-14 text-emerald-500 mx-auto mb-3" />
          <p className="font-medium text-gray-900">E-mail enviado com sucesso</p>
          <p className="text-sm text-gray-500 mt-1">Para {tenantName} &lt;{tenantEmail}&gt;</p>
          {adminEmails.length > 0 && (
            <p className="text-xs text-gray-400 mt-1">Com cópia para {adminEmails.length} administrador(es)</p>
          )}
        </div>
        <div className="flex justify-end">
          <button className="btn-primary" onClick={onClose}>Fechar</button>
        </div>
      </Shell>
    )
  }

  // ── Ecrã: correções propostas ──
  if (step === 'review') {
    return (
      <Shell onClose={onClose} title="Revisão ortográfica">
        <p className="text-sm text-gray-600 mb-4">
          Foram encontradas <strong>{corrections.length}</strong> correção(ões). Revê e decide:
        </p>
        <div className="space-y-2 max-h-72 overflow-y-auto mb-4">
          {corrections.map((c, i) => (
            <div key={i} className="border border-gray-200 rounded-lg p-3 text-sm">
              <p className="text-xs text-gray-500 mb-1">{c.reason}</p>
              <p className="text-red-600 line-through">{c.original}</p>
              <p className="text-emerald-700 font-medium">{c.corrected}</p>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={rejectCorrections}>Manter o meu texto</button>
          <button className="btn-primary" onClick={acceptCorrections}>
            <CheckCircle className="w-4 h-4" /> Aplicar correções
          </button>
        </div>
      </Shell>
    )
  }

  // ── Ecrã: pré-visualização ──
  if (step === 'preview') {
    return (
      <Shell onClose={onClose} title="Pré-visualização">
        <div className="border border-gray-200 rounded-lg overflow-hidden mb-4">
          <div className="bg-emerald-600 px-6 py-4">
            <p className="text-white font-bold text-sm">{senderName}</p>
          </div>
          <div className="p-6 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
            {body}
            {'\n\n'}Com os melhores cumprimentos,{'\n'}{senderName}
          </div>
        </div>
        <div className="flex justify-between">
          <button className="btn-secondary" onClick={() => setStep('compose')}>
            <ArrowLeft className="w-4 h-4" /> Voltar
          </button>
          <button className="btn-primary" onClick={handleSend} disabled={!canSend || sending}>
            {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> A enviar...</> : <><Send className="w-4 h-4" /> Enviar</>}
          </button>
        </div>
      </Shell>
    )
  }

  // ── Ecrã principal: redação ──
  return (
    <Shell onClose={onClose} title="Enviar e-mail">
      {!gmailConfigured && (
        <div className="mb-4 flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>O envio de e-mail ainda não está configurado no servidor (falta a conta Gmail). Podes escrever e rever, mas o envio vai falhar.</span>
        </div>
      )}

      {/* Destinatários */}
      <div className="mb-4 space-y-1.5 text-sm">
        <div className="flex gap-2">
          <span className="text-gray-400 w-10 flex-shrink-0">Para</span>
          <span className={tenantEmail ? 'text-gray-900' : 'text-red-600'}>
            {tenantEmail ? `${tenantName} <${tenantEmail}>` : `${tenantName} — sem e-mail registado`}
          </span>
        </div>
        <div className="flex gap-2">
          <span className="text-gray-400 w-10 flex-shrink-0">Cc</span>
          <span className="text-gray-600 flex items-center gap-1 flex-wrap">
            <Users className="w-3.5 h-3.5 text-gray-400" />
            {adminEmails.length > 0
              ? adminEmails.join(', ')
              : <span className="text-gray-400">administradores da aplicação</span>}
          </span>
        </div>
      </div>

      {/* Assunto com prefixo obrigatório */}
      <div className="mb-3">
        <label className="label">Assunto</label>
        <div className="flex items-stretch">
          <span className="flex items-center px-2.5 bg-gray-100 border border-r-0 border-gray-200 rounded-l-lg text-xs font-medium text-gray-500 whitespace-nowrap">
            {subjectPrefix.trim()}
          </span>
          <input
            className="input rounded-l-none"
            value={subject}
            placeholder={generating ? 'A gerar...' : 'Assunto do e-mail'}
            onChange={e => handleSubjectChange(e.target.value)}
          />
        </div>
      </div>

      {/* Corpo */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <label className="label mb-0">
            Mensagem
            <span className="ml-2 text-xs font-normal text-gray-400">{EMAIL_CONTEXT_LABELS[context]}</span>
          </label>
          <button
            className="text-xs text-emerald-600 hover:underline disabled:text-gray-300 flex items-center gap-1"
            onClick={() => generate(extraNotes)}
            disabled={generating}
          >
            <Sparkles className="w-3 h-3" /> {generating ? 'A gerar...' : 'Gerar de novo'}
          </button>
        </div>
        {generating ? (
          <div className="border border-gray-200 rounded-lg p-8 flex flex-col items-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
            A escrever o e-mail com base nos dados do inquilino...
          </div>
        ) : (
          <textarea
            className="input font-normal"
            rows={10}
            value={body}
            onChange={e => handleBodyChange(e.target.value)}
          />
        )}
      </div>

      {/* Instruções para a IA */}
      <div className="mb-3">
        <label className="label">Instruções para reescrever <span className="font-normal text-gray-400">(opcional)</span></label>
        <input
          className="input text-sm"
          placeholder="ex: mais curto e mais firme; mencionar que é o segundo aviso"
          value={extraNotes}
          onChange={e => setExtraNotes(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && extraNotes.trim()) generate(extraNotes) }}
        />
      </div>

      {/* Estado da revisão */}
      <div className={`mb-4 flex items-center gap-2 text-xs rounded-lg px-3 py-2 ${
        reviewed
          ? 'text-emerald-800 bg-emerald-50 border border-emerald-200'
          : 'text-amber-800 bg-amber-50 border border-amber-200'
      }`}>
        {reviewed ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <SpellCheck className="w-4 h-4 flex-shrink-0" />}
        <span className="flex-1">
          {reviewed
            ? (noErrorsFound ? 'Revisto — não foram encontrados erros.' : 'Revisto — podes enviar.')
            : 'É preciso rever a ortografia antes de enviar. Qualquer alteração ao texto obriga a nova revisão.'}
        </span>
        {!reviewed && (
          <button
            className="btn-secondary py-1 px-2.5 text-xs flex-shrink-0"
            onClick={runReview}
            disabled={reviewing || generating || !body.trim()}
          >
            {reviewing ? <><Loader2 className="w-3 h-3 animate-spin" /> A rever...</> : <><SpellCheck className="w-3 h-3" /> Rever</>}
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg mb-3">{error}</p>}

      <p className="text-xs text-gray-400 mb-4 truncate">
        Assunto final: <span className="font-mono">{finalSubject}</span>
      </p>

      <div className="flex justify-between">
        <button className="btn-secondary" onClick={onClose}>Cancelar</button>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setStep('preview')} disabled={!body.trim()}>
            <Eye className="w-4 h-4" /> Pré-visualizar
          </button>
          <button className="btn-primary" onClick={handleSend} disabled={!canSend || sending}>
            {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> A enviar...</> : <><Send className="w-4 h-4" /> Enviar</>}
          </button>
        </div>
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
