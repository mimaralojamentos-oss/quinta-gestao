/**
 * Leituras de contador: um contador não anda para trás.
 *
 * Uma leitura menor do que a anterior é sempre um erro de registo (dedo
 * trocado, OCR a ler mal, contador do espaço errado). Até aqui entrava sem
 * aviso e produzia consumo e valor NEGATIVOS, que seguiam para a cobrança e
 * para a divisão dos contadores partilhados. Passa a ser recusada em todos
 * os caminhos que registam leituras.
 *
 * DUAS EXCEÇÕES, as duas legítimas:
 *   · a leitura de arranque a 0 de uma troca de contador, que só se cria
 *     pelo botão "🔄 Reset do contador" (lib/meterReset.ts) e não passa por
 *     nenhum destes formulários;
 *   · nos contadores GERAIS (quadros da luz e contadores gerais da água),
 *     o valor 0 significa "fatura sem leitura" — é o que a importação de
 *     faturas grava e a página mostra como "—". Essas linhas não são
 *     leituras: não se recusam nem servem de termo de comparação.
 */

export type TabelaDeLeituras =
  | 'electricity_readings' | 'water_readings'        // contadores dos espaços
  | 'meter_readings' | 'water_meter_readings'        // contadores gerais

export interface LeituraAnterior {
  reading_value: number
  reading_date: string
}

const numeroPT = (v: number) => new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 3 }).format(v)
const dataPT = (iso: string) => String(iso ?? '').slice(0, 10).split('-').reverse().join('/')

/**
 * A mensagem de recusa, ou null quando a leitura pode entrar.
 *
 * A mensagem mostra sempre os dois valores, para se ver logo onde está o
 * erro sem ir procurar o histórico.
 */
export function recusaDeLeitura(p: {
  novoValor: number
  anterior: LeituraAnterior | null
  unidade: 'kWh' | 'm³'
  /** Contador de espaço: há o botão do reset para a contagem recomeçar. */
  comReset?: boolean
  /** Contador geral: 0 é "fatura sem leitura", não é uma leitura. */
  zeroEhSemLeitura?: boolean
}): string | null {
  const valor = Number(p.novoValor)
  if (!Number.isFinite(valor)) return 'O valor da leitura não é um número válido.'
  if (valor < 0) return `A leitura não pode ser um valor negativo (${numeroPT(valor)} ${p.unidade}).`

  if (p.zeroEhSemLeitura && valor === 0) return null
  if (!p.anterior) return null

  const anterior = Number(p.anterior.reading_value)
  if (!Number.isFinite(anterior) || valor >= anterior) return null

  const base =
    `A leitura que estás a registar (${numeroPT(valor)} ${p.unidade}) é MENOR do que a anterior ` +
    `(${numeroPT(anterior)} ${p.unidade}, de ${dataPT(p.anterior.reading_date)}).\n\n` +
    `Um contador não anda para trás — confirma o valor.`

  return p.comReset
    ? `${base}\n\nSe o contador foi trocado e a contagem recomeçou do zero, não registes a leitura aqui: usa o botão "🔄 Reset do contador".`
    : base
}

/**
 * A leitura imediatamente anterior a uma data, no mesmo contador.
 *
 * Procura por data (a ordem em que as leituras contam) e não pela ordem de
 * criação. `ignorarId` serve para a edição de uma leitura não se comparar
 * consigo mesma.
 */
export async function leituraAnteriorDe(
  supabase: any,
  p: {
    tabela: TabelaDeLeituras
    coluna: 'space_id' | 'meter_id'
    id: string
    dataISO: string
    ignorarId?: string | null
    zeroEhSemLeitura?: boolean
  },
): Promise<LeituraAnterior | null> {
  const { data } = await supabase
    .from(p.tabela)
    .select('id, reading_date, reading_value')
    .eq(p.coluna, p.id)
    .lte('reading_date', p.dataISO)
    .order('reading_date', { ascending: false })
    .limit(100)

  const candidatas = (data ?? [])
    .filter((r: any) => r.id !== p.ignorarId)
    .filter((r: any) => !p.zeroEhSemLeitura || Number(r.reading_value) !== 0)

  const ultima = candidatas[0]
  return ultima
    ? { reading_value: Number(ultima.reading_value), reading_date: ultima.reading_date }
    : null
}

/** As duas coisas de uma vez: busca a anterior e valida. */
export async function recusaPorRegressao(
  supabase: any,
  p: {
    tabela: TabelaDeLeituras
    coluna: 'space_id' | 'meter_id'
    id: string
    dataISO: string
    novoValor: number
    unidade: 'kWh' | 'm³'
    ignorarId?: string | null
    comReset?: boolean
    zeroEhSemLeitura?: boolean
  },
): Promise<string | null> {
  const anterior = await leituraAnteriorDe(supabase, {
    tabela: p.tabela, coluna: p.coluna, id: p.id, dataISO: p.dataISO,
    ignorarId: p.ignorarId, zeroEhSemLeitura: p.zeroEhSemLeitura,
  })
  return recusaDeLeitura({
    novoValor: p.novoValor, anterior, unidade: p.unidade,
    comReset: p.comReset, zeroEhSemLeitura: p.zeroEhSemLeitura,
  })
}
