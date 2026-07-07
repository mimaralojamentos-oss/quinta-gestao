'use client'

import { useState, useEffect } from 'react'
import { X, Mail, Send, Loader2, CheckCircle, Settings, Eye, ArrowLeft, Save } from 'lucide-react'

export interface EmailTemplate {
  label: string
  subject: string
  body: string
}

export interface EmailSettings {
  signature: string
  senderName: string
  replyTo: string
  subjectPrefix: string
  footerNote: string
}

const DEFAULT_SETTINGS: EmailSettings = {
  signature: 'Com os melhores cumprimentos,\nMiguel Severino',
  senderName: 'Miguel Severino',
  replyTo: 'miguelseverino@gmail.com',
  subjectPrefix: '',
  footerNote: '',
}

function loadSettings(): EmailSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const s = localStorage.getItem('email_settings')
    return s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : DEFAULT_SETTINGS
  } catch { return DEFAULT_SETTINGS }
}

function saveSettings(s: EmailSettings) {
  localStorage.setItem('email_settings', JSON.stringify(s))
}

function buildHtml(body: string, settings: EmailSettings, appName: string, appLocation: string) {
  const escaped = body.replace(/\n/g, '<br>')
  const footer = settings.footerNote
    ? `${settings.footerNote} · ${appLocation}`
    : `${appName} · ${appLocation}`
  return `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Arial,sans-serif">
  <div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08)">
    <div style="background:#059669;padding:24px 32px">
      <h1 style="margin:0;color:#ffffff;font-size:18px;font-weight:700">${settings.senderName}</h1>
      <p style="margin:4px 0 0;color:#a7f3d0;font-size:13px">${appLocation}</p>
    </div>
    <div style="padding:32px;color:#374151;font-size:15px;line-height:1.7">${escaped}</div>
    <div style="padding:16px 32px;background:#f3f4f6;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af">${footer}</div>
  </div>
</body></html>`
}

const DEFAULT_TEMPLATES: EmailTemplate[] = [
  {
    label: '🏠 Renda em atraso',
    subject: 'Aviso de renda em atraso',
    body: `Caro/a {nome},

Venho por este meio informar que a renda referente ao mês em curso ainda não foi liquidada.

Solicito que proceda ao pagamento o mais breve possível.

Qualquer questão, não hesite em contactar-me.`,
  },
  {
    label: '⚡ Eletricidade por pagar',
    subject: 'Aviso de despesa de eletricidade',
    body: `Caro/a {nome},

Venho por este meio informar que existe uma despesa de eletricidade em aberto referente ao seu alojamento.

Solicito que proceda ao pagamento do valor em falta.

Qualquer questão, não hesite em contactar-me.`,
  },
  {
    label: '📋 Aviso geral',
    subject: 'Informação importante',
    body: `Caro/a {nome},

`,
  },
]

interface EmailModalProps {
  tenantName: string
  tenantEmail: string | null | undefined
  spaceRef?: string
  templates?: EmailTemplate[]
  onClose: () => void
}

type Mode = 'compose' | 'preview' | 'settings' | 'sent'

