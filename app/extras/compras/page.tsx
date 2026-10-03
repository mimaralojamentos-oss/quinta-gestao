'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, formatDate, normalizeText, openStorageDocument } from '@/lib/utils'
import { useAuth } from '@/lib/auth-context'
import { logAccess } from '@/lib/logAccess'
import { useSort } from '@/lib/useSort'
import {
  aplicarRegrasCompras, carregarRegras, contarLinhasDaRegra, excluirDocumento,
  motivoExclusaoDocumento, normalizarPadrao, reincluirDocumento,
  type FornecedorExcluido, type RegraExclusao,
} from '@/lib/purchaseExclusions'
import {
  ShoppingCart, Search, ChevronLeft, FileText, Pencil, Trash2, X,
  RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, Loader2, Ban, Settings2, Undo2,
} from 'lucide-react'
import Link from 'next/link'

const supabase = createClient()

/**
 * Compras — catálogo de todos os itens comprados, linha a linha, tirado das
 * faturas que estão nos Documentos.
 *
 * É uma tabela de LINHAS DE COMPRA, para consultar preços e fornecedores de
 * materiais: de propósito não tem totais de fatura nem somatórios. Para ver
 * totais existem as Despesas e os Fornecedores.
 */

type Campo =
  | 'purchase_date' | 'supplier_name' | 'description' | 'unit' | 'quantity'
  | 'unit_price_net' | 'total_net' | 'vat_amount' | 'total_gross' | 'project'

/** Quantas linhas se mostram de uma vez (o resto entra com "Mostrar mais"). */
const PAGINA = 300

function Seta({ ativo, dir }: { ativo: boolean; dir: 'asc' | 'desc' }) {
  if (!ativo) return <ArrowUpDown className="w-3 h-3 text-gray-300 ml-1 inline" />
  return dir === 'asc'
    ? <ArrowUp className="w-3 h-3 text-emerald-600 ml-1 inline" />
    : <ArrowDown className="w-3 h-3 text-emerald-600 ml-1 inline" />
}

const num = (v: string): number | null => {
  const s = v.trim()
  if (!s) return null
  const n = parseFloat(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

const txt = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v))

