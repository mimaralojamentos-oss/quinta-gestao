import { formatCurrency, formatDate } from './utils'

/**
 * Revisão de Rendas: o estudo anual de atualização dos preços.
 *
 * É SÓ UM ESTUDO. Nada aqui toca em contratos, rendas ou pagamentos: o valor
 * atual de cada fração é uma FOTOGRAFIA tirada quando o estudo é criado, e
 * fica guardada no próprio estudo. Se as rendas mudarem entretanto, a
 * fotografia só é refrescada quando alguém o pedir.
 *
 * As contas vivem todas aqui para serem as mesmas no ecrã e na impressão.
 */

export interface EstudoRevisao {
  id: string
  ano: number
  /** Multiplicador (1,0256 = +2,56%). */
  coeficiente: number
  notes: string | null
  created_at?: string
}

export interface ItemRevisao {
  id: string
  study_id: string
  space_id: string
  /** Capturados quando o estudo foi criado — a fotografia. */
  space_ref: string
  tenant_name: string | null
  valor_atual: number
  lease_start_date: string | null
  lease_id: string | null
  com_aumento: boolean
  /** Null = segue o recomendado (ou o valor atual, se for sem aumento). */
  valor_a_pedir: number | null
}

// ---------------------------------------------------------- coeficiente

export interface CoeficienteLido {
  /** O multiplicador (1,0256). */
  coeficiente: number
  /** A mesma coisa em percentagem (2,56). */
  percentagem: number
}

/**
 * Lê o coeficiente escrito à mão, nas duas formas que se usam:
 *   "1,0256" ou "1.0256"  → multiplicador
 *   "2,56%" ou "2,56 %"   → percentagem
 *
 * Sem o símbolo de percentagem, decide-se pelo valor: números a partir de 1,5
 * só podem ser percentagens (um aumento de 50% num ano não acontece, mas um
 * IPC de 2,56 escrito sem o % acontece todos os dias).
 */
export function lerCoeficiente(texto: string | number | null | undefined): CoeficienteLido | null {
  if (texto === null || texto === undefined || texto === '') return null

  const bruto = String(texto).trim().replace(',', '.')
  const ehPercentagem = bruto.includes('%')
  const numero = parseFloat(bruto.replace('%', '').trim())
  if (!Number.isFinite(numero)) return null

  const percentagem = (ehPercentagem || numero >= 1.5) ? numero : (numero - 1) * 100
  return {
    coeficiente: parseFloat((1 + percentagem / 100).toFixed(6)),
    percentagem: parseFloat(percentagem.toFixed(4)),
  }
}

/** Como se escreve o coeficiente no ecrã e na impressão. */
export function escreverCoeficiente(coeficiente: number): string {
  const pct = (coeficiente - 1) * 100
  const n = (v: number, casas: number) =>
    v.toLocaleString('pt-PT', { minimumFractionDigits: casas, maximumFractionDigits: casas })
  return `${n(coeficiente, 4)} (${n(pct, 2)}%)`
}

// ------------------------------------------------------------- cálculos

/** O valor recomendado: valor atual × coeficiente, ao cêntimo. */
export function valorRecomendado(valorAtual: number, coeficiente: number): number {
  return parseFloat((Number(valorAtual ?? 0) * Number(coeficiente ?? 1)).toFixed(2))
}

/**
 * Pré-marcação ao criar o estudo: um contrato que começou há menos de 12
 * meses, contados a partir de 1 de janeiro do ano do estudo, nasce "sem
 * aumento" — é a regra prática de não aumentar a quem entrou agora. A marca
 * é sempre alterável à mão depois.
 */
export function nasceSemAumento(leaseStartDate: string | null | undefined, anoDoEstudo: number): boolean {
  if (!leaseStartDate) return false
  const limite = `${anoDoEstudo - 1}-01-01`
  return String(leaseStartDate).slice(0, 10) > limite
}

