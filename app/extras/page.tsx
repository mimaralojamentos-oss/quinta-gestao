'use client'

import AppLayout from '@/components/layout/AppLayout'
import Link from 'next/link'
import { Mail, Truck, ChevronRight } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

/**
 * Extras — área de apoio, para as páginas que não pertencem ao dia-a-dia
 * da gestão mas fazem falta de vez em quando.
 */

const cards = [
  {
    href: '/extras/emails',
    icon: Mail,
    title: 'E-mails Enviados',
    description: 'Histórico completo de todos os e-mails que a aplicação enviou, com o texto original.',
    roles: ['admin', 'coadmin', 'super_reader'],
    color: 'bg-blue-50 text-blue-600 border-blue-100',
  },
  {
    href: '/extras/fornecedores',
    icon: Truck,
    title: 'Fornecedores',
    description: 'Lista de fornecedores retirada das faturas, com a tabela de equivalências para juntar nomes diferentes da mesma empresa.',
    roles: ['admin', 'coadmin', 'super_reader', 'viewer', 'electrician'],
    color: 'bg-amber-50 text-amber-600 border-amber-100',
  },
]

export default function ExtrasPage() {
  const { profile } = useAuth()
  const role = profile?.role ?? ''
  const visiveis = cards.filter(c => c.roles.includes(role))

  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Extras</h1>
        <p className="text-gray-500 text-sm mt-1">Ferramentas de apoio à gestão</p>
      </div>

      {visiveis.length === 0 ? (
        <p className="text-gray-500 text-sm">Não tens acesso a nenhuma destas ferramentas.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {visiveis.map(card => {
            const Icon = card.icon
            return (
              <Link key={card.href} href={card.href} prefetch={false}
                className="group flex items-start gap-4 bg-white border border-gray-100 rounded-xl p-5 hover:border-emerald-200 hover:shadow-sm transition-all">
                <div className={`w-11 h-11 rounded-lg border flex items-center justify-center flex-shrink-0 ${card.color}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 group-hover:text-emerald-700 transition-colors">{card.title}</p>
                  <p className="text-sm text-gray-500 mt-1 leading-relaxed">{card.description}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-emerald-500 flex-shrink-0 mt-1 transition-colors" />
              </Link>
            )
          })}
        </div>
      )}
    </AppLayout>
  )
}
