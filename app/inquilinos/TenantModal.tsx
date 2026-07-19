'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Tenant } from '@/lib/types'
import { X, User, Home, FileText, Plus, Trash2, Pencil, ChevronRight, ChevronLeft, Upload, Loader2, Sparkles, Printer, ReceiptText, Banknote, Mail } from 'lucide-react'
import EmailModal from '@/components/EmailModal'
import { formatCurrency, formatDate, getCurrentMonth } from '@/lib/utils'
import { logAccess } from '@/lib/logAccess'

interface Props {
  tenant: Tenant | null
  onClose: () => void
  onSaved: () => void
  initialTab?: 'dados' | 'espacos' | 'conta'
}

const tipoConfig = {
  renda:  { label: '🏠 Renda' },
  caucao: { label: '🔒 Caução' },
  extra:  { label: '➕ Extra' },
  luz:    { label: '⚡ Luz' },
  adiantamento: { label: '💰 Adiantamento' },
  divida: { label: '⚠️ Dívida' },
  eletricidade: { label: '⚡ Eletricidade' },
}

interface PaymentRow {
  id?: string
  lease_id?: string
  reference_month: string
  amount: number
  payment_date: string | null
  payment_method: string | null
  tipo: string
  notes?: string | null
  used?: boolean
  lease?: any
  isMissing?: boolean
  isManualDebt?: boolean
  isElecCharge?: boolean
  isPartialElec?: boolean
  remainingAmount?: number
}

