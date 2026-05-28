'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Building2, Users, CreditCard,
  Receipt, Wallet, Bell, Zap, Home, LogOut, ShieldCheck,
  TrendingUp, Landmark, ChevronDown, ChevronRight, FileText, FolderOpen,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth-context'
import { useState } from 'react'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/espacos', label: 'Espaços', icon: Building2 },
  { href: '/inquilinos', label: 'Inquilinos', icon: Users },
  { href: '/eletricidade', label: 'Eletricidade', icon: Zap },
  { href: '/faturas', label: 'Faturas', icon: FileText },
  { href: '/documentos', label: 'Documentos', icon: FolderOpen },
  { href: '/alertas', label: 'Alertas', icon: Bell },
]

const financeItems = [
  { href: '/pagamentos', label: 'Rendas & Pagamentos', icon: CreditCard },
  { href: '/despesas', label: 'Despesas', icon: Receipt },
  { href: '/caixa', label: 'Fluxo de Caixa', icon: Wallet },
  { href: '/financeiro/bancos', label: 'Bancos', icon: Landmark },
]

export default function Sidebar() {
  const pathname = usePathname()
  const { profile, isAdmin, signOut } = useAuth()
  const [financeOpen, setFinanceOpen] = useState(
    pathname.startsWith('/pagamentos') ||
    pathname.startsWith('/despesas') ||
    pathname.startsWith('/caixa') ||
    pathname.startsWith('/financeiro')
  )

  return (
    <aside className="w-64 bg-white border-r border-gray-100 min-h-screen flex flex-col">
      <div className="p-6 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
            <Home className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-bold text-gray-900 text-sm">Gestão da Quinta</p>
            <p className="text-xs text-gray-500">Évora</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link key={item.href} href={item.href} prefetch={false}
              className={cn('sidebar-link', isActive ? 'active' : '')}>
              <Icon className="w-4 h-4 flex-shrink-0" />
              {item.label}
            </Link>
          )
        })}

        {/* Secção Financeiro */}
        <div className="pt-2">
          <button
            onClick={() => setFinanceOpen(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
          >
            <div className="flex items-center gap-3">
              <TrendingUp className="w-4 h-4 flex-shrink-0" />
              <span>Financeiro</span>
            </div>
            {financeOpen
              ? <ChevronDown className="w-3 h-3" />
              : <ChevronRight className="w-3 h-3" />}
          </button>

          {financeOpen && (
            <div className="ml-4 mt-1 space-y-1 border-l-2 border-gray-100 pl-3">
              {financeItems.map((item) => {
                const Icon = item.icon
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
                return (
                  <Link key={item.href} href={item.href} prefetch={false}
                    className={cn('sidebar-link text-xs py-2', isActive ? 'active' : '')}>
                    <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                    {item.label}
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Admin */}
        {isAdmin && (
          <>
            <div className="pt-3 pb-1">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4">Administração</p>
            </div>
            <Link href="/utilizadores" prefetch={false}
              className={cn('sidebar-link', pathname.startsWith('/utilizadores') ? 'active' : '')}>
              <ShieldCheck className="w-4 h-4 flex-shrink-0" />
              Utilizadores
            </Link>
          </>
        )}
      </nav>

      <div className="p-4 border-t border-gray-100">
        {profile && (
          <div className="flex items-center gap-3 mb-3 px-1">
            <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-emerald-700">{profile.name.charAt(0).toUpperCase()}</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{profile.name}</p>
              <p className="text-xs text-gray-400">{profile.role === 'admin' ? '🔑 Administrador' : '👁 Visualizador'}</p>
            </div>
          </div>
        )}
        <button onClick={signOut}
          className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors">
          <LogOut className="w-4 h-4" />
          Sair
        </button>
      </div>
    </aside>
  )
}
