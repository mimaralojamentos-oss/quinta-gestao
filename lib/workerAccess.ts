import { gerarPin, gerarToken, type Worker } from '@/lib/ponto'

/**
 * Regenerar o acesso de um trabalhador à folha de ponto.
 *
 * Como funciona a "sessão" no telemóvel (app/ponto/[token]/page.tsx):
 *   - Não há cookie nem sessão no servidor. O código fica guardado em
 *     localStorage, na chave `ponto_pin_<token>`, e CADA pedido a /api/ponto
 *     envia o link + o código, que são validados de novo.
 *   - Novo código: a página já aberta continua a mostrar o que tinha em
 *     memória, mas o próximo pedido (abrir, recarregar, registar horas)
 *     falha, o código guardado é apagado e é pedido o novo. O link e o
 *     ícone instalado continuam a servir.
 *   - Novo link: o endereço antigo deixa de existir, e com ele o ícone
 *     instalado (arranca sempre no link antigo). É preciso abrir o link novo
 *     e instalar outra vez. O código mantém-se, mas tem de ser escrito de
 *     novo, porque fica guardado por link.
 *
 * Cada ação muda apenas o segredo respetivo e limpa o travão de tentativas
 * (failed_attempts / locked_until): um acesso novo não herda os códigos
 * errados nem o bloqueio do antigo. Não toca em dados nem em horas.
 */

export type TipoRegeneracao = 'codigo' | 'link'

export function confirmacaoRegeneracao(tipo: TipoRegeneracao, nome: string): string {
  return tipo === 'codigo'
    ? `Regenerar o código de ${nome}?\n\n` +
      'O código antigo deixa de funcionar de imediato. No telemóvel, da próxima vez que abrir a folha de ponto ' +
      '(ou tentar registar horas) é-lhe pedido o código novo.\n\n' +
      'O link mantém-se — o ícone instalado continua a servir. O trabalhador vai precisar do código novo.'
    : `Regenerar o link secreto de ${nome}?\n\n` +
      'O link antigo deixa de funcionar de imediato, incluindo o ícone instalado no telemóvel: ' +
      'vai ter de abrir o link novo e instalá-lo outra vez.\n\n' +
      'O código mantém-se, mas tem de o escrever de novo ao abrir o link novo. O trabalhador vai precisar dos dados novos.'
}

/** Texto para o registo de acessos. Nunca inclui o link nem o código. */
export function detalheLogRegeneracao(tipo: TipoRegeneracao, nome: string): string {
  return tipo === 'codigo'
    ? `Regenerou o código de acesso de "${nome}" (o código antigo deixou de funcionar)`
    : `Regenerou o link secreto de "${nome}" (o link antigo deixou de funcionar)`
}

/** Campos a gravar: só o segredo pedido (sempre diferente do atual) + travão de tentativas limpo. */
export function camposRegeneracao(
  tipo: TipoRegeneracao,
  atual: Pick<Worker, 'access_token' | 'pin'>,
  gerar: { pin: () => string; token: () => string } = { pin: gerarPin, token: gerarToken },
): { pin: string; failed_attempts: 0; locked_until: null } | { access_token: string; failed_attempts: 0; locked_until: null } {
  const limpo = { failed_attempts: 0 as const, locked_until: null }
  if (tipo === 'codigo') {
    let pin = gerar.pin()
    for (let i = 0; i < 20 && pin === atual.pin; i++) pin = gerar.pin()
    return { pin, ...limpo }
  }
  let token = gerar.token()
  for (let i = 0; i < 20 && token === atual.access_token; i++) token = gerar.token()
  return { access_token: token, ...limpo }
}

/**
 * Regenera o código ou o link e devolve os dois segredos já gravados, para
 * serem enviados ao trabalhador. Só admin/coadmin conseguem (RLS de workers).
 */
export async function regenerarAcesso(
  supabase: any,
  workerId: string,
  tipo: TipoRegeneracao,
): Promise<{ erro: string } | { acesso: Pick<Worker, 'access_token' | 'pin'> }> {
  const { data: atual, error: erroLer } = await supabase
    .from('workers').select('access_token, pin').eq('id', workerId).maybeSingle()
  if (erroLer || !atual) return { erro: erroLer?.message ?? 'Trabalhador não encontrado.' }

  const { data, error } = await supabase
    .from('workers')
    .update(camposRegeneracao(tipo, atual))
    .eq('id', workerId)
    .select('access_token, pin')
    .single()
  if (error || !data) return { erro: error?.message ?? 'Não foi possível regenerar.' }
  return { acesso: data }
}
