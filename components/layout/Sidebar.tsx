'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Building2,
  Users,
  CreditCard,
  Receipt,
  Wallet,
  Bell,
  Zap,
  Home,
} from 'lucide-react'
import { cn } from '@/lib/utils'

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
              className={cn(
                'sidebar-link',
                isActive ? 'active' : 'text-gray-600'
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-gray-100">
        <p className="text-xs text-gray-400 text-center">v1.0 · Quinta Évora</p>
      </div>
    </aside>
  )
}
