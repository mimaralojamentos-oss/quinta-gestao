'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Building2, Users, CreditCard,
  Receipt, Wallet, Bell, Zap, Home, LogOut, Settings, ShieldCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth-context'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/espacos', label: 'Espaços', icon: Building2 },
  { href: '/inquilinos', label: 'Inquilinos', icon: Users },
  { href: '/pagamentos', label: 'Rendas & Pagamentos', icon: CreditCard },
  { href: '/eletricidade', label: 'Eletricidade', icon: Zap },
  { href: '/despesas', label: 'Despesas', icon: Receipt },
  { href: '/caixa', label: 'Fundo de Caixa', icon: Wallet },
  { href: '/alertas', label: 'Alertas', icon: Bell },
]

export default function Sidebar() {
  const pathname = usePathname()
  const { profile, isAdmin, signOut } = useAuth()

  return (
    <aside className="w-64 bg-white border-r border-gray-100 min-h-screen flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-emerald-600 rounded-lg flex items-center justify-center">
            <Home className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-bold text-gray-900 text-sm">Gestão da Quinta</p>
            <p className="text-xs text-gray-500">Évora</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn('sidebar-link', isActive ? 'active' : '')}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {item.label}
            </Link>
          )
        })}

        {/* Admin only */}
        {isAdmin && (
          <>
            <div className="pt-3 pb-1">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4">
                Administração
              </p>
            </div>
            <Link
              href="/utilizadores"
              className={cn('sidebar-link', pathname.startsWith('/utilizadores') ? 'active' : '')}
            >
              <ShieldCheck className="w-4 h-4 flex-shrink-0" />
              Utilizadores
            </Link>
          </>
        )}
      </nav>

      {/* User info + logout */}
      <div className="p-4 border-t border-gray-100">
        {profile && (
          <div className="flex items-center gap-3 mb-3 px-1">
            <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-emerald-700">
                {profile.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{profile.name}</p>
              <p className="text-xs text-gray-400">
                {profile.role === 'admin' ? '🔑 Administrador' : '👁 Visualizador'}
              </p>
            </div>
          </div>
        )}
        <button
          onClick={signOut}
          className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sair
        </button>
      </div>
    </aside>
  )
}