export default function TenantModal({ tenant, onClose, onSaved, initialTab }: Props) {
  const isNew = !tenant

  const [createMode, setCreateMode] = useState<'escolha' | 'manual' | 'ocr'>('escolha')
  const [step, setStep] = useState<1 | 2>(1)
  const [newTenantId, setNewTenantId] = useState<string | null>(null)
  const [tab, setTab] = useState<'dados' | 'espacos' | 'conta'>(initialTab ?? 'dados')

  const [form, setForm] = useState({
    name: tenant?.name ?? '',
    phone: tenant?.phone ?? '',
    email: tenant?.email ?? '',
    nif: tenant?.nif ?? '',
    notes: tenant?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [contractFile, setContractFile] = useState<File | null>(null)
  const [processingOCR, setProcessingOCR] = useState(false)
  const [ocrDone, setOcrDone] = useState(false)
  const [ocrError, setOcrError] = useState('')

  const [spaces, setSpaces] = useState<any[]>([])
  const [contractForm, setContractForm] = useState({
    space_id: '', monthly_rent: '', deposit: '', start_date: '', end_date: '', notes: '', status: 'ativo', skip: false,
  })
  const [savingContract, setSavingContract] = useState(false)
  const [contractError, setContractError] = useState('')

  const [allSpaces, setAllSpaces] = useState<any[]>([])
  const [assignedSpaces, setAssignedSpaces] = useState<string[]>([])
  const [savingSpaces, setSavingSpaces] = useState(false)

  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [leases, setLeases] = useState<any[]>([])
  const [loadingPayments, setLoadingPayments] = useState(false)
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null)
  const [paymentForm, setPaymentForm] = useState({
    lease_id: '', reference_month: getCurrentMonth().slice(0, 7), amount: '',
    payment_date: new Date().toISOString().slice(0, 10), payment_method: 'dinheiro',
    tipo: 'renda', notes: '', is_debt: false,
  })
  const [savingPayment, setSavingPayment] = useState(false)
  const [paymentError, setPaymentError] = useState('')

  const [showEmailModal, setShowEmailModal] = useState(false)

  const [showRecebimentoForm, setShowRecebimentoForm] = useState(false)
  const [recebimentoForm, setRecebimentoForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    amount: '',
    method: 'dinheiro',
  })
  const [savingRecebimento, setSavingRecebimento] = useState(false)

  useEffect(() => {
    async function loadSpaces() {
      const { data } = await supabase.from('spaces').select('*').order('ref')
      setSpaces(data ?? [])
      setAllSpaces(data ?? [])
    }
    loadSpaces()
    if (tenant) { fetchSpaces(); fetchPayments() }
  }, [tenant])

  async function fetchSpaces() {
    const { data } = await supabase.from('spaces').select('id, ref, status, tenant_id').order('ref')
    setAllSpaces(data ?? [])
    const assigned = (data ?? []).filter(s => s.tenant_id === tenant?.id).map(s => s.id)
    setAssignedSpaces(assigned)
  }

  async function fetchPayments() {
    if (!tenant) return
    setLoadingPayments(true)
    const { data: leasesData } = await supabase
      .from('leases').select('id, space:spaces(ref), monthly_rent, status, start_date')
      .eq('tenant_id', tenant.id)
    setLeases(leasesData ?? [])

    const leaseIds = (leasesData ?? []).map(l => l.id)
    const activeLease = (leasesData ?? []).find(l => l.status === 'ativo')
    if (activeLease) setPaymentForm(f => ({ ...f, lease_id: activeLease.id, amount: String(activeLease.monthly_rent) }))

    // Histórico de rendas (para calcular renda correta por mês)
    const { data: rentHistoryRaw } = leaseIds.length > 0
      ? await supabase.from('lease_rent_history').select('*').in('lease_id', leaseIds).order('effective_date', { ascending: true })
      : { data: [] }
    const rentHistoryAll = rentHistoryRaw ?? []

    const getRentForMonth = (leaseId: string, monthStr: string, fallback: number): number => {
      const monthStart = monthStr + '-01'
      const applicable = rentHistoryAll
        .filter((h: any) => h.lease_id === leaseId && h.effective_date <= monthStart)
        .sort((a: any, b: any) => b.effective_date.localeCompare(a.effective_date))
      return applicable[0]?.monthly_rent ?? fallback
    }

    // Pagamentos normais
    const { data: pays } = leaseIds.length > 0
      ? await supabase.from('rent_payments').select('*').in('lease_id', leaseIds).order('reference_month', { ascending: false })
      : { data: [] }

    const enriched: PaymentRow[] = (pays ?? []).map(p => ({
      ...p, lease: (leasesData ?? []).find(l => l.id === p.lease_id), isMissing: false, isManualDebt: false, isElecCharge: false
    }))

    // Rendas em falta
    const missingRows: PaymentRow[] = []
    const mayStart = new Date('2026-05-01')
    const today = new Date(); today.setDate(1)
    for (const lease of (leasesData ?? []).filter(l => l.status === 'ativo')) {
      if (!lease.start_date) continue
      const contractStart = new Date(lease.start_date); contractStart.setDate(1)
      const start = contractStart > mayStart ? contractStart : mayStart
      const cursor = new Date(start)
      while (cursor <= today) {
        const monthStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
        const monthPayments = enriched.filter(p => p.lease_id === lease.id && p.reference_month?.slice(0, 7) === monthStr && (p.tipo === 'renda' || !p.tipo))
        const totalPaidThisMonth = monthPayments.reduce((s, p) => s + (p.amount ?? 0), 0)
        const hasPayment = monthPayments.length > 0
        const rentForMonth = getRentForMonth(lease.id, monthStr, lease.monthly_rent)
        if (!hasPayment) {
          missingRows.push({
            reference_month: monthStr + '-01', amount: rentForMonth,
            payment_date: null, payment_method: null, tipo: 'renda', lease, isMissing: true, isManualDebt: false, isElecCharge: false
          })
        } else if (totalPaidThisMonth < rentForMonth - 0.01) {
          const shortfall = parseFloat((rentForMonth - totalPaidThisMonth).toFixed(2))
          missingRows.push({
            reference_month: monthStr + '-01', amount: shortfall,
            payment_date: null, payment_method: null, tipo: 'renda', lease, isMissing: true, isManualDebt: false, isElecCharge: false,
            notes: `Pagamento parcial — faltam ${formatCurrency(shortfall)}`
          })
        }
        cursor.setMonth(cursor.getMonth() + 1)
      }
    }

    // Dívidas manuais
    const { data: debtsData } = await supabase.from('debts').select('*, payments:debt_payments(*)').eq('tenant_id', tenant.id).order('reference_date', { ascending: false })
    const manualDebtRows: PaymentRow[] = (debtsData ?? []).map(d => {
      const paid = (d.payments ?? []).reduce((s: number, p: any) => s + p.amount, 0)
      const remaining = Math.max(0, d.original_amount - paid)
      return {
        id: d.id,
        reference_month: d.reference_date,
        amount: d.original_amount,
        remainingAmount: remaining,
        payment_date: remaining === 0 ? 'liquidada' : null,
        payment_method: null,
        tipo: 'divida',
        notes: d.description,
        isMissing: false,
        isManualDebt: true,
        isElecCharge: false,
      }
    })

    // Cobranças de eletricidade (pagas e por pagar)
    const elecChargeRows: PaymentRow[] = []
    if (leaseIds.length > 0) {
      const { data: elecData } = await supabase
        .from('electricity_charges')
        .select('id, lease_id, amount, amount_paid, charge_date, reference_month, paid, payment_date, payment_method')
        .in('lease_id', leaseIds)

      for (const ec of elecData ?? []) {
        const lease = (leasesData ?? []).find(l => l.id === ec.lease_id)
        const refDate = ec.charge_date ?? ec.reference_month ?? new Date().toISOString().slice(0, 10)
        const amountPaid = ec.amount_paid ?? 0
        const remaining = Math.max(0, ec.amount - amountPaid)
        const isPartial = !ec.paid && amountPaid > 0
        elecChargeRows.push({
          id: ec.id,
          lease_id: ec.lease_id,
          reference_month: refDate,
          amount: ec.amount,
          remainingAmount: ec.paid ? 0 : remaining,
          payment_date: ec.paid ? ec.payment_date : null,
          payment_method: ec.paid ? ec.payment_method : null,
          tipo: 'eletricidade',
          notes: ec.paid
            ? 'Cobrança de eletricidade paga'
            : isPartial
              ? `Cobrança de eletricidade — pago parcialmente (${formatCurrency(amountPaid)} de ${formatCurrency(ec.amount)})`
              : 'Cobrança de eletricidade por pagar',
          lease,
          isMissing: false,
          isManualDebt: false,
          isElecCharge: true,
          isPartialElec: isPartial,
        })
      }
    }

    const allRows = [...enriched, ...missingRows, ...manualDebtRows, ...elecChargeRows]
      .sort((a, b) => {
        // 1. Mês descendente
        const monthDiff = b.reference_month.localeCompare(a.reference_month)
        if (monthDiff !== 0) return monthDiff
        // 2. Dentro do mesmo mês: em dívida/por pagar primeiro, pago depois
        const aIsPaid = !a.isMissing && !!a.payment_date
        const bIsPaid = !b.isMissing && !!b.payment_date
        if (aIsPaid !== bIsPaid) return aIsPaid ? 1 : -1
        return 0
      })

    setPayments(allRows)
    setLoadingPayments(false)
  }

  async function handleOCR(file: File) {
    setContractFile(file); setOcrDone(false); setOcrError(''); setProcessingOCR(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/process-contract', { method: 'POST', body: formData })
      const result = await res.json()
      if (result.error) { setOcrError('Erro no OCR: ' + result.error); setProcessingOCR(false); return }
      const d = result.data
      setForm(f => ({ ...f, name: d.tenant_name ?? f.name, nif: d.tenant_nif ?? f.nif, phone: d.tenant_phone ?? f.phone, email: d.tenant_email ?? f.email }))
      setContractForm(f => ({ ...f, monthly_rent: d.monthly_rent ? String(d.monthly_rent) : f.monthly_rent, deposit: d.deposit ? String(d.deposit) : f.deposit, start_date: d.start_date ?? f.start_date, end_date: d.end_date ?? f.end_date, notes: d.notes ?? f.notes }))
      setOcrDone(true); setStep(2)
    } catch (e: any) { setOcrError('Erro: ' + e.message) }
    setProcessingOCR(false)
  }

  async function handleSaveStep1() {
    if (!form.name.trim()) { setError('O nome é obrigatório'); return }
    setSaving(true); setError('')
    const payload = { name: form.name.trim(), phone: form.phone || null, email: form.email || null, nif: form.nif || null, notes: form.notes || null }
    if (isNew) {
      const { data, error: err } = await supabase.from('tenants').insert(payload).select().single()
      setSaving(false)
      if (err) { setError(err.message); return }
      await logAccess({ action: 'criar', page: '/inquilinos', details: `Criou inquilino "${form.name.trim()}"` })
      setNewTenantId(data.id); setStep(2)
    } else {
      const { error: err } = await supabase.from('tenants').update(payload).eq('id', tenant!.id)
      setSaving(false)
      if (err) { setError(err.message); return }
      await logAccess({ action: 'editar', page: '/inquilinos', details: `Editou inquilino "${form.name.trim()}"` })
      onSaved()
    }
  }

  async function handleSaveContract() {
    if (contractForm.skip) { onSaved(); return }
    if (!contractForm.space_id || !contractForm.monthly_rent || !contractForm.start_date) { setContractError('Espaço, renda e data de início são obrigatórios'); return }
    setSavingContract(true); setContractError('')
    const tenantId = newTenantId!
    let contractPath = null
    if (contractFile) {
      const cleanName = contractFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const filename = `contracts/${tenantId}/${Date.now()}_${cleanName}`
      const bytes = await contractFile.arrayBuffer()
      await supabase.storage.from('documents').upload(filename, bytes, { contentType: 'application/pdf' })
      contractPath = filename
    }
    const { error: err } = await supabase.from('leases').insert({
      space_id: contractForm.space_id, tenant_id: tenantId,
      monthly_rent: parseFloat(contractForm.monthly_rent),
      deposit: contractForm.deposit ? parseFloat(contractForm.deposit) : null,
      start_date: contractForm.start_date, end_date: contractForm.end_date || null,
      notes: contractForm.notes || null, status: contractForm.status, contract_file_path: contractPath,
    })
    if (!err) await supabase.from('spaces').update({ status: 'arrendado', tenant_id: tenantId }).eq('id', contractForm.space_id)
    setSavingContract(false)
    if (err) { setContractError(err.message); return }
    const space = spaces.find(s => s.id === contractForm.space_id)
    await logAccess({ action: 'criar', page: '/inquilinos', details: `Criou contrato para "${form.name}" no espaço ${space?.ref ?? ''} (${formatCurrency(parseFloat(contractForm.monthly_rent))}/mês)` })
    onSaved()
  }

  async function handleToggleSpace(spaceId: string) {
    if (!tenant) return
    const isAssigned = assignedSpaces.includes(spaceId)
    const space = allSpaces.find(s => s.id === spaceId)
    setSavingSpaces(true)
    if (isAssigned) {
      await supabase.from('spaces').update({ tenant_id: null, status: 'disponivel' }).eq('id', spaceId)
      setAssignedSpaces(prev => prev.filter(id => id !== spaceId))
      await logAccess({ action: 'editar', page: '/inquilinos', details: `Desassociou espaço ${space?.ref ?? ''} de "${tenant.name}"` })
    } else {
      await supabase.from('spaces').update({ tenant_id: tenant.id, status: 'arrendado' }).eq('id', spaceId)
      setAssignedSpaces(prev => [...prev, spaceId])
      await logAccess({ action: 'editar', page: '/inquilinos', details: `Associou espaço ${space?.ref ?? ''} a "${tenant.name}"` })
    }
    setSavingSpaces(false)
    await fetchSpaces()
  }

  function handleEditPayment(p: PaymentRow) {
    setEditingPaymentId(p.id ?? null)
    setPaymentForm({ lease_id: p.lease_id ?? leases[0]?.id ?? '', reference_month: p.reference_month?.slice(0, 7) ?? '', amount: String(p.amount), payment_date: p.payment_date ?? new Date().toISOString().slice(0, 10), payment_method: p.payment_method ?? 'dinheiro', tipo: p.tipo ?? 'renda', notes: p.notes ?? '', is_debt: !p.payment_date })
    setShowPaymentForm(true); setPaymentError('')
  }

  function handleNewPayment() {
    setEditingPaymentId(null)
    const activeLease = leases.find(l => l.status === 'ativo')
    setPaymentForm({ lease_id: activeLease?.id ?? '', reference_month: getCurrentMonth().slice(0, 7), amount: String(activeLease?.monthly_rent ?? ''), payment_date: new Date().toISOString().slice(0, 10), payment_method: 'dinheiro', tipo: 'renda', notes: '', is_debt: false })
    setShowPaymentForm(true); setPaymentError('')
  }

  async function handleSavePayment() {
    if (!paymentForm.lease_id) { setPaymentError('Seleciona um contrato'); return }
    if (!paymentForm.amount) { setPaymentError('O valor é obrigatório'); return }
    if (!paymentForm.is_debt && !paymentForm.payment_date) { setPaymentError('A data é obrigatória'); return }
    setSavingPayment(true); setPaymentError('')
    const payload = { lease_id: paymentForm.lease_id, reference_month: paymentForm.reference_month + '-01', payment_date: paymentForm.is_debt ? null : paymentForm.payment_date, amount: parseFloat(paymentForm.amount), payment_method: paymentForm.is_debt ? null : paymentForm.payment_method, tipo: paymentForm.tipo, notes: paymentForm.notes || null }
    let err
    if (editingPaymentId) {
      ;({ error: err } = await supabase.from('rent_payments').update(payload).eq('id', editingPaymentId))
    } else {
      ;({ error: err } = await supabase.from('rent_payments').insert(payload))
    }
    setSavingPayment(false)
    if (err) { setPaymentError(err.message); return }
    const tipoLabel = tipoConfig[paymentForm.tipo as keyof typeof tipoConfig]?.label ?? paymentForm.tipo
    await logAccess({
      action: editingPaymentId ? 'editar' : 'criar',
      page: '/inquilinos',
      details: `${editingPaymentId ? 'Editou' : 'Registou'} ${tipoLabel} (${formatCurrency(parseFloat(paymentForm.amount))}) de "${tenant?.name}" — ${paymentForm.reference_month}`,
    })
    setShowPaymentForm(false); setEditingPaymentId(null)
    await fetchPayments()
  }

  async function handleDeletePayment(id: string) {
    if (!confirm('Tens a certeza que queres apagar este pagamento?')) return
    const payment = payments.find(p => p.id === id)
    await supabase.from('rent_payments').delete().eq('id', id)
    await logAccess({ action: 'apagar', page: '/inquilinos', details: `Apagou pagamento (${formatCurrency(payment?.amount ?? 0)}) de "${tenant?.name}"` })
    await fetchPayments()
  }

  // totalDebt inclui: rendas em falta + dívidas manuais + eletricidade por pagar, deduzindo adiantamentos disponíveis (crédito do inquilino)
  const totalAdvance = payments
    .filter(p => p.tipo === 'adiantamento' && !p.used)
    .reduce((sum, p) => sum + (p.amount ?? 0), 0)

  const totalDebt = payments
    .filter(p => !p.payment_date || p.payment_date === null)
    .filter(p => p.payment_date !== 'liquidada')
    .reduce((sum, p) => {
      if (p.isManualDebt) return sum + (p.remainingAmount ?? 0)
      return sum + (p.amount ?? 0)
    }, 0) - totalAdvance

  function computeAllocation(totalAmount: number, includeElec: boolean, includeDebts: boolean) {
    let remaining = totalAmount
    const result: Array<{ item: PaymentRow; paying: number }> = []

    // 1ª PRIORIDADE: Rendas vencidas (do mais antigo para o mais recente, pagamento parcial permitido)
    const rendas = payments
      .filter(p => !p.payment_date && !p.isManualDebt && !p.isElecCharge)
      .sort((a, b) => (a.reference_month ?? '').localeCompare(b.reference_month ?? ''))
    for (const item of rendas) {
      if (remaining <= 0) break
      const paying = parseFloat(Math.min(remaining, item.amount).toFixed(2))
      result.push({ item, paying })
      remaining = parseFloat((remaining - paying).toFixed(2))
    }

    // 2ª PRIORIDADE: Eletricidade (pagamento total por cobrança — não se paga eletricidade a meias)
    if (includeElec && remaining > 0) {
      const elec = payments
        .filter(p => !p.payment_date && p.isElecCharge)
        .sort((a, b) => (a.reference_month ?? '').localeCompare(b.reference_month ?? ''))
      for (const item of elec) {
        if (remaining <= 0) break
        if (remaining >= item.amount) {
          result.push({ item, paying: item.amount })
          remaining = parseFloat((remaining - item.amount).toFixed(2))
        }
      }
    }

    // 3ª PRIORIDADE: Outras dívidas manuais (do mais antigo para o mais recente, parcial permitido)
    if (includeDebts && remaining > 0) {
      const debts = payments
        .filter(p => p.isManualDebt && p.payment_date !== 'liquidada' && !p.payment_date)
        .sort((a, b) => (a.reference_month ?? '').localeCompare(b.reference_month ?? ''))
      for (const item of debts) {
        if (remaining <= 0) break
        const owed = item.remainingAmount ?? item.amount
        const paying = parseFloat(Math.min(remaining, owed).toFixed(2))
        result.push({ item, paying })
        remaining = parseFloat((remaining - paying).toFixed(2))
      }
    }

    return { allocation: result, leftover: parseFloat(remaining.toFixed(2)) }
  }

  async function handleSaveRecebimento() {
    const total = parseFloat(recebimentoForm.amount)
    if (!total || total <= 0) return
    setSavingRecebimento(true)
    const { allocation, leftover } = computeAllocation(total, true, true)

    const isCash = recebimentoForm.method === 'dinheiro'
    const activeLease = leases.find((l: any) => l.status === 'ativo') ?? leases[0]
    const spaceRef = activeLease?.space?.ref ?? ''
    const tenantName = tenant?.name ?? ''

    for (const { item, paying } of allocation) {
      if (item.isElecCharge && item.id) {
        // Marcar cobrança de eletricidade como paga
        await supabase.from('electricity_charges').update({
          paid: true,
          payment_date: recebimentoForm.date,
          payment_method: recebimentoForm.method,
        }).eq('id', item.id)
        // Fundo de Maneio
        if (isCash) {
          await supabase.from('cash_fund_movements').insert({
            movement_date: recebimentoForm.date,
            description: `⚡ Eletricidade ${item.reference_month.slice(0, 7)} — ${spaceRef} (${tenantName})`,
            amount: paying,
            type: 'entrada',
            source: 'renda',
            source_id: item.id,
          })
        }
      } else if (item.isManualDebt && item.id) {
        // Registar pagamento de dívida manual
        const { data: debtPayment } = await supabase.from('debt_payments').insert({
          debt_id: item.id,
          amount: paying,
          payment_date: recebimentoForm.date,
          payment_method: recebimentoForm.method,
        }).select().single()
        // Fundo de Maneio
        if (isCash) {
          await supabase.from('cash_fund_movements').insert({
            movement_date: recebimentoForm.date,
            description: `⚠️ ${item.notes ?? 'Dívida'} — ${tenantName}`,
            amount: paying,
            type: 'entrada',
            source: 'divida',
            source_id: item.id,
          })
        }
      } else {
        // Registar pagamento de renda
        const leaseId = item.lease_id ?? item.lease?.id
        if (!leaseId) continue
        const monthLabel = item.reference_month.slice(0, 7)
        const { data: newPayment } = await supabase.from('rent_payments').insert({
          lease_id: leaseId,
          reference_month: item.reference_month.slice(0, 7) + '-01',
          amount: paying,
          payment_date: recebimentoForm.date,
          payment_method: recebimentoForm.method,
          tipo: 'renda',
          notes: paying < item.amount ? 'Pagamento parcial' : null,
        }).select().single()
        // Fundo de Maneio
        if (isCash && newPayment) {
          await supabase.from('cash_fund_movements').insert({
            movement_date: recebimentoForm.date,
            description: `🏠 Renda ${monthLabel} — ${spaceRef} (${tenantName})`,
            amount: paying,
            type: 'entrada',
            source: 'renda',
            source_id: newPayment.id,
          })
        }
      }
    }

    if (leftover > 0.01) {
      const leaseId = activeLease?.id
      if (leaseId) {
        const monthLabel = recebimentoForm.date.slice(0, 7)
        const { data: advPayment } = await supabase.from('rent_payments').insert({
          lease_id: leaseId,
          reference_month: monthLabel + '-01',
          amount: leftover,
          payment_date: recebimentoForm.date,
          payment_method: recebimentoForm.method,
          tipo: 'adiantamento',
          notes: 'Excedente (adiantamento)',
        }).select().single()
        // Fundo de Maneio
        if (isCash && advPayment) {
          await supabase.from('cash_fund_movements').insert({
            movement_date: recebimentoForm.date,
            description: `💰 Adiantamento ${monthLabel} — ${spaceRef} (${tenantName})`,
            amount: leftover,
            type: 'entrada',
            source: 'renda',
            source_id: advPayment.id,
          })
        }
      }
    }

    await fetchPayments()
    setShowRecebimentoForm(false)
    setRecebimentoForm({ date: new Date().toISOString().slice(0, 10), amount: '', method: 'dinheiro' })
    setSavingRecebimento(false)
  }

  function printContaCorrente() {
    const today = new Date().toLocaleDateString('pt-PT')
    const tenantName = tenant?.name ?? ''
    const tenantNif = tenant?.nif ? `NIF: ${tenant.nif}` : ''
    const tenantPhone = tenant?.phone ?? ''
    const tenantEmail = tenant?.email ?? ''
    const activeLease = leases.find((l: any) => l.status === 'ativo')
    const spaceRef = activeLease?.space?.ref ?? leases[0]?.space?.ref ?? '—'
    const monthlyRent = activeLease?.monthly_rent ?? leases[0]?.monthly_rent ?? 0

    const tipoLabel: Record<string, string> = {
      renda: 'Renda', caucao: 'Caução', extra: 'Extra', luz: 'Luz',
      adiantamento: 'Adiantamento', divida: 'Dívida', eletricidade: 'Eletricidade',
    }

    const rows = payments.map((p: PaymentRow) => {
      const isLiquidada = p.isManualDebt && p.payment_date === 'liquidada'
      const isPago = !p.isManualDebt && !!p.payment_date && p.payment_date !== 'liquidada'
      const estado = isLiquidada ? 'Liquidada' : isPago ? 'Pago' : p.isMissing ? 'Em falta' : 'Por pagar'
      const estadoColor = isPago || isLiquidada ? '#16a34a' : '#dc2626'
      const amount = p.isManualDebt ? (p.remainingAmount ?? p.amount) : p.amount
      const periodo = p.reference_month?.slice(0, 7) ?? '—'
      const tipo = tipoLabel[p.tipo] ?? p.tipo
      return `<tr>
        <td>${periodo}</td>
        <td>${tipo}${p.notes ? ` — ${p.notes}` : ''}</td>
        <td>${p.payment_date && p.payment_date !== 'liquidada' ? p.payment_date : '—'}</td>
        <td style="color:${estadoColor};font-weight:600">${estado}</td>
        <td style="text-align:right;font-weight:600">${formatCurrency(amount)}</td>
      </tr>`
    }).join('')

    const totalPago = payments.filter((p: PaymentRow) => p.payment_date && p.payment_date !== 'liquidada').reduce((s: number, p: PaymentRow) => s + p.amount, 0)

    const html = `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <title>Conta Corrente — ${tenantName}</title>
  <style>
    @page { size: A4; margin: 18mm 15mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 11px; color: #1a1a1a; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; border-bottom: 2px solid #059669; padding-bottom: 10px; }
    .property { font-size: 14px; font-weight: 700; color: #059669; }
    .date { font-size: 10px; color: #666; margin-top: 2px; }
    .tenant-block { margin-bottom: 12px; }
    .tenant-name { font-size: 15px; font-weight: 700; }
    .tenant-meta { font-size: 10px; color: #555; margin-top: 3px; }
    .lease-row { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 5px; padding: 7px 12px; margin-bottom: 14px; display: flex; gap: 32px; }
    .lease-row span { font-size: 10px; color: #555; }
    .lease-row strong { display: block; font-size: 12px; color: #111; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
    th { background: #f3f4f6; font-size: 10px; text-align: left; padding: 6px 7px; border-bottom: 2px solid #e5e7eb; }
    td { padding: 5px 7px; border-bottom: 1px solid #f3f4f6; font-size: 10px; vertical-align: middle; }
    tr:nth-child(even) td { background: #fafafa; }
    .totals { border-top: 2px solid #111; padding-top: 10px; display: flex; justify-content: flex-end; gap: 40px; }
    .total-item { text-align: right; }
    .total-label { font-size: 9px; color: #666; margin-bottom: 2px; }
    .total-value { font-size: 14px; font-weight: 700; }
    .divida { color: #dc2626; }
    .pago { color: #16a34a; }
    .assinatura { margin-top: 36px; display: flex; justify-content: space-between; }
    .assinatura-line { border-top: 1px solid #999; width: 200px; padding-top: 5px; font-size: 9px; color: #666; text-align: center; }
    .footer { margin-top: 18px; font-size: 9px; color: #aaa; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 7px; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="property">Serpa Pinto 131A — Évora</div>
      <div class="date">Conta Corrente gerada em ${today}</div>
    </div>
    <div style="text-align:right">
      <div class="date">Espaço: <strong style="font-size:12px;color:#111">${spaceRef}</strong></div>
      ${monthlyRent ? `<div class="date">Renda mensal: <strong style="font-size:12px;color:#111">${formatCurrency(monthlyRent)}</strong></div>` : ''}
    </div>
  </div>

  <div class="tenant-block">
    <div class="tenant-name">${tenantName}</div>
    <div class="tenant-meta">${[tenantNif, tenantPhone, tenantEmail].filter(Boolean).join(' · ')}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:90px">Período</th>
        <th>Descrição</th>
        <th style="width:90px">Data Pag.</th>
        <th style="width:80px">Estado</th>
        <th style="width:80px;text-align:right">Valor</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <div class="total-item">
      <div class="total-label">Total pago</div>
      <div class="total-value pago">${formatCurrency(totalPago)}</div>
    </div>
    <div class="total-item">
      <div class="total-label">${totalDebt > 0 ? 'Total em dívida' : totalDebt < 0 ? 'Crédito do inquilino' : 'Situação'}</div>
      <div class="total-value ${totalDebt > 0 ? 'divida' : 'pago'}">${totalDebt !== 0 ? formatCurrency(Math.abs(totalDebt)) : '✓ Sem dívida'}</div>
    </div>
  </div>

  <div class="assinatura">
    <div class="assinatura-line">Proprietário / Gestor</div>
    <div class="assinatura-line">Inquilino — ${tenantName}</div>
  </div>

  <div class="footer">Documento informativo gerado automaticamente em ${today} · Serpa Pinto 131A, Évora</div>
  <script>window.onload = () => window.print()</script>
</body>
</html>`

    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close() }
  }

  function printPagamentos() {
    const today = new Date().toLocaleDateString('pt-PT')
    const tenantName = tenant?.name ?? ''
    const tenantNif = tenant?.nif ? `NIF: ${tenant.nif}` : ''
    const tenantPhone = tenant?.phone ?? ''
    const tenantEmail = tenant?.email ?? ''
    const activeLease = leases.find((l: any) => l.status === 'ativo')
    const spaceRef = activeLease?.space?.ref ?? leases[0]?.space?.ref ?? '—'

    const tipoLabel: Record<string, string> = {
      renda: 'Renda', caucao: 'Caução', extra: 'Extra', luz: 'Luz',
      adiantamento: 'Adiantamento', divida: 'Dívida', eletricidade: 'Eletricidade',
    }
    const methodLabel: Record<string, string> = {
      dinheiro: 'Dinheiro', banco: 'Transferência Bancária',
    }

    // Agrupar pagamentos reais por (payment_date + payment_method)
    const paid = payments.filter((p: PaymentRow) => p.payment_date && p.payment_date !== 'liquidada')
    type Group = { date: string; method: string; items: PaymentRow[]; total: number }
    const groupMap: Record<string, Group> = {}
    for (const p of paid) {
      const key = `${p.payment_date}__${p.payment_method ?? 'outro'}`
      if (!groupMap[key]) groupMap[key] = { date: p.payment_date!, method: p.payment_method ?? 'outro', items: [], total: 0 }
      groupMap[key].items.push(p)
      groupMap[key].total = parseFloat((groupMap[key].total + (p.amount ?? 0)).toFixed(2))
    }
    const groups = Object.values(groupMap).sort((a, b) => b.date.localeCompare(a.date))

    const groupRows = groups.map((g, idx) => {
      const itemLines = g.items.map(p => {
        const periodo = p.reference_month?.slice(0, 7) ?? '—'
        const tipo = tipoLabel[p.tipo] ?? p.tipo
        return `<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:10px;color:#555">
          <span>↳ ${tipo} — ${periodo}${p.notes ? ` (${p.notes})` : ''}</span>
          <span>${formatCurrency(p.amount)}</span>
        </div>`
      }).join('')

      return `<div style="margin-bottom:12px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#f0fdf4;border-bottom:1px solid #bbf7d0">
          <div>
            <span style="font-size:12px;font-weight:700;color:#111">${new Date(g.date + 'T00:00:00').toLocaleDateString('pt-PT')}</span>
            <span style="margin-left:10px;font-size:11px;color:#059669;font-weight:600">${methodLabel[g.method] ?? g.method}</span>
          </div>
          <span style="font-size:13px;font-weight:700;color:#059669">${formatCurrency(g.total)}</span>
        </div>
        <div style="padding:6px 12px 8px">${itemLines}</div>
      </div>`
    }).join('')

    const totalPago = groups.reduce((s, g) => s + g.total, 0)

    const html = `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <title>Histórico de Pagamentos — ${tenantName}</title>
  <style>
    @page { size: A4; margin: 18mm 15mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 11px; color: #1a1a1a; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; border-bottom: 2px solid #059669; padding-bottom: 10px; }
    .property { font-size: 14px; font-weight: 700; color: #059669; }
    .date { font-size: 10px; color: #666; margin-top: 2px; }
    .tenant-block { margin-bottom: 14px; }
    .tenant-name { font-size: 15px; font-weight: 700; }
    .tenant-meta { font-size: 10px; color: #555; margin-top: 3px; }
    .total-bar { display: flex; justify-content: flex-end; gap: 40px; border-top: 2px solid #111; padding-top: 10px; margin-top: 4px; }
    .total-item { text-align: right; }
    .total-label { font-size: 9px; color: #666; margin-bottom: 2px; }
    .total-value { font-size: 14px; font-weight: 700; color: #16a34a; }
    .footer { margin-top: 18px; font-size: 9px; color: #aaa; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 7px; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="property">Serpa Pinto 131A — Évora</div>
      <div class="date">Histórico de Pagamentos · gerado em ${today}</div>
    </div>
    <div style="text-align:right">
      <div class="date">Espaço: <strong style="font-size:12px;color:#111">${spaceRef}</strong></div>
    </div>
  </div>

  <div class="tenant-block">
    <div class="tenant-name">${tenantName}</div>
    <div class="tenant-meta">${[tenantNif, tenantPhone, tenantEmail].filter(Boolean).join(' · ')}</div>
  </div>

  ${groups.length === 0 ? '<p style="color:#999;text-align:center;padding:20px 0">Sem pagamentos registados.</p>' : groupRows}

  <div class="total-bar">
    <div class="total-item">
      <div class="total-label">Total recebido (${groups.length} pagamento${groups.length !== 1 ? 's' : ''})</div>
      <div class="total-value">${formatCurrency(totalPago)}</div>
    </div>
  </div>

  <div class="footer">Documento informativo gerado automaticamente em ${today} · Serpa Pinto 131A, Évora</div>
  <script>window.onload = () => window.print()</script>
</body>
</html>`

    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close() }
  }

  const getTitle = () => {
    if (!isNew) return tenant!.name
    if (createMode === 'escolha') return 'Novo Inquilino'
    if (createMode === 'ocr') return step === 1 ? 'Novo Inquilino — Via Contrato PDF' : `${form.name || 'Novo Inquilino'} — Confirmar dados`
    return step === 1 ? 'Novo Inquilino — Dados' : `${form.name || 'Novo Inquilino'} — Contrato`
  }

  return (
    <>
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-lg text-gray-900">{getTitle()}</h2>
            {isNew && createMode !== 'escolha' && <p className="text-xs text-gray-400 mt-0.5">Passo {step} de 2</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {isNew && createMode !== 'escolha' && (
          <div className="flex gap-2 mb-5">
            <div className={`flex-1 h-1.5 rounded-full ${step >= 1 ? 'bg-emerald-500' : 'bg-gray-200'}`} />
            <div className={`flex-1 h-1.5 rounded-full ${step >= 2 ? 'bg-emerald-500' : 'bg-gray-200'}`} />
          </div>
        )}

        {!isNew && (
          <div className="flex gap-1 mb-5 bg-gray-100 rounded-lg p-1">
            <button onClick={() => setTab('dados')} className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors ${tab === 'dados' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <User className="w-4 h-4" /> Dados
            </button>
            <button onClick={() => setTab('espacos')} className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors ${tab === 'espacos' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <Home className="w-4 h-4" /> Espaços
            </button>
            <button onClick={() => setTab('conta')} className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors ${tab === 'conta' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <FileText className="w-4 h-4" /> Conta Corrente
              {totalDebt > 0 && <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">{formatCurrency(totalDebt)}</span>}
              {totalDebt < 0 && <span className="bg-purple-500 text-white text-xs px-1.5 py-0.5 rounded-full">+{formatCurrency(Math.abs(totalDebt))}</span>}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">

          {isNew && createMode === 'escolha' && (
            <div className="space-y-4 py-4">
              <p className="text-sm text-gray-500 text-center mb-6">Como queres adicionar o novo inquilino?</p>
              <button onClick={() => setCreateMode('manual')}
                className="w-full flex items-start gap-4 p-5 border-2 border-gray-200 rounded-xl hover:border-emerald-400 hover:bg-emerald-50 transition-all text-left">
                <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <User className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="font-semibold text-gray-800">Introduzir dados manualmente</p>
                  <p className="text-sm text-gray-500 mt-0.5">Preenches os dados do inquilino e do contrato um a um</p>
                </div>
              </button>
              <button onClick={() => setCreateMode('ocr')}
                className="w-full flex items-start gap-4 p-5 border-2 border-gray-200 rounded-xl hover:border-blue-400 hover:bg-blue-50 transition-all text-left">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="font-semibold text-gray-800">Importar via contrato PDF</p>
                  <p className="text-sm text-gray-500 mt-0.5">A IA lê o contrato e preenche automaticamente nome, NIF, datas e valor da renda</p>
                </div>
              </button>
            </div>
          )}

          {isNew && createMode === 'ocr' && step === 1 && (
            <div className="space-y-4">
              <label className={`flex items-center gap-3 border-2 border-dashed rounded-lg p-6 cursor-pointer transition-colors ${processingOCR ? 'border-blue-300 bg-blue-50' : ocrDone ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 hover:border-blue-400'}`}>
                {processingOCR ? <Loader2 className="w-6 h-6 text-blue-500 animate-spin flex-shrink-0" />
                  : ocrDone ? <Sparkles className="w-6 h-6 text-emerald-500 flex-shrink-0" />
                  : <Upload className="w-6 h-6 text-gray-400 flex-shrink-0" />}
                <div>
                  {processingOCR && <p className="font-medium text-blue-600">A ler contrato com IA...</p>}
                  {ocrDone && <p className="font-medium text-emerald-600">✓ Dados extraídos! A avançar...</p>}
                  {!processingOCR && !ocrDone && (
                    <>
                      <p className="font-medium text-gray-700">{contractFile ? contractFile.name : 'Clica para fazer upload do contrato PDF'}</p>
                      <p className="text-xs text-gray-400 mt-0.5">A IA vai extrair nome, NIF, datas e valor da renda automaticamente</p>
                    </>
                  )}
                </div>
                <input type="file" accept=".pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleOCR(f) }} />
              </label>
              {ocrError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{ocrError}</p>}
            </div>
          )}

          {isNew && createMode === 'ocr' && step === 2 && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 mb-2">
                <p className="text-xs text-blue-600 font-medium">✨ Dados extraídos pelo OCR — confirma e corrige se necessário</p>
              </div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Dados do Inquilino</p>
              <div>
                <label className="label">Nome completo *</label>
                <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Telefone</label><input className="input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
                <div><label className="label">NIF</label><input className="input" value={form.nif} onChange={e => setForm(f => ({ ...f, nif: e.target.value }))} /></div>
              </div>
              <div><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mt-2">Dados do Contrato</p>
              <div>
                <label className="label">Espaço *</label>
                <select className="input" value={contractForm.space_id} onChange={e => setContractForm(f => ({ ...f, space_id: e.target.value }))}>
                  <option value="">— Seleciona o espaço —</option>
                  {spaces.map(s => <option key={s.id} value={s.id}>{s.ref} — {s.type}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Renda Mensal (€) *</label><input className="input" type="number" value={contractForm.monthly_rent} onChange={e => setContractForm(f => ({ ...f, monthly_rent: e.target.value }))} /></div>
                <div><label className="label">Caução (€)</label><input className="input" type="number" value={contractForm.deposit} onChange={e => setContractForm(f => ({ ...f, deposit: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Data de Início *</label><input className="input" type="date" value={contractForm.start_date} onChange={e => setContractForm(f => ({ ...f, start_date: e.target.value }))} /></div>
                <div><label className="label">Data de Fim</label><input className="input" type="date" value={contractForm.end_date} onChange={e => setContractForm(f => ({ ...f, end_date: e.target.value }))} /></div>
              </div>
              <div><label className="label">Notas do contrato</label><textarea className="input" rows={2} value={contractForm.notes} onChange={e => setContractForm(f => ({ ...f, notes: e.target.value }))} /></div>
              {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
              {contractError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{contractError}</p>}
            </div>
          )}

          {isNew && createMode === 'manual' && step === 1 && (
            <div className="space-y-4">
              <div><label className="label">Nome completo *</label><input className="input" placeholder="Nome do inquilino" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Telefone</label><input className="input" placeholder="9XX XXX XXX" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
                <div><label className="label">NIF</label><input className="input" placeholder="XXX XXX XXX" value={form.nif} onChange={e => setForm(f => ({ ...f, nif: e.target.value }))} /></div>
              </div>
              <div><label className="label">Email</label><input className="input" type="email" placeholder="email@exemplo.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
              <div><label className="label">Notas</label><textarea className="input" rows={3} placeholder="Observações..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
              {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            </div>
          )}

          {isNew && createMode === 'manual' && step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 mb-2">
                <button onClick={() => setContractForm(f => ({ ...f, skip: false }))}
                  className={`py-3 rounded-lg border-2 text-sm font-medium transition-colors ${!contractForm.skip ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-500'}`}>
                  📄 Adicionar contrato agora
                </button>
                <button onClick={() => setContractForm(f => ({ ...f, skip: true }))}
                  className={`py-3 rounded-lg border-2 text-sm font-medium transition-colors ${contractForm.skip ? 'border-gray-400 bg-gray-50 text-gray-700' : 'border-gray-200 text-gray-500'}`}>
                  ⏭ Saltar por agora
                </button>
              </div>
              {!contractForm.skip && (
                <>
                  <div>
                    <label className="label">Espaço *</label>
                    <select className="input" value={contractForm.space_id} onChange={e => setContractForm(f => ({ ...f, space_id: e.target.value }))}>
                      <option value="">Selecionar espaço...</option>
                      {spaces.map(s => <option key={s.id} value={s.id}>{s.ref} — {s.type}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="label">Renda Mensal (€) *</label><input className="input" type="number" placeholder="0.00" value={contractForm.monthly_rent} onChange={e => setContractForm(f => ({ ...f, monthly_rent: e.target.value }))} /></div>
                    <div><label className="label">Caução (€)</label><input className="input" type="number" placeholder="0.00" value={contractForm.deposit} onChange={e => setContractForm(f => ({ ...f, deposit: e.target.value }))} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="label">Data de Início *</label><input className="input" type="date" value={contractForm.start_date} onChange={e => setContractForm(f => ({ ...f, start_date: e.target.value }))} /></div>
                    <div><label className="label">Data de Fim</label><input className="input" type="date" value={contractForm.end_date} onChange={e => setContractForm(f => ({ ...f, end_date: e.target.value }))} /></div>
                  </div>
                  <div><label className="label">Notas do contrato</label><textarea className="input" rows={2} value={contractForm.notes} onChange={e => setContractForm(f => ({ ...f, notes: e.target.value }))} /></div>
                  {contractError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{contractError}</p>}
                </>
              )}
            </div>
          )}

          {!isNew && tab === 'dados' && (
            <div className="space-y-4">
              <div><label className="label">Nome completo *</label><input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Telefone</label><input className="input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
                <div><label className="label">NIF</label><input className="input" value={form.nif} onChange={e => setForm(f => ({ ...f, nif: e.target.value }))} /></div>
              </div>
              <div><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
              <div><label className="label">Notas</label><textarea className="input" rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
              {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            </div>
          )}

          {!isNew && tab === 'espacos' && (
            <div>
              <p className="text-sm text-gray-500 mb-4">Clica num espaço para associar ou desassociar.</p>
              {savingSpaces && <p className="text-xs text-emerald-600 mb-3">A guardar...</p>}
              <div className="grid grid-cols-4 gap-2">
                {allSpaces.map(space => {
                  const isAssigned = assignedSpaces.includes(space.id)
                  const isOtherTenant = space.tenant_id && space.tenant_id !== tenant?.id
                  return (
                    <button key={space.id} onClick={() => !isOtherTenant && handleToggleSpace(space.id)} disabled={isOtherTenant || savingSpaces}
                      className={`p-3 rounded-lg border-2 text-sm font-medium transition-all ${isAssigned ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : isOtherTenant ? 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed' : 'border-gray-200 bg-white text-gray-600 hover:border-emerald-300 hover:bg-emerald-50'}`}>
                      {space.ref}
                      {isAssigned && <span className="block text-xs mt-0.5">✓</span>}
                      {isOtherTenant && <span className="block text-xs mt-0.5 text-gray-300">ocupado</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {!isNew && tab === 'conta' && (
            <div>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500 mb-1">Total pago</p>
                  <p className="font-semibold text-gray-900">{formatCurrency(payments.filter(p => p.payment_date && p.payment_date !== 'liquidada').reduce((s, p) => s + p.amount, 0))}</p>
                </div>
                <div className={`rounded-lg p-3 text-center ${totalDebt > 0 ? 'bg-red-50' : totalDebt < 0 ? 'bg-purple-50' : 'bg-emerald-50'}`}>
                  <p className="text-xs text-gray-500 mb-1">{totalDebt < 0 ? '💰 Crédito do inquilino' : 'Em dívida'}</p>
                  <p className={`font-semibold ${totalDebt > 0 ? 'text-red-600' : totalDebt < 0 ? 'text-purple-700' : 'text-emerald-600'}`}>
                    {totalDebt > 0 ? formatCurrency(totalDebt) : totalDebt < 0 ? formatCurrency(Math.abs(totalDebt)) : '✓ Sem dívida'}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500 mb-1">Nº registos</p>
                  <p className="font-semibold text-gray-900">{payments.filter(p => !p.isMissing).length}</p>
                </div>
              </div>
              {!showPaymentForm && !showRecebimentoForm && (
                <div className="flex gap-2 mb-4">
                  <button onClick={() => setShowRecebimentoForm(true)}
                    className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg border-2 border-blue-500 text-blue-600 bg-blue-50 hover:bg-blue-100 text-sm font-medium transition-colors">
                    <Banknote className="w-4 h-4" /> Registar Recebimento
                  </button>
                  <button onClick={handleNewPayment} className="btn-secondary flex-1 justify-center">
                    <Plus className="w-4 h-4" /> Registo Manual
                  </button>
                  <button onClick={printContaCorrente} className="btn-secondary px-3 justify-center" title="Imprimir conta corrente">
                    <Printer className="w-4 h-4" />
                  </button>
                  <button onClick={printPagamentos} className="btn-secondary px-3 justify-center" title="Imprimir histórico de pagamentos">
                    <ReceiptText className="w-4 h-4" />
                  </button>
                  <button onClick={() => setShowEmailModal(true)} className="btn-secondary px-3 justify-center" title="Enviar e-mail ao inquilino">
                    <Mail className="w-4 h-4" />
                  </button>
                </div>
              )}

              {showRecebimentoForm && (() => {
                const total = parseFloat(recebimentoForm.amount) || 0
                const { allocation, leftover } = computeAllocation(total, true, true)
                return (
                  <div className="border border-blue-200 bg-blue-50 rounded-xl p-4 mb-4">
                    <h3 className="font-medium text-gray-800 mb-3">💰 Registar Recebimento</h3>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="label">Data do recebimento</label>
                        <input className="input" type="date" value={recebimentoForm.date}
                          onChange={e => setRecebimentoForm(f => ({ ...f, date: e.target.value }))} />
                      </div>
                      <div>
                        <label className="label">Valor recebido (€)</label>
                        <input className="input" type="number" step="0.01" placeholder="0.00"
                          value={recebimentoForm.amount}
                          onChange={e => setRecebimentoForm(f => ({ ...f, amount: e.target.value }))} />
                      </div>
                    </div>
                    <div className="mb-3">
                      <label className="label">Método</label>
                      <div className="grid grid-cols-2 gap-2">
                        {['dinheiro', 'banco'].map(m => (
                          <button key={m} onClick={() => setRecebimentoForm(f => ({ ...f, method: m }))}
                            className={`py-2 rounded-lg border text-xs font-medium transition-colors ${recebimentoForm.method === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                            {m === 'dinheiro' ? '💵 Dinheiro' : '🏦 Banco'}
                          </button>
                        ))}
                      </div>
                    </div>


                    {total > 0 && (
                      <div className="border border-blue-200 rounded-lg overflow-hidden mb-3">
                        <div className="bg-blue-100 px-3 py-2 text-xs font-semibold text-blue-800">Distribuição automática</div>
                        {allocation.length === 0 ? (
                          <p className="text-xs text-gray-400 p-3 text-center">Não há valores em dívida para cobrir.</p>
                        ) : (
                          <div className="divide-y divide-blue-50">
                            {allocation.map((a, i) => {
                              const icon = a.item.isElecCharge ? '⚡' : a.item.isManualDebt ? '📋' : '🏠'
                              const label = a.item.isElecCharge ? `Eletricidade ${a.item.reference_month?.slice(0, 7)}`
                                : a.item.isManualDebt ? (a.item.notes ?? `Dívida ${a.item.reference_month?.slice(0, 7)}`)
                                : `Renda ${a.item.reference_month?.slice(0, 7)}`
                              return (
                                <div key={i} className="flex justify-between items-center px-3 py-2">
                                  <span className="text-xs text-gray-700">
                                    {icon} {label}
                                    {a.paying < a.item.amount && <span className="text-orange-500 ml-1">(parcial)</span>}
                                  </span>
                                  <span className="text-xs font-semibold">{formatCurrency(a.paying)}</span>
                                </div>
                              )
                            })}
                            {leftover > 0.01 && (
                              <div className="flex justify-between items-center px-3 py-2 bg-purple-50">
                                <span className="text-xs text-purple-700">💰 Excedente → adiantamento</span>
                                <span className="text-xs font-semibold text-purple-700">{formatCurrency(leftover)}</span>
                              </div>
                            )}
                            <div className="flex justify-between items-center px-3 py-2 bg-gray-50 border-t border-gray-200">
                              <span className="text-xs font-bold text-gray-700">Total</span>
                              <span className="text-xs font-bold">{formatCurrency(total)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button className="btn-secondary flex-1" onClick={() => { setShowRecebimentoForm(false); setRecebimentoForm({ date: new Date().toISOString().slice(0, 10), amount: '', method: 'dinheiro' }) }}>
                        Cancelar
                      </button>
                      <button onClick={handleSaveRecebimento} disabled={savingRecebimento || !recebimentoForm.amount || allocation.length === 0}
                        className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50 transition-colors">
                        {savingRecebimento ? <Loader2 className="w-4 h-4 animate-spin" /> : <Banknote className="w-4 h-4" />}
                        {savingRecebimento ? 'A guardar...' : 'Confirmar Recebimento'}
                      </button>
                    </div>
                  </div>
                )
              })()}
              {showPaymentForm && (
                <div className="border border-emerald-200 bg-emerald-50 rounded-xl p-4 mb-4">
                  <h3 className="font-medium text-gray-800 mb-3">{editingPaymentId ? '✏️ Editar Registo' : 'Novo Registo'}</h3>
                  <div className="space-y-3">
                    {leases.length > 1 && (
                      <div>
                        <label className="label">Contrato / Espaço</label>
                        <select className="input" value={paymentForm.lease_id} onChange={e => setPaymentForm(f => ({ ...f, lease_id: e.target.value }))}>
                          <option value="">— Seleciona —</option>
                          {leases.map(l => <option key={l.id} value={l.id}>{l.space?.ref} — {formatCurrency(l.monthly_rent)}/mês</option>)}
                        </select>
                      </div>
                    )}
                    <div>
                      <label className="label">Tipo</label>
                      <div className="grid grid-cols-4 gap-2">
                        {Object.entries(tipoConfig).filter(([k]) => k !== 'divida' && k !== 'eletricidade' && k !== 'adiantamento').map(([key, cfg]) => (
                          <button key={key} onClick={() => setPaymentForm(f => ({ ...f, tipo: key }))}
                            className={`py-2 rounded-lg border text-xs font-medium transition-colors ${paymentForm.tipo === key ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                            {cfg.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="label">Mês de referência</label><input className="input" type="month" value={paymentForm.reference_month} onChange={e => setPaymentForm(f => ({ ...f, reference_month: e.target.value }))} /></div>
                      <div><label className="label">Valor (€)</label><input className="input" type="number" step="0.01" value={paymentForm.amount} onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))} /></div>
                    </div>
                    <div>
                      <label className="label">Estado</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setPaymentForm(f => ({ ...f, is_debt: false }))}
                          className={`py-2 rounded-lg border text-sm font-medium transition-colors ${!paymentForm.is_debt ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                          ✓ Já foi pago
                        </button>
                        <button onClick={() => setPaymentForm(f => ({ ...f, is_debt: true }))}
                          className={`py-2 rounded-lg border text-sm font-medium transition-colors ${paymentForm.is_debt ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                          ⚠ Em dívida
                        </button>
                      </div>
                    </div>
                    {!paymentForm.is_debt && (
                      <div className="grid grid-cols-2 gap-3">
                        <div><label className="label">Data do pagamento</label><input className="input" type="date" value={paymentForm.payment_date} onChange={e => setPaymentForm(f => ({ ...f, payment_date: e.target.value }))} /></div>
                        <div>
                          <label className="label">Método</label>
                          <div className="grid grid-cols-2 gap-2">
                            {['dinheiro', 'banco'].map(m => (
                              <button key={m} onClick={() => setPaymentForm(f => ({ ...f, payment_method: m }))}
                                className={`py-2 rounded-lg border text-xs font-medium transition-colors ${paymentForm.payment_method === m ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                                {m === 'dinheiro' ? '💵 Dinheiro' : '🏦 Banco'}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                    <div><label className="label">Notas (opcional)</label><input className="input" placeholder="ex: pagamento parcial" value={paymentForm.notes} onChange={e => setPaymentForm(f => ({ ...f, notes: e.target.value }))} /></div>
                    {paymentError && <p className="text-sm text-red-600 bg-red-100 px-3 py-2 rounded-lg">{paymentError}</p>}
                    <div className="flex gap-2 pt-1">
                      <button className="btn-secondary flex-1" onClick={() => { setShowPaymentForm(false); setEditingPaymentId(null) }}>Cancelar</button>
                      <button className="btn-primary flex-1 justify-center" onClick={handleSavePayment} disabled={savingPayment}>
                        {savingPayment ? 'A guardar...' : editingPaymentId ? 'Guardar alterações' : 'Guardar'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {loadingPayments ? (
                <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-600" /></div>
              ) : payments.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-8">Sem registos de pagamentos</p>
              ) : (
                <div className="space-y-2">
                  {payments.map((p, i) => {
                    const isLiquidada = p.isManualDebt && p.payment_date === 'liquidada'
                    const isPago = !p.isManualDebt && !!p.payment_date && p.payment_date !== 'liquidada'
                    return (
                      <div key={p.id ?? `row-${i}`}
                        className={`flex items-center justify-between p-3 rounded-lg border ${
                          p.tipo === 'adiantamento' ? (p.used ? 'border-gray-100 bg-gray-50' : 'border-purple-200 bg-purple-50')
                          : isPago || isLiquidada ? 'border-gray-100 bg-white'
                          : p.isMissing ? 'border-orange-200 bg-orange-50'
                          : p.isElecCharge ? 'border-red-200 bg-red-50'
                          : p.isManualDebt ? 'border-red-200 bg-red-50'
                          : 'border-red-100 bg-red-50'
                        }`}>
                        <div>
                          <p className="text-sm font-medium text-gray-800">
                            {p.reference_month?.slice(0, 7)} — {p.isManualDebt ? '📋' : (p.lease?.space?.ref ?? '—')}
                            <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                              p.tipo === 'caucao' ? 'bg-blue-100 text-blue-700'
                              : p.tipo === 'extra' ? 'bg-orange-100 text-orange-700'
                              : p.tipo === 'luz' ? 'bg-yellow-100 text-yellow-700'
                              : p.tipo === 'eletricidade' ? 'bg-red-100 text-red-700'
                              : p.tipo === 'divida' ? 'bg-red-100 text-red-700'
                              : p.tipo === 'adiantamento' ? 'bg-purple-100 text-purple-700'
                              : 'bg-gray-100 text-gray-600'
                            }`}>
                              {tipoConfig[p.tipo as keyof typeof tipoConfig]?.label ?? '🏠 Renda'}
                            </span>
                          </p>
                          {p.tipo === 'adiantamento' ? (
                            p.used ? (
                              <p className="text-xs text-gray-400 font-medium">✓ Aplicado a uma fatura de eletricidade</p>
                            ) : (
                              <p className="text-xs text-purple-600 font-medium">💰 Crédito do inquilino · pago em {formatDate(p.payment_date!)} · {p.payment_method}</p>
                            )
                          ) : p.isManualDebt ? (
                            <p className="text-xs text-gray-600">{p.notes}</p>
                          ) : p.isElecCharge ? (
                            p.payment_date ? (
                              <p className="text-xs text-gray-500">⚡ Pago em {formatDate(p.payment_date)} · {p.payment_method}</p>
                            ) : (p as any).isPartialElec ? (
                              <p className="text-xs text-orange-600 font-medium">⚡ Pagamento parcial — falta {formatCurrency((p as any).remainingAmount ?? 0)}</p>
                            ) : (
                              <p className="text-xs text-red-600 font-medium">⚡ Eletricidade por pagar</p>
                            )
                          ) : p.payment_date ? (
                            <p className="text-xs text-gray-500">Pago em {formatDate(p.payment_date)} · {p.payment_method}</p>
                          ) : p.isMissing ? (
                            <p className="text-xs text-orange-600 font-medium">⚠ Sem registo de pagamento</p>
                          ) : (
                            <p className="text-xs text-red-500 font-medium">⚠ Por pagar</p>
                          )}
                          {p.isManualDebt && (
                            <p className={`text-xs font-medium mt-0.5 ${isLiquidada ? 'text-emerald-600' : 'text-red-600'}`}>
                              {isLiquidada ? '✓ Liquidada' : `Em dívida: ${formatCurrency(p.remainingAmount ?? p.amount)}`}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`font-semibold text-sm ${
                            p.tipo === 'adiantamento' ? (p.used ? 'text-gray-400' : 'text-purple-700')
                            : isPago || isLiquidada ? 'text-gray-900'
                            : 'text-red-600'
                          }`}>
                            {p.tipo === 'adiantamento' && !p.used ? '+' : ''}{formatCurrency(p.amount)}
                          </span>
                          {!p.isMissing && !p.isManualDebt && !p.isElecCharge && p.id && (
                            <>
                              <button onClick={() => handleEditPayment(p)} className="text-gray-300 hover:text-blue-500 transition-colors" title="Editar"><Pencil className="w-4 h-4" /></button>
                              <button onClick={() => handleDeletePayment(p.id!)} className="text-gray-300 hover:text-red-500 transition-colors" title="Apagar"><Trash2 className="w-4 h-4" /></button>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {isNew && createMode === 'escolha' && (
          <div className="flex justify-end mt-6 pt-4 border-t border-gray-100">
            <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          </div>
        )}
        {isNew && createMode === 'ocr' && step === 1 && (
          <div className="flex justify-between mt-6 pt-4 border-t border-gray-100">
            <button className="btn-secondary" onClick={() => setCreateMode('escolha')}><ChevronLeft className="w-4 h-4" /> Voltar</button>
          </div>
        )}
        {isNew && createMode === 'ocr' && step === 2 && (
          <div className="flex justify-between gap-3 mt-6 pt-4 border-t border-gray-100">
            <button className="btn-secondary flex items-center gap-1" onClick={() => setStep(1)}><ChevronLeft className="w-4 h-4" /> Voltar</button>
            <button className="btn-primary" onClick={async () => { await handleSaveStep1(); if (newTenantId || form.name) await handleSaveContract() }} disabled={savingContract || saving}>
              {savingContract || saving ? 'A guardar...' : 'Guardar tudo'}
            </button>
          </div>
        )}
        {isNew && createMode === 'manual' && step === 1 && (
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
            <button className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button className="btn-primary" onClick={handleSaveStep1} disabled={saving}>
              {saving ? 'A guardar...' : 'Seguinte'} <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
        {isNew && createMode === 'manual' && step === 2 && (
          <div className="flex justify-between gap-3 mt-6 pt-4 border-t border-gray-100">
            <button className="btn-secondary flex items-center gap-1" onClick={() => setStep(1)}><ChevronLeft className="w-4 h-4" /> Voltar</button>
            <button className="btn-primary" onClick={handleSaveContract} disabled={savingContract}>
              {savingContract ? 'A guardar...' : contractForm.skip ? 'Concluir sem contrato' : 'Guardar tudo'}
            </button>
          </div>
        )}
        {!isNew && tab === 'dados' && (
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
            <button className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button className="btn-primary" onClick={handleSaveStep1} disabled={saving}>{saving ? 'A guardar...' : 'Guardar'}</button>
          </div>
        )}
        {!isNew && (tab === 'espacos' || tab === 'conta') && (
          <div className="flex justify-end mt-6 pt-4 border-t border-gray-100">
            <button className="btn-secondary" onClick={onClose}>Fechar</button>
          </div>
        )}
      </div>
    </div>

    {showEmailModal && tenant && (
      <EmailModal
        tenantName={tenant.name}
        tenantEmail={tenant.email}
        spaceRef={leases.find((l: any) => l.status === 'ativo')?.space?.ref ?? leases[0]?.space?.ref}
        onClose={() => setShowEmailModal(false)}
      />
    )}
    </>
  )
}