export default function EmailModal({ tenantName, tenantEmail, spaceRef, templates, onClose }: EmailModalProps) {
  const allTemplates = templates ?? DEFAULT_TEMPLATES
  const [settings, setSettings] = useState<EmailSettings>(DEFAULT_SETTINGS)
  const [settingsDraft, setSettingsDraft] = useState<EmailSettings>(DEFAULT_SETTINGS)
  const [mode, setMode] = useState<Mode>('compose')

  const [to, setTo] = useState(tenantEmail ?? '')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const s = loadSettings()
    setSettings(s)
    setSettingsDraft(s)
  }, [])

  const appName = process.env.NEXT_PUBLIC_APP_NAME ?? 'Gestão de Alojamentos'
  const appLocation = process.env.NEXT_PUBLIC_APP_LOCATION ?? 'Évora'

  function applyTemplate(tpl: EmailTemplate) {
    setSubject(settings.subjectPrefix ? `${settings.subjectPrefix} ${tpl.subject}` : tpl.subject)
    const bodyWithName = tpl.body.replace(/{nome}/g, tenantName)
    setBody(settings.signature ? `${bodyWithName}\n\n${settings.signature}` : bodyWithName)
  }

  function handleSaveSettings() {
    saveSettings(settingsDraft)
    setSettings(settingsDraft)
    setMode('compose')
  }

  async function handleSend() {
    if (!to || !subject || !body) { setError('Preenche todos os campos.'); return }
    setSending(true); setError('')
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to, subject, body,
          senderName: settings.senderName,
          replyTo: settings.replyTo || undefined,
          footerNote: settings.footerNote || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? 'Erro desconhecido')
      setMode('sent')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  const previewHtml = buildHtml(body, settings, appName, appLocation)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            {mode === 'settings' ? (
              <button onClick={() => setMode('compose')} className="text-gray-400 hover:text-gray-600 mr-1">
                <ArrowLeft className="w-4 h-4" />
              </button>
            ) : mode === 'preview' ? (
              <button onClick={() => setMode('compose')} className="text-gray-400 hover:text-gray-600 mr-1">
                <ArrowLeft className="w-4 h-4" />
              </button>
            ) : null}
            <Mail className="w-5 h-5 text-emerald-600" />
            <div>
              <h2 className="font-semibold text-gray-900">
                {mode === 'settings' ? 'Definições de E-mail' : mode === 'preview' ? 'Pré-visualização' : 'Enviar E-mail'}
              </h2>
              {mode !== 'settings' && (
                <p className="text-xs text-gray-500">{tenantName}{spaceRef ? ` · ${spaceRef}` : ''}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {mode === 'compose' && (
              <button onClick={() => { setSettingsDraft(settings); setMode('settings') }}
                className="text-gray-400 hover:text-gray-600" title="Definições de e-mail">
                <Settings className="w-4 h-4" />
              </button>
            )}
            <button onClick={onClose}><X className="w-5 h-5 text-gray-400 hover:text-gray-600" /></button>
          </div>
        </div>

        {/* ── SENT ── */}
        {mode === 'sent' && (
          <div className="flex flex-col items-center justify-center py-16 px-6">
            <CheckCircle className="w-14 h-14 text-emerald-500 mb-4" />
            <p className="text-lg font-semibold text-gray-900 mb-1">E-mail enviado!</p>
            <p className="text-sm text-gray-500 mb-6">Mensagem enviada para {to}</p>
            <button onClick={onClose} className="btn-primary">Fechar</button>
          </div>
        )}

        {/* ── SETTINGS ── */}
        {mode === 'settings' && (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">

              <div>
                <label className="label">Nome do remetente</label>
                <input className="input" value={settingsDraft.senderName}
                  onChange={e => setSettingsDraft(s => ({ ...s, senderName: e.target.value }))}
                  placeholder="Miguel Severino" />
                <p className="text-xs text-gray-400 mt-1">Nome que aparece no cabeçalho do e-mail</p>
              </div>

              <div>
                <label className="label">Responder para (Reply-To)</label>
                <input className="input" type="email" value={settingsDraft.replyTo}
                  onChange={e => setSettingsDraft(s => ({ ...s, replyTo: e.target.value }))}
                  placeholder="miguelseverino@gmail.com" />
                <p className="text-xs text-gray-400 mt-1">E-mail para onde vão as respostas dos inquilinos</p>
              </div>

              <div>
                <label className="label">Prefixo do assunto</label>
                <input className="input" value={settingsDraft.subjectPrefix}
                  onChange={e => setSettingsDraft(s => ({ ...s, subjectPrefix: e.target.value }))}
                  placeholder="Ex: [Serpa Pinto]" />
                <p className="text-xs text-gray-400 mt-1">Adicionado automaticamente antes do assunto de cada e-mail</p>
              </div>

              <div>
                <label className="label">Assinatura</label>
                <textarea className="input min-h-[100px] resize-none" value={settingsDraft.signature}
                  onChange={e => setSettingsDraft(s => ({ ...s, signature: e.target.value }))}
                  placeholder={`Com os melhores cumprimentos,\nMiguel Severino`} />
                <p className="text-xs text-gray-400 mt-1">Inserida automaticamente no final de cada mensagem ao usar um modelo</p>
              </div>

              <div>
                <label className="label">Nota de rodapé do e-mail</label>
                <input className="input" value={settingsDraft.footerNote}
                  onChange={e => setSettingsDraft(s => ({ ...s, footerNote: e.target.value }))}
                  placeholder="Ex: Serpa Pinto 131A" />
                <p className="text-xs text-gray-400 mt-1">Texto no rodapé cinzento do e-mail (deixar vazio para usar o nome da app)</p>
              </div>

            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setMode('compose')} className="btn-secondary">Cancelar</button>
              <button onClick={handleSaveSettings} className="btn-primary flex items-center gap-2">
                <Save className="w-4 h-4" /> Guardar
              </button>
            </div>
          </div>
        )}

        {/* ── PREVIEW ── */}
        {mode === 'preview' && (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="overflow-y-auto flex-1">
              {/* Meta info */}
              <div className="px-6 py-3 bg-gray-50 border-b border-gray-100 text-xs text-gray-600 space-y-1">
                <div><span className="font-medium text-gray-500 w-16 inline-block">Para:</span>{to}</div>
                <div><span className="font-medium text-gray-500 w-16 inline-block">Assunto:</span>{subject}</div>
                <div><span className="font-medium text-gray-500 w-16 inline-block">De:</span>{settings.senderName} &lt;{process.env.NEXT_PUBLIC_APP_NAME ?? 'miguelseverino@gmail.com'}&gt;</div>
              </div>
              {/* Rendered HTML */}
              <div className="p-4 bg-gray-100 min-h-[300px]">
                <iframe
                  srcDoc={previewHtml}
                  className="w-full rounded-lg border border-gray-200 bg-white"
                  style={{ height: '360px' }}
                  sandbox="allow-same-origin"
                />
              </div>
              <p className="text-xs text-center text-gray-400 pb-2">Esta é a pré-visualização do e-mail tal como o destinatário o irá receber</p>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-between items-center">
              <button onClick={() => setMode('compose')} className="btn-secondary flex items-center gap-2">
                <ArrowLeft className="w-4 h-4" /> Editar
              </button>
              <button onClick={handleSend} disabled={sending}
                className="btn-primary flex items-center gap-2">
                {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> A enviar...</> : <><Send className="w-4 h-4" /> Enviar</>}
              </button>
            </div>
          </div>
        )}

        {/* ── COMPOSE ── */}
        {mode === 'compose' && (
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
                <textarea className="input min-h-[200px] resize-none font-mono text-sm" value={body}
                  onChange={e => setBody(e.target.value)}
                  placeholder="Escreve a mensagem aqui..." />
              </div>

              {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex justify-between items-center">
              <p className="text-xs text-gray-400">De: {settings.senderName}</p>
              <div className="flex gap-2">
                <button onClick={onClose} className="btn-secondary">Cancelar</button>
                <button
                  onClick={() => { setError(''); if (!to || !subject || !body) { setError('Preenche todos os campos.'); return } setMode('preview') }}
                  disabled={!to || !subject || !body}
                  className="btn-primary flex items-center gap-2">
                  <Eye className="w-4 h-4" /> Pré-visualizar
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
