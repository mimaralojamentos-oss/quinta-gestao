'use client'

import Sidebar from '@/components/layout/Sidebar'
import { useState } from 'react'
import { Menu, Eye } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { isSuperReader, profile } = useAuth()
  // Perfis sem qualquer permissão de escrita — mostra aviso permanente para
  // não haver dúvidas sobre porque é que uma ação falha.
  const readOnly = isSuperReader || profile?.role === 'viewer'

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Overlay escuro no mobile quando o menu está aberto */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`fixed inset-y-0 left-0 z-50 flex-shrink-0 transition-transform duration-300 lg:static lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Conteúdo principal */}
      <main className="flex-1 overflow-auto">
        {/* Barra topo mobile */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-100 sticky top-0 z-30">
          <button onClick={() => setSidebarOpen(true)} className="p-1.5 rounded-lg hover:bg-gray-100">
            <Menu className="w-5 h-5 text-gray-600" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white text-xs font-bold">GQ</span>
            </div>
            <p className="font-bold text-gray-900 text-sm">{process.env.NEXT_PUBLIC_APP_NAME || 'Gestão da Quinta'}</p>
          </div>
        </div>
        {readOnly && (
          <div className="sticky top-0 z-20 flex items-center gap-2 px-4 py-2 bg-blue-50 border-b border-blue-100 text-xs text-blue-800">
            <Eye className="w-3.5 h-3.5 flex-shrink-0" />
            <span>
              <strong>{isSuperReader ? 'Super Leitor' : 'Visualizador'}</strong> — modo leitura.
              Podes consultar toda a informação, mas não alterar dados nem enviar comunicações.
            </span>
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
