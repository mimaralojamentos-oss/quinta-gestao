'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Building2, Users, CreditCard,
  Receipt, Wallet, Bell, Zap, Droplet, LogOut, ShieldCheck,
  TrendingUp, Landmark, ChevronDown, ChevronRight, FolderOpen, HardHat, NotebookPen,
  BarChart3, UserCircle, DoorOpen, ScrollText, Mail, Boxes, Clock,
  Home, Gauge, Wrench, Briefcase,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth-context'
import { useEffect, useRef, useState } from 'react'

/**
 * Menu lateral, arrumado em grupos.
 *
 * A lista de páginas cresceu até deixar de se ler, por isso as entradas
 * passaram a viver em grupos que se abrem e fecham (o padrão que o
 * Financeiro já usava). Nenhuma rota mudou: isto é só arrumação.
 *
 * O grupo da página aberta abre-se sozinho e fica realçado, sem fechar os
 * que o utilizador abriu à mão. O que está aberto fica guardado no
 * localStorage, para o menu estar como o deixámos na visita seguinte.
 *
 * As permissões são as mesmas de sempre: cada entrada diz quem a vê, e um
 * grupo onde o utilizador não vê nenhuma entrada não aparece de todo.
 */

/** Quem vê uma entrada. Sem isto, vê-se sempre (como era antes). */
type QuemVe = 'pessoal' | 'email' | 'admin'

interface Entrada {
  href: string
  label: string
  icon: typeof Home
  ve?: QuemVe
}

interface Subgrupo {
  key: string
  label: string
  icon: typeof Home
  entradas: Entrada[]
}

interface Grupo {
  key: string
  label: string
  icon: typeof Home
  entradas?: Entrada[]
  subgrupos?: Subgrupo[]
}

const GRUPOS: Grupo[] = [
  {
    key: 'arrendamento',
    label: 'Arrendamento',
    icon: Home,
    entradas: [
      { href: '/espacos', label: 'Espaços', icon: Building2 },
      { href: '/inquilinos', label: 'Inquilinos', icon: Users },
      { href: '/contratos', label: 'Contratos', icon: ScrollText },
    ],
  },
  {
    key: 'contadores',
    label: 'Contadores',
    icon: Gauge,
    subgrupos: [
      {
        key: 'contadores-luz',
        label: 'Eletricidade',
        icon: Zap,
        entradas: [
          { href: '/eletricidade/quadros', label: 'Quadros Elétricos', icon: Zap },
          { href: '/eletricidade/espacos', label: 'Quadros dos Espaços', icon: Building2 },
        ],
      },
      {
        key: 'contadores-agua',
        label: 'Água',
        icon: Droplet,
        entradas: [
          { href: '/agua/contadores', label: 'Contadores Gerais', icon: Droplet },
          { href: '/agua/espacos', label: 'Contadores dos Espaços', icon: Building2 },
        ],
      },
    ],
  },
  {
    key: 'financeiro',
    label: 'Financeiro',
    icon: TrendingUp,
    entradas: [
      { href: '/pagamentos', label: 'Rendas & Pagamentos', icon: CreditCard },
      { href: '/despesas', label: 'Despesas', icon: Receipt },
      { href: '/financeiro/receitas', label: 'Receitas Extraordinárias', icon: TrendingUp },
      { href: '/caixa', label: 'Fundo de Maneio', icon: Wallet },
      { href: '/financeiro/bancos', label: 'Bancos', icon: Landmark },
    ],
  },
  {
    key: 'operacoes',
    label: 'Operações',
    icon: Wrench,
    entradas: [
      { href: '/projetos', label: 'Projetos', icon: HardHat },
      // Salários e o link/PIN secreto da folha de ponto: só quem gere pessoal.
      { href: '/trabalhadores', label: 'Folha de Ponto', icon: Clock, ve: 'pessoal' },
      { href: '/portao', label: 'Portão', icon: DoorOpen },
    ],
  },
  {
    key: 'escritorio',
    label: 'Escritório',
    icon: Briefcase,
    entradas: [
      { href: '/documentos', label: 'Documentos', icon: FolderOpen },
      { href: '/relatorios', label: 'Relatórios', icon: BarChart3 },
      { href: '/notas', label: 'Notas', icon: NotebookPen },
      { href: '/alertas', label: 'Alertas', icon: Bell },
      { href: '/email', label: 'Enviar E-mail', icon: Mail, ve: 'email' },
    ],
  },
]

