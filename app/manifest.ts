import type { MetadataRoute } from 'next'

/**
 * Identidade da aplicação quando é instalada no telemóvel.
 *
 * O mesmo código serve os dois prédios, por isso o nome, a cor e os ícones
 * vêm das variáveis de ambiente de cada projeto no Vercel. Assim a Quinta e
 * a Serpa Pinto instalam-se como duas aplicações separadas, cada uma com o
 * seu ícone, em vez de se confundirem uma com a outra.
 *
 * Variáveis usadas (todas com valor por omissão, nada rebenta se faltarem):
 *   NEXT_PUBLIC_APP_NAME        nome que aparece por baixo do ícone
 *   NEXT_PUBLIC_APP_LOCATION    cidade, usada na descrição
 *   NEXT_PUBLIC_PWA_ICON        'quinta' ou 'serpa'
 *   NEXT_PUBLIC_PWA_COLOR       cor da barra de estado do telemóvel
 */
export default function manifest(): MetadataRoute.Manifest {
  const nome = process.env.NEXT_PUBLIC_APP_NAME || 'Gestão da Quinta'
  const local = process.env.NEXT_PUBLIC_APP_LOCATION || 'Évora'
  const icone = process.env.NEXT_PUBLIC_PWA_ICON || 'quinta'
  const cor = process.env.NEXT_PUBLIC_PWA_COLOR || '#2563EB'

  return {
    name: nome,
    // Nome curto: é o que cabe por baixo do ícone no ecrã do telemóvel
    short_name: nome.length > 12 ? nome.slice(0, 12) : nome,
    description: `Gestão de arrendamentos — ${local}`,
    start_url: '/dashboard',
    scope: '/',
    // standalone = abre sem a barra do navegador, como uma app normal
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: cor,
    lang: 'pt-PT',
    categories: ['business', 'productivity'],
    icons: [
      {
        src: `/icons/${icone}-192.png`,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: `/icons/${icone}-512.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        // O Android recorta o ícone em círculo ou quadrado arredondado
        // conforme o telemóvel; esta versão tem margem para aguentar o corte.
        src: `/icons/${icone}-maskable-512.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
