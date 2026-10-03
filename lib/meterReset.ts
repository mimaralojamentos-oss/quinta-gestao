/**
 * Troca de contador: a contagem recomeça do zero.
 *
 * Quando o contador físico de um espaço é trocado, o contador antigo fecha
 * na última leitura que já está na app (nada do histórico é mexido) e o
 * contador novo arranca com uma leitura de valor 0.
 *
 * COMO SE RECONHECE UM ARRANQUE, sem coluna nova nem marcas em texto:
 * um contador nunca volta a zero sozinho, por isso o próprio valor 0 é a
 * marca. É a leitura que corta a cadeia: não tem anterior, não tem consumo
 * e a leitura seguinte conta a partir de 0. Uma nota em texto não servia —
 * o campo das notas é editável e a marca podia desaparecer sem ninguém
 * perceber, e aí a cadeia voltava a ligar o contador novo ao antigo.
 *
 * O mesmo código serve a Luz (kwh_consumed) e a Água (m3_consumed): a
 * diferença entra pelo campo das unidades.
 */

export type CampoUnidades = 'kwh_consumed' | 'm3_consumed'

/** Nota automática da leitura de arranque. */
export const NOTA_RESET = 'Troca de contador — início de contagem a 0'

export interface LeituraDaCadeia {
  id: string
  reading_date: string
  reading_value: number
  charged?: boolean
  waived?: boolean
}

/**
 * True quando a leitura é o arranque de um contador novo.
 *
 * Também é true na primeiríssima leitura de um espaço que comece a 0 — o
 * tratamento é o mesmo (sem anterior e sem consumo), por isso não faz
 * diferença.
 */
export function ehArranqueDeContador(leitura: { reading_value: number | string | null } | null | undefined): boolean {
  if (!leitura) return false
  const valor = Number(leitura.reading_value)
  return Number.isFinite(valor) && valor === 0
}

/**
 * A leitura de arranque do contador novo, pronta a gravar.
 *
 * Nunca gera consumo nem cobrança. Se o espaço tinha valor acumulado do
 * contador antigo, esse valor continua a contar para a próxima cobrança —
 * uma troca de contador não é a saída de um inquilino e não pode fazer
 * desaparecer dinheiro em dívida.
 */
export function leituraDeArranque(p: {
  spaceId: string
  dataISO: string
  acumulado: number
  campoUnidades: CampoUnidades
}): Record<string, unknown> {
  const transporta = p.acumulado > 0
  return {
    space_id: p.spaceId,
    reading_date: p.dataISO,
    reading_value: 0,
    previous_value: null,
    [p.campoUnidades]: null,
    amount_calculated: transporta ? parseFloat(p.acumulado.toFixed(2)) : 0,
    // Sem acumulado, fica tratada (não transita nada para a leitura
    // seguinte). Com acumulado, continua acumulada com esse valor.
    charged: !transporta,
    accumulated: transporta,
    waived: false,
    waived_reason: null,
    share_split: null,
    notes: NOTA_RESET,
  }
}

/** Recusa datas que ponham o arranque antes do fecho do contador antigo. */
export function validarDataDoReset(dataISO: string, ultimaDataISO: string | null): string | null {
  if (!dataISO) return 'Indica a data em que o contador novo começou a contar.'
  if (ultimaDataISO && dataISO < ultimaDataISO) {
    return 'A data do arranque não pode ser anterior à última leitura registada do contador antigo.'
  }
  return null
}

/**
 * As ligações da cadeia de leituras de um espaço, refeitas por ordem
 * cronológica — com o corte nos arranques de contador.
 *
 * Devolve só o que há a gravar em cada leitura. Leituras já cobradas ou
 * oferecidas mantêm o valor: essas já produziram (ou dispensaram) uma
 * cobrança e reescrevê-las alteraria contas fechadas. O arranque também
 * mantém o seu valor, que é o acumulado que transporta.
 */
export function cadeiaRecalculada(
  leituras: LeituraDaCadeia[],
  opcoes: { campoUnidades: CampoUnidades; precoComIva: number },
): { id: string; patch: Record<string, unknown> }[] {
  const ordenadas = [...leituras].sort((a, b) => String(a.reading_date).localeCompare(String(b.reading_date)))
  const resultado: { id: string; patch: Record<string, unknown> }[] = []

  let anterior: number | null = null
  for (const r of ordenadas) {
    const arranque = ehArranqueDeContador(r)
    const unidades = (!arranque && anterior != null)
      ? parseFloat((Number(r.reading_value) - anterior).toFixed(2))
      : null

    const patch: Record<string, unknown> = {
      previous_value: arranque ? null : anterior,
      [opcoes.campoUnidades]: unidades,
    }

    if (!arranque && !r.charged && !r.waived) {
      patch.amount_calculated = unidades != null
        ? parseFloat((unidades * opcoes.precoComIva).toFixed(2))
        : null
    }

    resultado.push({ id: r.id, patch })
    anterior = Number(r.reading_value)
  }

  return resultado
}
