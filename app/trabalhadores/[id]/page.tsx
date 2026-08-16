'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState, use } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  calcularConta, calcularHoras, formatarHoras, tarifaDoDia, ehDiaEspecial,
  motivoDiaEspecial, gerarToken, gerarPin,
  type Worker, type WorkEntry, type WorkerPayment, type ResumoConta,
} from '@/lib/ponto'
import { useAuth } from '@/lib/auth-context'
import { logAccess } from '@/lib/logAccess'
import {
  ChevronLeft, Copy, Check, Plus, Trash2, Pencil, X, Loader2,
  Banknote, RefreshCw, Link2, FileText,
} from 'lucide-react'
import Link from 'next/link'

/**
 * Ficha de um trabalhador: tarifas, link de acesso, registos e pagamentos.
 *
 * Cada pagamento registado aqui cria automaticamente:
 *   - uma despesa paga em dinheiro,
 *   - a saída correspondente no fundo de maneio,
 *   - um recibo em PDF guardado nos documentos e ligado à despesa.
 */

/** Número do recibo. Fora do componente para não correr durante o desenho do ecrã. */
function novoNumeroRecibo(): string {
  return `REC-${Date.now().toString().slice(-8)}`
}

export default function TrabalhadorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const supabase = createClient()
  const { isAdmin, isCoAdmin } = useAuth()
  const podeEditar = isAdmin || isCoAdmin

  const [worker, setWorker] = useState<Worker | null>(null)
  const [conta, setConta] = useState<ResumoConta | null>(null)
  const [pagamentos, setPagamentos] = useState<WorkerPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [copiado, setCopiado] = useState<'link' | 'pin' | null>(null)

  // Edição das tarifas e dos dados
  const [editarDados, setEditarDados] = useState(false)
  const [dados, setDados] = useState({ name: '', phone: '', nif: '', notes: '', hourly_rate: '', hourly_rate_holiday: '', active: true })
  const [guardandoDados, setGuardandoDados] = useState(false)

  // Registo de horas (pelo gestor)
  const [formHoras, setFormHoras] = useState<{ id?: string; work_date: string; start_time: string; end_time: string; description: string } | null>(null)
  const [guardandoHoras, setGuardandoHoras] = useState(false)

  // Pagamento
  const [formPagamento, setFormPagamento] = useState<{ payment_date: string; amount: string; notes: string } | null>(null)
  const [guardandoPagamento, setGuardandoPagamento] = useState(false)
  const [erroPagamento, setErroPagamento] = useState('')


  async function carregar(silencioso = false) {
    if (!silencioso) setLoading(true)
    const [wRes, eRes, pRes] = await Promise.all([
      supabase.from('workers').select('*').eq('id', id).maybeSingle(),
      supabase.from('work_entries').select('*').eq('worker_id', id),
      supabase.from('worker_payments').select('*').eq('worker_id', id),
    ])

    if (wRes.error || !wRes.data) {
      setErro(wRes.error?.message ?? 'Trabalhador não encontrado.')
      setLoading(false)
      return
    }

    const w = wRes.data as Worker
    setWorker(w)
    setDados({
      name: w.name, phone: w.phone ?? '', nif: w.nif ?? '', notes: w.notes ?? '',
      hourly_rate: String(w.hourly_rate ?? ''),
      hourly_rate_holiday: w.hourly_rate_holiday != null ? String(w.hourly_rate_holiday) : '',
      active: w.active,
    })
    setConta(calcularConta((eRes.data ?? []) as WorkEntry[], (pRes.data ?? []) as WorkerPayment[]))
    setPagamentos(((pRes.data ?? []) as WorkerPayment[]).sort((a, b) =>
      String(b.payment_date).localeCompare(String(a.payment_date))))
    setLoading(false)
  }

  const linkPonto = typeof window !== 'undefined' && worker
    ? `${window.location.origin}/ponto/${worker.access_token}`
    : ''

  async function copiar(texto: string, qual: 'link' | 'pin') {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(qual)
      setTimeout(() => setCopiado(null), 2000)
    } catch {
      alert('Não foi possível copiar. Seleciona o texto e copia à mão.')
    }
  }

  // ------------------------------------------------------------ dados
  async function guardarDados() {
    if (!worker) return
    const tarifa = parseFloat(dados.hourly_rate)
    if (!dados.name.trim()) { alert('O nome é obrigatório'); return }
    if (!tarifa || tarifa <= 0) { alert('Indica o preço por hora'); return }

    setGuardandoDados(true)
    const { error } = await supabase.from('workers').update({
      name: dados.name.trim(),
      phone: dados.phone.trim() || null,
      nif: dados.nif.trim() || null,
      notes: dados.notes.trim() || null,
      hourly_rate: tarifa,
      hourly_rate_holiday: dados.hourly_rate_holiday ? parseFloat(dados.hourly_rate_holiday) : null,
      active: dados.active,
    }).eq('id', worker.id)
    setGuardandoDados(false)
    if (error) { alert(`Não foi possível guardar: ${error.message}`); return }

    await logAccess({ action: 'editar', page: '/trabalhadores', details: `Editou o trabalhador "${dados.name.trim()}"` })
    setEditarDados(false)
    await carregar(true)
  }

  async function novoLink() {
    if (!worker) return
    if (!confirm('Gerar um link e um código novos?\n\nO link antigo deixa de funcionar imediatamente. Terás de enviar o novo ao trabalhador.')) return
    const { error } = await supabase.from('workers')
      .update({ access_token: gerarToken(), pin: gerarPin() })
      .eq('id', worker.id)
    if (error) { alert(`Não foi possível: ${error.message}`); return }
    await logAccess({ action: 'editar', page: '/trabalhadores', details: `Gerou novo link de acesso para "${worker.name}"` })
    await carregar(true)
  }

  // ------------------------------------------------------------ horas
  async function guardarHoras() {
    if (!worker || !formHoras) return
    const horas = calcularHoras(formHoras.start_time, formHoras.end_time)
    if (horas <= 0) { alert('A hora de saída tem de ser depois da entrada.'); return }

    setGuardandoHoras(true)
    const tarifa = tarifaDoDia(worker, formHoras.work_date)
    const payload = {
      worker_id: worker.id,
      work_date: formHoras.work_date,
      start_time: formHoras.start_time,
      end_time: formHoras.end_time,
      hours: horas,
      is_holiday: ehDiaEspecial(formHoras.work_date),
      hourly_rate: tarifa,
      amount: parseFloat((horas * tarifa).toFixed(2)),
      description: formHoras.description.trim() || null,
      created_by: 'gestor',
    }

    const { error } = formHoras.id
      ? await supabase.from('work_entries').update(payload).eq('id', formHoras.id)
      : await supabase.from('work_entries').insert(payload)

    setGuardandoHoras(false)
    if (error) { alert(`Não foi possível guardar: ${error.message}`); return }

    await logAccess({
      action: formHoras.id ? 'editar' : 'criar',
      page: '/trabalhadores',
      details: `${formHoras.id ? 'Editou' : 'Registou'} ${formatarHoras(horas)} de "${worker.name}" em ${formatDate(formHoras.work_date)}`,
    })
    setFormHoras(null)
    await carregar(true)
  }

  async function apagarHoras(e: any) {
    if (!confirm(`Apagar o registo de ${formatDate(e.work_date)} (${formatarHoras(e.hours)} · ${formatCurrency(e.amount)})?`)) return
    const { error } = await supabase.from('work_entries').delete().eq('id', e.id)
    if (error) { alert(`Não foi possível apagar: ${error.message}`); return }
    await logAccess({ action: 'apagar', page: '/trabalhadores', details: `Apagou registo de horas de "${worker?.name}" em ${formatDate(e.work_date)}` })
    await carregar(true)
  }

  // ------------------------------------------------------------ recibo
  /** Recibo em PDF do pagamento, para ficar prova nos documentos. */
  async function gerarRecibo(numero: string, valor: number, data: string, notas: string): Promise<Blob> {
    const { default: jsPDF } = await import('jspdf')
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
    const largura = pdf.internal.pageSize.getWidth()
    const margem = 20
    let y = 28

    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16)
    pdf.text('RECIBO DE PAGAMENTO', margem, y)
    y += 7
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(120)
    pdf.text(`${process.env.NEXT_PUBLIC_APP_NAME ?? 'Gestão da Quinta'}  -  ${process.env.NEXT_PUBLIC_APP_LOCATION ?? 'Evora'}`, margem, y)
    pdf.text(`No ${numero}`, largura - margem, y, { align: 'right' })
    y += 8
    pdf.setDrawColor(200); pdf.line(margem, y, largura - margem, y)
    y += 12

    const linha = (etiqueta: string, valorTexto: string) => {
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(110)
      pdf.text(etiqueta, margem, y)
      y += 5
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(11); pdf.setTextColor(20)
      pdf.text(valorTexto, margem, y)
      y += 10
    }

    linha('RECEBI DE', process.env.NEXT_PUBLIC_APP_NAME ?? 'Gestao da Quinta')
    linha('TRABALHADOR', worker?.name ?? '')
    if (worker?.nif) linha('NIF', worker.nif)
    linha('DATA DO PAGAMENTO', formatDate(data))
    linha('FORMA DE PAGAMENTO', 'Dinheiro')

    pdf.setDrawColor(220); pdf.line(margem, y, largura - margem, y); y += 10
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(110)
    pdf.text('VALOR RECEBIDO', margem, y); y += 8
    pdf.setFontSize(22); pdf.setTextColor(16, 122, 86)
    pdf.text(`${valor.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`, margem, y)
    pdf.setTextColor(20); y += 14

    if (notas) {
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(110)
      pdf.text('OBSERVACOES', margem, y); y += 5
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(40)
      const linhas = pdf.splitTextToSize(notas, largura - margem * 2)
      pdf.text(linhas, margem, y); y += linhas.length * 5 + 6
    }

    y = Math.max(y, 200)
    pdf.setDrawColor(150)
    pdf.line(margem, y, margem + 70, y)
    pdf.line(largura - margem - 70, y, largura - margem, y)
    y += 5
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(120)
    pdf.text('O pagador', margem + 35, y, { align: 'center' })
    pdf.text('O trabalhador', largura - margem - 35, y, { align: 'center' })

    const altura = pdf.internal.pageSize.getHeight()
    pdf.setFont('helvetica', 'italic'); pdf.setFontSize(7.5); pdf.setTextColor(150)
    pdf.text(
      `Documento gerado automaticamente em ${new Date().toLocaleDateString('pt-PT')}`,
      largura / 2, altura - 14, { align: 'center' }
    )

    return pdf.output('blob')
  }

  // ------------------------------------------------------------ pagamento
  async function guardarPagamento() {
    if (!worker || !formPagamento) return
    const valor = parseFloat(formPagamento.amount)
    if (!valor || valor <= 0) { setErroPagamento('Indica um valor válido'); return }

    setGuardandoPagamento(true); setErroPagamento('')
    const data = formPagamento.payment_date
    const notas = formPagamento.notes.trim()
    const numero = novoNumeroRecibo()
    const descricao = `Pagamento a ${worker.name} — trabalho${notas ? ` (${notas})` : ''}`

    try {
      // 1. Despesa, paga em dinheiro
      const { data: despesa, error: errDespesa } = await supabase.from('expenses').insert({
        expense_date: data,
        category: 'pessoal',
        type: 'pontual',
        description: descricao,
        amount: valor,
        payment_method: 'dinheiro',
        supplier: worker.name,
        notes: `Folha de ponto — recibo ${numero}`,
      }).select().single()
      if (errDespesa) throw new Error(`ao criar a despesa: ${errDespesa.message}`)

      // 2. Saída do fundo de maneio
      await supabase.from('cash_fund_movements').insert({
        movement_date: data,
        description: `💸 ${descricao}`,
        amount: -Math.abs(valor),
        type: 'saida',
        source: 'despesa',
        source_id: despesa.id,
        notes: notas || null,
      })

      // 3. Recibo em PDF, guardado nos documentos
      let documentoId: string | null = null
      try {
        const blob = await gerarRecibo(numero, valor, data, notas)
        const nomeLimpo = worker.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30)
        const caminho = `recibos/${data}_${nomeLimpo}_${numero}.pdf`

        const { error: errUpload } = await supabase.storage
          .from('documents').upload(caminho, blob, { contentType: 'application/pdf', upsert: false })
        if (!errUpload) {
          const { data: doc } = await supabase.from('documents').insert({
            file_path: caminho,
            original_name: `Recibo ${numero} — ${worker.name}.pdf`,
            tipo: 'outro',
            tipo_custom: 'Recibo de pagamento',
            supplier_name: worker.name,
            amount: valor,
            doc_date: data,
            doc_number: numero,
            items_summary: descricao,
            category: 'pessoal',
            ocr_done: false,
            status: 'ativo',
            expense_id: despesa.id,
          }).select().single()
          if (doc) {
            documentoId = doc.id
            await supabase.from('expenses').update({ invoice_id: doc.id }).eq('id', despesa.id)
          }
        }
      } catch {
        // O recibo é um extra: se falhar, o pagamento fica registado na mesma.
      }

      // 4. O pagamento em si
      const { error: errPag } = await supabase.from('worker_payments').insert({
        worker_id: worker.id,
        payment_date: data,
        amount: valor,
        payment_method: 'dinheiro',
        notes: notas || null,
        expense_id: despesa.id,
        document_id: documentoId,
      })
      if (errPag) throw new Error(`ao registar o pagamento: ${errPag.message}`)

      await logAccess({
        action: 'criar', page: '/trabalhadores',
        details: `Pagou ${formatCurrency(valor)} a "${worker.name}" — despesa e recibo ${numero} criados`,
      })

      setFormPagamento(null)
      await carregar(true)
    } catch (e: any) {
      setErroPagamento(`Não foi possível concluir ${e.message ?? e}`)
    } finally {
      setGuardandoPagamento(false)
    }
  }

  async function apagarPagamento(p: WorkerPayment) {
    if (!confirm(
      `Apagar o pagamento de ${formatCurrency(p.amount)} de ${formatDate(p.payment_date)}?` +
      `\n\nA despesa e a saída do fundo de maneio também são apagadas. O recibo fica nos documentos.`
    )) return

    if (p.expense_id) {
      await supabase.from('cash_fund_movements').delete().eq('source_id', p.expense_id)
      await supabase.from('documents').update({ expense_id: null }).eq('expense_id', p.expense_id)
      await supabase.from('expenses').delete().eq('id', p.expense_id)
    }
    const { error } = await supabase.from('worker_payments').delete().eq('id', p.id)
    if (error) { alert(`Não foi possível apagar: ${error.message}`); return }

    await logAccess({ action: 'apagar', page: '/trabalhadores', details: `Apagou pagamento de ${formatCurrency(p.amount)} a "${worker?.name}"` })
    await carregar(true)
  }

  async function abrirRecibo(documentId: string) {
    const { data: doc } = await supabase.from('documents').select('file_path').eq('id', documentId).maybeSingle()
    if (!doc?.file_path) { alert('Recibo não encontrado.'); return }
    const { data } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  useEffect(() => { carregar() }, [id])

  // ------------------------------------------------------------ ecrã
  if (loading) {
    return <AppLayout><div className="p-8"><Loader2 className="w-6 h-6 text-emerald-600 animate-spin" /></div></AppLayout>
  }
  if (!worker) {
    return <AppLayout><div className="p-8"><p className="text-red-600">{erro || 'Trabalhador não encontrado.'}</p></div></AppLayout>
  }

  return (
    <AppLayout>
      <div className="p-4 md:p-8">
        <Link href="/trabalhadores" prefetch={false}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-emerald-600 mb-3 transition-colors">
          <ChevronLeft className="w-4 h-4" /> Folha de Ponto
        </Link>

        <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {worker.name}
              {!worker.active && <span className="ml-2 text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded-full align-middle">inativo</span>}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {formatCurrency(worker.hourly_rate)}/hora
              {worker.hourly_rate_holiday
                ? ` · ${formatCurrency(worker.hourly_rate_holiday)}/hora aos fins de semana e feriados`
                : ' · mesma tarifa aos fins de semana e feriados'}
            </p>
          </div>
          {podeEditar && (
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={() => setEditarDados(true)}>
                <Pencil className="w-4 h-4" /> Editar
              </button>
              <button className="btn-primary" onClick={() => { setFormPagamento({ payment_date: new Date().toISOString().slice(0, 10), amount: String(conta?.saldo ?? ''), notes: '' }); setErroPagamento('') }}>
                <Banknote className="w-4 h-4" /> Registar Pagamento
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div className="bg-white rounded-lg border border-gray-100 px-4 py-2.5">
            <p className="text-xs text-gray-500">Horas</p>
            <p className="text-lg font-bold text-gray-900">{formatarHoras(conta?.totalHoras ?? 0)}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-100 px-4 py-2.5">
            <p className="text-xs text-gray-500">Ganho</p>
            <p className="text-lg font-bold text-gray-900">{formatCurrency(conta?.totalGanho ?? 0)}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-100 px-4 py-2.5">
            <p className="text-xs text-gray-500">Já pago</p>
            <p className="text-lg font-bold text-gray-700">{formatCurrency(conta?.totalPago ?? 0)}</p>
          </div>
          <div className={`rounded-lg border px-4 py-2.5 ${(conta?.saldo ?? 0) > 0.005 ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
            <p className="text-xs text-gray-500">Por pagar</p>
            <p className={`text-lg font-bold ${(conta?.saldo ?? 0) > 0.005 ? 'text-red-600' : 'text-emerald-600'}`}>
              {(conta?.saldo ?? 0) > 0.005 ? formatCurrency(conta!.saldo) : '✓ em dia'}
            </p>
          </div>
        </div>

        {/* Acesso do trabalhador */}
        {podeEditar && (
          <div className="bg-white border border-gray-100 rounded-xl p-4 mb-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <Link2 className="w-4 h-4 text-emerald-600" /> Acesso do trabalhador
              </h2>
              <button onClick={novoLink} className="text-xs text-gray-400 hover:text-red-500 inline-flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> Gerar link novo
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                <label className="text-xs text-gray-500 block mb-1">Link para enviar (WhatsApp, SMS...)</label>
                <div className="flex gap-2">
                  <input readOnly className="input text-xs font-mono flex-1 min-w-0" value={linkPonto} onFocus={e => e.target.select()} />
                  <button onClick={() => copiar(linkPonto, 'link')} className="btn-secondary px-3 flex-shrink-0">
                    {copiado === 'link' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Código</label>
                <div className="flex gap-2">
                  <input readOnly className="input text-lg font-bold tracking-widest text-center w-28" value={worker.pin} />
                  <button onClick={() => copiar(worker.pin, 'pin')} className="btn-secondary px-3">
                    {copiado === 'pin' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <p className="text-xs text-gray-500 mt-3">
              Envia o link e o código. Ao abrir, o trabalhador escreve o código uma vez e fica
              guardado no telemóvel dele. Só vê as horas dele e o que tem a receber — mais nada da aplicação.
            </p>
          </div>
        )}

        {/* Registos */}
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-gray-900">Dias trabalhados</h2>
          {podeEditar && (
            <button className="btn-secondary text-sm"
              onClick={() => setFormHoras({ work_date: new Date().toISOString().slice(0, 10), start_time: '08:00', end_time: '17:00', description: '' })}>
              <Plus className="w-4 h-4" /> Registar horas
            </button>
          )}
        </div>

        {(conta?.entradas.length ?? 0) === 0 ? (
          <div className="bg-white border border-gray-100 rounded-xl p-8 text-center mb-6">
            <p className="text-sm text-gray-400">Ainda não há horas registadas.</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase">
                  <th className="table-header">Dia</th>
                  <th className="table-header">Horário</th>
                  <th className="table-header text-right">Horas</th>
                  <th className="table-header">Trabalho</th>
                  <th className="table-header text-right">Valor</th>
                  <th className="table-header">Estado</th>
                  {podeEditar && <th className="table-header"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {conta!.entradas.map(e => (
                  <tr key={e.id} className="hover:bg-gray-50 transition-colors">
                    <td className="table-cell whitespace-nowrap">
                      {formatDate(e.work_date)}
                      {e.is_holiday && <span className="ml-1.5 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">tarifa alta</span>}
                    </td>
                    <td className="table-cell text-xs text-gray-500 whitespace-nowrap">
                      {String(e.start_time).slice(0, 5)} — {String(e.end_time).slice(0, 5)}
                    </td>
                    <td className="table-cell text-right whitespace-nowrap">{formatarHoras(e.hours)}</td>
                    <td className="table-cell text-xs text-gray-600">{e.description ?? '—'}</td>
                    <td className="table-cell text-right whitespace-nowrap">
                      <span className="font-semibold text-gray-900">{formatCurrency(e.amount)}</span>
                      <span className="block text-xs text-gray-400">{formatCurrency(e.hourly_rate)}/h</span>
                    </td>
                    <td className="table-cell whitespace-nowrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        e.estado === 'pago' ? 'bg-emerald-100 text-emerald-700'
                        : e.estado === 'parcial' ? 'bg-amber-100 text-amber-700'
                        : 'bg-gray-100 text-gray-600'
                      }`}>
                        {e.estado === 'pago' ? '✓ pago'
                          : e.estado === 'parcial' ? `falta ${formatCurrency(e.emFalta)}`
                          : 'por pagar'}
                      </span>
                    </td>
                    {podeEditar && (
                      <td className="table-cell">
                        <div className="flex items-center gap-2">
                          <button onClick={() => setFormHoras({
                            id: e.id, work_date: e.work_date,
                            start_time: String(e.start_time).slice(0, 5),
                            end_time: String(e.end_time).slice(0, 5),
                            description: e.description ?? '',
                          })} className="text-gray-300 hover:text-blue-500 transition-colors" title="Editar">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => apagarHoras(e)} className="text-gray-300 hover:text-red-500 transition-colors" title="Apagar">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagamentos */}
        <h2 className="font-semibold text-gray-900 mb-2">Pagamentos</h2>
        {pagamentos.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-xl p-8 text-center">
            <p className="text-sm text-gray-400">Ainda não foi pago nada.</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase">
                  <th className="table-header">Data</th>
                  <th className="table-header">Notas</th>
                  <th className="table-header text-right">Valor</th>
                  <th className="table-header">Recibo</th>
                  {podeEditar && <th className="table-header"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {pagamentos.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    <td className="table-cell whitespace-nowrap">{formatDate(p.payment_date)}</td>
                    <td className="table-cell text-xs text-gray-600">{p.notes ?? '—'}</td>
                    <td className="table-cell text-right font-semibold text-emerald-600 whitespace-nowrap">{formatCurrency(p.amount)}</td>
                    <td className="table-cell">
                      {p.document_id ? (
                        <button onClick={() => abrirRecibo(p.document_id!)}
                          className="text-xs text-emerald-600 hover:underline inline-flex items-center gap-1">
                          <FileText className="w-3.5 h-3.5" /> Ver
                        </button>
                      ) : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    {podeEditar && (
                      <td className="table-cell">
                        <button onClick={() => apagarPagamento(p)} className="text-gray-300 hover:text-red-500 transition-colors" title="Apagar">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Janela: editar dados */}
      {editarDados && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="font-semibold text-lg text-gray-900">Editar trabalhador</h2>
              <button onClick={() => setEditarDados(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="label">Nome *</label>
                <input className="input" value={dados.name} onChange={e => setDados(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Telefone</label>
                  <input className="input" value={dados.phone} onChange={e => setDados(f => ({ ...f, phone: e.target.value }))} /></div>
                <div><label className="label">NIF</label>
                  <input className="input" value={dados.nif} onChange={e => setDados(f => ({ ...f, nif: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Preço/hora (€) *</label>
                  <input className="input" type="number" step="0.01" value={dados.hourly_rate}
                    onChange={e => setDados(f => ({ ...f, hourly_rate: e.target.value }))} /></div>
                <div><label className="label">Fim de semana e feriados (€)</label>
                  <input className="input" type="number" step="0.01" placeholder="igual ao normal" value={dados.hourly_rate_holiday}
                    onChange={e => setDados(f => ({ ...f, hourly_rate_holiday: e.target.value }))} /></div>
              </div>
              <div>
                <label className="label">Notas</label>
                <input className="input" value={dados.notes} onChange={e => setDados(f => ({ ...f, notes: e.target.value }))} />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer pt-1">
                <input type="checkbox" className="accent-emerald-600 w-4 h-4"
                  checked={dados.active} onChange={e => setDados(f => ({ ...f, active: e.target.checked }))} />
                Trabalhador ativo
              </label>
              <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                Alterar o preço por hora só afeta os registos futuros. Os dias já registados
                mantêm a tarifa que estava em vigor nessa altura.
              </p>
            </div>
            <div className="flex justify-end gap-3 p-4 border-t border-gray-100">
              <button className="btn-secondary" onClick={() => setEditarDados(false)}>Cancelar</button>
              <button className="btn-primary" onClick={guardarDados} disabled={guardandoDados}>
                {guardandoDados ? 'A guardar...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Janela: registar horas */}
      {formHoras && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="font-semibold text-lg text-gray-900">{formHoras.id ? 'Editar registo' : 'Registar horas'}</h2>
              <button onClick={() => setFormHoras(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="label">Dia</label>
                <input className="input" type="date" value={formHoras.work_date}
                  onChange={e => setFormHoras(f => f && ({ ...f, work_date: e.target.value }))} />
                {motivoDiaEspecial(formHoras.work_date) && (
                  <p className="text-xs text-amber-600 mt-1 font-medium">
                    É {motivoDiaEspecial(formHoras.work_date)} — aplica a tarifa mais alta
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Entrada</label>
                  <input className="input" type="time" value={formHoras.start_time}
                    onChange={e => setFormHoras(f => f && ({ ...f, start_time: e.target.value }))} /></div>
                <div><label className="label">Saída</label>
                  <input className="input" type="time" value={formHoras.end_time}
                    onChange={e => setFormHoras(f => f && ({ ...f, end_time: e.target.value }))} /></div>
              </div>
              <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm">
                <span className="text-gray-500">Dá </span>
                <strong className="text-gray-900">{formatarHoras(calcularHoras(formHoras.start_time, formHoras.end_time))}</strong>
                <span className="text-gray-500"> × {formatCurrency(tarifaDoDia(worker, formHoras.work_date))}/h = </span>
                <strong className="text-gray-900">
                  {formatCurrency(calcularHoras(formHoras.start_time, formHoras.end_time) * tarifaDoDia(worker, formHoras.work_date))}
                </strong>
              </div>
              <div>
                <label className="label">Trabalho realizado</label>
                <textarea className="input" rows={3} value={formHoras.description}
                  onChange={e => setFormHoras(f => f && ({ ...f, description: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-4 border-t border-gray-100">
              <button className="btn-secondary" onClick={() => setFormHoras(null)}>Cancelar</button>
              <button className="btn-primary" onClick={guardarHoras} disabled={guardandoHoras}>
                {guardandoHoras ? 'A guardar...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Janela: pagamento */}
      {formPagamento && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="font-semibold text-lg text-gray-900">Registar pagamento</h2>
              <button onClick={() => setFormPagamento(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Data</label>
                  <input className="input" type="date" value={formPagamento.payment_date}
                    onChange={e => setFormPagamento(f => f && ({ ...f, payment_date: e.target.value }))} /></div>
                <div><label className="label">Valor (€)</label>
                  <input className="input" type="number" step="0.01" value={formPagamento.amount}
                    onChange={e => setFormPagamento(f => f && ({ ...f, amount: e.target.value }))} /></div>
              </div>
              <div>
                <label className="label">Notas</label>
                <input className="input" placeholder="opcional" value={formPagamento.notes}
                  onChange={e => setFormPagamento(f => f && ({ ...f, notes: e.target.value }))} />
              </div>

              <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 text-xs text-emerald-800 space-y-1">
                <p className="font-medium">Ao guardar, a aplicação cria sozinha:</p>
                <p>· uma despesa de {formatCurrency(parseFloat(formPagamento.amount) || 0)} paga em dinheiro</p>
                <p>· a saída correspondente no fundo de maneio</p>
                <p>· um recibo em PDF nos documentos, ligado à despesa</p>
                <p className="pt-1">O valor abate primeiro aos dias mais antigos por pagar.</p>
              </div>

              {erroPagamento && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{erroPagamento}</p>}
            </div>
            <div className="flex justify-end gap-3 p-4 border-t border-gray-100">
              <button className="btn-secondary" onClick={() => setFormPagamento(null)}>Cancelar</button>
              <button className="btn-primary" onClick={guardarPagamento} disabled={guardandoPagamento}>
                {guardandoPagamento ? 'A guardar...' : 'Pagar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
