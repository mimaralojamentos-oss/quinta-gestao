'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatDate } from '@/lib/utils'
import { BarChart3, TrendingUp, Home, FileText, Calendar, ChevronDown, ChevronUp, Edit2, X, Save, ClipboardList, Download, Loader2, Receipt, Mail, AlertTriangle, Printer } from 'lucide-react'
import EmailComposer from '@/components/EmailComposer'
import { buildAppliedAdvanceMap, appliedAdvanceFor } from '@/lib/advanceCredit'

interface MonthOption { label: string; value: string }

function getLastMonths(n: number): MonthOption[] {
  const result: MonthOption[] = []
  const now = new Date()
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' })
    result.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) })
  }
  return result
}

const MONTHS = getLastMonths(12)
const CATEGORIAS = ['administracao', 'contabilidade', 'edp', 'manutencao', 'obras', 'outros', 'pessoal']

const TIPO_LABELS: Record<string, string> = {
  renda: '🏠 Renda',
  luz: '⚡ Luz',
  caucao: '🔒 Caucao',
  extra: '➕ Extra',
  adiantamento: '💰 Adiantamento',
  outro: '📝 Outro',
}

/** "2026-07-01" ou "2026-07" → "Julho 2026" */
function mesLegivel(valor: string | null | undefined): string {
  if (!valor) return 'sem data'
  const [ano, mes] = String(valor).split('-')
  const nomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
  const i = Number(mes) - 1
  return nomes[i] ? `${nomes[i]} ${ano}` : String(valor)
}

