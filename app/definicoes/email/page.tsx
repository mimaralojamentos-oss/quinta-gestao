'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import Link from 'next/link'
import {
  Mail, ChevronLeft, Loader2, CheckCircle, AlertTriangle, Send, Save, Eye, EyeOff,
} from 'lucide-react'

interface PublicSettings {
  smtpHost: string
  smtpPort: number
  smtpUser: string
  fromEmail: string
  fromName: string
  replyTo: string | null
  subjectPrefix: string
  passwordSet: boolean
  source: string
  configured: boolean
}

// Configurações prontas dos fornecedores mais comuns, para não ser preciso
// procurar os dados do servidor de envio.
const PRESETS = [
  { label: 'Gmail / Google Workspace', host: 'smtp.gmail.com', port: 587, nota: 'Precisa de uma palavra-passe de aplicação (não a palavra-passe normal) e de verificação em duas etapas ativa.' },
  { label: 'Resend', host: 'smtp.resend.com', port: 587, nota: 'Utilizador: resend · Palavra-passe: a chave de API. Permite enviar de noreply@teudominio depois de verificares o domínio.' },
  { label: 'Brevo (ex-Sendinblue)', host: 'smtp-relay.brevo.com', port: 587, nota: 'Utilizador e chave SMTP são fornecidos no painel da Brevo.' },
  { label: 'Mailgun', host: 'smtp.mailgun.org', port: 587, nota: 'Utilizador e palavra-passe SMTP estão no painel do domínio.' },
]