export interface LinhaCalculada extends ItemRevisao {
  recomendado: number
  /** O que vai ser pedido: o valor escrito, o recomendado, ou o atual se for sem aumento. */
  aPedir: number
  diferenca: number
  /** true quando o contrato capturado já não está ativo. */
  contratoTerminado?: boolean
}

/**
 * Uma linha do estudo, com as contas feitas.
 *
 * Linha sem aumento: o valor a pedir é SEMPRE o valor atual, mesmo que o
 * coeficiente mude depois — e não é editável enquanto a marca estiver ativa.
 */
export function calcularLinha(item: ItemRevisao, coeficiente: number, ativos?: Set<string>): LinhaCalculada {
  const recomendado = valorRecomendado(item.valor_atual, coeficiente)
  const aPedir = item.com_aumento
    ? (item.valor_a_pedir ?? recomendado)
    : Number(item.valor_atual ?? 0)

  return {
    ...item,
    recomendado,
    aPedir: parseFloat(Number(aPedir).toFixed(2)),
    diferenca: parseFloat((Number(aPedir) - Number(item.valor_atual ?? 0)).toFixed(2)),
    contratoTerminado: ativos ? !ativos.has(item.space_id) : undefined,
  }
}

export interface TotaisRevisao {
  frações: number
  comAumento: number
  semAumento: number
  atual: number
  recomendado: number
  aPedir: number
  /** O número que interessa na conversa entre os donos. */
  diferenca: number
}

/** Os totais somam as linhas, para baterem sempre com o que está na tabela. */
export function calcularTotais(linhas: LinhaCalculada[]): TotaisRevisao {
  const soma = (f: (l: LinhaCalculada) => number) =>
    parseFloat((linhas ?? []).reduce((s, l) => s + f(l), 0).toFixed(2))

  return {
    frações: linhas.length,
    comAumento: linhas.filter(l => l.com_aumento).length,
    semAumento: linhas.filter(l => !l.com_aumento).length,
    atual: soma(l => Number(l.valor_atual ?? 0)),
    recomendado: soma(l => l.recomendado),
    aPedir: soma(l => l.aPedir),
    diferenca: soma(l => l.diferenca),
  }
}

/** Ordena como se lê: pela referência da fração. */
export function ordenarLinhas(linhas: LinhaCalculada[]): LinhaCalculada[] {
  return [...linhas].sort((a, b) =>
    String(a.space_ref).localeCompare(String(b.space_ref), 'pt', { numeric: true, sensitivity: 'base' }))
}

// ----------------------------------------------------------- impressão

