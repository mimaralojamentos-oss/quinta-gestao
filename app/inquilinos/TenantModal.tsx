'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Tenant } from '@/lib/types'
import { X, User, Home, FileText, Plus, Trash2, Pencil, ChevronRight, ChevronLeft, Upload, Loader2, Sparkles } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'

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
  lease?: any
  isMissing?: boolean
  isManualDebt?: boolean
  isElecCharge?: boolean
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
    lease_id: '', reference_month: new Date().toISOString().slice(0, 7), amount: '',
    payment_date: new Date().toISOString().slice(0, 10), payment_method: 'dinheiro',
    tipo: 'renda', notes: '', is_debt: false,
  })
  const [savingPayment, setSavingPayment] = useState(false)
  const [paymentError, setPaymentError] = useState('')

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
        const monthStr = cursor.toISOString().slice(0, 7)
        const hasPayment = enriched.some(p => p.lease_id === lease.id && p.reference_month?.slice(0, 7) === monthStr && (p.tipo === 'renda' || !p.tipo))
        if (!hasPayment) missingRows.push({
          reference_month: monthStr + '-01', amount: lease.monthly_rent,
          payment_date: null, payment_method: null, tipo: 'renda', lease, isMissing: true, isManualDebt: false, isElecCharge: false
        })
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

    // Cobranças de eletricidade por pagar
    const elecChargeRows: PaymentRow[] = []
    if (leaseIds.length > 0) {
      const { data: elecData } = await supabase
        .from('electricity_charges')
        .select('id, lease_id, amount, charge_date, reference_month')
        .in('lease_id', leaseIds)
        .eq('paid', false)

      for (const ec of elecData ?? []) {
        const lease = (leasesData ?? []).find(l => l.id === ec.lease_id)
        const refDate = ec.charge_date ?? ec.reference_month ?? new Date().toISOString().slice(0, 10)
        elecChargeRows.push({
          id: ec.id,
          lease_id: ec.lease_id,
          reference_month: refDate,
          amount: ec.amount,
          payment_date: null,
          payment_method: null,
          tipo: 'eletricidade',
          notes: 'Cobrança de eletricidade por pagar',
          lease,
          isMissing: false,
          isManualDebt: false,
          isElecCharge: true,
        })
      }
    }

    const allRows = [...enriched, ...missingRows, ...manualDebtRows, ...elecChargeRows]
      .sort((a, b) => b.reference_month.localeCompare(a.reference_month))

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
      setNewTenantId(data.id); setStep(2)
    } else {
      const { error: err } = await supabase.from('tenants').update(payload).eq('id', tenant!.id)
      setSaving(false)
      if (err) { setError(err.message); return }
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
    onSaved()
  }

  async function handleToggleSpace(spaceId: string) {
    if (!tenant) return
    const isAssigned = assignedSpaces.includes(spaceId)
    setSavingSpaces(true)
    if (isAssigned) {
      await supabase.from('spaces').update({ tenant_id: null, status: 'disponivel' }).eq('id', spaceId)
      setAssignedSpaces(prev => prev.filter(id => id !== spaceId))
    } else {
      await supabase.from('spaces').update({ tenant_id: tenant.id, status: 'arrendado' }).eq('id', spaceId)
      setAssignedSpaces(prev => [...prev, spaceId])
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
    setPaymentForm({ lease_id: activeLease?.id ?? '', reference_month: new Date().toISOString().slice(0, 7), amount: String(activeLease?.monthly_rent ?? ''), payment_date: new Date().toISOString().slice(0, 10), payment_method: 'dinheiro', tipo: 'renda', notes: '', is_debt: false })
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
    setShowPaymentForm(false); setEditingPaymentId(null)
    await fetchPayments()
  }

  async function handleDeletePayment(id: string) {
    if (!confirm('Tens a certeza que queres apagar este pagamento?')) return
    await supabase.from('rent_payments').delete().eq('id', id)
    await fetchPayments()
  }

  // totalDebt inclui: rendas em falta + dívidas manuais + eletricidade por pagar, deduzindo adiantamentos disponíveis (crédito do inquilino)
  const totalAdvance = payments
    .filter(p => p.tipo === 'adiantamento')
    .reduce((sum, p) => sum + (p.amount ?? 0), 0)

  const totalDebt = payments
    .filter(p => !p.payment_date || p.payment_date === null)
    .filter(p => p.payment_date !== 'liquidada')
    .reduce((sum, p) => {
      if (p.isManualDebt) return sum + (p.remainingAmount ?? 0)
      return sum + (p.amount ?? 0)
    }, 0) - totalAdvance

  const getTitle = () => {
    if (!isNew) return tenant!.name
    if (createMode === 'escolha') return 'Novo Inquilino'
    if (createMode === 'ocr') return step === 1 ? 'Novo Inquilino — Via Contrato PDF' : `${form.name || 'Novo Inquilino'} — Confirmar dados`
    return step === 1 ? 'Novo Inquilino — Dados' : `${form.name || 'Novo Inquilino'} — Contrato`
  }

  return (
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
              {!showPaymentForm && (
                <button onClick={handleNewPayment} className="btn-primary w-full mb-4 justify-center">
                  <Plus className="w-4 h-4" /> Registar Pagamento / Dívida
                </button>
              )}
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
                    const isPago = !p.isManualDebt && !p.isElecCharge && p.payment_date
                    return (
                      <div key={p.id ?? `row-${i}`}
                        className={`flex items-center justify-between p-3 rounded-lg border ${
                          p.tipo === 'adiantamento' ? 'border-purple-200 bg-purple-50'
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
                            <p className="text-xs text-purple-600 font-medium">💰 Crédito do inquilino · pago em {formatDate(p.payment_date!)} · {p.payment_method}</p>
                          ) : p.isManualDebt ? (
                            <p className="text-xs text-gray-600">{p.notes}</p>
                          ) : p.isElecCharge ? (
                            <p className="text-xs text-red-600 font-medium">⚡ Eletricidade por pagar</p>
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
                            p.tipo === 'adiantamento' ? 'text-purple-700'
                            : isPago || isLiquidada ? 'text-gray-900'
                            : 'text-red-600'
                          }`}>
                            {p.tipo === 'adiantamento' ? '+' : ''}{formatCurrency(p.amount)}
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
  )
}
