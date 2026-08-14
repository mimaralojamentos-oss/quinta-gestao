import type { Metadata } from 'next'

/**
 * A folha de ponto tem identidade separada da aplicação principal.
 *
 * `manifest` aponta para um ficheiro gerado à medida deste link, com o
 * arranque neste endereço — sem isso, o ícone instalado abriria o login
 * do gestor, porque a aplicação principal arranca no painel.
 *
 * `no-referrer` impede que o endereço, que contém o segredo, seja enviado
 * a sites terceiros. `noindex` impede que apareça em motores de busca.
 */
export async function generateMetadata(
  { params }: { params: Promise<{ token: string }> },
): Promise<Metadata> {
  const { token } = await params

  const serpa = (process.env.NEXT_PUBLIC_PWA_ICON || 'quinta') === 'serpa'
  const prefixo = serpa ? 'ponto-serpa' : 'ponto-quinta'
  const nomeCurto = serpa ? 'Miguel' : 'Quinta'

  return {
    title: `Folha de Ponto — ${nomeCurto}`,
    description: 'Registo de horas de trabalho',
    manifest: `/ponto/${token}/manifest.webmanifest`,
    referrer: 'no-referrer',
    robots: { index: false, follow: false, nocache: true },
    appleWebApp: {
      capable: true,
      // É este o nome que fica por baixo do ícone no iPhone
      title: nomeCurto,
      statusBarStyle: 'default',
    },
    icons: {
      icon: `/icons/${prefixo}-192.png`,
      apple: `/icons/${prefixo}-apple-180.png`,
    },
  }
}

export default function PontoLayout({ children }: { children: React.ReactNode }) {
  return children
}
