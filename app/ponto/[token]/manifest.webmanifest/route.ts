import { NextResponse } from 'next/server'

/**
 * Identidade da folha de ponto quando é instalada no telemóvel do trabalhador.
 *
 * Tem de ser gerada por link, e não partilhada com a aplicação principal,
 * por duas razões:
 *
 *   1. O arranque da app principal aponta para /dashboard. Se o trabalhador
 *      instalasse com essa identidade, o ícone abriria o login do gestor.
 *   2. O `scope` limita a aplicação instalada a este endereço. Mesmo que
 *      alguém lhe passe outro link, a app dele não sai daqui.
 *
 * Não expõe nada: o token já está no endereço de quem pede o ficheiro, e
 * sem o código de 4 dígitos não se vê dado nenhum.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  // Só aceita o formato dos tokens gerados pela aplicação, para este
  // endereço não servir de espelho a texto arbitrário.
  if (!/^[a-z0-9]{20,64}$/.test(token)) {
    return NextResponse.json({ error: 'Link inválido' }, { status: 404 })
  }

  const base = `/ponto/${token}`

  // O trabalhador pode andar nos dois prédios. O ícone tem de dizer, de
  // relance, a que folha de ponto pertence — daí o nome por baixo do relógio.
  const serpa = (process.env.NEXT_PUBLIC_PWA_ICON || 'quinta') === 'serpa'
  const prefixo = serpa ? 'ponto-serpa' : 'ponto-quinta'
  const nomeCurto = serpa ? 'Miguel' : 'Quinta'
  const cor = serpa ? '#2563EB' : '#059669'

  return NextResponse.json({
    name: `Folha de Ponto — ${nomeCurto}`,
    short_name: nomeCurto,
    description: 'Registo de horas de trabalho',
    start_url: base,
    scope: base,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: cor,
    lang: 'pt-PT',
    icons: [
      { src: `/icons/${prefixo}-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `/icons/${prefixo}-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `/icons/${prefixo}-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, {
    headers: {
      'Content-Type': 'application/manifest+json',
      // Não guardar em memória: se o gestor gerar um link novo, o antigo
      // deixa de existir e não deve ficar preso no telemóvel.
      'Cache-Control': 'no-store',
    },
  })
}