/** Entradas discretas no fundo, fora dos grupos. */
const RODAPE: Entrada[] = [
  { href: '/extras', label: 'Extras', icon: Boxes },
  { href: '/utilizadores', label: 'Utilizadores', icon: ShieldCheck, ve: 'admin' },
  { href: '/definicoes/email', label: 'Definições de E-mail', icon: Mail, ve: 'admin' },
]

const CHAVE_LOCAL = 'sidebar-grupos-abertos'

export default function Sidebar({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname()
  const { profile, isAdmin, isCoAdmin, signOut } = useAuth()

  const permissoes: Record<QuemVe, boolean> = {
    admin: isAdmin,
    pessoal: isAdmin || isCoAdmin,
    // O Super Leitor entra para consultar e rever, mas o botão de enviar
    // fica-lhe desativado dentro do próprio módulo.
    email: ['admin', 'coadmin', 'super_reader'].includes(profile?.role ?? ''),
  }

  const podeVer = (e: Entrada) => (e.ve ? permissoes[e.ve] : true)
  const naRota = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  /** Só os grupos (e subgrupos) com pelo menos uma entrada visível. */
  const grupos = GRUPOS
    .map(g => ({
      ...g,
      entradas: (g.entradas ?? []).filter(podeVer),
      subgrupos: (g.subgrupos ?? [])
        .map(s => ({ ...s, entradas: s.entradas.filter(podeVer) }))
        .filter(s => s.entradas.length > 0),
    }))
    .filter(g => g.entradas.length > 0 || g.subgrupos.length > 0)

  /** As chaves dos grupos/subgrupos que contêm a página aberta. */
  function chavesDaRota(): string[] {
    const chaves: string[] = []
    for (const g of grupos) {
      const aqui = g.entradas.some(e => naRota(e.href))
      const subAqui = g.subgrupos.filter(s => s.entradas.some(e => naRota(e.href)))
      if (aqui || subAqui.length > 0) chaves.push(g.key)
      chaves.push(...subAqui.map(s => s.key))
    }
    return chaves
  }

  // Começa com o grupo da página aberta já aberto — sem esperar pelos
  // efeitos, para não haver um salto visual ao entrar.
  const [abertos, setAbertos] = useState<Record<string, boolean>>(
    () => Object.fromEntries(chavesDaRota().map(k => [k, true])),
  )
  const hidratado = useRef(false)

  // O que estava aberto na última visita. O que a rota abriu fica aberto.
  useEffect(() => {
    try {
      const guardado = JSON.parse(localStorage.getItem(CHAVE_LOCAL) ?? '{}')
      setAbertos(atual => ({ ...guardado, ...atual }))
    } catch {
      // localStorage indisponível (ou com lixo): o menu funciona sem isso.
    }
    hidratado.current = true
  }, [])

  // Ao mudar de página, abre o grupo dela sem fechar os outros.
  useEffect(() => {
    const chaves = chavesDaRota()
    if (chaves.length === 0) return
    setAbertos(atual => ({ ...atual, ...Object.fromEntries(chaves.map(k => [k, true])) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  useEffect(() => {
    if (!hidratado.current) return
    try { localStorage.setItem(CHAVE_LOCAL, JSON.stringify(abertos)) } catch { /* sem localStorage */ }
  }, [abertos])

  const alternar = (key: string) => setAbertos(a => ({ ...a, [key]: !a[key] }))

  /** Uma entrada do menu, dentro de um grupo. */
  function LinkEntrada({ entrada }: { entrada: Entrada }) {
    const Icon = entrada.icon
    return (
      <Link href={entrada.href} prefetch={false} onClick={onClose}
        className={cn('sidebar-link text-xs py-2', naRota(entrada.href) ? 'active' : '')}>
        <Icon className="w-3.5 h-3.5 flex-shrink-0" />
        {entrada.label}
      </Link>
    )
  }

  return (
    <aside className="w-64 bg-white border-r border-gray-100 h-screen flex flex-col">
      <div className="p-6 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-bold">GQ</span>
          </div>
          <div>
            <p className="font-bold text-gray-900 text-sm">{process.env.NEXT_PUBLIC_APP_NAME || 'Gestão da Quinta'}</p>
            <p className="text-xs text-gray-500">{process.env.NEXT_PUBLIC_APP_LOCATION || 'Évora'}</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {/* Dashboard — solto no topo */}
        <Link href="/dashboard" prefetch={false} onClick={onClose}
          className={cn('sidebar-link', naRota('/dashboard') ? 'active' : '')}>
          <LayoutDashboard className="w-4 h-4 flex-shrink-0" />
          Dashboard
        </Link>

        {grupos.map(grupo => {
          const Icon = grupo.icon
          const aberto = !!abertos[grupo.key]
          const temPaginaAberta =
            grupo.entradas.some(e => naRota(e.href)) ||
            grupo.subgrupos.some(s => s.entradas.some(e => naRota(e.href)))

          return (
            <div key={grupo.key} className="pt-1">
              <button onClick={() => alternar(grupo.key)}
                className={cn(
                  'w-full flex items-center justify-between px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  'hover:bg-emerald-50 hover:text-emerald-700',
                  temPaginaAberta ? 'text-emerald-700 bg-emerald-50/60' : 'text-gray-600',
                )}>
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span>{grupo.label}</span>
                </div>
                {aberto ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>

              {aberto && (
                <div className="ml-4 mt-1 space-y-1 border-l-2 border-gray-100 pl-3">
                  {grupo.entradas.map(entrada => (
                    <LinkEntrada key={entrada.href} entrada={entrada} />
                  ))}

                  {/* Subgrupos (Eletricidade e Água mantêm os seus submenus) */}
                  {grupo.subgrupos.map(sub => {
                    const IconSub = sub.icon
                    const subAberto = !!abertos[sub.key]
                    const subTemPagina = sub.entradas.some(e => naRota(e.href))
                    return (
                      <div key={sub.key}>
                        <button onClick={() => alternar(sub.key)}
                          className={cn(
                            'w-full flex items-center justify-between px-4 py-2 rounded-lg text-xs font-medium transition-colors',
                            'hover:bg-emerald-50 hover:text-emerald-700',
                            subTemPagina ? 'text-emerald-700' : 'text-gray-600',
                          )}>
                          <div className="flex items-center gap-3">
                            <IconSub className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>{sub.label}</span>
                          </div>
                          {subAberto ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </button>
                        {subAberto && (
                          <div className="ml-3 mt-1 space-y-1 border-l-2 border-gray-100 pl-3">
                            {sub.entradas.map(entrada => (
                              <LinkEntrada key={entrada.href} entrada={entrada} />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      <div className="p-4 border-t border-gray-100">
        {/* Fora dos grupos, discretos: Extras e administração */}
        <div className="mb-3 space-y-0.5">
          {RODAPE.filter(podeVer).map(entrada => {
            const Icon = entrada.icon
            return (
              <Link key={entrada.href} href={entrada.href} prefetch={false} onClick={onClose}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors hover:bg-gray-50',
                  naRota(entrada.href) ? 'text-emerald-700 bg-emerald-50' : 'text-gray-500 hover:text-gray-700',
                )}>
                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                {entrada.label}
              </Link>
            )
          })}
        </div>

        {profile && (
          <Link href="/perfil" prefetch={false}
            className={cn('flex items-center gap-3 mb-3 px-1 rounded-lg py-1.5 hover:bg-gray-50 transition-colors cursor-pointer', pathname.startsWith('/perfil') ? 'bg-emerald-50' : '')}>
            <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-emerald-700">{profile.name.charAt(0).toUpperCase()}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-800 truncate">{profile.name}</p>
              <p className="text-xs text-gray-400">{profile.role === 'admin' ? '🔑 Administrador' : profile.role === 'coadmin' ? '🔑 Co-Administrador' : profile.role === 'electrician' ? '⚡ Eletricista' : '👁 Visualizador'}</p>
            </div>
            <UserCircle className="w-4 h-4 text-gray-300 flex-shrink-0" />
          </Link>
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
