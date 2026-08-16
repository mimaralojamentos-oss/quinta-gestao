'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/lib/auth-context'
import EmailComposer, { type EmailContact } from '@/components/EmailComposer'
import { EMAIL_CONTEXT_LABELS, type EmailContext } from '@/lib/emailConfig'
import { Mail, Loader2, Send, Users } from 'lucide-react'

// Área de envio de e-mail livre: sem inquilino agarrado, o utilizador escolhe
// o destinatário e escreve a mensagem. Continua a usar o módulo único de
// e-mail, por isso mantém as mesmas regras: prefixo obrigatório no assunto,
// administradores em CC e revisão ortográfica antes de enviar.
export default function EmailLivrePage() {
  const supabase = createClient()
  const { profile, loading: authLoading } = useAuth()

  const [contacts, setContacts] = useState<EmailContact[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [context, setContext] = useState<EmailContext>('geral')
  const [sentCount, setSentCount] = useState(0)

  async function loadContacts() {
    try {
      const lista: EmailContact[] = []

      // Inquilinos
      const { data: tenants } = await supabase
        .from('tenants').select('name, email').not('email', 'is', null).order('name')
      for (const t of tenants ?? []) {
        if (t.email?.trim()) lista.push({ email: t.email.trim(), name: t.name, group: 'Inquilino' })
      }

      // Contactos adicionais dos inquilinos
      const { data: extra } = await supabase
        .from('tenant_contacts').select('name, email, relationship').not('email', 'is', null)
      for (const c of extra ?? []) {
        if (c.email?.trim()) {
          lista.push({
            email: c.email.trim(),
            name: c.relationship ? `${c.name} (${c.relationship})` : c.name,
            group: 'Contacto',
          })
        }
      }

      // Administradores da aplicação
      try {
        const res = await fetch('/api/send-email')
        if (res.ok) {
          const data = await res.json()
          for (const e of data.adminEmails ?? []) {
            lista.push({ email: e, name: e, group: 'Administrador' })
          }
        }
      } catch { /* sem administradores na lista — não é impeditivo */ }

      // Remover repetidos, mantendo a primeira ocorrência
      const vistos = new Set<string>()
      const unicos = lista.filter(c => {
        const k = c.email.toLowerCase()
        if (vistos.has(k)) return false
        vistos.add(k)
        return true
      })

      setContacts(unicos)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadContacts() }, [])

  if (authLoading || loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
        </div>
      </AppLayout>
    )
  }

  const podeAceder = ['admin', 'coadmin', 'super_reader'].includes(profile?.role ?? '')
  if (!podeAceder) {
    return (
      <AppLayout>
        <div className="p-8 text-center text-gray-500">Não tens permissão para aceder a esta página.</div>
      </AppLayout>
    )
  }

  const porGrupo = contacts.reduce<Record<string, number>>((acc, c) => {
    acc[c.group] = (acc[c.group] ?? 0) + 1
    return acc
  }, {})

  return (
    <AppLayout>
      <div className="p-4 md:p-8 max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Mail className="w-6 h-6 text-emerald-600" /> Enviar E-mail
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            E-mail livre, para qualquer destinatário — não precisa de estar associado a um inquilino
          </p>
        </div>

        <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 space-y-4">
          <div>
            <label className="label">Tipo de e-mail</label>
            <select className="input" value={context} onChange={e => setContext(e.target.value as EmailContext)}>
              {Object.entries(EMAIL_CONTEXT_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Só serve para orientar a IA, caso lhe peças para escrever. Podes escrever tudo à mão.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
            <Users className="w-3.5 h-3.5 flex-shrink-0" />
            <span>
              {contacts.length} contacto(s) disponíveis na lista
              {Object.keys(porGrupo).length > 0 && (
                <> — {Object.entries(porGrupo).map(([g, n]) => `${n} ${g.toLowerCase()}${n > 1 ? 's' : ''}`).join(', ')}</>
              )}
            </span>
          </div>

          <p className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
            Aplicam-se as mesmas regras dos restantes e-mails da aplicação: prefixo obrigatório no assunto,
            administradores em cópia e revisão ortográfica antes de enviar.
          </p>

          <button className="btn-primary w-full justify-center" onClick={() => setOpen(true)}>
            <Send className="w-4 h-4" /> Escrever e-mail
          </button>

          {sentCount > 0 && (
            <p className="text-sm text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg">
              {sentCount} e-mail(s) enviado(s) nesta sessão.
            </p>
          )}
        </div>
      </div>

      {open && (
        <EmailComposer
          freeMode
          contacts={contacts}
          context={context}
          tenantName=""
          tenantEmail={null}
          onClose={() => setOpen(false)}
          onSent={() => setSentCount(n => n + 1)}
        />
      )}
    </AppLayout>
  )
}