export default function ComprasPage() {
  const { profile, user } = useAuth()
  const podeEditar = ['admin', 'coadmin'].includes(profile?.role ?? '')

  const [linhas, setLinhas] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [pesquisa, setPesquisa] = useState('')
  const [mostrar, setMostrar] = useState(PAGINA)
  const { sortField, sortDir, handleSort } = useSort<Campo>('purchase_date', 'desc')

  // Faturas por processar / que falharam
  const [porProcessar, setPorProcessar] = useState(0)
  const [comErro, setComErro] = useState(0)

  // Processamento em lote
  const [lote, setLote] = useState<{ feitos: number; total: number; linhas: number; falhas: number } | null>(null)
  const pararRef = useRef(false)

  // Reprocessar um documento
  const [aReprocessar, setAReprocessar] = useState<string | null>(null)

  // Exclusões: regras de item, fornecedores marcados e documentos de fora
  const [regras, setRegras] = useState<RegraExclusao[]>([])
  const [fornecedoresFora, setFornecedoresFora] = useState<FornecedorExcluido[]>([])
  const [docsExcluidos, setDocsExcluidos] = useState<any[]>([])
  const [verRegras, setVerRegras] = useState(false)
  const [novaRegra, setNovaRegra] = useState('')
  const [ocupadoRegras, setOcupadoRegras] = useState(false)
  const [aAplicar, setAAplicar] = useState(false)
  const [limpeza, setLimpeza] = useState<string | null>(null)

  // Janela de correção
  const [editar, setEditar] = useState<any | null>(null)
  const [form, setForm] = useState({
    purchase_date: '', supplier_name: '', description: '', unit: '',
    quantity: '', unit_price_net: '', total_net: '', vat_rate: '', vat_amount: '', total_gross: '',
  })
  const [guardando, setGuardando] = useState(false)
  const [erroModal, setErroModal] = useState('')

  async function carregar() {
    setLoading(true)
    const { data, error } = await supabase
      .from('purchase_items')
      .select(`id, document_id, line_number, purchase_date, supplier_name, description, unit,
               quantity, unit_price_net, total_net, vat_rate, vat_amount, total_gross,
               vat_estimated, source,
               document:documents(id, file_path, doc_number, original_name),
               project:projects(name)`)
      .order('purchase_date', { ascending: false, nullsFirst: false })
      .order('line_number', { ascending: true })
      .limit(10000)

    if (error) setErro(error.message)
    setLinhas(data ?? [])
    setLoading(false)
  }

  async function carregarPendentes() {
    const [pend, err] = await Promise.all([
      supabase.from('documents').select('id', { count: 'exact', head: true })
        .eq('tipo', 'fatura').eq('status', 'ativo').is('purchase_items_status', null),
      supabase.from('documents').select('id', { count: 'exact', head: true })
        .eq('tipo', 'fatura').eq('status', 'ativo').eq('purchase_items_status', 'erro'),
    ])
    setPorProcessar(pend.count ?? 0)
    setComErro(err.count ?? 0)
  }

  async function carregarExclusoes() {
    const [fornecedores, excluidos] = await Promise.all([
      supabase.from('purchase_supplier_exclusions').select('*').order('supplier_name'),
      supabase.from('documents')
        .select('id, doc_date, supplier_name, original_name, doc_number, file_path, purchase_items_motivo')
        .eq('purchase_items_status', 'excluido')
        .order('doc_date', { ascending: false, nullsFirst: false }),
    ])
    setRegras(await carregarRegras(supabase))
    setFornecedoresFora(fornecedores.data ?? [])
    setDocsExcluidos(excluidos.data ?? [])
  }

  useEffect(() => { carregar(); carregarPendentes(); carregarExclusoes() }, [])

  // ── Pesquisa instantânea (fornecedor e descrição) + ordenação ──
  const q = normalizeText(pesquisa)
  const filtradas = q
    ? linhas.filter(l =>
        normalizeText(String(l.supplier_name ?? '')).includes(q) ||
        normalizeText(String(l.description ?? '')).includes(q))
    : linhas

  const ordenadas = [...filtradas].sort((a, b) => {
    const sinal = sortDir === 'asc' ? 1 : -1
    const campo = sortField
    if (campo === 'project') {
      return sinal * String(a.project?.name ?? '').localeCompare(String(b.project?.name ?? ''), 'pt', { sensitivity: 'base' })
    }
    const va = a[campo], vb = b[campo]
    if (typeof va === 'number' || typeof vb === 'number') {
      // Vazios ficam sempre no fim, em qualquer direção.
      if (va === null || va === undefined) return 1
      if (vb === null || vb === undefined) return -1
      return sinal * (va - vb)
    }
    const sa = String(va ?? ''), sb = String(vb ?? '')
    if (!sa) return 1
    if (!sb) return -1
    return sinal * sa.localeCompare(sb, 'pt', { sensitivity: 'base' })
  })

  const visiveis = ordenadas.slice(0, mostrar)

  async function abrirFatura(doc: any) {
    if (!doc?.file_path) { alert('Esta fatura não tem ficheiro guardado.'); return }
    await openStorageDocument(supabase, doc.file_path)
  }

  // ── Extração ──

  /** Processa uma fatura (substituição em bloco: repetir não duplica). */
  async function processarDocumento(documentId: string) {
    const res = await fetch('/api/extract-purchase-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_id: documentId }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false as const, erro: json?.error ?? `erro ${res.status}` }
    return { ok: true as const, linhas: Number(json?.linhas ?? 0), status: json?.status as string }
  }

  async function reprocessar(documentId: string) {
    setAReprocessar(documentId)
    const r = await processarDocumento(documentId)
    setAReprocessar(null)
    if (!r.ok) { alert(`Não foi possível reprocessar: ${r.erro}`); return }
    await logAccess({
      action: 'editar', page: '/extras/compras',
      details: `Reprocessou as linhas de uma fatura (${r.linhas} linha(s))`,
    })
    await Promise.all([carregar(), carregarPendentes()])
  }

  /**
   * Faturas antigas, em lote. Pede ao servidor uma fatura de cada vez para
   * haver progresso visível e não esgotar o tempo de resposta.
   *
   * Salta sempre as que já estão processadas, por isso carregar no botão dez
   * vezes dá o mesmo resultado que carregar uma.
   */
  async function processarAntigas(repetirFalhadas = false) {
    const consulta = supabase.from('documents')
      .select('id')
      .eq('tipo', 'fatura')
      .eq('status', 'ativo')
      .order('doc_date', { ascending: false, nullsFirst: false })

    const { data, error } = repetirFalhadas
      ? await consulta.eq('purchase_items_status', 'erro')
      : await consulta.is('purchase_items_status', null)

    if (error) { alert(`Não foi possível ver as faturas: ${error.message}`); return }
    const ids = (data ?? []).map(d => d.id)
    if (ids.length === 0) {
      alert(repetirFalhadas ? 'Não há faturas falhadas para repetir.' : 'Não há faturas por processar.')
      return
    }

    pararRef.current = false
    setLote({ feitos: 0, total: ids.length, linhas: 0, falhas: 0 })

    let feitos = 0, totalLinhas = 0, falhas = 0
    for (const id of ids) {
      if (pararRef.current) break
      const r = await processarDocumento(id)
      feitos++
      if (r.ok) totalLinhas += r.linhas
      else falhas++
      setLote({ feitos, total: ids.length, linhas: totalLinhas, falhas })
    }

    await logAccess({
      action: 'editar', page: '/extras/compras',
      details: `Processou faturas antigas: ${feitos} de ${ids.length}, ${totalLinhas} linha(s), ${falhas} falha(s)`,
    })
    await Promise.all([carregar(), carregarPendentes()])
  }

  // ── Exclusões ──

  /** Corre todas as regras sobre o que já está na base. Repetir não faz mal. */
  async function aplicarRegras() {
    setAAplicar(true); setLimpeza(null)
    const r = await aplicarRegrasCompras(supabase)
    setAAplicar(false)

    if ('erro' in r) { alert(`Não foi possível aplicar as regras: ${r.erro}`); return }

    setLimpeza(
      r.documentos_excluidos === 0 && r.linhas_removidas_por_regra === 0
        ? 'Nada a excluir — já estava tudo em ordem.'
        : `${r.documentos_excluidos} documento(s) excluído(s), ${r.linhas_removidas_dos_documentos} linha(s) removida(s) por documento e ${r.linhas_removidas_por_regra} por regra de descrição.`
    )
    if (r.documentos_excluidos > 0 || r.linhas_removidas_por_regra > 0) {
      await logAccess({
        action: 'editar', page: '/extras/compras',
        details: `Aplicou as regras de exclusão: ${r.documentos_excluidos} documento(s), ${r.linhas_removidas_dos_documentos + r.linhas_removidas_por_regra} linha(s)`,
      })
    }
    await Promise.all([carregar(), carregarPendentes(), carregarExclusoes()])
  }

  /** Exclusão avulsa, para os casos que as regras não apanham. */
  async function excluirEsteDocumento(l: any) {
    const nome = l.document?.doc_number ? `nº ${l.document.doc_number}` : (l.supplier_name ?? 'este documento')
    if (!confirm(`Excluir a fatura ${nome} das Compras?\n\nAs linhas dela saem do catálogo e a fatura passa a ser ignorada pela leitura automática. A fatura, a despesa e os totais não são tocados.`)) return

    const r = await excluirDocumento(supabase, l.document_id, 'excluído à mão')
    if (r.erro) { alert(`Não foi possível excluir: ${r.erro}`); return }
    await logAccess({
      action: 'editar', page: '/extras/compras',
      details: `Excluiu das Compras a fatura ${nome} (${l.supplier_name ?? 'sem fornecedor'})`,
    })
    await Promise.all([carregar(), carregarPendentes(), carregarExclusoes()])
  }

  /** Voltar a incluir um documento — avisa se uma regra o continua a excluir. */
  async function reincluir(doc: any) {
    const motivo = await motivoExclusaoDocumento(supabase, doc.id)
    const aviso = motivo
      ? `Atenção: este documento continua a ser excluído por uma regra (${motivo}).\n\nSe o reincluíres agora, a próxima leitura volta a excluí-lo. Para ele entrar no catálogo tens de tirar primeiro a regra ou a marca do fornecedor.\n\nReincluir mesmo assim?`
      : `Voltar a incluir este documento nas Compras?\n\nFica "por processar": as linhas só aparecem depois de o processar (botão das faturas antigas ou "Reprocessar").`
    if (!confirm(aviso)) return

    const r = await reincluirDocumento(supabase, doc.id)
    if (r.erro) { alert(`Não foi possível reincluir: ${r.erro}`); return }
    await logAccess({
      action: 'editar', page: '/extras/compras',
      details: `Voltou a incluir nas Compras o documento ${doc.doc_number ?? doc.original_name ?? doc.id}`,
    })
    await Promise.all([carregarPendentes(), carregarExclusoes()])
  }

  /** Regra nova por texto na descrição: mostra o que remove e pede confirmação. */
  async function adicionarRegra() {
    const texto = novaRegra.trim()
    if (texto.length < 3) { alert('Escreve pelo menos 3 letras, para a regra não apanhar linhas a mais.'); return }

    setOcupadoRegras(true)
    const quantas = await contarLinhasDaRegra(supabase, texto)
    setOcupadoRegras(false)

    const confirmado = confirm(
      quantas === 0
        ? `Criar a regra "${texto}"?\n\nNão há linhas no catálogo com este texto — a regra vai valer para as faturas que forem lidas de agora em diante.`
        : `Criar a regra "${texto}"?\n\nVai remover ${quantas} linha(s) que já estão no catálogo, e passa a valer para as faturas lidas de agora em diante.\n\nApagar uma regra não repõe as linhas: para as recuperar usa o "Reprocessar" da fatura.`
    )
    if (!confirmado) return

    setOcupadoRegras(true)
    const { error } = await supabase.from('purchase_exclusion_rules').insert({
      rule_type: 'descricao',
      pattern: texto,
      pattern_normalized: normalizarPadrao(texto),
      created_by: user?.email ?? null,
    })
    if (error) {
      setOcupadoRegras(false)
      alert(error.message.includes('duplicate') || error.message.includes('purchase_exclusion_rules_key')
        ? 'Já existe uma regra com este texto.'
        : `Não foi possível criar a regra: ${error.message}`)
      return
    }

    await logAccess({
      action: 'criar', page: '/extras/compras',
      details: `Criou a regra de exclusão "${texto}" (removeu ${quantas} linha(s) já existentes)`,
    })

    const r = await aplicarRegrasCompras(supabase)
    setOcupadoRegras(false)
    setNovaRegra('')
    if (!('erro' in r)) {
      setLimpeza(`Regra criada — ${r.linhas_removidas_por_regra} linha(s) removida(s).`)
    }
    await Promise.all([carregar(), carregarPendentes(), carregarExclusoes()])
  }

  async function apagarRegra(r: RegraExclusao) {
    if (!confirm(`Apagar a regra "${r.pattern}"?\n\nAs linhas que ela já removeu NÃO voltam — para as recuperar usa o "Reprocessar" da fatura. A regra deixa de valer para as leituras futuras.`)) return
    const { error } = await supabase.from('purchase_exclusion_rules').delete().eq('id', r.id)
    if (error) { alert(`Não foi possível apagar: ${error.message}`); return }
    await logAccess({
      action: 'apagar', page: '/extras/compras',
      details: `Apagou a regra de exclusão "${r.pattern}"`,
    })
    await carregarExclusoes()
  }

  async function removerFornecedorFora(x: FornecedorExcluido) {
    if (!confirm(`Voltar a incluir "${x.supplier_name}" nas Compras?\n\nAs faturas dele só entram no catálogo depois de serem processadas.`)) return
    const { error } = await supabase.from('purchase_supplier_exclusions').delete().eq('id', x.id)
    if (error) { alert(`Não foi possível remover a marca: ${error.message}`); return }
    await logAccess({
      action: 'apagar', page: '/extras/compras',
      details: `Voltou a incluir o fornecedor "${x.supplier_name}" nas Compras`,
    })
    await carregarExclusoes()
  }

  // ── Correção de linhas ──

  function abrirEdicao(l: any) {
    setEditar(l)
    setForm({
      purchase_date: l.purchase_date ?? '',
      supplier_name: l.supplier_name ?? '',
      description: l.description ?? '',
      unit: l.unit ?? '',
      quantity: txt(l.quantity),
      unit_price_net: txt(l.unit_price_net),
      total_net: txt(l.total_net),
      vat_rate: l.vat_rate === null || l.vat_rate === undefined ? '' : String(Math.round(l.vat_rate * 100)),
      vat_amount: txt(l.vat_amount),
      total_gross: txt(l.total_gross),
    })
    setErroModal('')
  }

  async function guardarLinha() {
    if (!editar) return
    const descricao = form.description.trim()
    if (!descricao) { setErroModal('A descrição não pode ficar vazia.'); return }

    setGuardando(true); setErroModal('')
    const taxa = num(form.vat_rate)
    const { error } = await supabase.from('purchase_items').update({
      purchase_date: form.purchase_date || null,
      supplier_name: form.supplier_name.trim() || null,
      description: descricao,
      unit: form.unit.trim() || null,
      quantity: num(form.quantity),
      unit_price_net: num(form.unit_price_net),
      total_net: num(form.total_net),
      vat_rate: taxa === null ? null : (taxa > 1 ? taxa / 100 : taxa),
      vat_amount: num(form.vat_amount),
      total_gross: num(form.total_gross),
      // Corrigida à mão: fica assinalada e o IVA deixa de ser estimado.
      source: 'manual',
      vat_estimated: false,
      updated_at: new Date().toISOString(),
    }).eq('id', editar.id)

    setGuardando(false)
    if (error) { setErroModal(error.message); return }

    await logAccess({
      action: 'editar', page: '/extras/compras',
      details: `Corrigiu a linha de compra "${descricao}"`,
    })
    setEditar(null)
    await carregar()
  }

  async function apagarLinha(l: any) {
    if (!confirm(`Apagar a linha "${l.description}"?\n\nSe a fatura for reprocessada, a linha volta a aparecer.`)) return
    const { error } = await supabase.from('purchase_items').delete().eq('id', l.id)
    if (error) { alert(`Não foi possível apagar: ${error.message}`); return }
    await logAccess({
      action: 'apagar', page: '/extras/compras',
      details: `Apagou a linha de compra "${l.description}"`,
    })
    await carregar()
  }

  const colunas: { campo: Campo; label: string; dir: 'left' | 'right' }[] = [
    { campo: 'purchase_date', label: 'Data', dir: 'left' },
    { campo: 'supplier_name', label: 'Fornecedor', dir: 'left' },
    { campo: 'description', label: 'Descrição', dir: 'left' },
    { campo: 'unit', label: 'Unidade', dir: 'left' },
    { campo: 'quantity', label: 'Qtd.', dir: 'right' },
    { campo: 'unit_price_net', label: 'Preço un. s/IVA', dir: 'right' },
    { campo: 'total_net', label: 'Total s/IVA', dir: 'right' },
    { campo: 'vat_amount', label: 'IVA', dir: 'right' },
    { campo: 'total_gross', label: 'Total c/IVA', dir: 'right' },
    { campo: 'project', label: 'Projeto', dir: 'left' },
  ]

  return (
    <AppLayout>
      <Link href="/extras" prefetch={false}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-emerald-600 mb-3 transition-colors">
        <ChevronLeft className="w-4 h-4" /> Extras
      </Link>

      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Compras</h1>
        <p className="text-gray-500 text-sm mt-1">
          Tudo o que foi comprado, linha a linha, tirado das faturas. Serve para consultar
          preços e fornecedores de materiais — cada linha abre a fatura de origem numa janela nova.
        </p>
      </div>

      {/* Pesquisa + extração */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[260px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input className="input pl-9" placeholder="Pesquisar material ou fornecedor..."
            value={pesquisa} onChange={e => { setPesquisa(e.target.value); setMostrar(PAGINA) }} />
        </div>

        {podeEditar && (
          <div className="flex items-center gap-2">
            {lote ? (
              <>
                <span className="text-sm text-gray-600 inline-flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                  {lote.feitos} de {lote.total} · {lote.linhas} linha(s)
                  {lote.falhas > 0 && <span className="text-amber-600">· {lote.falhas} falha(s)</span>}
                </span>
                {lote.feitos < lote.total && (
                  <button className="btn-secondary text-sm" onClick={() => { pararRef.current = true }}>
                    Parar
                  </button>
                )}
                {lote.feitos >= lote.total && (
                  <button className="btn-secondary text-sm" onClick={() => setLote(null)}>Fechar</button>
                )}
              </>
            ) : (
              <>
                <button className="btn-primary text-sm inline-flex items-center gap-2"
                  onClick={() => processarAntigas(false)} disabled={porProcessar === 0}
                  title={porProcessar === 0 ? 'Todas as faturas já foram processadas' : 'Lê as faturas que ainda não foram processadas'}>
                  <RefreshCw className="w-4 h-4" />
                  Processar faturas antigas{porProcessar > 0 ? ` (${porProcessar})` : ''}
                </button>
                {comErro > 0 && (
                  <button className="btn-secondary text-sm" onClick={() => processarAntigas(true)}
                    title="Volta a tentar as faturas cuja leitura falhou">
                    Repetir as falhadas ({comErro})
                  </button>
                )}
                <button className="btn-secondary text-sm inline-flex items-center gap-2"
                  onClick={aplicarRegras} disabled={aAplicar}
                  title="Tira do catálogo o que as regras de exclusão apanham. Pode correr-se quantas vezes se quiser.">
                  {aAplicar ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
                  {aAplicar ? 'A aplicar...' : 'Aplicar regras de exclusão'}
                </button>
                <button className="btn-secondary text-sm inline-flex items-center gap-2"
                  onClick={() => setVerRegras(true)}>
                  <Settings2 className="w-4 h-4" /> Regras de exclusão
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {podeEditar && !lote && (
        <p className="text-xs text-gray-400 mb-4">
          As faturas novas são lidas sozinhas quando entram na app. O botão só lê as que
          ainda não foram processadas — carregar nele várias vezes dá sempre o mesmo resultado.
          Mensalidades de serviços, recibos internos e pagamentos a pessoal ficam de fora pelas
          regras de exclusão.
        </p>
      )}

      {limpeza && (
        <p className="text-sm text-gray-700 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 mb-4 flex items-start gap-2">
          <Ban className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
          <span className="flex-1">{limpeza}</span>
          <button onClick={() => setLimpeza(null)} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </p>
      )}

      {erro && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">
          Não foi possível carregar: {erro}
        </p>
      )}

      {loading ? (
        <p className="text-gray-500">A carregar...</p>
      ) : ordenadas.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-xl p-10 text-center">
          <ShoppingCart className="w-8 h-8 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">
            {linhas.length === 0
              ? (podeEditar
                  ? 'Ainda não há linhas de compra. Carrega em "Processar faturas antigas" para ler as faturas que já estão na app.'
                  : 'Ainda não há linhas de compra.')
              : 'Nenhuma compra corresponde a esta pesquisa.'}
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-2">
            {ordenadas.length} linha(s){q ? ` de ${linhas.length}` : ''}
          </p>

          <div className="bg-white border border-gray-100 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase">
                  {colunas.map(c => (
                    <th key={c.campo}
                      className={`px-3 py-2.5 whitespace-nowrap cursor-pointer select-none hover:text-gray-700 ${c.dir === 'right' ? 'text-right' : ''}`}
                      onClick={() => handleSort(c.campo)}>
                      {c.label} <Seta ativo={sortField === c.campo} dir={sortDir} />
                    </th>
                  ))}
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">Fatura</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {visiveis.map(l => (
                  <tr key={l.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                      {l.purchase_date ? formatDate(l.purchase_date) : '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-700 max-w-[180px] truncate" title={l.supplier_name ?? ''}>
                      {l.supplier_name ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-900 max-w-[320px]">
                      <span className="block truncate" title={l.description}>{l.description}</span>
                      {l.source === 'manual' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">
                          corrigida
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{l.unit ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-700 whitespace-nowrap">
                      {l.quantity ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-900 font-medium whitespace-nowrap">
                      {l.unit_price_net != null ? formatCurrency(l.unit_price_net) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700 whitespace-nowrap">
                      {l.total_net != null ? formatCurrency(l.total_net) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-500 whitespace-nowrap">
                      {l.vat_amount != null ? formatCurrency(l.vat_amount) : '—'}
                      {l.vat_estimated && (
                        <span className="text-gray-300 ml-1" title="O IVA não vinha por linha na fatura — foi calculado a partir da taxa indicada">*</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700 whitespace-nowrap">
                      {l.total_gross != null ? formatCurrency(l.total_gross) : '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-500 max-w-[140px] truncate" title={l.project?.name ?? ''}>
                      {l.project?.name ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button onClick={() => abrirFatura(l.document)}
                          className="text-xs text-emerald-700 hover:underline inline-flex items-center gap-1"
                          title={l.document?.doc_number ? `Fatura nº ${l.document.doc_number}` : 'Abrir a fatura numa janela nova'}>
                          <FileText className="w-3.5 h-3.5" /> Abrir
                        </button>
                        {podeEditar && (
                          <>
                            <button onClick={() => abrirEdicao(l)}
                              className="text-gray-400 hover:text-emerald-600" title="Corrigir esta linha">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => apagarLinha(l)}
                              className="text-gray-300 hover:text-red-500" title="Apagar esta linha">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => excluirEsteDocumento(l)}
                              className="text-gray-300 hover:text-amber-600"
                              title="Excluir esta fatura das Compras (tira todas as linhas dela)">
                              <Ban className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => reprocessar(l.document_id)}
                              disabled={aReprocessar === l.document_id}
                              className="text-gray-300 hover:text-gray-600 disabled:opacity-50"
                              title="Ler outra vez esta fatura (substitui as linhas dela)">
                              {aReprocessar === l.document_id
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <RefreshCw className="w-3.5 h-3.5" />}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {ordenadas.length > visiveis.length && (
            <div className="text-center mt-3">
              <button className="btn-secondary text-sm" onClick={() => setMostrar(m => m + PAGINA)}>
                Mostrar mais ({ordenadas.length - visiveis.length} por mostrar)
              </button>
            </div>
          )}

          <p className="text-xs text-gray-400 mt-3">
            * IVA calculado a partir da taxa da fatura, por não vir discriminado nessa linha.
          </p>
        </>
      )}

      {/* Regras de exclusão: itens, fornecedores e documentos de fora */}
      {verRegras && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h2 className="font-semibold text-gray-900">Regras de exclusão</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  O que não entra no catálogo de Compras
                </p>
              </div>
              <button onClick={() => setVerRegras(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>

            <div className="p-5 space-y-6">
              {/* 1. Regras por texto na descrição */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Texto na descrição</h3>
                <p className="text-xs text-gray-500 mt-0.5 mb-3">
                  Qualquer linha cuja descrição contenha o texto é removida do catálogo —
                  ex.: &quot;portes&quot;, &quot;taxa de serviço&quot;, &quot;aluguer&quot;. Não distingue
                  maiúsculas nem acentos. Aplica-se às linhas futuras e, ao criar, também às
                  que já existem (diz-te quantas antes de remover).
                </p>

                <div className="flex gap-2 mb-3">
                  <input className="input flex-1" placeholder="ex: portes" value={novaRegra}
                    onChange={e => setNovaRegra(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !ocupadoRegras) adicionarRegra() }} />
                  <button className="btn-primary text-sm whitespace-nowrap"
                    onClick={adicionarRegra} disabled={ocupadoRegras || !novaRegra.trim()}>
                    {ocupadoRegras ? 'A tratar...' : 'Adicionar'}
                  </button>
                </div>

                {regras.length === 0 ? (
                  <p className="text-xs text-gray-400">Ainda não há regras de descrição.</p>
                ) : (
                  <div className="space-y-1.5">
                    {regras.map(r => (
                      <div key={r.id} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
                        <span className="text-sm text-gray-800 flex-1 truncate">{r.pattern}</span>
                        {r.created_by && (
                          <span className="text-xs text-gray-400 whitespace-nowrap hidden sm:inline">{r.created_by}</span>
                        )}
                        <button onClick={() => apagarRegra(r)}
                          className="text-gray-400 hover:text-red-500 flex-shrink-0" title="Apagar esta regra">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 2. Fornecedores marcados */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Fornecedores fora das Compras</h3>
                <p className="text-xs text-gray-500 mt-0.5 mb-3">
                  Marcam-se nos <Link href="/extras/fornecedores" prefetch={false}
                    className="text-emerald-700 hover:underline">Fornecedores</Link>. Nenhuma fatura
                  deles entra no catálogo — é o que resolve as mensalidades de serviços. A marca
                  apanha também as variantes que começam pelo nome (ex.: &quot;MEO&quot; cobre
                  &quot;MEO - Serviços de Comunicações&quot;).
                </p>

                {fornecedoresFora.length === 0 ? (
                  <p className="text-xs text-gray-400">Nenhum fornecedor marcado.</p>
                ) : (
                  <div className="space-y-1.5">
                    {fornecedoresFora.map(x => (
                      <div key={x.id} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
                        <span className="text-sm text-gray-800 flex-1 truncate">{x.supplier_name}</span>
                        {x.notes && (
                          <span className="text-xs text-gray-400 truncate hidden sm:inline max-w-[220px]">{x.notes}</span>
                        )}
                        <button onClick={() => removerFornecedorFora(x)}
                          className="text-gray-400 hover:text-emerald-600 flex-shrink-0 inline-flex items-center gap-1 text-xs whitespace-nowrap"
                          title="Voltar a incluir este fornecedor">
                          <Undo2 className="w-3.5 h-3.5" /> Incluir
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 3. Documentos excluídos */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  Documentos excluídos ({docsExcluidos.length})
                </h3>
                <p className="text-xs text-gray-500 mt-0.5 mb-3">
                  Faturas fora do catálogo, por regra ou à mão. Não têm linhas e são sempre
                  ignoradas pela leitura automática.
                </p>

                {docsExcluidos.length === 0 ? (
                  <p className="text-xs text-gray-400">Nenhum documento excluído.</p>
                ) : (
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {docsExcluidos.map(d => (
                      <div key={d.id} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
                        <span className="text-xs text-gray-400 whitespace-nowrap w-20 flex-shrink-0">
                          {d.doc_date ? formatDate(d.doc_date) : '—'}
                        </span>
                        <span className="text-sm text-gray-800 truncate flex-1"
                          title={d.original_name ?? ''}>
                          {d.supplier_name ?? d.original_name ?? '—'}
                          {d.doc_number ? ` · nº ${d.doc_number}` : ''}
                        </span>
                        <span className="text-xs text-gray-500 whitespace-nowrap hidden sm:inline">
                          {d.purchase_items_motivo ?? '—'}
                        </span>
                        {d.file_path && (
                          <button onClick={() => abrirFatura(d)}
                            className="text-gray-400 hover:text-emerald-600 flex-shrink-0" title="Abrir a fatura">
                            <FileText className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button onClick={() => reincluir(d)}
                          className="text-gray-400 hover:text-emerald-600 flex-shrink-0 inline-flex items-center gap-1 text-xs whitespace-nowrap"
                          title="Voltar a incluir este documento">
                          <Undo2 className="w-3.5 h-3.5" /> Reincluir
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 p-4 border-t border-gray-100">
              <button className="btn-secondary" onClick={() => setVerRegras(false)}>Fechar</button>
              <button className="btn-primary inline-flex items-center gap-2"
                onClick={async () => { await aplicarRegras(); setVerRegras(false) }} disabled={aAplicar}>
                {aAplicar ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
                {aAplicar ? 'A aplicar...' : 'Aplicar regras agora'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Correção de uma linha */}
      {editar && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h2 className="font-semibold text-gray-900">Corrigir linha de compra</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Linha {editar.line_number} da fatura
                  {editar.document?.doc_number ? ` nº ${editar.document.doc_number}` : ''}
                </p>
              </div>
              <button onClick={() => setEditar(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>

            <div className="p-5 space-y-4">
              <div className="flex justify-end">
                <button onClick={() => abrirFatura(editar.document)}
                  className="text-sm text-emerald-700 hover:underline inline-flex items-center gap-1">
                  <FileText className="w-4 h-4" /> Abrir a fatura numa janela nova
                </button>
              </div>

              <div>
                <label className="label">Descrição *</label>
                <input className="input" value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} autoFocus />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Data da compra</label>
                  <input type="date" className="input" value={form.purchase_date}
                    onChange={e => setForm(f => ({ ...f, purchase_date: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Fornecedor</label>
                  <input className="input" value={form.supplier_name}
                    onChange={e => setForm(f => ({ ...f, supplier_name: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Unidade</label>
                  <input className="input" value={form.unit} placeholder="un, L, kg, m, m2, saco..."
                    onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Quantidade</label>
                  <input className="input" value={form.quantity} inputMode="decimal"
                    onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Preço unitário s/IVA (€)</label>
                  <input className="input" value={form.unit_price_net} inputMode="decimal"
                    onChange={e => setForm(f => ({ ...f, unit_price_net: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Total s/IVA (€)</label>
                  <input className="input" value={form.total_net} inputMode="decimal"
                    onChange={e => setForm(f => ({ ...f, total_net: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Taxa de IVA (%)</label>
                  <input className="input" value={form.vat_rate} inputMode="decimal" placeholder="23"
                    onChange={e => setForm(f => ({ ...f, vat_rate: e.target.value }))} />
                </div>
                <div>
                  <label className="label">IVA (€)</label>
                  <input className="input" value={form.vat_amount} inputMode="decimal"
                    onChange={e => setForm(f => ({ ...f, vat_amount: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Total c/IVA (€)</label>
                  <input className="input" value={form.total_gross} inputMode="decimal"
                    onChange={e => setForm(f => ({ ...f, total_gross: e.target.value }))} />
                </div>
              </div>

              <p className="text-xs text-gray-500">
                Os valores ficam exatamente como os escreveres — não são recalculados. A linha
                passa a estar marcada como corrigida à mão; se a fatura for reprocessada, volta
                ao que a leitura automática encontrar.
              </p>

              {erroModal && (
                <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{erroModal}</p>
              )}
            </div>

            <div className="flex justify-end gap-3 p-4 border-t border-gray-100">
              <button className="btn-secondary" onClick={() => setEditar(null)}>Cancelar</button>
              <button className="btn-primary" onClick={guardarLinha} disabled={guardando}>
                {guardando ? 'A guardar...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
