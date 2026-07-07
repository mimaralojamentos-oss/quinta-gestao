'use client'

import { useState } from 'react'
import { X, Mail, Send, Loader2, CheckCircle } from 'lucide-react'

export interface EmailTemplate {
  label: string
  subject: string
  body: string
}

interface EmailModalProps {
  tenantName: string
  tenantEmail: string | null | undefined
  spaceRef?: string
  templates?: EmailTemplate[]
  onClose: () => void
}

const DEFAULT_TEMPLATES: EmailTemplate[] = [
  {
    label: '🏠 Renda em atraso',
    subject: 'Aviso de renda em atraso',
    body: `Caro/a {nome},

Venho por este meio informar que a renda referente ao mês em curso ainda não foi liquidada.

Solicito que proceda ao pagamento o mais breve possível.

Qualquer questão, não hesite em contactar-me.

Com os melhores cumprimentos,
Miguel Severino`,
  },
  {
    label: '⚡ Eletricidade por pagar',
    subject: 'Aviso de despesa de eletricidade',
    body: `Caro/a {nome},

Venho por este meio informar que existe uma despesa de eletricidade em aberto referente ao seu alojamento.

Solicito que proceda ao pagamento do valor em falta.

Qualquer questão, não hesite em contactar-me.

Com os melhores cumprimentos,
Miguel Severino`,
  },
  {
    label: '📋 Aviso geral',
    subject: 'Informação importante',
    body: `Caro/a {nome},

`,
  },
]

export default function EmailModal({ tenantName, tenantEmail, spaceRef, templates, onClose }: EmailModalProps) {
  const allTemplates = templates ?? DEFAULT_TEMPLATES
  const [to, setTo] = useState(tenantEmail ?? '')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  function applyTemplate(tpl: EmailTemplate) {
    setSubject(tpl.subject)
    setBody(tpl.body.replace(/{nome}/g, tenantName))
  }

  async function handleSend() {
    if (!to || !subject || !body) { setError('Preenche todos os campos.'); return }
    setSending(true); setError('')
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject, body }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? 'Erro desconhecido')
      setSent(true)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-emerald-600" />
            <div>
              <h2 className="font-semibold text-gray-900">Enviar E-mail</h2>
              <p className="text-xs text-gray-500">{tenantName}{spaceRef ? ` · ${spaceRef}` : ''}</p>
            </div>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400 hover:text-gray-600" /></button>
        </div>

        {sent ? (
          <div className="flex flex-col items-center justify-center py-16 px-6">
            <CheckCircle className="w-14 h-14 text-emerald-500 mb-4" />
            <p className="text-lg font-semibold text-gray-900 mb-1">E-mail enviado!</p>
            <p className="text-sm text-gray-500 mb-6">Mensagem enviada para {to}</p>
            <button onClick={onClose} className="btn-primary">Fechar</button>
          </div>
        ) : (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
              {/* Templates */}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Modelos rápidos</p>
                <div className="flex flex-wrap gap-2">
                  {allTemplates.map((tpl, i) => (
                    <button key={i} onClick={() => applyTemplate(tpl)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 transition-colors">
                      {tpl.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Para */}
              <div>
                <label className="label">Para</label>
                <input className="input" type="email" value={to} onChange={e => setTo(e.target.value)}
                  placeholder="email@exemplo.com" />
                {!tenantEmail && (
                  <p className="text-xs text-yellow-600 mt-1">⚠ Este inquilino não tem e-mail registado</p>
                )}
              </div>

              {/* Assunto */}
              <div>
                <label className="label">Assunto</label>
                <input className="input" value={subject} onChange={e => setSubject(e.target.value)}
                  placeholder="Assunto do e-mail" />
              </div>

              {/* Corpo */}
              <div>
                <label className="label">Mensagem</label>
                <textarea className="input min-h-[180px] resize-none" value={body}
                  onChange={e => setBody(e.target.value)}
                  placeholder="Escreve a mensagem aqui..." />
              </div>

              {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex justify-between items-center">
              <p className="text-xs text-gray-400">Enviado de miguelseverino@gmail.com</p>
              <div className="flex gap-2">
                <button onClick={onClose} className="btn-secondary">Cancelar</button>
                <button onClick={handleSend} disabled={sending || !to || !subject || !body}
                  className="btn-primary flex items-center gap-2">
                  {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> A enviar...</> : <><Send className="w-4 h-4" /> Enviar</>}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
