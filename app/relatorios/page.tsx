'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatDate } from '@/lib/utils'
import { BarChart3, TrendingUp, Home, FileText, Calendar, ChevronDown, ChevronUp, Edit2, X, Save, ClipboardList, Download, Loader2, Receipt } from 'lucide-react'

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

export default function RelatoriosPage() {
  const supabase = createClient()
  const [activeReport, setActiveReport] = useState('rendas')
  const [selectedMonth, setSelectedMonth] = useState(MONTHS[0].value)
  const [loading, setLoading] = useState(false)

  const [rendas, setRendas] = useState<any>(null)
  const [ocupacao, setOcupacao] = useState<any>(null)
  const [financeiro, setFinanceiro] = useState<any>(null)
  const [contratos, setContratos] = useState<any>(null)

  const [expandedCategory, setExpandedCategory] = useState<string | null>(null)

  const [contaCorrenteModal, setContaCorrenteModal] = useState<any>(null)
  const [contaCorrenteData, setContaCorrenteData] = useState<any[]>([])
  const [loadingCC, setLoadingCC] = useState(false)

  const [editingExpense, setEditingExpense] = useState<any>(null)
  const [editForm, setEditForm] = useState<any>({})
  const [savingExpense, setSavingExpense] = useState(false)

  const [cobrancasSort, setCobrancasSort] = useState<'espaco' | 'nome' | 'renda'>('espaco')
  const [cobrancasSortDir, setCobrancasSortDir] = useState<'asc' | 'desc'>('asc')

  const [exportingPDF, setExportingPDF] = useState(false)

  // Pagamentos dos Inquilinos
  const [pagamentos, setPagamentos] = useState<any>(null)
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
        .order('reference_month', { ascending: false })

      if (leaseIdFilter !== null) {
        rpQuery = rpQuery.in('lease_id', leaseIdFilter.length ? leaseIdFilter : noResults)
      }

      const { data: paymentsData } = await rpQuery

      // --- electricity_charges (pagas) ---
      let ecQuery = supabase
        .from('electricity_charges')
        .select('*, lease:leases(id, space:spaces(id, ref), tenant:tenants(name))')
        .eq('paid', true)
        .gte('reference_month', startDate)
        .lt('reference_month', endDate)
        .order('reference_month', { ascending: false })

      if (leaseIdFilter !== null) {
        ecQuery = ecQuery.in('lease_id', leaseIdFilter.length ? leaseIdFilter : noResults)
      }

      const { data: elecData } = await ecQuery

      // Normalizar electricity_charges para o mesmo formato que rent_payments
      const elecNorm = (elecData ?? []).map((e: any) => ({
        ...e,
        tipo: 'luz',
        payment_date: e.payment_date,
        payment_method: e.payment_method,
      }))

      const filtered = [...(paymentsData ?? []), ...elecNorm].sort((a: any, b: any) =>
        (b.reference_month ?? '').localeCompare(a.reference_month ?? '')
      )

      const total = filtered.reduce((s: number, p: any) => s + (p.amount ?? 0), 0)
      const totalPorTipo: Record<string, number> = {}
      for (const p of filtered) {
        const tipo = p.tipo || 'renda'
        totalPorTipo[tipo] = (totalPorTipo[tipo] ?? 0) + (p.amount ?? 0)
      }

      setPagamentos({ payments: filtered, total, totalPorTipo })
    } catch (e) {
      console.error(e)
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
  ]

  const showMonthPicker = activeReport === 'rendas' || activeReport === 'financeiro' || activeReport === 'cobrancas'

  return (
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

                {pagamentos && (
                  <>
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
                        const withPayment = pagamentos.payments.filter((p: any) => p.payment_date)
                        const withoutPayment = pagamentos.payments.filter((p: any) => !p.payment_date)

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
                )}
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
  )
}
