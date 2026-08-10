import type { Metadata, Viewport } from 'next'
import './globals.css'
import { AuthProvider } from '@/lib/auth-context'
import RegisterServiceWorker from '@/components/RegisterServiceWorker'

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'Gestão da Quinta'
const PWA_ICON = process.env.NEXT_PUBLIC_PWA_ICON || 'quinta'
const PWA_COLOR = process.env.NEXT_PUBLIC_PWA_COLOR || '#2563EB'

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'Sistema de gestão de arrendamentos',
  // Faz o iPhone abrir a app em ecrã inteiro e usar o ícone certo.
  // O Android trata disto pelo manifesto (app/manifest.ts).
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: 'default',
  },
  icons: {
    icon: `/icons/${PWA_ICON}-192.png`,
    apple: `/icons/${PWA_ICON}-apple-180.png`,
  },
}

export const viewport: Viewport = {
  // Cor da barra de estado do telemóvel quando a app está aberta
  themeColor: PWA_COLOR,
  width: 'device-width',
  initialScale: 1,
  // Deixa o utilizador dar zoom — as tabelas de contas precisam disso
  maximumScale: 5,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt">
      <body>
        <RegisterServiceWorker />
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
