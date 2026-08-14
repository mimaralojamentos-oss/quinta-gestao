import type { Metadata } from 'next'

/**
 * O link da folha de ponto tem o segredo no próprio endereço.
 *
 * `no-referrer` impede que esse endereço seja enviado a sites terceiros
 * no cabeçalho de referência, e `noindex` impede que apareça em motores
 * de busca caso o link seja publicado por engano nalgum lado.
 */
export const metadata: Metadata = {
  title: 'Folha de Ponto',
  referrer: 'no-referrer',
  robots: { index: false, follow: false, nocache: true },
}

export default function PontoLayout({ children }: { children: React.ReactNode }) {
  return children
}
