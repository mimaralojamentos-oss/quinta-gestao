import { formatCurrency, formatDate } from '@/lib/utils'
import { formatarHoras, ehValorFixo, type RelatorioPagamento, type Worker } from '@/lib/ponto'

/**
 * O documento do relatório de pagamento, em HTML pronto a imprimir.
 *
 * Abre-se numa janela nova e imprime-se (ou guarda-se como PDF) pelo
 * browser, como as listas de leituras da luz e da água. Pensado para A4 e
 * para se ler a preto e branco: as marcas são caixas com contorno, não
 * manchas de cor.
 *
 * É só leitura — o documento não altera nada. O pagamento registra-se
 * depois como sempre, e é o recibo que fica assinado.
 */

/** O texto que vem dos dados nunca entra cru no HTML. */
function escapar(texto: unknown): string {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function estadoTexto(e: RelatorioPagamento['entradas'][number]): string {
  if (e.estado === 'pago') return 'pago'
  if (e.estado === 'parcial') return `parcial — falta ${formatCurrency(e.emFalta)}`
  return 'por pagar'
}

export function htmlRelatorioPagamento(p: {
  worker: Pick<Worker, 'name' | 'nif' | 'hourly_rate' | 'hourly_rate_holiday'>
  relatorio: RelatorioPagamento
  emitidoEm?: Date
  appName?: string
  appLocation?: string
}): string {
  const { worker, relatorio } = p
  const emitido = formatDate((p.emitidoEm ?? new Date()).toISOString().slice(0, 10))
  const titulo = p.appName ?? 'Gestão da Quinta'
  const local = p.appLocation ?? 'Évora'

  const linhas = relatorio.entradas.map(e => {
    const fixo = ehValorFixo(e)
    return `
      <tr>
        <td class="nowrap">
          ${escapar(formatDate(e.work_date))}
          ${e.is_holiday ? '<span class="marca">fds/feriado</span>' : ''}
        </td>
        <td class="nowrap">${fixo
          ? '<span class="marca">valor fixo</span>'
          : `${escapar(String(e.start_time).slice(0, 5))} — ${escapar(String(e.end_time).slice(0, 5))}`}</td>
        <td class="nowrap right">${fixo ? '—' : escapar(formatarHoras(e.hours))}</td>
        <td>${escapar(e.description ?? '—')}</td>
        <td class="nowrap right forte">${escapar(formatCurrency(Number(e.amount ?? 0)))}</td>
        <td class="nowrap">${escapar(estadoTexto(e))}</td>
      </tr>`
  }).join('')

  const semRegistos = relatorio.entradas.length === 0

  return `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <title>Relatório de pagamento — ${escapar(worker.name)}</title>
  <style>
    @page { size: A4 portrait; margin: 18mm 16mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 12.5px; color: #111; }
    .cabecalho { display: flex; justify-content: space-between; align-items: flex-start;
                 border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 18px; }
    .cabecalho h1 { font-size: 19px; }
    .cabecalho p { font-size: 11.5px; color: #555; margin-top: 3px; }
    .cabecalho .meta { text-align: right; font-size: 11.5px; color: #555; }
    .caixa { border: 1px solid #bbb; border-radius: 6px; padding: 12px 16px; margin-bottom: 18px;
             display: flex; gap: 32px; flex-wrap: wrap; }
    .caixa label { display: block; font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: .05em; }
    .caixa span { font-size: 13.5px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    thead th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .04em;
               border-bottom: 1.5px solid #111; padding: 7px 8px; }
    tbody td { padding: 7px 8px; border-bottom: 1px solid #e5e5e5; vertical-align: top; }
    tbody tr:nth-child(even) { background: #f7f7f7; }
    .right { text-align: right; }
    .nowrap { white-space: nowrap; }
    .forte { font-weight: 700; }
    .marca { display: inline-block; border: 1px solid #999; border-radius: 9px;
             padding: 0 5px; font-size: 9.5px; color: #444; margin-left: 4px; white-space: nowrap; }
    .totais { border: 1px solid #bbb; border-radius: 6px; margin-bottom: 10px; }
    .totais div { display: flex; justify-content: space-between; padding: 8px 16px; border-bottom: 1px solid #eee; }
    .totais div:last-child { border-bottom: 0; }
    .totais .etiqueta { color: #444; }
    .totais .liquidar { background: #f0f0f0; }
    .totais .liquidar .etiqueta,
    .totais .liquidar .valor { font-size: 16px; font-weight: 700; color: #111; }
    .vazio { border: 1px dashed #bbb; border-radius: 6px; padding: 24px; text-align: center; color: #666; margin-bottom: 18px; }
    .nota { font-size: 10.5px; color: #666; margin-top: 14px; }
    .rodape { margin-top: 26px; border-top: 1px solid #ddd; padding-top: 10px;
              display: flex; justify-content: space-between; font-size: 10px; color: #888; }
  </style>
</head>
<body>
  <div class="cabecalho">
    <div>
      <h1>Relatório de pagamento</h1>
      <p>${escapar(titulo)} · ${escapar(local)}</p>
    </div>
    <div class="meta">
      <p>Período: <strong>${escapar(formatDate(relatorio.periodo.de))} a ${escapar(formatDate(relatorio.periodo.ate))}</strong></p>
      <p>Emitido em: <strong>${escapar(emitido)}</strong></p>
    </div>
  </div>

  <div class="caixa">
    <div><label>Trabalhador</label><span>${escapar(worker.name)}</span></div>
    ${worker.nif ? `<div><label>NIF</label><span>${escapar(worker.nif)}</span></div>` : ''}
    <div><label>Tarifa</label><span>${escapar(formatCurrency(Number(worker.hourly_rate)))}/hora</span></div>
    ${worker.hourly_rate_holiday
      ? `<div><label>Fins de semana e feriados</label><span>${escapar(formatCurrency(Number(worker.hourly_rate_holiday)))}/hora</span></div>`
      : ''}
  </div>

  ${semRegistos ? `
  <div class="vazio">Sem dias registados neste período.</div>
  ` : `
  <table>
    <thead>
      <tr>
        <th>Dia</th>
        <th>Horário</th>
        <th class="right">Horas</th>
        <th>Trabalho</th>
        <th class="right">Valor</th>
        <th>Estado</th>
      </tr>
    </thead>
    <tbody>${linhas}</tbody>
  </table>
  `}

  <div class="totais">
    <div><span class="etiqueta">Total de horas</span><span class="valor">${escapar(formatarHoras(relatorio.totalHoras))}</span></div>
    <div><span class="etiqueta">Total ganho no período</span><span class="valor">${escapar(formatCurrency(relatorio.totalGanho))}</span></div>
    <div><span class="etiqueta">Já pago</span><span class="valor">${escapar(formatCurrency(relatorio.totalPago))}</span></div>
    <div class="liquidar"><span class="etiqueta">Por pagar</span><span class="valor">${escapar(formatCurrency(relatorio.porPagar))}</span></div>
  </div>

  <p class="nota">
    ${relatorio.registosPorPagar > 0
      ? `${relatorio.registosPorPagar} registo(s) deste período ainda não estão pagos por inteiro.`
      : 'Todos os registos deste período estão pagos.'}
    Os dias com valor fixo não têm horário nem horas e entram apenas pelo valor combinado.
  </p>

  <div class="rodape">
    <span>${escapar(titulo)} · ${escapar(local)}</span>
    <span>Documento informativo — não serve de recibo</span>
  </div>

  <script>window.onload = () => window.print()</script>
</body>
</html>`
}