const escapar = (t: unknown) => String(t ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * O documento do estudo, em HTML pronto a imprimir (A4, preto e branco).
 *
 * As linhas sem aumento saem esbatidas mas legíveis, com a marca escrita —
 * numa fotocópia a cinzento tem de continuar a ver-se qual é qual.
 */
export function htmlEstudoRevisao(p: {
  estudo: EstudoRevisao
  linhas: LinhaCalculada[]
  appName?: string
  appLocation?: string
  emitidoEm?: Date
}): string {
  const linhas = ordenarLinhas(p.linhas)
  const t = calcularTotais(linhas)
  const titulo = p.appName ?? 'Gestão de Alojamentos'
  const local = p.appLocation ?? 'Évora'
  const emitido = formatDate((p.emitidoEm ?? new Date()).toISOString().slice(0, 10))

  const corpo = linhas.map(l => `
      <tr${l.com_aumento ? '' : ' class="sem-aumento"'}>
        <td class="nowrap forte">${escapar(l.space_ref)}</td>
        <td>${escapar(l.tenant_name ?? '—')}</td>
        <td class="nowrap">${l.com_aumento
          ? '<span class="marca">com aumento</span>'
          : '<span class="marca">sem aumento</span>'}${l.contratoTerminado
            ? ' <span class="marca">contrato terminado</span>' : ''}</td>
        <td class="right nowrap">${escapar(formatCurrency(Number(l.valor_atual ?? 0)))}</td>
        <td class="right nowrap">${escapar(formatCurrency(l.recomendado))}</td>
        <td class="right nowrap forte">${escapar(formatCurrency(l.aPedir))}</td>
        <td class="right nowrap">${l.diferenca === 0 ? '—' : escapar(formatCurrency(l.diferenca))}</td>
      </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <title>Revisão de Rendas ${p.estudo.ano} — ${escapar(titulo)}</title>
  <style>
    @page { size: A4 portrait; margin: 16mm 14mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; }
    .cabecalho { display: flex; justify-content: space-between; align-items: flex-start;
                 border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 16px; }
    .cabecalho h1 { font-size: 19px; }
    .cabecalho p { font-size: 11.5px; color: #555; margin-top: 3px; }
    .meta { text-align: right; font-size: 11.5px; color: #555; }
    .meta strong { color: #111; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
    thead th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .04em;
               border-bottom: 1.5px solid #111; padding: 7px 6px; }
    tbody td { padding: 6px; border-bottom: 1px solid #e5e5e5; }
    tfoot td { padding: 8px 6px; border-top: 1.5px solid #111; font-weight: 700; font-size: 12.5px; }
    .right { text-align: right; }
    .nowrap { white-space: nowrap; }
    .forte { font-weight: 700; }
    .marca { display: inline-block; border: 1px solid #999; border-radius: 9px;
             padding: 0 5px; font-size: 9px; color: #444; white-space: nowrap; }
    /* Esbatida mas legível a preto e branco, e com o fundo riscado a cinzento
       claro para se distinguir numa fotocópia. */
    tr.sem-aumento td { color: #777; background: #f2f2f2; font-style: italic; }
    tr.sem-aumento .forte { font-weight: 400; }
    .nota { font-size: 10.5px; color: #666; margin-top: 12px; }
    .rodape { margin-top: 20px; border-top: 1px solid #ddd; padding-top: 10px;
              display: flex; justify-content: space-between; font-size: 10px; color: #888; }
  </style>
</head>
<body>
  <div class="cabecalho">
    <div>
      <h1>Revisão de Rendas ${p.estudo.ano}</h1>
      <p>${escapar(titulo)} · ${escapar(local)}</p>
    </div>
    <div class="meta">
      <p>Coeficiente: <strong>${escapar(escreverCoeficiente(p.estudo.coeficiente))}</strong></p>
      <p>Emitido em: <strong>${escapar(emitido)}</strong></p>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Fração</th>
        <th>Inquilino</th>
        <th>Aumento</th>
        <th class="right">Valor atual</th>
        <th class="right">Recomendado</th>
        <th class="right">A pedir</th>
        <th class="right">Diferença</th>
      </tr>
    </thead>
    <tbody>${corpo}</tbody>
    <tfoot>
      <tr>
        <td colspan="3">${t.frações} fração(ões) · ${t.semAumento} sem aumento</td>
        <td class="right">${escapar(formatCurrency(t.atual))}</td>
        <td class="right">${escapar(formatCurrency(t.recomendado))}</td>
        <td class="right">${escapar(formatCurrency(t.aPedir))}</td>
        <td class="right">${escapar(formatCurrency(t.diferenca))}</td>
      </tr>
    </tfoot>
  </table>

  <p class="nota">
    As linhas esbatidas estão marcadas como <strong>sem aumento</strong>: entram nos
    totais com o valor atual. O recomendado é o valor atual multiplicado pelo
    coeficiente; o valor a pedir é o que foi decidido, podendo ficar acima ou abaixo.
    ${p.estudo.notes ? `<br><br>${escapar(p.estudo.notes)}` : ''}
  </p>

  <div class="rodape">
    <span>${escapar(titulo)} · ${escapar(local)}</span>
    <span>Estudo interno — não altera contratos nem rendas</span>
  </div>

  <script>window.onload = () => window.print()</script>
</body>
</html>`
}