export default function DefinicoesEmailPage() {
  const { profile, loading: authLoading } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [okMessage, setOkMessage] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [current, setCurrent] = useState<PublicSettings | null>(null)

  const [form, setForm] = useState({
    smtpHost: '', smtpPort: 587, smtpUser: '', smtpPassword: '',
    fromEmail: '', fromName: '', replyTo: '', subjectPrefix: '',
  })

  useEffect(() => { load() }, [])

  async function load() {
    try {
      const res = await fetch('/api/email-settings')
      if (!res.ok) { setLoading(false); return }
      const data = await res.json()
      const s: PublicSettings = data.settings
      setCurrent(s)
      setForm({
        smtpHost: s.smtpHost || '',
        smtpPort: s.smtpPort || 587,
        smtpUser: s.smtpUser || '',
        smtpPassword: '',
        fromEmail: s.fromEmail || '',
        fromName: s.fromName || '',
        replyTo: s.replyTo || '',
        subjectPrefix: s.subjectPrefix || '',
      })
    } catch {
      setError('Não foi possível carregar as definições.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    setSaving(true); setError(''); setOkMessage('')
    try {
      const res = await fetch('/api/email-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setError(data.error ?? 'Erro ao guardar'); return }
      setCurrent(data.settings)
      setForm(f => ({ ...f, smtpPassword: '' }))
      setOkMessage('Definições guardadas.')
    } catch {
      setError('Erro de ligação ao guardar.')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true); setError(''); setOkMessage('')
    try {
      const res = await fetch('/api/email-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setError(`Falha no teste: ${data.error}`); return }
      setOkMessage(`E-mail de teste enviado para ${data.sentTo}. Confirma se chegou (vê também o spam).`)
    } catch {
      setError('Erro de ligação ao testar.')
    } finally {
      setTesting(false)
    }
  }

  function applyPreset(p: typeof PRESETS[number]) {
    setForm(f => ({ ...f, smtpHost: p.host, smtpPort: p.port }))
  }

  if (authLoading || loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
        </div>
      </AppLayout>
    )
  }

  if (profile?.role !== 'admin') {
    return (
      <AppLayout>
        <div className="p-8 text-center text-gray-500">Não tens permissão para aceder a esta página.</div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="p-4 md:p-8 max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/dashboard" prefetch={false} className="text-gray-400 hover:text-gray-600">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Mail className="w-6 h-6 text-emerald-600" /> Definições de E-mail
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">Conta usada para enviar e-mails aos inquilinos</p>
          </div>
        </div>

        {/* Estado atual */}
        <div className={`mb-5 flex items-start gap-2 rounded-lg px-4 py-3 text-sm border ${
          current?.configured
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-amber-50 border-amber-200 text-amber-800'
        }`}>
          {current?.configured
            ? <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            : <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
          <div>
            {current?.configured ? (
              <>
                <p className="font-medium">Envio configurado</p>
                <p className="text-xs mt-0.5">A ler as definições de: {current.source}</p>
              </>
            ) : (
              <>
                <p className="font-medium">Envio ainda não configurado</p>
                <p className="text-xs mt-0.5">Preenche os campos abaixo e guarda. Depois usa o botão de teste.</p>
              </>
            )}
          </div>
        </div>

        {/* Atalhos de fornecedor */}
        <div className="mb-5">
          <p className="label">Preencher automaticamente para</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map(p => (
              <button key={p.label} onClick={() => applyPreset(p)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  form.smtpHost === p.host
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-emerald-400'
                }`}>
                {p.label}
              </button>
            ))}
          </div>
          {PRESETS.find(p => p.host === form.smtpHost) && (
            <p className="text-xs text-gray-500 mt-2">
              {PRESETS.find(p => p.host === form.smtpHost)!.nota}
            </p>
          )}
        </div>

        <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="label">Servidor de envio (SMTP) *</label>
              <input className="input" placeholder="ex: smtp.gmail.com" value={form.smtpHost}
                onChange={e => setForm(f => ({ ...f, smtpHost: e.target.value }))} />
            </div>
            <div>
              <label className="label">Porta</label>
              <input className="input" type="number" value={form.smtpPort}
                onChange={e => setForm(f => ({ ...f, smtpPort: Number(e.target.value) }))} />
            </div>
          </div>

          <div>
            <label className="label">Utilizador *</label>
            <input className="input" placeholder="resend, postmaster@dominio.pt ou conta@dominio.pt"
              value={form.smtpUser}
              onChange={e => setForm(f => ({ ...f, smtpUser: e.target.value }))} />
            <p className="text-xs text-gray-400 mt-1">
              Nem todos os fornecedores usam um e-mail aqui. O Resend usa <span className="font-mono">resend</span>,
              o Mailgun usa <span className="font-mono">postmaster@dominio</span>, o Gmail usa o endereço da conta.
            </p>
          </div>

          <div>
            <label className="label">
              Palavra-passe {current?.passwordSet && <span className="font-normal text-emerald-600">(já guardada — deixa vazio para manter)</span>}
            </label>
            <div className="relative">
              <input className="input pr-10" type={showPassword ? 'text' : 'password'}
                placeholder={current?.passwordSet ? '••••••••••••' : 'Palavra-passe de aplicação ou chave de API'}
                value={form.smtpPassword}
                onChange={e => setForm(f => ({ ...f, smtpPassword: e.target.value }))} />
              <button type="button" onClick={() => setShowPassword(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Guardada de forma inacessível ao navegador — só o servidor lhe consegue aceder.
            </p>
          </div>

          <hr className="border-gray-100" />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Endereço de remetente *</label>
              <input className="input" placeholder="noreply@teudominio.pt" value={form.fromEmail}
                onChange={e => setForm(f => ({ ...f, fromEmail: e.target.value }))} />
            </div>
            <div>
              <label className="label">Nome do remetente</label>
              <input className="input" placeholder="ex: Quinta da Bela Vista" value={form.fromName}
                onChange={e => setForm(f => ({ ...f, fromName: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="label">Endereço de resposta <span className="font-normal text-gray-400">(opcional)</span></label>
            <input className="input" placeholder="ex: geral@teudominio.pt" value={form.replyTo}
              onChange={e => setForm(f => ({ ...f, replyTo: e.target.value }))} />
            <p className="text-xs text-gray-400 mt-1">
              Para onde vão as respostas dos inquilinos. Útil se enviares de um endereço no-reply.
            </p>
          </div>

          <div>
            <label className="label">Prefixo do assunto</label>
            <input className="input font-mono text-sm" placeholder="[QdBV Severino] - " value={form.subjectPrefix}
              onChange={e => setForm(f => ({ ...f, subjectPrefix: e.target.value }))} />
            <p className="text-xs text-gray-400 mt-1">
              Aplicado a todos os e-mails desta propriedade. Não te esqueças do espaço no fim.
            </p>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
          {okMessage && <p className="text-sm text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg">{okMessage}</p>}

          <div className="flex justify-between pt-1">
            <button className="btn-secondary" onClick={handleTest} disabled={testing || !current?.configured}
              title={!current?.configured ? 'Guarda as definições primeiro' : 'Envia um e-mail de teste para ti'}>
              {testing ? <><Loader2 className="w-4 h-4 animate-spin" /> A testar...</> : <><Send className="w-4 h-4" /> Enviar teste para mim</>}
            </button>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> A guardar...</> : <><Save className="w-4 h-4" /> Guardar</>}
            </button>
          </div>
        </div>

        <div className="mt-5 text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg p-4 space-y-1.5">
          <p className="font-medium text-gray-700">Para enviar de um endereço no-reply</p>
          <p>1. Verifica o teu domínio no fornecedor escolhido (adicionas uns registos ao DNS).</p>
          <p>2. Usa <span className="font-mono">noreply@teudominio.pt</span> no endereço de remetente.</p>
          <p>3. Põe o teu endereço verdadeiro no campo de resposta, para não perderes respostas.</p>
          <p className="pt-1">Estas definições são independentes em cada propriedade — configura em cada uma.</p>
        </div>
      </div>
    </AppLayout>
  )
}