export default function RelatoriosPage() {
  const supabase = createClient()
  const [activeReport, setActiveReport] = useState('dividas')
  const [selectedMonth, setSelectedMonth] = useState(MONTHS[0].value)
  const [loading, setLoading] = useState(false)

  const [rendas, setRendas] = useState<any>(null)
  const [ocupacao, setOcupacao] = useState<any>(null)
  const [financeiro, setFinanceiro] = useState<any>(null)
  const [contratos, setContratos] = useState<any>(null)
  const [dividas, setDividas] = useState<any>(null)
  const [dividaExpandida, setDividaExpandida] = useState<string | null>(null)
  const [dividaOrdem, setDividaOrdem] = useState<'valor' | 'espaco'>('valor')
  const [dividaOrdemDir, setDividaOrdemDir] = useState<'asc' | 'desc'>('desc')
  const [dividaFiltro, setDividaFiltro] = useState('all')

  const [expandedCategory, setExpandedCategory] = useState<string | null>(null)

  const [contaCorrenteModal, setContaCorrenteModal] = useState<any>(null)
  const [contaCorrenteData, setContaCorrenteData] = useState<any[]>([])
  const [loadingCC, setLoadingCC] = useState(false)

  const [editingExpense, setEditingExpense] = useState<any>(null)
  const [editForm, setEditForm] = useState<any>({})
  const [savingExpense, setSavingExpense] = useState(false)

  const [cobrancasSort, setCobrancasSort] = useState<'espaco' | 'nome' | 'renda'>('espaco')
  const [cobrancasSortDir, setCobrancasSortDir] = useState<'asc' | 'desc'>('asc')
  const [emailTarget, setEmailTarget] = useState<{ name: string; email: string | null; spaceRef?: string; amount?: number | null; period?: string; items?: any[] } | null>(null)

  const [exportingPDF, setExportingPDF] = useState(false)

  // Pagamentos dos Inquilinos
  const [pagamentos, setPagamentos] = useState<any>(null)
  const [pagamentosErro, setPagamentosErro] = useState('')
  const [allSpaces, setAllSpaces] = useState<any[]>([])
  const [pagamentosEspacos, setPagamentosEspacos] = useState<string[]>([])
  const [showPagamentosSpaceDropdown, setShowPagamentosSpaceDropdown] = useState(false)
  const pagamentosSpaceRef = useRef<HTMLDivElement>(null)
  const [pagamentosMes, setPagamentosMes] = useState('year')

  useEffect(() => {
    if (activeReport === 'rendas' || activeReport === 'cobrancas') fetchRendas()
    if (activeReport === 'ocupacao') fetchOcupacao()
    if (activeReport === 'financeiro') fetchFinanceiro()
    if (activeReport === 'contratos') fetchContratos()
    if (activeReport === 'pagamentos') fetchPagamentos()
    if (activeReport === 'dividas') fetchDividas()
  }, [activeReport, selectedMonth])

  useEffect(() => {
    if (activeReport === 'pagamentos') fetchPagamentos()
  }, [pagamentosEspacos, pagamentosMes])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (pagamentosSpaceRef.current && !pagamentosSpaceRef.current.contains(e.target as Node)) {
        setShowPagamentosSpaceDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function fetchRendasData() {
    const startDate = `${selectedMonth}-01`
    const [y, m] = selectedMonth.split('-').map(Number)
    const endYear = m === 12 ? y + 1 : y
    const endMonth = m === 12 ? 1 : m + 1
    const nextMonthDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`

    const { data: leasesData } = await supabase
      .from('leases')
      .select('id, monthly_rent, start_date, space:spaces(ref), tenant:tenants(id, name)')
      .eq('status', 'ativo')
      .lt('start_date', nextMonthDate)

    const { data: allPayments } = await supabase
      .from('rent_payments')
      .select('*')
      .gte('reference_month', startDate)
      .lt('reference_month', nextMonthDate)

    const leasesMap: Record<string, any> = {}
    for (const l of leasesData ?? []) {
      leasesMap[l.id] = l
    }

    const { data: allLeasesData } = await supabase
      .from('leases')
      .select('id, space:spaces(ref), tenant:tenants(name)')

    const allLeasesMap: Record<string, any> = {}
    for (const l of allLeasesData ?? []) {
      allLeasesMap[l.id] = l
    }

    const rendaPayments = (allPayments ?? []).filter((p: any) => p.tipo === 'renda' || !p.tipo)
    const outrosPayments = (allPayments ?? [])
      .filter((p: any) => p.tipo && p.tipo !== 'renda')
      .map((p: any) => ({ ...p, lease: allLeasesMap[p.lease_id] ?? null }))

    const totalEsperado = (leasesData ?? []).reduce((s: number, l: any) => s + (l.monthly_rent ?? 0), 0)
    const totalRecebido = rendaPayments.reduce((s: number, p: any) => s + (p.amount ?? 0), 0)
    const totalOutros = outrosPayments.reduce((s: number, p: any) => s + (p.amount ?? 0), 0)

    const pagosLeaseIds = new Set(rendaPayments.map((p: any) => String(p.lease_id)))
    const emFalta = (leasesData ?? []).filter((l: any) => !pagosLeaseIds.has(String(l.id)))
    const pagos = (leasesData ?? []).filter((l: any) => pagosLeaseIds.has(String(l.id)))

    return {
      totalEsperado,
      totalRecebido,
      totalOutros,
      emFalta,
      pagos,
      leases: leasesData,
      payments: rendaPayments,
      outrosPayments,
    }
  }

  async function fetchRendas() {
    setLoading(true)
    setRendas(await fetchRendasData())
    setLoading(false)
  }

  async function fetchContaCorrente(tenant: any) {
    setContaCorrenteModal(tenant)
    setLoadingCC(true)
    const { data } = await supabase
      .from('rent_payments')
      .select('*, lease:leases(space:spaces(ref))')
      .eq('lease_id', tenant.leaseId)
      .order('reference_month', { ascending: false })
    setContaCorrenteData(data ?? [])
    setLoadingCC(false)
  }

  /**
   * Dívida por inquilino, decomposta parcela a parcela.
   *
   * Usa exatamente a mesma regra da página de Inquilinos, para os totais
   * baterem certo entre os dois sítios:
   *   rendas registadas por pagar
   * + meses sem pagamento (só de contratos ativos, a partir de maio de 2026)
   * + dívidas manuais em aberto
   * + eletricidade por pagar
   * − adiantamentos disponíveis
   */
  async function fetchDividas() {
    setLoading(true)
    try {
      const [tenantsRes, leasesRes, paymentsRes, debtsRes, debtPaymentsRes, elecRes] = await Promise.all([
        supabase.from('tenants').select('id, name, email'),
        supabase.from('leases').select('id, tenant_id, monthly_rent, start_date, status, space_id, space:spaces(ref)'),
        supabase.from('rent_payments').select('id, lease_id, reference_month, payment_date, amount, tipo, used, applied_to_type, applied_to_month, applied_to_lease_id'),
        supabase.from('debts').select('id, tenant_id, description, original_amount, reference_date'),
        supabase.from('debt_payments').select('debt_id, amount'),
        supabase.from('electricity_charges').select('id, lease_id, reference_month, charge_date, units, amount, amount_paid').eq('paid', false),
      ])

      // Histórico de atualizações de renda: a renda de um mês antigo pode ser
      // diferente da renda atual do contrato.
      const { data: rentHistory } = await supabase
        .from('lease_rent_history').select('lease_id, effective_date, monthly_rent')
        .order('effective_date', { ascending: true })

      function rendaDoMes(leaseId: string, mes: string, fallback: number): number {
        const aplicaveis = (rentHistory ?? [])
          .filter((h: any) => h.lease_id === leaseId && h.effective_date <= `${mes}-01`)
          .sort((a: any, b: any) => b.effective_date.localeCompare(a.effective_date))
        return aplicaveis[0]?.monthly_rent ?? fallback
      }

      // Leituras por espaço, para saber o período que cada cobrança cobre.
      // A cobrança guarda só o mês de referência; o período real é o intervalo
      // entre a leitura anterior e a leitura que gerou a cobrança.
      const { data: readingsData } = await supabase
        .from('electricity_readings')
        .select('space_id, reading_date')
        .order('reading_date', { ascending: true })

      const leiturasPorEspaco = new Map<string, string[]>()
      for (const r of readingsData ?? []) {
        if (!r.space_id) continue
        const lista = leiturasPorEspaco.get(r.space_id) ?? []
        lista.push(r.reading_date)
        leiturasPorEspaco.set(r.space_id, lista)
      }

      function periodoDaCobranca(spaceId: string | undefined, chargeDate: string | null): string | null {
        if (!spaceId || !chargeDate) return null
        const datas = leiturasPorEspaco.get(spaceId)
        if (!datas) return null
        const i = datas.indexOf(chargeDate)
        if (i <= 0) return null
        return `${formatDate(datas[i - 1])} a ${formatDate(chargeDate)}`
      }

      const tenants = tenantsRes.data ?? []
      const leases = leasesRes.data ?? []
      const payments = paymentsRes.data ?? []
      const debts = debtsRes.data ?? []
      const debtPayments = debtPaymentsRes.data ?? []
      const elecCharges = elecRes.data ?? []

      const mayStart = new Date('2026-05-01')
      const hoje = new Date()
      hoje.setDate(1)

      // Adiantamentos já aplicados a rendas — contam como pagamento desse mês.
      const adiantamentosAplicados = buildAppliedAdvanceMap(payments)

      const linhas = tenants.map(t => {
        const tLeases = leases.filter(l => l.tenant_id === t.id)
        const leaseIds = tLeases.map(l => l.id)
        // `data` serve só para ordenar as parcelas cronologicamente no fim
        const parcelas: { grupo: string; descricao: string; valor: number; data: string }[] = []

        // Rendas registadas sem data de pagamento
        for (const p of payments.filter(p => leaseIds.includes(p.lease_id) && !p.payment_date)) {
          parcelas.push({
            grupo: 'Renda',
            descricao: `Renda de ${mesLegivel(p.reference_month)} (registada por pagar)`,
            valor: p.amount ?? 0,
            data: p.reference_month ?? '',
          })
        }

        // Rendas em falta, mês a mês.
        // Conta também os pagamentos PARCIAIS: se o mês tem 375 € de renda e
        // só entraram 200 €, faltam 175 € — antes o mês era dado como pago
        // só por existir um pagamento, e a diferença desaparecia da dívida.
        for (const lease of tLeases.filter(l => l.status === 'ativo')) {
          if (!lease.start_date) continue
          const inicio = new Date(lease.start_date)
          inicio.setDate(1)
          const cursor = new Date(inicio > mayStart ? inicio : mayStart)
          const espacoRef = (lease.space as any)?.ref

          while (cursor <= hoje) {
            const mes = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
            const rendaMes = rendaDoMes(lease.id, mes, lease.monthly_rent)

            const doMes = payments.filter(p =>
              p.lease_id === lease.id &&
              p.reference_month?.slice(0, 7) === mes &&
              (p.tipo === 'renda' || !p.tipo)
            )
            // O crédito já formalmente aplicado a esta renda também conta como pago.
            const credito = appliedAdvanceFor(adiantamentosAplicados, lease.id, mes)
            const registado = doMes.reduce((s, p) => s + (p.amount ?? 0), 0) + credito
            const emFalta = parseFloat((rendaMes - registado).toFixed(2))

            if (rendaMes > 0 && emFalta >= 0.01) {
              parcelas.push({
                grupo: 'Renda',
                descricao: doMes.length > 0 || credito > 0
                  ? `Renda de ${mesLegivel(mes)}${espacoRef ? ` · ${espacoRef}` : ''} — falta parte (${fmt(registado)} de ${fmt(rendaMes)})`
                  : `Renda de ${mesLegivel(mes)}${espacoRef ? ` · ${espacoRef}` : ''}`,
                valor: emFalta,
                data: `${mes}-01`,
              })
            }
            cursor.setMonth(cursor.getMonth() + 1)
          }
        }

        // Eletricidade por pagar
        for (const c of elecCharges.filter(c => leaseIds.includes(c.lease_id))) {
          const emFalta = Math.max(0, (c.amount ?? 0) - (c.amount_paid ?? 0))
          if (emFalta > 0) {
            const lease = tLeases.find(l => l.id === c.lease_id)
            const periodo = periodoDaCobranca(lease?.space_id, c.charge_date)
            const detalhes = [
              periodo ? `consumo de ${periodo}` : `mês de ${mesLegivel(c.reference_month)}`,
              c.units != null ? `${Number(c.units).toFixed(0)} kWh` : null,
              (c.amount_paid ?? 0) > 0 ? `já pagou ${fmt(c.amount_paid ?? 0)}` : null,
            ].filter(Boolean).join(' · ')

            parcelas.push({
              grupo: 'Eletricidade',
              descricao: `Luz — ${detalhes}`,
              valor: emFalta,
              data: c.charge_date ?? c.reference_month ?? '',
            })
          }
        }

        // Dívidas manuais
        for (const d of debts.filter(d => d.tenant_id === t.id)) {
          const pago = debtPayments.filter(p => p.debt_id === d.id).reduce((s, p) => s + p.amount, 0)
          const emFalta = Math.max(0, d.original_amount - pago)
          if (emFalta > 0) {
            parcelas.push({
              grupo: 'Dívida',
              descricao: `${d.description}${pago > 0 ? ` (já pagou ${fmt(pago)})` : ''}`,
              valor: emFalta,
              data: d.reference_date ?? '',
            })
          }
        }

        // Adiantamentos disponíveis (abatem à dívida)
        const adiantamentos = payments.filter(p =>
          leaseIds.includes(p.lease_id) && p.tipo === 'adiantamento' && !p.used
        )
        for (const a of adiantamentos) {
          parcelas.push({
            grupo: 'Crédito',
            descricao: `Adiantamento de ${mesLegivel(a.reference_month)}`,
            valor: -(a.amount ?? 0),
            data: a.reference_month ?? '',
          })
        }

        // Ordem cronológica: as parcelas são recolhidas por tipo, mas o que
        // faz sentido ler é a linha do tempo da dívida.
        parcelas.sort((a, b) => {
          if (!a.data) return 1
          if (!b.data) return -1
          return a.data.localeCompare(b.data)
        })

        const total = parcelas.reduce((s, p) => s + p.valor, 0)
        const porGrupo = {
          Renda: parcelas.filter(p => p.grupo === 'Renda').reduce((s, p) => s + p.valor, 0),
          Eletricidade: parcelas.filter(p => p.grupo === 'Eletricidade').reduce((s, p) => s + p.valor, 0),
          Dívida: parcelas.filter(p => p.grupo === 'Dívida').reduce((s, p) => s + p.valor, 0),
          Crédito: parcelas.filter(p => p.grupo === 'Crédito').reduce((s, p) => s + p.valor, 0),
        }
        const espacos = tLeases.filter(l => l.status === 'ativo').map(l => (l.space as any)?.ref).filter(Boolean)

        return { id: t.id, nome: t.name, email: t.email, espacos, parcelas, porGrupo, total }
      })
        .filter(l => Math.abs(l.total) >= 0.01)
        .sort((a, b) => b.total - a.total)

      setDividas({
        linhas,
        total: linhas.reduce((s, l) => s + l.total, 0),
        totalRenda: linhas.reduce((s, l) => s + l.porGrupo.Renda, 0),
        totalLuz: linhas.reduce((s, l) => s + l.porGrupo.Eletricidade, 0),
        totalManual: linhas.reduce((s, l) => s + l.porGrupo.Dívida, 0),
        totalCredito: linhas.reduce((s, l) => s + l.porGrupo.Crédito, 0),
      })
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  /** Etiqueta "A10 - Fernando" usada no filtro e nos cabeçalhos. */
  function etiquetaInquilino(l: any): string {
    const espaco = l.espacos?.[0]
    return espaco ? `${espaco} - ${l.nome}` : l.nome
  }

  const dividasOrdenadas: any[] = (() => {
    if (!dividas) return []
    const lista = dividas.linhas.filter((l: any) => dividaFiltro === 'all' || l.id === dividaFiltro)
    const dir = dividaOrdemDir === 'asc' ? 1 : -1
    return [...lista].sort((a, b) => {
      if (dividaOrdem === 'espaco') {
        // Sem espaço ativo vai para o fim, seja qual for a direção
        const ea = a.espacos?.[0] ?? ''
        const eb = b.espacos?.[0] ?? ''
        if (!ea && !eb) return 0
        if (!ea) return 1
        if (!eb) return -1
        return dir * ea.localeCompare(eb, 'pt', { numeric: true })
      }
      return dir * (a.total - b.total)
    })
  })()

  function alternarOrdem(campo: 'valor' | 'espaco') {
    if (dividaOrdem === campo) setDividaOrdemDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setDividaOrdem(campo); setDividaOrdemDir(campo === 'espaco' ? 'asc' : 'desc') }
  }

  /** Folha A4 com a decomposição da dívida de um inquilino. */
  function imprimirDivida(l: any) {
    const hoje = new Date().toLocaleDateString('pt-PT')
    const propriedade = process.env.NEXT_PUBLIC_APP_NAME ?? 'Gestão de Alojamentos'
    const local = process.env.NEXT_PUBLIC_APP_LOCATION ?? 'Évora'

    const linhas = l.parcelas.map((p: any) => `
      <tr>
        <td class="grupo">${p.grupo}</td>
        <td>${p.descricao}</td>
        <td class="valor ${p.valor < 0 ? 'credito' : ''}">${fmt(p.valor)}</td>
      </tr>`).join('')

    const resumo = [
      l.porGrupo.Renda > 0 ? `<tr><td>Rendas em atraso</td><td class="valor">${fmt(l.porGrupo.Renda)}</td></tr>` : '',
      l.porGrupo.Eletricidade > 0 ? `<tr><td>Eletricidade</td><td class="valor">${fmt(l.porGrupo.Eletricidade)}</td></tr>` : '',
      l.porGrupo['Dívida'] > 0 ? `<tr><td>Outras dívidas</td><td class="valor">${fmt(l.porGrupo['Dívida'])}</td></tr>` : '',
      l.porGrupo['Crédito'] < 0 ? `<tr><td>Créditos a abater</td><td class="valor credito">${fmt(l.porGrupo['Crédito'])}</td></tr>` : '',
    ].filter(Boolean).join('')

    const html = `<!DOCTYPE html>
<html lang="pt"><head><meta charset="UTF-8"><title>Divida - ${l.nome}</title>
<style>
  @page { size: A4; margin: 20mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; font-size: 12px; margin: 0; }
  .cabecalho { border-bottom: 2px solid #059669; padding-bottom: 12px; margin-bottom: 20px;
               display: flex; justify-content: space-between; align-items: flex-end; }
  .cabecalho h1 { margin: 0; font-size: 20px; color: #059669; }
  .cabecalho .sub { color: #6b7280; font-size: 11px; margin-top: 2px; }
  .cabecalho .data { text-align: right; color: #6b7280; font-size: 11px; }
  .ficha { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px;
           padding: 12px 16px; margin-bottom: 20px; }
  .ficha .nome { font-size: 15px; font-weight: bold; }
  .ficha .espaco { color: #6b7280; font-size: 11px; margin-top: 2px; }
  h2 { font-size: 13px; margin: 22px 0 8px; color: #374151; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .04em;
       color: #6b7280; border-bottom: 1px solid #d1d5db; padding: 6px 4px; }
  td { padding: 6px 4px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  td.grupo { width: 90px; color: #6b7280; font-size: 11px; }
  td.valor, th.valor { text-align: right; white-space: nowrap; }
  td.credito { color: #059669; }
  .total { margin-top: 16px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px;
           padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; }
  .total .rotulo { font-weight: bold; font-size: 13px; }
  .total .montante { font-size: 22px; font-weight: bold; color: #dc2626; }
  .rodape { margin-top: 28px; padding-top: 10px; border-top: 1px solid #e5e7eb;
            color: #9ca3af; font-size: 10px; }
  .assinatura { margin-top: 42px; display: flex; gap: 60px; }
  .assinatura div { flex: 1; border-top: 1px solid #9ca3af; padding-top: 5px;
                    font-size: 10px; color: #6b7280; text-align: center; }
</style></head><body>
  <div class="cabecalho">
    <div>
      <h1>Extrato de conta</h1>
      <div class="sub">${propriedade} · ${local}</div>
    </div>
    <div class="data">Emitido em ${hoje}</div>
  </div>

  <div class="ficha">
    <div class="nome">${l.nome}</div>
    <div class="espaco">${l.espacos?.length ? `Espaço: ${l.espacos.join(', ')}` : 'Sem espaço associado'}</div>
  </div>

  <h2>Decomposição dos valores em dívida</h2>
  <table>
    <thead><tr><th>Tipo</th><th>Descrição</th><th class="valor">Valor</th></tr></thead>
    <tbody>${linhas}</tbody>
  </table>

  <h2>Resumo</h2>
  <table><tbody>${resumo}</tbody></table>

  <div class="total">
    <span class="rotulo">Total em dívida</span>
    <span class="montante">${fmt(l.total)}</span>
  </div>

  <div class="assinatura">
    <div>Assinatura do senhorio</div>
    <div>Tomei conhecimento (inquilino)</div>
  </div>

  <div class="rodape">
    Documento informativo gerado automaticamente. As rendas em falta são contabilizadas
    a partir de maio de 2026 e apenas para contratos ativos.
  </div>

  <script>window.onload = function(){ window.print(); }</script>
</body></html>`

    const janela = window.open('', '_blank', 'width=900,height=1000')
    if (!janela) { alert('O navegador bloqueou a janela de impressão. Permite pop-ups para este site.'); return }
    janela.document.write(html)
    janela.document.close()
  }

  async function fetchOcupacao() {
    setLoading(true)
    const { data: spaces } = await supabase
      .from('spaces')
      .select('id, ref, status, leases(id, status, tenant:tenants(name))')
      .order('ref')

    const total = (spaces ?? []).length
    const ocupados = (spaces ?? []).filter((s: any) =>
      (s.leases ?? []).some((l: any) => l.status === 'ativo')
    ).length
    const livres = total - ocupados

    setOcupacao({ spaces, total, ocupados, livres, taxa: total > 0 ? Math.round((ocupados / total) * 100) : 0 })
    setLoading(false)
  }

  async function fetchFinanceiroData() {
    const [y, m] = selectedMonth.split('-').map(Number)
    const startDate = `${selectedMonth}-01`
    const endYear = m === 12 ? y + 1 : y
    const endMonth = m === 12 ? 1 : m + 1
    const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`

    const { data: payments } = await supabase
      .from('rent_payments')
      .select('amount')
      .gte('reference_month', startDate)
      .lt('reference_month', endDate)

    const { data: despesas } = await supabase
      .from('expenses')
      .select('id, amount, category, description, expense_date, supplier, payment_method')
      .gte('expense_date', startDate)
      .lt('expense_date', endDate)
      .order('expense_date', { ascending: false })

    const receitas = (payments ?? []).reduce((s: number, p: any) => s + (p.amount ?? 0), 0)
    const totalDespesas = (despesas ?? []).reduce((s: number, e: any) => s + (e.amount ?? 0), 0)
    const saldo = receitas - totalDespesas

    const porCategoria: Record<string, { total: number; items: any[] }> = {}
    ;(despesas ?? []).forEach((e: any) => {
      const cat = e.category ?? 'outros'
      if (!porCategoria[cat]) porCategoria[cat] = { total: 0, items: [] }
      porCategoria[cat].total += e.amount
      porCategoria[cat].items.push(e)
    })

    return { receitas, totalDespesas, saldo, porCategoria, despesas }
  }

  async function fetchFinanceiro() {
    setLoading(true)
    setFinanceiro(await fetchFinanceiroData())
    setLoading(false)
  }

  async function fetchContratos() {
    setLoading(true)
    const hoje = new Date()
    const em6meses = new Date(hoje.getFullYear(), hoje.getMonth() + 6, hoje.getDate())
      .toISOString().slice(0, 10)

    const { data } = await supabase
      .from('leases')
      .select('id, end_date, monthly_rent, space:spaces(ref), tenant:tenants(name)')
      .eq('status', 'ativo')
      .not('end_date', 'is', null)
      .lte('end_date', em6meses)
      .order('end_date', { ascending: true })

    setContratos(data ?? [])
    setLoading(false)
  }

  async function fetchPagamentos() {
    setLoading(true)
    try {
      const currentYear = new Date().getFullYear()

      let startDate: string, endDate: string
      if (pagamentosMes === 'year') {
        startDate = `${currentYear}-01-01`
        endDate = `${currentYear + 1}-01-01`
      } else {
        const [y, m] = pagamentosMes.split('-').map(Number)
        const endYear = m === 12 ? y + 1 : y
        const endMonth = m === 12 ? 1 : m + 1
        startDate = `${pagamentosMes}-01`
        endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`
      }

      const { data: spacesData } = await supabase.from('spaces').select('id, ref').order('ref')
      setAllSpaces(spacesData ?? [])

      // Buscar contratos dos espaços selecionados (vazio = todos)
      let leaseIdFilter: string[] | null = null
      if (pagamentosEspacos.length > 0) {
        const { data: spacesFiltered } = await supabase
          .from('spaces')
          .select('id, leases(id)')
          .in('ref', pagamentosEspacos)
        leaseIdFilter = (spacesFiltered ?? []).flatMap((s: any) => (s.leases ?? []).map((l: any) => String(l.id)))
      }

      const noResults = ['00000000-0000-0000-0000-000000000000']

      // --- rent_payments ---
      let rpQuery = supabase
        .from('rent_payments')
        .select('*, lease:leases(id, space:spaces(id, ref), tenant:tenants(name))')
        .gte('reference_month', startDate)
        .lt('reference_month', endDate)
        .not('payment_date', 'is', null)
        .order('reference_month', { ascending: false })

      if (leaseIdFilter !== null) {
        rpQuery = rpQuery.in('lease_id', leaseIdFilter.length ? leaseIdFilter : noResults)
      }

      const { data: paymentsDataRaw, error: rpError } = await rpQuery
      // Um erro aqui fazia o relatório mostrar-se sem rendas nenhumas, como se
      // não existissem. Agora fica à vista em vez de desaparecer em silêncio.
      if (rpError) throw new Error(`Não foi possível carregar as rendas: ${rpError.message}`)
      // Excluir registos internos de crédito (não representam dinheiro físico recebido)
      const paymentsData = (paymentsDataRaw ?? []).filter((p: any) => p.notes !== 'Crédito de adiantamento aplicado')

      // --- electricity_charges (pagas) ---
      let ecQuery = supabase
        .from('electricity_charges')
        .select('*, lease:leases(id, space:spaces(id, ref), tenant:tenants(name))')
        .eq('paid', true)
        .gte('payment_date', startDate)
        .lt('payment_date', endDate)
        .order('payment_date', { ascending: false })

      if (leaseIdFilter !== null) {
        ecQuery = ecQuery.in('lease_id', leaseIdFilter.length ? leaseIdFilter : noResults)
      }

      const { data: elecData, error: ecError } = await ecQuery
      if (ecError) throw new Error(`Não foi possível carregar a eletricidade: ${ecError.message}`)

      // Normalizar electricity_charges para o mesmo formato que rent_payments
      const elecNorm = (elecData ?? []).map((e: any) => {
        const refMonth = e.reference_month
          ? new Date(e.reference_month).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' })
          : null
        return {
          ...e,
          tipo: 'luz',
          payment_date: e.payment_date,
          payment_method: e.payment_method,
          notes: refMonth ? `Eletricidade de ${refMonth}` : 'Eletricidade',
        }
      })

      // --- debt_payments (pagamentos de dívidas manuais) ---
      let dpQuery = supabase
        .from('debt_payments')
        .select('*, debt:debts(id, description, tenant_id, tenant:tenants(id, name, leases:leases(id, space:spaces(id, ref))))')
        .gte('payment_date', startDate)
        .lt('payment_date', endDate)

      const { data: debtPayData, error: dpError } = await dpQuery
      if (dpError) throw new Error(`Não foi possível carregar as dívidas: ${dpError.message}`)

      // Filtrar por espaço se necessário e normalizar
      const debtPayNorm = (debtPayData ?? []).filter((dp: any) => {
        if (leaseIdFilter === null) return true
        const leases = dp.debt?.tenant?.leases ?? []
        return leases.some((l: any) => leaseIdFilter.includes(l.id))
      }).map((dp: any) => {
        const lease = (dp.debt?.tenant?.leases ?? [])[0]
        return {
          id: dp.id,
          tipo: 'divida',
          amount: dp.amount,
          payment_date: dp.payment_date,
          payment_method: dp.payment_method,
          reference_month: dp.payment_date,
          notes: dp.debt?.description ?? 'Dívida',
          lease: { space: lease?.space, tenant: { name: dp.debt?.tenant?.name } },
        }
      })

      const filtered = [...(paymentsData ?? []), ...elecNorm, ...debtPayNorm].sort((a: any, b: any) =>
        (b.reference_month ?? '').localeCompare(a.reference_month ?? '')
      )

      const total = filtered.reduce((s: number, p: any) => s + (p.amount ?? 0), 0)
      const totalPorTipo: Record<string, number> = {}
      for (const p of filtered) {
        const tipo = p.tipo || 'renda'
        totalPorTipo[tipo] = (totalPorTipo[tipo] ?? 0) + (p.amount ?? 0)
      }

      setPagamentos({ payments: filtered, total, totalPorTipo })
      setPagamentosErro('')
    } catch (e: any) {
      console.error(e)
      setPagamentosErro(e?.message ?? 'Erro ao carregar o relatório de pagamentos.')
      setPagamentos({ payments: [], total: 0, totalPorTipo: {} })
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveExpense() {
    if (!editingExpense) return
    setSavingExpense(true)
    await supabase.from('expenses').update({
      description: editForm.description,
      amount: parseFloat(editForm.amount),
      category: editForm.category,
      expense_date: editForm.expense_date,
      supplier: editForm.supplier,
      payment_method: editForm.payment_method,
    }).eq('id', editingExpense.id)
    setEditingExpense(null)
    setSavingExpense(false)
    setExpandedCategory(null)
    fetchFinanceiro()
  }

  function fmt(v: number) {
    return v.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })
  }

  function diasAteExpirar(dateStr: string) {
    const diff = new Date(dateStr).getTime() - new Date().getTime()
    return Math.ceil(diff / (1000 * 60 * 60 * 24))
  }

  async function handleExportPDF() {
    setExportingPDF(true)
    try {
      const [data, fin] = await Promise.all([fetchRendasData(), fetchFinanceiroData()])
      const { default: jsPDF } = await import('jspdf')

      const pdf = new jsPDF('p', 'mm', 'a4')
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const margin = 14
      let y = 20

      const monthLabel = MONTHS.find(m => m.value === selectedMonth)?.label ?? selectedMonth

      function checkPageBreak(needed: number) {
        if (y + needed > pageHeight - margin) {
          pdf.addPage()
          y = margin + 6
        }
      }

      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(16)
      pdf.text(`Relatorio Financeiro - ${monthLabel}`, margin, y)
      y += 7

      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(9)
      pdf.setTextColor(120)
      pdf.text(
        `Gerado em ${new Date().toLocaleDateString('pt-PT')} as ${new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}`,
        margin, y
      )
      pdf.setTextColor(0)
      y += 10

      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(12)
      pdf.text('Resumo', margin, y)
      y += 7
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(10)
      pdf.text(`Total Receitas: ${fmt(fin.receitas)}`, margin, y)
      y += 6
      pdf.text(`Total Despesas: ${fmt(fin.totalDespesas)}`, margin, y)
      y += 6
      pdf.setFont('helvetica', 'bold')
      if (fin.saldo >= 0) pdf.setTextColor(16, 122, 86)
      else pdf.setTextColor(200, 40, 40)
      pdf.text(`Saldo: ${fmt(fin.saldo)}`, margin, y)
      pdf.setTextColor(0)
      pdf.setFont('helvetica', 'normal')
      y += 6

      pdf.setFontSize(9)
      pdf.setTextColor(120)
      pdf.text(
        `Rendas: esperado ${fmt(data.totalEsperado)} · recebido ${fmt(data.totalRecebido)} · em falta ${fmt(Math.max(0, data.totalEsperado - data.totalRecebido))}`,
        margin, y
      )
      pdf.setTextColor(0)
      pdf.setFontSize(10)
      y += 10

      function drawList(title: string, items: any[], getValue: (l: any) => number, getExtra?: (l: any) => string, totalLabel?: string, totalValue?: number) {
        checkPageBreak(14)
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(12)
        pdf.text(`${title} (${items.length})`, margin, y)
        y += 7

        if (items.length === 0) {
          pdf.setFont('helvetica', 'normal')
          pdf.setFontSize(10)
          pdf.text('Sem registos.', margin, y)
          y += 10
          return
        }

        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(9)
        pdf.text('Inquilino', margin, y)
        pdf.text('Espaco', margin + 95, y)
        pdf.text('Valor', pageWidth - margin, y, { align: 'right' })
        y += 4
        pdf.setDrawColor(200)
        pdf.line(margin, y, pageWidth - margin, y)
        y += 5

        pdf.setFont('helvetica', 'normal')
        for (const l of items) {
          const extra = getExtra?.(l)
          checkPageBreak(extra ? 11 : 6)
          pdf.setFontSize(9)
          pdf.setTextColor(0)
          pdf.text(String(l.tenant?.name ?? '-'), margin, y)
          pdf.text(String(l.space?.ref ?? '-'), margin + 95, y)
          pdf.text(fmt(getValue(l)), pageWidth - margin, y, { align: 'right' })
          y += 6
          if (extra) {
            pdf.setFontSize(8)
            pdf.setTextColor(130)
            pdf.text(extra, margin, y)
            pdf.setTextColor(0)
            y += 5
          }
        }

        if (totalLabel !== undefined && totalValue !== undefined) {
          checkPageBreak(8)
          pdf.setDrawColor(200)
          pdf.line(margin, y, pageWidth - margin, y)
          y += 5
          pdf.setFont('helvetica', 'bold')
          pdf.setFontSize(9)
          pdf.text(totalLabel, margin, y)
          pdf.text(fmt(totalValue), pageWidth - margin, y, { align: 'right' })
          y += 6
        }

        y += 6
      }

      function drawCategoriaTable(title: string, porCategoria: Record<string, { total: number; items: any[] }>, total: number) {
        const entries = Object.entries(porCategoria).sort(([, a], [, b]) => b.total - a.total)

        checkPageBreak(14)
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(12)
        pdf.text(`${title} (${entries.length})`, margin, y)
        y += 7

        if (entries.length === 0) {
          pdf.setFont('helvetica', 'normal')
          pdf.setFontSize(10)
          pdf.text('Sem despesas registadas.', margin, y)
          y += 10
          return
        }

        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(9)
        pdf.text('Categoria', margin, y)
        pdf.text('Registos', margin + 110, y, { align: 'center' })
        pdf.text('Total', pageWidth - margin, y, { align: 'right' })
        y += 4
        pdf.setDrawColor(200)
        pdf.line(margin, y, pageWidth - margin, y)
        y += 5

        pdf.setFont('helvetica', 'normal')
        for (const [cat, catData] of entries) {
          checkPageBreak(6)
          pdf.setFontSize(9)
          pdf.text(cat.charAt(0).toUpperCase() + cat.slice(1), margin, y)
          pdf.text(String(catData.items.length), margin + 110, y, { align: 'center' })
          pdf.text(fmt(catData.total), pageWidth - margin, y, { align: 'right' })
          y += 6
        }

        checkPageBreak(8)
        pdf.setDrawColor(200)
        pdf.line(margin, y, pageWidth - margin, y)
        y += 5
        pdf.setFont('helvetica', 'bold')
        pdf.text('Total Despesas', margin, y)
        pdf.text(fmt(total), pageWidth - margin, y, { align: 'right' })
        y += 10
      }

      drawList('Receitas - Rendas Recebidas por Inquilino', data.pagos,
        (l: any) => data.payments.find((pay: any) => String(pay.lease_id) === String(l.id))?.amount ?? 0,
        (l: any) => {
          const p = data.payments.find((pay: any) => String(pay.lease_id) === String(l.id))
          const parts: string[] = []
          if (p?.payment_date) parts.push(`Pago em ${formatDate(p.payment_date)}`)
          if (p?.payment_method) parts.push(p.payment_method === 'dinheiro' ? 'Dinheiro' : 'Banco')
          return parts.join(' · ')
        },
        'Total Rendas Recebidas', data.totalRecebido)

      drawList('Rendas em Falta', data.emFalta, (l: any) => l.monthly_rent ?? 0)

      drawCategoriaTable('Despesas por Categoria', fin.porCategoria, fin.totalDespesas)

      pdf.save(`relatorio-${selectedMonth}.pdf`)
    } catch (e) {
      console.error('Erro ao gerar PDF:', e)
    }
    setExportingPDF(false)
  }

  const REPORTS = [
    { key: 'rendas', label: 'Rendas do Mes', icon: FileText, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { key: 'ocupacao', label: 'Ocupacao', icon: Home, color: 'text-blue-600', bg: 'bg-blue-50' },
    { key: 'financeiro', label: 'Financeiro', icon: TrendingUp, color: 'text-purple-600', bg: 'bg-purple-50' },
    { key: 'contratos', label: 'Contratos a Expirar', icon: Calendar, color: 'text-orange-600', bg: 'bg-orange-50' },
    { key: 'cobrancas', label: 'Lista de Cobrancas', icon: ClipboardList, color: 'text-rose-600', bg: 'bg-rose-50' },
    { key: 'pagamentos', label: 'Pagamentos dos Inquilinos', icon: Receipt, color: 'text-teal-600', bg: 'bg-teal-50' },
    { key: 'dividas', label: 'Dividas', icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50' },
  ]

  const showMonthPicker = activeReport === 'rendas' || activeReport === 'financeiro' || activeReport === 'cobrancas'

  return (
    <>
    <AppLayout>
      {/* Cabecalho fixo */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-8 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BarChart3 className="w-5 h-5 text-emerald-600" />
            <h1 className="text-xl font-bold text-gray-900">Relatorios</h1>
            <button onClick={handleExportPDF} disabled={exportingPDF || loading}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-50 transition-colors">
              {exportingPDF ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              {exportingPDF ? 'A gerar PDF...' : 'Exportar PDF'}
            </button>
          </div>
          <div className="flex items-center gap-3">
            {showMonthPicker && (
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-600">Mes:</label>
                <div className="relative">
                  <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
                    className="appearance-none bg-white border border-gray-200 rounded-lg px-3 py-1.5 pr-8 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500">
                    {MONTHS.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
              </div>
            )}
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              {REPORTS.map(r => (
                <button key={r.key} onClick={() => setActiveReport(r.key)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${activeReport === r.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  <r.icon className={`w-3.5 h-3.5 ${activeReport === r.key ? r.color : ''}`} />
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 md:p-8">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
          </div>
        ) : (
          <div>
            {/* RENDAS */}
            {activeReport === 'rendas' && rendas && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Valor Esperado</p>
                    <p className="text-2xl font-bold text-gray-900">{fmt(rendas.totalEsperado)}</p>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Rendas Recebidas</p>
                    <p className="text-2xl font-bold text-emerald-600">{fmt(rendas.totalRecebido)}</p>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Em Falta</p>
                    <p className="text-2xl font-bold text-red-500">{fmt(Math.max(0, rendas.totalEsperado - rendas.totalRecebido))}</p>
                  </div>
                </div>

                {rendas.totalOutros > 0 && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                    <p className="text-xs text-blue-600 font-medium mb-1">Outros recebimentos este mes (luz, caucao, adiantamento...)</p>
                    <p className="text-xl font-bold text-blue-700">{fmt(rendas.totalOutros)}</p>
                  </div>
                )}

                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-600 font-medium">Taxa de cobranca</span>
                    <span className="font-bold text-gray-900">
                      {rendas.totalEsperado > 0 ? Math.round((rendas.totalRecebido / rendas.totalEsperado) * 100) : 0}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-3">
                    <div className="bg-emerald-500 h-3 rounded-full transition-all"
                      style={{ width: `${rendas.totalEsperado > 0 ? Math.min(100, Math.round((rendas.totalRecebido / rendas.totalEsperado) * 100)) : 0}%` }} />
                  </div>
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>{rendas.pagos.length} pagos</span>
                    <span>{rendas.emFalta.length} em falta</span>
                  </div>
                </div>

                {rendas.emFalta.length > 0 && (
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Rendas em falta ({rendas.emFalta.length})</h3>
                    <div className="space-y-1">
                      {rendas.emFalta.map((l: any) => (
                        <div key={l.id}
                          onClick={() => fetchContaCorrente({ name: l.tenant?.name, leaseId: l.id, spaceRef: l.space?.ref })}
                          className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50 rounded-lg px-2 transition-colors">
                          <div>
                            <p className="text-sm font-medium text-gray-800">{l.tenant?.name ?? '—'}</p>
                            <p className="text-xs text-gray-400">{l.space?.ref}</p>
                          </div>
                          <span className="text-sm font-semibold text-red-500">{fmt(l.monthly_rent ?? 0)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {rendas.pagos.length > 0 && (
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Rendas pagas ({rendas.pagos.length})</h3>
                    <div className="space-y-1">
                      {rendas.pagos.map((l: any) => {
                        const p = rendas.payments.find((pay: any) => String(pay.lease_id) === String(l.id))
                        return (
                          <div key={l.id}
                            onClick={() => fetchContaCorrente({ name: l.tenant?.name, leaseId: l.id, spaceRef: l.space?.ref })}
                            className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50 rounded-lg px-2 transition-colors">
                            <div>
                              <p className="text-sm font-medium text-gray-800">{l.tenant?.name ?? '—'}</p>
                              <p className="text-xs text-gray-400">
                                {l.space?.ref}
                                {p?.payment_date ? ` · Pago em ${formatDate(p.payment_date)}` : ''}
                                {p?.payment_method ? ` · ${p.payment_method === 'dinheiro' ? 'Dinheiro' : 'Banco'}` : ''}
                              </p>
                            </div>
                            <span className="text-sm font-semibold text-emerald-600">{fmt(p?.amount ?? 0)}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {rendas.outrosPayments?.length > 0 && (
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Outros pagamentos do mes ({rendas.outrosPayments.length})</h3>
                    <div className="space-y-1">
                      {rendas.outrosPayments.map((p: any) => (
                        <div key={p.id} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0 px-2">
                          <div>
                            <p className="text-sm font-medium text-gray-800">
                              {p.lease?.tenant?.name ?? '—'}
                            </p>
                            <p className="text-xs text-gray-400">
                              {p.lease?.space?.ref} · {TIPO_LABELS[p.tipo] ?? p.tipo}
                              {p.payment_date ? ` · Pago em ${formatDate(p.payment_date)}` : ''}
                              {p.payment_method ? ` · ${p.payment_method === 'dinheiro' ? 'Dinheiro' : 'Banco'}` : ''}
                            </p>
                          </div>
                          <span className={`text-sm font-semibold ${p.tipo === 'adiantamento' ? 'text-purple-600' : 'text-blue-600'}`}>
                            {fmt(p.amount ?? 0)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t border-gray-100 mt-2">
                      <span className="text-xs font-semibold text-gray-500">Total outros</span>
                      <span className="text-sm font-bold text-blue-600">{fmt(rendas.totalOutros)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* DIVIDAS */}
            {activeReport === 'dividas' && dividas && (
              <div className="space-y-5">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 col-span-2 sm:col-span-1">
                    <p className="text-xs text-red-600 mb-1">
                      Dívida {dividaFiltro === 'all' ? 'total' : 'do inquilino'}
                    </p>
                    <p className="text-2xl font-bold text-red-700">
                      {fmt(dividasOrdenadas.reduce((s: number, l: any) => s + l.total, 0))}
                    </p>
                    <p className="text-xs text-red-500 mt-0.5">{dividasOrdenadas.length} inquilino(s)</p>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Rendas</p>
                    <p className="text-lg font-bold text-gray-900">
                      {fmt(dividasOrdenadas.reduce((s: number, l: any) => s + l.porGrupo.Renda, 0))}
                    </p>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Eletricidade</p>
                    <p className="text-lg font-bold text-gray-900">
                      {fmt(dividasOrdenadas.reduce((s: number, l: any) => s + l.porGrupo.Eletricidade, 0))}
                    </p>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Dívidas manuais</p>
                    <p className="text-lg font-bold text-gray-900">
                      {fmt(dividasOrdenadas.reduce((s: number, l: any) => s + l.porGrupo['Dívida'], 0))}
                    </p>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Créditos a abater</p>
                    <p className="text-lg font-bold text-emerald-600">
                      {fmt(Math.abs(dividasOrdenadas.reduce((s: number, l: any) => s + l.porGrupo['Crédito'], 0)))}
                    </p>
                  </div>
                </div>

                {dividas.linhas.length === 0 ? (
                  <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
                    <p className="text-gray-500">Nenhum inquilino com dívida em aberto.</p>
                  </div>
                ) : (
                  <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3">
                      <p className="font-semibold text-gray-900 text-sm flex-1 min-w-40">Dívida por inquilino</p>

                      <select
                        className="input text-sm py-1.5 w-64 print:hidden"
                        value={dividaFiltro}
                        onChange={e => { setDividaFiltro(e.target.value); setDividaExpandida(null) }}
                      >
                        <option value="all">Todos os inquilinos ({dividas.linhas.length})</option>
                        {[...dividas.linhas]
                          .sort((a: any, b: any) => etiquetaInquilino(a).localeCompare(etiquetaInquilino(b), 'pt', { numeric: true }))
                          .map((l: any) => (
                            <option key={l.id} value={l.id}>{etiquetaInquilino(l)}</option>
                          ))}
                      </select>

                      <div className="flex items-center gap-1 print:hidden">
                        <span className="text-xs text-gray-400 mr-1">Ordenar:</span>
                        <button
                          onClick={() => alternarOrdem('espaco')}
                          className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                            dividaOrdem === 'espaco'
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                          }`}>
                          Habitação {dividaOrdem === 'espaco' && (dividaOrdemDir === 'asc' ? '↑' : '↓')}
                        </button>
                        <button
                          onClick={() => alternarOrdem('valor')}
                          className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                            dividaOrdem === 'valor'
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                          }`}>
                          Valor {dividaOrdem === 'valor' && (dividaOrdemDir === 'asc' ? '↑' : '↓')}
                        </button>
                      </div>
                    </div>

                    {dividasOrdenadas.map((l: any) => {
                      const aberta = dividaExpandida === l.id
                      return (
                        <div key={l.id} className="border-b border-gray-50 last:border-0">
                          <button
                            onClick={() => setDividaExpandida(aberta ? null : l.id)}
                            className="w-full px-5 py-3 flex items-center gap-3 hover:bg-gray-50 text-left print:hover:bg-transparent"
                          >
                            {aberta
                              ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
                              : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-gray-900 text-sm">{l.nome}</p>
                              <p className="text-xs text-gray-500">
                                {l.espacos.length > 0 ? l.espacos.join(', ') : 'sem espaço ativo'} · {l.parcelas.length} parcela(s)
                              </p>
                            </div>
                            <div className="hidden sm:flex items-center gap-3 text-xs">
                              {l.porGrupo.Renda > 0 && (
                                <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full whitespace-nowrap">
                                  Rendas {fmt(l.porGrupo.Renda)}
                                </span>
                              )}
                              {l.porGrupo.Eletricidade > 0 && (
                                <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full whitespace-nowrap">
                                  Luz {fmt(l.porGrupo.Eletricidade)}
                                </span>
                              )}
                              {l.porGrupo['Dívida'] > 0 && (
                                <span className="bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full whitespace-nowrap">
                                  Dívidas {fmt(l.porGrupo['Dívida'])}
                                </span>
                              )}
                              {l.porGrupo['Crédito'] < 0 && (
                                <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full whitespace-nowrap">
                                  Crédito {fmt(Math.abs(l.porGrupo['Crédito']))}
                                </span>
                              )}
                            </div>
                            <span className={`font-bold text-sm whitespace-nowrap ${l.total > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                              {fmt(l.total)}
                            </span>
                          </button>

                          {aberta && (
                            <div className="px-5 pb-4 bg-gray-50/60">
                              <table className="w-full text-sm">
                                <tbody>
                                  {l.parcelas.map((p: any, i: number) => (
                                    <tr key={i} className="border-b border-gray-100 last:border-0">
                                      <td className="py-1.5 pr-3 w-28">
                                        <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${
                                          p.grupo === 'Renda' ? 'bg-gray-100 text-gray-600'
                                          : p.grupo === 'Eletricidade' ? 'bg-amber-50 text-amber-700'
                                          : p.grupo === 'Dívida' ? 'bg-purple-50 text-purple-700'
                                          : 'bg-emerald-50 text-emerald-700'
                                        }`}>
                                          {p.grupo}
                                        </span>
                                      </td>
                                      <td className="py-1.5 text-gray-700">{p.descricao}</td>
                                      <td className={`py-1.5 text-right font-medium whitespace-nowrap ${p.valor < 0 ? 'text-emerald-600' : 'text-gray-900'}`}>
                                        {fmt(p.valor)}
                                      </td>
                                    </tr>
                                  ))}
                                  <tr className="border-t-2 border-gray-200">
                                    <td colSpan={2} className="py-2 font-semibold text-gray-800">Total</td>
                                    <td className={`py-2 text-right font-bold ${l.total > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                      {fmt(l.total)}
                                    </td>
                                  </tr>
                                </tbody>
                              </table>

                              <div className="mt-3 flex items-center gap-4 print:hidden">
                                <button
                                  onClick={() => imprimirDivida(l)}
                                  className="text-xs text-blue-600 hover:underline font-medium flex items-center gap-1"
                                >
                                  <Printer className="w-3 h-3" /> Imprimir extrato (A4)
                                </button>
                                {l.email && (
                                  <button
                                    onClick={() => setEmailTarget({
                                      name: l.nome, email: l.email, spaceRef: l.espacos[0],
                                      amount: l.total, items: l.parcelas,
                                    })}
                                    className="text-xs text-emerald-600 hover:underline font-medium flex items-center gap-1"
                                  >
                                    <Mail className="w-3 h-3" /> Enviar e-mail sobre esta dívida
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                <p className="text-xs text-gray-400">
                  As rendas em falta contam a partir de maio de 2026 e apenas para contratos ativos.
                  Ao terminar um contrato, os meses seguintes deixam de ser contabilizados.
                </p>
              </div>
            )}

            {/* OCUPACAO */}
            {activeReport === 'ocupacao' && ocupacao && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Total de Espacos</p>
                    <p className="text-2xl font-bold text-gray-900">{ocupacao.total}</p>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Ocupados</p>
                    <p className="text-2xl font-bold text-emerald-600">{ocupacao.ocupados}</p>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Livres</p>
                    <p className="text-2xl font-bold text-orange-500">{ocupacao.livres}</p>
                  </div>
                </div>

                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-600 font-medium">Taxa de ocupacao</span>
                    <span className="font-bold text-gray-900">{ocupacao.taxa}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-3">
                    <div className="bg-blue-500 h-3 rounded-full transition-all" style={{ width: `${ocupacao.taxa}%` }} />
                  </div>
                </div>

                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Todos os espacos</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {ocupacao.spaces.map((s: any) => {
                      const activeLease = (s.leases ?? []).find((l: any) => l.status === 'ativo')
                      return (
                        <div key={s.id} className={`flex items-center gap-2 p-2.5 rounded-lg border ${activeLease ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'}`}>
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${activeLease ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-gray-800">{s.ref}</p>
                            <p className="text-xs text-gray-400 truncate">{activeLease?.tenant?.name ?? 'Livre'}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* FINANCEIRO */}
            {activeReport === 'financeiro' && financeiro && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Receitas</p>
                    <p className="text-2xl font-bold text-emerald-600">{fmt(financeiro.receitas)}</p>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Despesas</p>
                    <p className="text-2xl font-bold text-red-500">{fmt(financeiro.totalDespesas)}</p>
                  </div>
                  <div className={`border rounded-xl p-4 ${financeiro.saldo >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                    <p className="text-xs text-gray-500 mb-1">Saldo</p>
                    <p className={`text-2xl font-bold ${financeiro.saldo >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmt(financeiro.saldo)}</p>
                  </div>
                </div>

                {Object.keys(financeiro.porCategoria).length > 0 && (
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Despesas por categoria</h3>
                    <div className="space-y-2">
                      {Object.entries(financeiro.porCategoria)
                        .sort(([, a]: any, [, b]: any) => b.total - a.total)
                        .map(([cat, data]: any) => (
                          <div key={cat} className="border border-gray-100 rounded-lg overflow-hidden">
                            <button
                              onClick={() => setExpandedCategory(expandedCategory === cat ? null : cat)}
                              className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 transition-colors">
                              <div className="flex-1">
                                <div className="flex justify-between text-sm mb-1.5">
                                  <span className="text-gray-700 font-medium capitalize">{cat}</span>
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-gray-800">{fmt(data.total)}</span>
                                    <span className="text-xs text-gray-400">({data.items.length} registo(s))</span>
                                  </div>
                                </div>
                                <div className="w-full bg-gray-100 rounded-full h-2">
                                  <div className="bg-purple-400 h-2 rounded-full"
                                    style={{ width: `${financeiro.totalDespesas > 0 ? Math.round((data.total / financeiro.totalDespesas) * 100) : 0}%` }} />
                                </div>
                              </div>
                              {expandedCategory === cat
                                ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                            </button>

                            {expandedCategory === cat && (
                              <div className="border-t border-gray-100 bg-gray-50">
                                {data.items.map((exp: any) => (
                                  <div key={exp.id} className="px-4 py-3 border-b border-gray-100 last:border-0">
                                    {editingExpense?.id === exp.id ? (
                                      <div className="space-y-2">
                                        <div className="grid grid-cols-2 gap-2">
                                          <div>
                                            <label className="text-xs text-gray-500 mb-0.5 block">Descricao</label>
                                            <input className="input text-sm" value={editForm.description}
                                              onChange={e => setEditForm((f: any) => ({ ...f, description: e.target.value }))} />
                                          </div>
                                          <div>
                                            <label className="text-xs text-gray-500 mb-0.5 block">Fornecedor</label>
                                            <input className="input text-sm" value={editForm.supplier ?? ''}
                                              onChange={e => setEditForm((f: any) => ({ ...f, supplier: e.target.value }))} />
                                          </div>
                                        </div>
                                        <div className="grid grid-cols-4 gap-2">
                                          <div>
                                            <label className="text-xs text-gray-500 mb-0.5 block">Valor (EUR)</label>
                                            <input type="number" step="0.01" className="input text-sm" value={editForm.amount}
                                              onChange={e => setEditForm((f: any) => ({ ...f, amount: e.target.value }))} />
                                          </div>
                                          <div>
                                            <label className="text-xs text-gray-500 mb-0.5 block">Data</label>
                                            <input type="date" className="input text-sm" value={editForm.expense_date}
                                              onChange={e => setEditForm((f: any) => ({ ...f, expense_date: e.target.value }))} />
                                          </div>
                                          <div>
                                            <label className="text-xs text-gray-500 mb-0.5 block">Categoria</label>
                                            <select className="input text-sm" value={editForm.category ?? ''}
                                              onChange={e => setEditForm((f: any) => ({ ...f, category: e.target.value }))}>
                                              {CATEGORIAS.map(c => (
                                                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                                              ))}
                                            </select>
                                          </div>
                                          <div>
                                            <label className="text-xs text-gray-500 mb-0.5 block">Pagamento</label>
                                            <select className="input text-sm" value={editForm.payment_method}
                                              onChange={e => setEditForm((f: any) => ({ ...f, payment_method: e.target.value }))}>
                                              <option value="dinheiro">Dinheiro</option>
                                              <option value="banco">Banco</option>
                                            </select>
                                          </div>
                                        </div>
                                        <div className="flex gap-2 justify-end mt-1">
                                          <button onClick={() => setEditingExpense(null)}
                                            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors">
                                            <X className="w-3 h-3" /> Cancelar
                                          </button>
                                          <button onClick={handleSaveExpense} disabled={savingExpense}
                                            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors">
                                            <Save className="w-3 h-3" /> {savingExpense ? 'A guardar...' : 'Guardar'}
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="flex items-center justify-between gap-3">
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm text-gray-800 font-medium truncate">{exp.description}</p>
                                          <div className="flex items-center gap-2 mt-0.5">
                                            <span className="text-xs text-gray-400">{formatDate(exp.expense_date)}</span>
                                            {exp.supplier && <span className="text-xs text-gray-400">· {exp.supplier}</span>}
                                            <span className="text-xs text-gray-400">· {exp.payment_method === 'dinheiro' ? 'Dinheiro' : 'Banco'}</span>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                          <span className="text-sm font-semibold text-red-600">{fmt(exp.amount)}</span>
                                          <button
                                            onClick={() => { setEditingExpense(exp); setEditForm({ ...exp }) }}
                                            className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                                            title="Editar">
                                            <Edit2 className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {financeiro.despesas?.length === 0 && (
                  <div className="text-center py-8 text-gray-400 text-sm">Sem despesas registadas neste mes.</div>
                )}
              </div>
            )}

            {/* CONTRATOS */}
            {activeReport === 'contratos' && (
              <div className="space-y-5">
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-1">Contratos a expirar nos proximos 6 meses</h3>
                  <p className="text-xs text-gray-400 mb-4">Apenas contratos com data de fim definida</p>

                  {!contratos || contratos.length === 0 ? (
                    <div className="text-center py-8 text-gray-400">
                      <p className="text-sm">Nenhum contrato a expirar nos proximos 6 meses.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {contratos.map((c: any) => {
                        const dias = diasAteExpirar(c.end_date)
                        const urgente = dias <= 30
                        const aviso = dias <= 60
                        return (
                          <div key={c.id} className={`flex items-center justify-between p-3 rounded-lg border ${urgente ? 'bg-red-50 border-red-200' : aviso ? 'bg-yellow-50 border-yellow-200' : 'bg-gray-50 border-gray-200'}`}>
                            <div>
                              <p className="text-sm font-semibold text-gray-800">{c.tenant?.name ?? '—'}</p>
                              <p className="text-xs text-gray-500">{c.space?.ref} · Fim: {formatDate(c.end_date)}</p>
                            </div>
                            <div className="text-right">
                              <p className={`text-sm font-bold ${urgente ? 'text-red-600' : aviso ? 'text-yellow-600' : 'text-gray-600'}`}>
                                {dias} dias
                              </p>
                              <p className="text-xs text-gray-400">{fmt(c.monthly_rent ?? 0)}/mes</p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* LISTA DE COBRANCAS */}
            {activeReport === 'cobrancas' && rendas && (() => {
              const totalEmFalta = rendas.emFalta.reduce((s: number, l: any) => s + (l.monthly_rent ?? 0), 0)
              const sortedEmFalta = [...rendas.emFalta].sort((a: any, b: any) => {
                const dir = cobrancasSortDir === 'asc' ? 1 : -1
                if (cobrancasSort === 'espaco') return dir * (a.space?.ref ?? '').localeCompare(b.space?.ref ?? '', 'pt', { numeric: true })
                if (cobrancasSort === 'renda') return dir * ((a.monthly_rent ?? 0) - (b.monthly_rent ?? 0))
                return dir * (a.tenant?.name ?? '').localeCompare(b.tenant?.name ?? '', 'pt')
              })
              function toggleSort(col: 'espaco' | 'nome' | 'renda') {
                if (cobrancasSort === col) setCobrancasSortDir(d => d === 'asc' ? 'desc' : 'asc')
                else { setCobrancasSort(col); setCobrancasSortDir('asc') }
              }
              function SortIcon({ col }: { col: string }) {
                if (cobrancasSort !== col) return <span className="ml-1 text-gray-300">↕</span>
                return <span className="ml-1 text-emerald-600">{cobrancasSortDir === 'asc' ? '↑' : '↓'}</span>
              }
              const monthLabel = MONTHS.find(m => m.value === selectedMonth)?.label ?? selectedMonth

              return (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-4 print:hidden">
                    <div className="bg-white border border-gray-200 rounded-xl p-4">
                      <p className="text-xs text-gray-500 mb-1">Total em Falta</p>
                      <p className="text-2xl font-bold text-red-500">{fmt(totalEmFalta)}</p>
                    </div>
                    <div className="bg-white border border-gray-200 rounded-xl p-4">
                      <p className="text-xs text-gray-500 mb-1">Inquilinos em Falta</p>
                      <p className="text-2xl font-bold text-gray-900">{sortedEmFalta.length}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-end print:hidden">
                    <button onClick={() => window.print()}
                      className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium bg-gray-800 text-white hover:bg-gray-900 transition-colors">
                      Imprimir
                    </button>
                  </div>

                  <div className="print-area bg-white border border-gray-200 rounded-xl p-4 print:border-0 print:rounded-none print:p-0">
                    <div className="hidden print:block mb-4">
                      <h1 className="text-lg font-bold text-gray-900">{process.env.NEXT_PUBLIC_APP_NAME || 'Gestao da Quinta'} — {process.env.NEXT_PUBLIC_APP_LOCATION || 'Evora'}</h1>
                      <h2 className="text-sm text-gray-700">Cobrancas de {monthLabel}</h2>
                    </div>

                    {sortedEmFalta.length === 0 ? (
                      <div className="text-center py-8 text-gray-400">
                        <p className="text-sm">Sem rendas em falta para {monthLabel}.</p>
                      </div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase cursor-pointer select-none hover:text-gray-800 print:cursor-default" onClick={() => toggleSort('espaco')}>
                              Espaço<SortIcon col="espaco" />
                            </th>
                            <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase cursor-pointer select-none hover:text-gray-800 print:cursor-default" onClick={() => toggleSort('nome')}>
                              Inquilino<SortIcon col="nome" />
                            </th>
                            <th className="text-right py-2 px-2 text-xs font-semibold text-gray-500 uppercase cursor-pointer select-none hover:text-gray-800 print:cursor-default" onClick={() => toggleSort('renda')}>
                              Renda<SortIcon col="renda" />
                            </th>
                            <th className="text-center py-2 px-2 text-xs font-semibold text-gray-500 uppercase w-20">Pago</th>
                            <th className="text-center py-2 px-2 text-xs font-semibold text-gray-500 uppercase w-10 print:hidden">Email</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedEmFalta.map((l: any) => (
                            <tr key={l.id} className="border-b border-gray-50 last:border-0">
                              <td className="py-2 px-2 font-medium text-gray-800">{l.space?.ref}</td>
                              <td className="py-2 px-2 text-gray-700">{l.tenant?.name ?? '—'}</td>
                              <td className="py-2 px-2 text-right font-semibold text-gray-900">{fmt(l.monthly_rent ?? 0)}</td>
                              <td className="py-2 px-2">
                                <div className="w-5 h-5 mx-auto border-2 border-gray-400 print:border-black rounded-sm" />
                              </td>
                              <td className="py-2 px-2 text-center print:hidden">
                                <button onClick={() => setEmailTarget({ name: l.tenant?.name ?? '', email: l.tenant?.email ?? null, spaceRef: l.space?.ref, amount: l.monthly_rent ?? null })}
                                  className="text-gray-400 hover:text-purple-600 transition-colors" title="Enviar e-mail">
                                  <Mail className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    <div className="hidden print:flex justify-between items-center mt-6 pt-3 border-t border-gray-300 text-xs text-gray-600">
                      <span>Impresso em {new Date().toLocaleDateString('pt-PT')}</span>
                      <span className="font-bold">Total em falta: {fmt(totalEmFalta)}</span>
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* PAGAMENTOS DOS INQUILINOS */}
            {activeReport === 'pagamentos' && (
              <div className="space-y-5">
                {pagamentosErro && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                    <p className="text-sm text-red-700 font-medium">⚠ O relatório está incompleto</p>
                    <p className="text-sm text-red-600 mt-1">{pagamentosErro}</p>
                  </div>
                )}
                {/* Filtros */}
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="flex flex-wrap gap-4 items-end">
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">Espaço</label>
                      <div className="relative" ref={pagamentosSpaceRef}>
                        <button
                          onClick={() => setShowPagamentosSpaceDropdown(v => !v)}
                          className={`appearance-none bg-white border rounded-lg px-3 py-1.5 pr-8 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500 flex items-center gap-2 min-w-[160px] ${pagamentosEspacos.length > 0 ? 'border-teal-400 text-teal-700' : 'border-gray-200 text-gray-700'}`}>
                          <span className="truncate">
                            {pagamentosEspacos.length === 0 ? 'Todos os espaços' : pagamentosEspacos.length === 1 ? pagamentosEspacos[0] : `${pagamentosEspacos.length} espaços`}
                          </span>
                          <ChevronDown className="w-4 h-4 flex-shrink-0 ml-auto text-gray-400" />
                        </button>
                        {showPagamentosSpaceDropdown && (
                          <div className="absolute z-20 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-y-auto min-w-[160px]">
                            <div className="p-2 border-b border-gray-100">
                              <button onClick={() => setPagamentosEspacos([])} className="text-xs text-gray-500 hover:text-teal-600 hover:underline">
                                Limpar seleção
                              </button>
                            </div>
                            <div className="p-1">
                              {[...allSpaces].sort((a: any, b: any) => a.ref.localeCompare(b.ref, 'pt', { numeric: true })).map((s: any) => (
                                <label key={s.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer">
                                  <input type="checkbox"
                                    checked={pagamentosEspacos.includes(s.ref)}
                                    onChange={() => setPagamentosEspacos(prev => prev.includes(s.ref) ? prev.filter(r => r !== s.ref) : [...prev, s.ref])}
                                    className="accent-teal-600 w-3.5 h-3.5" />
                                  <span className="text-sm text-gray-700">{s.ref}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">Periodo</label>
                      <div className="relative">
                        <select
                          value={pagamentosMes}
                          onChange={e => setPagamentosMes(e.target.value)}
                          className="appearance-none bg-white border border-gray-200 rounded-lg px-3 py-1.5 pr-8 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500">
                          <option value="year">Ano atual ({new Date().getFullYear()})</option>
                          {MONTHS.map(m => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                      </div>
                    </div>
                  </div>
                </div>

                {pagamentos && (() => {
                  function printPagamentos() {
                    const withPayment = pagamentos.payments
                    const withoutPayment: any[] = []
                    const groupMap: Record<string, any> = {}
                    for (const p of withPayment) {
                      const key = `${p.payment_date}__${p.payment_method}__${p.lease?.tenant?.name ?? ''}__${p.lease?.space?.ref ?? ''}`
                      if (!groupMap[key]) groupMap[key] = { key, date: p.payment_date, method: p.payment_method, tenant: p.lease?.tenant?.name ?? '—', space: p.lease?.space?.ref ?? '—', items: [], total: 0 }
                      groupMap[key].items.push(p)
                      groupMap[key].total += p.amount ?? 0
                    }
                    const groups = Object.values(groupMap).sort((a: any, b: any) => a.date.localeCompare(b.date))
                    const periodoLabel = pagamentosMes === 'year' ? `Ano ${new Date().getFullYear()}` : MONTHS.find(m => m.value === pagamentosMes)?.label ?? pagamentosMes
                    const espacoLabel = pagamentosEspacos.length === 0 ? 'Todos os espaços' : pagamentosEspacos.join(', ')
                    const today = new Date().toLocaleDateString('pt-PT')

                    const groupsHtml = groups.map((g: any) => {
                      const rows = [...g.items].sort((a: any, b: any) => (a.reference_month ?? '').localeCompare(b.reference_month ?? '')).map((p: any) => {
                        const mes = p.reference_month ? new Date(p.reference_month).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' }) : '—'
                        const tipoLabel = TIPO_LABELS[p.tipo || 'renda'] ?? p.tipo ?? 'Renda'
                        const tipoColor = (p.tipo || 'renda') === 'renda' ? '#065f46;background:#d1fae5' : p.tipo === 'adiantamento' ? '#5b21b6;background:#ede9fe' : '#92400e;background:#fef3c7'
                        return `<tr>
                          <td style="padding:6px 8px;color:#6b7280;font-size:12px">↳ ${mes}</td>
                          <td style="padding:6px 8px"><span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:12px;color:${tipoColor}">${tipoLabel}</span></td>
                          <td style="padding:6px 8px;color:#6b7280;font-size:12px;font-style:italic">${p.notes ?? ''}</td>
                          <td style="padding:6px 8px;text-align:right;font-weight:600;font-size:13px">${(p.amount ?? 0).toFixed(2)} €</td>
                        </tr>`
                      }).join('')
                      const dateStr = formatDate(g.date)
                      const methodStr = g.method === 'dinheiro' ? '💵 Dinheiro' : '🏦 Banco'
                      return `<div style="margin-bottom:16px;border:1px solid #99f6e4;border-radius:8px;overflow:hidden;page-break-inside:avoid">
                        <div style="background:#f0fdfa;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #99f6e4">
                          <div>
                            <p style="font-size:13px;font-weight:700;color:#0f766e;margin:0">${dateStr} · ${methodStr}</p>
                            <p style="font-size:11px;color:#0d9488;margin:2px 0 0">${g.tenant} · ${g.space}</p>
                          </div>
                          <p style="font-size:15px;font-weight:700;color:#0f766e;margin:0">${g.total.toFixed(2)} €</p>
                        </div>
                        <table style="width:100%;border-collapse:collapse"><tbody>${rows}</tbody></table>
                      </div>`
                    }).join('')

                    const semDataHtml = withoutPayment.length > 0 ? `<div style="margin-bottom:16px;border:1px solid #fed7aa;border-radius:8px;overflow:hidden">
                      <div style="background:#fff7ed;padding:10px 14px;border-bottom:1px solid #fed7aa"><p style="font-size:13px;font-weight:600;color:#c2410c;margin:0">⚠ Sem data de pagamento registada</p></div>
                      <table style="width:100%;border-collapse:collapse"><tbody>${withoutPayment.map((p: any) => `<tr><td style="padding:6px 8px">${p.reference_month ? new Date(p.reference_month).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' }) : '—'}</td><td style="padding:6px 8px;text-align:right;font-weight:600">${(p.amount ?? 0).toFixed(2)} €</td></tr>`).join('')}</tbody></table>
                    </div>` : ''

                    const html = `<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8">
                    <title>Pagamentos — ${espacoLabel}</title>
                    <style>
                      @page { size: A4 portrait; margin: 18mm 16mm; }
                      * { box-sizing: border-box; margin: 0; padding: 0; }
                      body { font-family: Arial, sans-serif; font-size: 13px; color: #1a1a1a; }
                      .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0d9488; padding-bottom: 14px; margin-bottom: 20px; }
                      .header h1 { font-size: 18px; font-weight: 700; color: #0d9488; }
                      .header p { font-size: 11px; color: #6b7280; margin-top: 3px; }
                      .meta { text-align: right; font-size: 11px; color: #6b7280; }
                      .summary { display: flex; gap: 24px; background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; }
                      .summary-item label { font-size: 10px; color: #0d9488; text-transform: uppercase; letter-spacing: 0.05em; display: block; }
                      .summary-item span { font-size: 16px; font-weight: 700; color: #0f766e; }
                      .footer { margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 12px; display: flex; justify-content: space-between; font-size: 10px; color: #9ca3af; }
                    </style></head><body>
                    <div class="header">
                      <div><h1>Histórico de Pagamentos</h1><p>${espacoLabel} · ${periodoLabel}</p></div>
                      <div class="meta"><p>Emitido em: <strong>${today}</strong></p></div>
                    </div>
                    <div class="summary">
                      <div class="summary-item"><label>Total Recebido</label><span>${pagamentos.total.toFixed(2)} €</span></div>
                      <div class="summary-item"><label>Eventos de Pagamento</label><span>${groups.length}</span></div>
                      <div class="summary-item"><label>Registos</label><span>${pagamentos.payments.length}</span></div>
                    </div>
                    ${groupsHtml}${semDataHtml}
                    <div class="footer"><span>Documento gerado automaticamente</span><span>Total: ${pagamentos.total.toFixed(2)} €</span></div>
                    <script>window.onload=()=>window.print()</script>
                    </body></html>`

                    const w = window.open('', '_blank')
                    if (w) { w.document.write(html); w.document.close() }
                  }

                  return <>
                    <div className="flex justify-end">
                      <button onClick={printPagamentos} className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium bg-gray-800 text-white hover:bg-gray-900 transition-colors">
                        🖨️ Imprimir
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 col-span-2 sm:col-span-1">
                        <p className="text-xs text-teal-600 font-medium mb-1">Total Recebido</p>
                        <p className="text-2xl font-bold text-teal-700">{fmt(pagamentos.total)}</p>
                        <p className="text-xs text-teal-500 mt-1">{pagamentos.payments.length} pagamento(s)</p>
                      </div>
                      {Object.entries(pagamentos.totalPorTipo).sort(([, a]: any, [, b]: any) => b - a).map(([tipo, val]: any) => (
                        <div key={tipo} className="bg-white border border-gray-200 rounded-xl p-4">
                          <p className="text-xs text-gray-500 mb-1">{TIPO_LABELS[tipo] ?? tipo}</p>
                          <p className="text-lg font-bold text-gray-900">{fmt(val)}</p>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-3">
                      {pagamentos.payments.length === 0 ? (
                        <div className="bg-white border border-gray-200 rounded-xl text-center py-12 text-gray-400">
                          <Receipt className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                          <p className="text-sm">Sem pagamentos para o periodo e filtro selecionados.</p>
                        </div>
                      ) : (() => {
                        // Agrupar por evento de pagamento: data + método + inquilino + espaço
                        const withPayment = pagamentos.payments
                        const withoutPayment: any[] = []

                        const groupMap: Record<string, { key: string; date: string; method: string; tenant: string; space: string; items: any[]; total: number }> = {}
                        for (const p of withPayment) {
                          const key = `${p.payment_date}__${p.payment_method}__${p.lease?.tenant?.name ?? ''}__${p.lease?.space?.ref ?? ''}`
                          if (!groupMap[key]) groupMap[key] = { key, date: p.payment_date, method: p.payment_method, tenant: p.lease?.tenant?.name ?? '—', space: p.lease?.space?.ref ?? '—', items: [], total: 0 }
                          groupMap[key].items.push(p)
                          groupMap[key].total += p.amount ?? 0
                        }
                        const groups = Object.values(groupMap).sort((a, b) => a.date.localeCompare(b.date))

                        return (
                          <>
                            {groups.map((g) => (
                              <div key={g.key} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                                {/* Cabeçalho do evento de pagamento */}
                                <div className="flex items-center justify-between px-4 py-3 bg-teal-50 border-b border-teal-100">
                                  <div className="flex items-center gap-3">
                                    <div>
                                      <p className="text-sm font-semibold text-teal-800">
                                        {formatDate(g.date)} · {g.method === 'dinheiro' ? '💵 Dinheiro' : '🏦 Banco'}
                                      </p>
                                      <p className="text-xs text-teal-600">{g.tenant} · {g.space}</p>
                                    </div>
                                  </div>
                                  <p className="text-base font-bold text-teal-700">{fmt(g.total)}</p>
                                </div>
                                {/* Linhas do que este pagamento cobriu */}
                                <table className="w-full text-sm">
                                  <tbody>
                                    {g.items.sort((a: any, b: any) => (a.reference_month ?? '').localeCompare(b.reference_month ?? '')).map((p: any) => (
                                      <tr key={p.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                                        <td className="py-2 px-4 text-gray-500 text-xs w-8">↳</td>
                                        <td className="py-2 px-4 text-gray-700">
                                          {p.reference_month
                                            ? new Date(p.reference_month).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' })
                                            : '—'}
                                        </td>
                                        <td className="py-2 px-4">
                                          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${
                                            (p.tipo || 'renda') === 'renda' ? 'bg-emerald-100 text-emerald-700' :
                                            p.tipo === 'luz' ? 'bg-yellow-100 text-yellow-700' :
                                            p.tipo === 'caucao' ? 'bg-gray-100 text-gray-700' :
                                            p.tipo === 'adiantamento' ? 'bg-purple-100 text-purple-700' :
                                            'bg-blue-100 text-blue-700'
                                          }`}>
                                            {TIPO_LABELS[p.tipo || 'renda'] ?? p.tipo}
                                          </span>
                                        </td>
                                        {p.notes && <td className="py-2 px-4 text-xs text-gray-400 italic">{p.notes}</td>}
                                        {!p.notes && <td className="py-2 px-4" />}
                                        <td className="py-2 px-4 text-right font-semibold text-gray-900">{fmt(p.amount ?? 0)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ))}

                            {/* Pagamentos sem data (registos sem payment_date) */}
                            {withoutPayment.length > 0 && (
                              <div className="bg-white border border-orange-200 rounded-xl overflow-hidden">
                                <div className="px-4 py-3 bg-orange-50 border-b border-orange-100">
                                  <p className="text-sm font-semibold text-orange-700">⚠ Sem data de pagamento registada</p>
                                </div>
                                <table className="w-full text-sm">
                                  <tbody>
                                    {withoutPayment.map((p: any) => (
                                      <tr key={p.id} className="border-b border-gray-50 last:border-0">
                                        <td className="py-2 px-4 text-gray-700">
                                          {p.reference_month ? new Date(p.reference_month).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' }) : '—'}
                                        </td>
                                        <td className="py-2 px-4 text-gray-600">{p.lease?.tenant?.name ?? '—'} · {p.lease?.space?.ref ?? '—'}</td>
                                        <td className="py-2 px-4 text-right font-semibold text-gray-900">{fmt(p.amount ?? 0)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            <div className="bg-teal-50 border border-teal-200 rounded-xl px-4 py-3 flex justify-between items-center">
                              <p className="text-sm font-semibold text-teal-700">{groups.length} evento(s) de pagamento · {pagamentos.payments.length} registos</p>
                              <p className="text-base font-bold text-teal-700">{fmt(pagamentos.total)}</p>
                            </div>
                          </>
                        )
                      })()}
                    </div>
                  </>
                })()}
              </div>
            )}

          </div>
        )}
      </div>

      {/* Modal Conta Corrente */}
      {contaCorrenteModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold text-lg text-gray-900">Conta Corrente</h2>
                <p className="text-sm text-gray-500">{contaCorrenteModal.name} · {contaCorrenteModal.spaceRef}</p>
              </div>
              <button onClick={() => setContaCorrenteModal(null)}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            {loadingCC ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-600" />
              </div>
            ) : contaCorrenteData.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Sem pagamentos registados.</p>
            ) : (
              <div className="space-y-2">
                {contaCorrenteData.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        {p.reference_month ? new Date(p.reference_month).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' }) : '—'}
                      </p>
                      <p className="text-xs text-gray-400">
                        {p.payment_date ? formatDate(p.payment_date) : '—'} · {p.payment_method === 'dinheiro' ? 'Dinheiro' : 'Banco'}
                        {p.tipo && p.tipo !== 'renda' ? ` · ${TIPO_LABELS[p.tipo] ?? p.tipo}` : ''}
                      </p>
                    </div>
                    <span className={`text-sm font-semibold ${p.tipo === 'adiantamento' ? 'text-purple-600' : 'text-emerald-600'}`}>
                      {fmt(p.amount ?? 0)}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between items-center pt-2 border-t border-gray-200 mt-2">
                  <span className="text-sm font-semibold text-gray-700">Total</span>
                  <span className="text-base font-bold text-emerald-600">
                    {fmt(contaCorrenteData.reduce((s: number, p: any) => s + (p.amount ?? 0), 0))}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </AppLayout>

    {emailTarget && (
      <EmailComposer
        // Vem da tabela "rendas em falta" — o e-mail é de aviso de renda em atraso
        context="renda_atraso"
        tenantName={emailTarget.name}
        tenantEmail={emailTarget.email}
        spaceRef={emailTarget.spaceRef}
        amount={emailTarget.amount ?? null}
        periods={emailTarget.period ? [emailTarget.period] : undefined}
        items={emailTarget.items}
        onClose={() => setEmailTarget(null)}
      />
    )}
    </>
  )
}
