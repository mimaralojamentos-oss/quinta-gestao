'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, formatDate, matchesSearch, getTenantName } from '@/lib/utils'
import { Zap, Trash2, X, ChevronDown, ChevronRight, Settings, Save, Pencil, Search, Printer } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { logAccess } from '@/lib/logAccess'
import { consumeAdvances, linkAdvancesToCharge } from '@/lib/advanceCredit'

const supabase = createClient()

interface ElectricityConfig {
  id: number
  price_per_kwh: number
  vat_rate: number
  min_charge: number
}

interface Space {
  id: string
  ref: string
  type: string
  has_own_meter: boolean
  tenant_id: string | null
  tenant: any
}

interface Reading {
  id: string
  space_id: string
  reading_date: string
  reading_value: number
  previous_value: number | null
  kwh_consumed: number | null
  amount_calculated: number | null
  charged: boolean
  accumulated: boolean
  /** Leitura registada mas deliberadamente não cobrada (oferta). */
  waived?: boolean
  waived_reason?: string | null
  notes: string | null
}

interface ReadingModal {
  space: Space
  lastReading: Reading | null
}

/**
 * Fecho de contas de eletricidade na saída de um inquilino.
 *
 * Junta as três operações que, feitas à mão, é fácil esquecer uma:
 *   1. leitura de saída com o valor atual do contador
 *   2. perdão das cobranças em aberto (sem as contar como recebidas)
 *   3. limpeza do valor acumulado, para não passar ao inquilino seguinte
 */
interface ResetModal {
  space: Space
  lastReading: Reading | null
  /** Cobranças de luz por pagar do inquilino atual neste espaço. */
  pendingCharges: { id: string; reference_month: string; amount: number; amount_paid: number | null }[]
  accumulated: number
  tenantName: string
}

export default function QuadrosEspacosPage() {
  const { isAdmin, isCoAdmin, profile } = useAuth()
  const canEdit = isAdmin || isCoAdmin || profile?.role === 'electrician'
  const [spaces, setSpaces] = useState<Space[]>([])
  const [readings, setReadings] = useState<Record<string, Reading[]>>({})
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [readingModal, setReadingModal] = useState<ReadingModal | null>(null)

  const [resetModal, setResetModal] = useState<ResetModal | null>(null)
  const [resetLoading, setResetLoading] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetForm, setResetForm] = useState({
    reading_date: new Date().toISOString().slice(0, 10),
    reading_value: '',
    forgiveCharges: true,
    notes: '',
  })
  const [resetConfirm, setResetConfirm] = useState(false)
  const [editReadingModal, setEditReadingModal] = useState<Reading | null>(null)
  const [saving, setSaving] = useState(false)
  const [readingForm, setReadingForm] = useState({
    reading_date: new Date().toISOString().slice(0, 10),
    reading_value: '',
    notes: '',
    waived_reason: '',
  })
  const [editForm, setEditForm] = useState({
    reading_date: '',
    reading_value: '',
    notes: '',
  })
  const [editLeaseId, setEditLeaseId] = useState<string | null>(null)
  const [editAdvance, setEditAdvance] = useState(0)

  // Filtros
  const [filterTenant, setFilterTenant] = useState('')
  const [filterSpaces, setFilterSpaces] = useState<string[]>([])
  const [showSpaceDropdown, setShowSpaceDropdown] = useState(false)
  const spaceDropdownRef = useRef<HTMLDivElement>(null)

  // Configurações
  const [config, setConfig] = useState<ElectricityConfig | null>(null)
  const [showConfig, setShowConfig] = useState(false)
  const [configForm, setConfigForm] = useState({
    price_per_kwh: '0.18',
    vat_rate: '23',
    min_charge: '5.00',
  })
  const [savingConfig, setSavingConfig] = useState(false)
  const [configSaved, setConfigSaved] = useState(false)

  const pricePerKwh = config?.price_per_kwh ?? 0.18
  const vatRate = config?.vat_rate ?? 0.23
  const priceWithVat = pricePerKwh * (1 + vatRate)
  const minCharge = config?.min_charge ?? 5

  async function fetchConfig() {
    const { data } = await supabase.from('electricity_config').select('*').single()
    if (data) {
      setConfig(data)
      setConfigForm({
        price_per_kwh: data.price_per_kwh.toString(),
        vat_rate: (data.vat_rate * 100).toString(),
        min_charge: data.min_charge.toString(),
      })
    }
  }

  async function saveConfig() {
    if (!config) return
    setSavingConfig(true)
    await supabase.from('electricity_config').update({
      price_per_kwh: parseFloat(configForm.price_per_kwh),
      vat_rate: parseFloat(configForm.vat_rate) / 100,
      min_charge: parseFloat(configForm.min_charge),
      updated_at: new Date().toISOString(),
    }).eq('id', config.id)
    await fetchConfig()
    setSavingConfig(false)
    setConfigSaved(true)
    setTimeout(() => setConfigSaved(false), 3000)
  }

  async function fetchAll() {
    setLoading(true)
    const { data: spacesData } = await supabase
      .from('spaces')
      .select('id, ref, type, has_own_meter, tenant_id, tenant:tenants(name)')
      .eq('has_own_meter', false)
      .order('ref')

    setSpaces((spacesData ?? []) as any[])

    const allReadings: Record<string, Reading[]> = {}
    for (const s of spacesData ?? []) {
      const { data } = await supabase
        .from('electricity_readings')
        .select('*')
        .eq('space_id', s.id)
        .order('reading_date', { ascending: false })
      allReadings[s.id] = data ?? []
    }
    setReadings(allReadings)
    setLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchConfig()
    fetchAll()
  }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (spaceDropdownRef.current && !spaceDropdownRef.current.contains(e.target as Node)) {
        setShowSpaceDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function toggleSpace(ref: string) {
    setFilterSpaces(prev => prev.includes(ref) ? prev.filter(r => r !== ref) : [...prev, ref])
  }

  async function openResetModal(space: Space) {
    setResetLoading(true)
    setResetConfirm(false)
    const lastReading = (readings[space.id] ?? [])[0] ?? null
    setResetForm({
      reading_date: new Date().toISOString().slice(0, 10),
      reading_value: '',
      forgiveCharges: true,
      notes: '',
    })

    // Cobranças por pagar do contrato ativo neste espaço
    let pendingCharges: ResetModal['pendingCharges'] = []
    let tenantName = '—'
    try {
      const { data: lease } = await supabase
        .from('leases').select('id, tenant:tenants(name)')
        .eq('space_id', space.id).eq('status', 'ativo').maybeSingle()

      if (lease) {
        tenantName = (lease.tenant as any)?.name ?? '—'
        const { data: charges } = await supabase
          .from('electricity_charges')
          .select('id, reference_month, amount, amount_paid')
          .eq('lease_id', lease.id).eq('paid', false)
          .order('reference_month')
        pendingCharges = charges ?? []
      }
    } catch (e) { console.error(e) }

    setResetModal({
      space, lastReading, pendingCharges,
      accumulated: getAccumulatedAmount(space.id),
      tenantName,
    })
    setResetLoading(false)
  }

  async function executeReset() {
    if (!resetModal) return
    setResetting(true)
    try {
      const { space, lastReading, pendingCharges } = resetModal
      const novoValor = parseFloat(String(resetForm.reading_value).replace(',', '.'))
      const anterior = lastReading?.reading_value ?? null
      const kwh = anterior != null ? parseFloat((novoValor - anterior).toFixed(2)) : null

      // 1. Leitura de saída. Fica logo marcada como tratada (charged, não
      //    acumulada, valor 0) para o consumo deste período não transitar
      //    para o inquilino seguinte.
      const { error: readingError } = await supabase.from('electricity_readings').insert({
        space_id: space.id,
        reading_date: resetForm.reading_date,
        reading_value: novoValor,
        previous_value: anterior,
        kwh_consumed: kwh,
        amount_calculated: 0,
        charged: true,
        accumulated: false,
        notes: resetForm.notes.trim() || `Fecho de contas — saída de ${resetModal.tenantName}`,
      })
      if (readingError) { alert(`Erro ao registar a leitura: ${readingError.message}`); return }

      // 2. Perdoar as cobranças em aberto.
      //    paid = true tira-as da dívida; payment_date fica VAZIA para não
      //    aparecerem nos relatórios como dinheiro recebido — porque não foi.
      let perdoadas = 0
      if (resetForm.forgiveCharges && pendingCharges.length > 0) {
        const { error: chargeError } = await supabase.from('electricity_charges').update({
          paid: true,
          amount_paid: 0,
          payment_date: null,
          payment_method: null,
          notes: `Dívida perdoada no fecho de contas de ${formatDate(resetForm.reading_date)}`,
        }).in('id', pendingCharges.map(c => c.id))
        if (chargeError) { alert(`Erro ao perdoar as cobranças: ${chargeError.message}`); return }
        perdoadas = pendingCharges.length
      }

      // 3. Limpar acumulados antigos que ainda não foram cobrados.
      const { error: accError } = await supabase.from('electricity_readings')
        .update({ accumulated: false, charged: true })
        .eq('space_id', space.id).eq('charged', false)
      if (accError) console.error(accError)

      await logAccess({
        action: 'editar',
        page: '/eletricidade/espacos',
        details: `Fecho de contas de eletricidade do ${space.ref} (${resetModal.tenantName}): leitura ${novoValor}${perdoadas > 0 ? `, ${perdoadas} cobrança(s) perdoada(s)` : ''}`,
      })

      const totalPerdoado = pendingCharges.reduce((s, c) => s + (c.amount - (c.amount_paid ?? 0)), 0)
      alert(
        `✅ Fecho de contas concluído no ${space.ref}.\n\n` +
        `Leitura de saída: ${novoValor} kWh\n` +
        (perdoadas > 0 ? `Cobranças perdoadas: ${perdoadas} (${formatCurrency(totalPerdoado)})\n` : '') +
        `O próximo inquilino começa a contar a partir deste valor.`
      )

      setResetModal(null)
      fetchAll()
    } finally {
      setResetting(false)
    }
  }

  function getAccumulatedAmount(spaceId: string): number {
    const latest = (readings[spaceId] ?? [])[0]
    // Uma oferta não acumula: o valor foi perdoado, não pode reaparecer
    // somado à leitura seguinte.
    if (latest && latest.accumulated && !latest.charged && !latest.waived) {
      return latest.amount_calculated ?? 0
    }
    return 0
  }

  function printElectricity(space: Space) {
    const spaceReadings = readings[space.id] ?? []
    const tenantName = getTenantName(space.tenant, '')
    const accumulated = getAccumulatedAmount(space.id)
    const today = new Date().toLocaleDateString('pt-PT')

    const rows = spaceReadings.map(r => `
      <tr>
        <td>${formatDate(r.reading_date)}</td>
        <td style="font-family:monospace">${r.reading_value ?? '—'}</td>
        <td style="font-family:monospace;color:#888">${r.previous_value ?? '—'}</td>
        <td>${r.kwh_consumed != null ? Number(r.kwh_consumed).toFixed(2) + ' kWh' : '—'}</td>
        <td style="font-weight:600">${r.amount_calculated != null ? formatCurrency(r.amount_calculated) : '—'}</td>
        <td><span style="padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;${
          r.waived ? 'background:#dbeafe;color:#1d4ed8'
          : r.charged ? 'background:#d1fae5;color:#065f46'
          : 'background:#fef3c7;color:#92400e'
        }">${r.waived ? 'Oferta' : r.charged ? 'Cobrado' : 'Acumulado'}</span>${
          r.waived && r.waived_reason ? `<br><span style="font-size:10px;color:#888">${r.waived_reason}</span>` : ''
        }</td>
      </tr>`).join('')

    const totalCobrado = spaceReadings.filter(r => r.charged && r.amount_calculated).reduce((s, r) => s + (r.amount_calculated ?? 0), 0)

    const html = `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <title>Leituras de Luz — ${space.ref}</title>
  <style>
    @page { size: A4 portrait; margin: 20mm 18mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 13px; color: #1a1a1a; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; border-bottom: 2px solid #059669; padding-bottom: 16px; }
    .logo-area h1 { font-size: 20px; font-weight: 700; color: #059669; }
    .logo-area p { font-size: 12px; color: #666; margin-top: 2px; }
    .meta { text-align: right; font-size: 12px; color: #555; }
    .section-title { font-size: 14px; font-weight: 700; color: #374151; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
    .info-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px 18px; margin-bottom: 24px; display: flex; gap: 40px; }
    .info-item label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; display: block; }
    .info-item span { font-size: 14px; font-weight: 600; color: #111827; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    thead tr { background: #059669; color: white; }
    thead th { padding: 9px 10px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
    tbody tr { border-bottom: 1px solid #f3f4f6; }
    tbody tr:nth-child(even) { background: #f9fafb; }
    tbody td { padding: 9px 10px; font-size: 13px; }
    .totals { background: #ecfdf5; border: 1px solid #6ee7b7; border-radius: 8px; padding: 14px 18px; margin-bottom: 32px; display: flex; gap: 40px; }
    .totals label { font-size: 11px; color: #065f46; text-transform: uppercase; display: block; }
    .totals span { font-size: 16px; font-weight: 700; color: #065f46; }
    .acum span { color: #92400e; }
    .acum { background: #fffbeb; border-color: #fcd34d; }
    .footer { margin-top: 40px; border-top: 1px solid #e5e7eb; padding-top: 16px; display: flex; justify-content: space-between; font-size: 11px; color: #9ca3af; }
    .signature { margin-top: 48px; display: flex; justify-content: space-between; }
    .signature-line { text-align: center; }
    .signature-line div { border-top: 1px solid #374151; width: 200px; padding-top: 6px; font-size: 11px; color: #6b7280; margin-top: 40px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo-area">
      <h1>⚡ Consumo de Eletricidade</h1>
      <p>Rua Serpa Pinto 131A, Évora</p>
    </div>
    <div class="meta">
      <p>Emitido em: <strong>${today}</strong></p>
    </div>
  </div>

  <div class="info-box">
    <div class="info-item"><label>Fração</label><span>${space.ref}</span></div>
    ${tenantName ? `<div class="info-item"><label>Inquilino</label><span>${tenantName}</span></div>` : ''}
    <div class="info-item"><label>Preço/kWh (c/ IVA)</label><span>${(pricePerKwh * (1 + vatRate)).toFixed(4)} €</span></div>
  </div>

  <p class="section-title">Histórico de Leituras</p>
  <table>
    <thead>
      <tr>
        <th>Data</th>
        <th>Leitura</th>
        <th>Anterior</th>
        <th>kWh</th>
        <th>Valor</th>
        <th>Estado</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals${accumulated > 0 ? ' acum' : ''}">
    <div><label>Total Cobrado</label><span>${formatCurrency(totalCobrado)}</span></div>
    ${accumulated > 0 ? `<div><label>Valor em Acumulado (por cobrar)</label><span>${formatCurrency(accumulated)}</span></div>` : ''}
  </div>

  <div class="signature">
    <div class="signature-line"><div>Proprietário</div></div>
    <div class="signature-line"><div>Inquilino</div></div>
  </div>

  <div class="footer">
    <span>Rua Serpa Pinto 131A · Évora</span>
    <span>Documento gerado automaticamente</span>
  </div>

  <script>window.onload = () => window.print()</script>
</body>
</html>`

    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
  }

  function openReadingModal(space: Space) {
    const spaceReadings = readings[space.id] ?? []
    const lastReading = spaceReadings[0] ?? null
    setReadingModal({ space, lastReading })
    setReadingForm({
      reading_date: new Date().toISOString().slice(0, 10),
      reading_value: '',
      notes: '',
      waived_reason: '',
    })
  }

  async function openEditModal(reading: Reading) {
    setEditReadingModal(reading)
    setEditForm({
      reading_date: reading.reading_date,
      reading_value: reading.reading_value.toString(),
      notes: reading.notes ?? '',
    })
    setEditLeaseId(null)
    setEditAdvance(0)

    if (!reading.charged) {
      const space = spaces.find(s => s.id === reading.space_id)
      if (space?.tenant_id) {
        const { data: lease } = await supabase
          .from('leases')
          .select('id')
          .eq('space_id', space.id)
          .eq('status', 'ativo')
          .single()
        if (lease) {
          setEditLeaseId(lease.id)
          const { data: advances } = await supabase
            .from('rent_payments')
            .select('amount')
            .eq('lease_id', lease.id)
            .eq('tipo', 'adiantamento')
            .eq('used', false)
          setEditAdvance((advances ?? []).reduce((sum, a) => sum + (a.amount ?? 0), 0))
        }
      }
    }
  }

  /**
   * Recalcula a cadeia de leituras de um espaço.
   *
   * Cada leitura guarda o valor da anterior para calcular o consumo. Se uma
   * data for corrigida, a ordem muda e essas ligações passam a estar erradas —
   * por isso são refeitas por ordem cronológica depois de qualquer edição.
   *
   * Os valores de leituras já cobradas ou oferecidas não são mexidos: essas
   * já produziram (ou dispensaram) uma cobrança e reescrevê-las alteraria
   * contas fechadas.
   */
  async function recalcularCadeia(spaceId: string) {
    const { data: todas } = await supabase
      .from('electricity_readings')
      .select('id, reading_date, reading_value, charged, waived, amount_calculated')
      .eq('space_id', spaceId)
      .order('reading_date', { ascending: true })

    if (!todas || todas.length === 0) return

    let anterior: number | null = null
    for (const r of todas) {
      const kwh = anterior != null ? parseFloat((r.reading_value - anterior).toFixed(2)) : null
      const patch: Record<string, any> = { previous_value: anterior, kwh_consumed: kwh }

      if (!r.charged && !r.waived) {
        patch.amount_calculated = kwh != null ? parseFloat((kwh * priceWithVat).toFixed(2)) : null
      }

      await supabase.from('electricity_readings').update(patch).eq('id', r.id)
      anterior = r.reading_value
    }
  }

  async function saveEditReading() {
    if (!editReadingModal || !editForm.reading_value) return
    if (!editForm.reading_date) { alert('Indica a data da leitura.'); return }

    const newValue = parseFloat(String(editForm.reading_value).replace(',', '.'))
    if (isNaN(newValue)) { alert('O valor da leitura não é um número válido.'); return }

    setSaving(true)

    // A data e o valor mudam aqui; o consumo e os montantes são refeitos a
    // seguir pela recalcularCadeia, que olha para todas as leituras em conjunto.
    const { error } = await supabase.from('electricity_readings').update({
      reading_date: editForm.reading_date,
      reading_value: newValue,
      notes: editForm.notes || null,
    }).eq('id', editReadingModal.id)

    if (error) {
      setSaving(false)
      alert(`Não foi possível guardar a alteração:\n\n${error.message}`)
      return
    }

    await recalcularCadeia(editReadingModal.space_id)

    await logAccess({
      action: 'editar',
      page: '/eletricidade/espacos',
      details: `Editou leitura de eletricidade (${formatDate(editForm.reading_date)} · ${newValue} kWh)`,
    })

    setSaving(false)
    setEditReadingModal(null)
    fetchAll()
  }

  async function handleCobrarAgora() {
    if (!editReadingModal || !editLeaseId) return
    const amountDue = editReadingModal.amount_calculated ?? 0
    if (amountDue <= 0) return

    setSaving(true)

    // Consome o crédito do inquilino e regista que foi para eletricidade.
    const { applied: totalApplied, consumedIds, error: advError } = await consumeAdvances(supabase, {
      leaseId: editLeaseId,
      amountNeeded: amountDue,
      target: { type: 'eletricidade' },
    })

    if (advError) {
      alert(`Erro ao aplicar o adiantamento: ${advError}`)
      setSaving(false)
      return
    }

    const remaining = parseFloat((amountDue - totalApplied).toFixed(2))

    const { data: newCharge, error: chargeError } = await supabase.from('electricity_charges').insert({
      lease_id: editLeaseId,
      charge_date: new Date().toISOString().slice(0, 10),
      reference_month: editReadingModal.reading_date.slice(0, 7) + '-01',
      units: editReadingModal.kwh_consumed,
      amount: remaining,
      paid: remaining === 0,
      payment_date: remaining === 0 ? new Date().toISOString().slice(0, 10) : null,
      payment_method: null,
      notes: totalApplied > 0 ? `Adiantamento de ${formatCurrency(totalApplied)} aplicado` : null,
    }).select().single()

    if (chargeError) {
      alert(`Erro ao criar a cobrança de eletricidade: ${chargeError.message}`)
      setSaving(false)
      return
    }

    // A cobrança só existe agora — liga-lhe os adiantamentos consumidos.
    if (newCharge?.id) await linkAdvancesToCharge(supabase, consumedIds, newCharge.id)

    await supabase.from('electricity_readings').update({
      charged: true,
      accumulated: false,
    }).eq('id', editReadingModal.id)

    setSaving(false)
    setEditReadingModal(null)
    fetchAll()
  }

  /**
   * Grava uma leitura. Três destinos possíveis:
   *   'cobrar'    → cria a cobrança na conta corrente do inquilino
   *   'acumular'  → guarda o valor para somar à leitura seguinte
   *   'oferta'    → regista o consumo mas não cobra nada, nem agora nem depois
   */
  async function saveReading(destino: 'cobrar' | 'acumular' | 'oferta') {
    if (!readingModal || !readingForm.reading_value) return
    setSaving(true)

    const { space, lastReading } = readingModal
    const newValue = parseFloat(readingForm.reading_value)
    const prevValue = lastReading?.reading_value ?? null
    const kwhConsumed = prevValue != null ? parseFloat((newValue - prevValue).toFixed(2)) : null
    const accumulatedSoFar = getAccumulatedAmount(space.id)
    const amountCalc = kwhConsumed != null ? parseFloat((kwhConsumed * priceWithVat + accumulatedSoFar).toFixed(2)) : null
    const charged = destino === 'cobrar' && amountCalc != null && amountCalc >= minCharge
    const oferta = destino === 'oferta'

    const { data: inserted, error: readingError } = await supabase.from('electricity_readings').insert({
      space_id: space.id,
      reading_date: readingForm.reading_date,
      reading_value: newValue,
      previous_value: prevValue,
      kwh_consumed: kwhConsumed,
      amount_calculated: amountCalc,
      // A oferta não fica acumulada: se ficasse, o valor transitava para a
      // leitura seguinte e acabava por ser cobrado à mesma.
      charged: false,
      accumulated: !oferta,
      waived: oferta,
      waived_reason: oferta ? (readingForm.waived_reason?.trim() || null) : null,
      notes: readingForm.notes || null,
    }).select('id').single()

    if (readingError || !inserted) {
      alert(`Erro ao guardar a leitura: ${readingError?.message ?? 'erro desconhecido'}`)
      setSaving(false)
      return
    }

    if (charged && space.tenant_id && amountCalc) {
      const { data: lease } = await supabase
        .from('leases')
        .select('id')
        .eq('space_id', space.id)
        .eq('status', 'ativo')
        .single()

      if (lease) {
        const { error: chargeError } = await supabase.from('electricity_charges').insert({
          lease_id: lease.id,
          reading_id: inserted.id,
          charge_date: readingForm.reading_date,
          reference_month: readingForm.reading_date.slice(0, 7) + '-01',
          units: kwhConsumed,
          amount: amountCalc,
          paid: false,
          payment_date: null,
          payment_method: null,
          notes: null,
        })

        if (chargeError) {
          alert(`Erro ao criar a cobrança de eletricidade: ${chargeError.message}`)
        } else {
          await supabase.from('electricity_readings').update({ charged: true, accumulated: false }).eq('id', inserted.id)
        }
      }
    }

    setSaving(false)
    setReadingModal(null)
    fetchAll()
  }

  /**
   * Procura a cobrança de eletricidade correspondente a uma leitura: primeiro
   * pela ligação direta (reading_id), e só depois pela data (leituras
   * antigas não têm reading_id). Devolve null se a leitura nunca gerou
   * cobrança.
   */
  async function encontrarCobrancaDaLeitura(reading: Reading): Promise<any | null> {
    const { data: porLigacao } = await supabase
      .from('electricity_charges').select('id, amount, paid, payment_date')
      .eq('reading_id', reading.id).maybeSingle()
    if (porLigacao) return porLigacao

    const { data: lease } = await supabase
      .from('leases').select('id').eq('space_id', reading.space_id).eq('status', 'ativo').maybeSingle()
    if (!lease) return null

    const { data: porData } = await supabase
      .from('electricity_charges').select('id, amount, paid, payment_date')
      .eq('lease_id', lease.id).eq('charge_date', reading.reading_date).maybeSingle()
    return porData
  }

  /**
   * Grava a oferta: apaga a cobrança associada (se houver e não estiver
   * paga) e marca a leitura como waived. Não pede confirmação nem faz
   * logAccess — isso fica a cargo de quem chama, porque cada sítio tem o seu
   * próprio texto (motivo por prompt vs. confirmação direta).
   */
  async function confirmarOferta(reading: Reading, cobranca: any | null, motivo: string | null): Promise<boolean> {
    if (cobranca) {
      const { error } = await supabase.from('electricity_charges').delete().eq('id', cobranca.id)
      if (error) { alert(`Erro ao apagar a cobrança: ${error.message}`); return false }
    }

    const { error: updateError } = await supabase.from('electricity_readings').update({
      waived: true,
      waived_reason: motivo,
      charged: false,
      accumulated: false,
      amount_calculated: reading.amount_calculated,
    }).eq('id', reading.id)

    if (updateError) { alert(`Erro ao marcar como oferta: ${updateError.message}`); return false }
    return true
  }

  /**
   * Converte uma leitura já registada em oferta, a partir da linha do
   * histórico (link "não cobrar"). Pede o motivo por prompt, como já
   * acontecia.
   */
  async function marcarComoOferta(reading: Reading, spaceRef: string) {
    const cobranca = await encontrarCobrancaDaLeitura(reading)

    if (cobranca?.paid) {
      alert(
        `⚠️ Esta cobrança de ${formatCurrency(cobranca.amount)} já foi paga pelo inquilino` +
        `${cobranca.payment_date ? ` em ${formatDate(cobranca.payment_date)}` : ''}.\n\n` +
        `Não é possível transformá-la em oferta, porque isso faria desaparecer dinheiro ` +
        `que entrou e as contas deixavam de bater certo.\n\n` +
        `Se queres mesmo devolver o valor, regista um adiantamento a favor do inquilino.`
      )
      return
    }

    const motivo = window.prompt(
      `Marcar a leitura de ${formatDate(reading.reading_date)} (${spaceRef}) como oferta.\n\n` +
      (cobranca
        ? `A cobrança de ${formatCurrency(cobranca.amount)} vai ser APAGADA da conta corrente do inquilino.\n\n`
        : `O valor deixa de ser cobrado e não transita para a leitura seguinte.\n\n`) +
      `Motivo (opcional):`,
      reading.waived_reason ?? ''
    )
    if (motivo === null) return

    const ok = await confirmarOferta(reading, cobranca, motivo.trim() || null)
    if (!ok) return

    await logAccess({
      action: 'editar',
      page: '/eletricidade/espacos',
      details: `Leitura de ${formatDate(reading.reading_date)} (${spaceRef}) marcada como oferta` +
        (cobranca ? ` — cobrança de ${formatCurrency(cobranca.amount)} apagada` : '') +
        (motivo.trim() ? ` · ${motivo.trim()}` : ''),
    })

    fetchAll()
  }

  /**
   * "🎁 Oferecer valor", no modal Editar Última Leitura — perdoa o acumulado
   * de um inquilino que sai, para a conta ficar a zeros para o próximo.
   * Confirmação direta (sem pedir motivo), com o valor bem visível.
   */
  async function handleOferecerValor() {
    if (!editReadingModal) return
    const reading = editReadingModal
    const valor = reading.amount_calculated ?? 0
    if (valor <= 0) return

    const cobranca = await encontrarCobrancaDaLeitura(reading)

    if (cobranca?.paid) {
      alert(
        `⚠️ Esta cobrança de ${formatCurrency(cobranca.amount)} já foi paga pelo inquilino` +
        `${cobranca.payment_date ? ` em ${formatDate(cobranca.payment_date)}` : ''}.\n\n` +
        `Não é possível oferecer um valor já pago, porque isso faria desaparecer dinheiro ` +
        `que entrou e as contas deixavam de bater certo.`
      )
      return
    }

    if (!confirm(
      `Oferecer ${formatCurrency(valor)} acumulados?\n\n` +
      `A conta fica a zeros e este valor não será cobrado a ninguém.`
    )) return

    setSaving(true)
    const ok = await confirmarOferta(reading, cobranca, null)
    setSaving(false)
    if (!ok) return

    const space = spaces.find(s => s.id === reading.space_id)
    await logAccess({
      action: 'editar',
      page: '/eletricidade/espacos',
      details: `Ofereceu ${formatCurrency(valor)} acumulados no ${space?.ref ?? ''} (leitura de ${formatDate(reading.reading_date)})` +
        (cobranca ? ` — cobrança de ${formatCurrency(cobranca.amount)} apagada` : ''),
    })

    setEditReadingModal(null)
    fetchAll()
  }

  /** Desfaz a oferta: a leitura volta a acumular para a leitura seguinte. */
  async function anularOferta(reading: Reading) {
    if (!window.confirm('Anular a oferta? O valor volta a acumular para a próxima leitura.')) return
    const { error } = await supabase.from('electricity_readings').update({
      waived: false, waived_reason: null, accumulated: true, charged: false,
    }).eq('id', reading.id)
    if (error) { alert(error.message); return }
    fetchAll()
  }

  function toggleExpanded(id: string) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }

  async function deleteReading(reading: Reading) {
    const { data: spaceLeases } = await supabase
      .from('leases')
      .select('id')
      .eq('space_id', reading.space_id)

    const leaseIds = (spaceLeases ?? []).map(l => l.id)
    const referenceMonth = reading.reading_date.slice(0, 7) + '-01'

    let unpaidCharges: { id: string }[] = []
    if (leaseIds.length > 0) {
      const { data: paidCharges } = await supabase
        .from('electricity_charges')
        .select('id')
        .in('lease_id', leaseIds)
        .eq('paid', true)
        .or(`charge_date.eq.${reading.reading_date},reference_month.eq.${referenceMonth}`)

      if ((paidCharges ?? []).length > 0) {
        alert('Não é possível apagar esta leitura porque já tem uma cobrança paga associada.')
        return
      }

      const { data: charges } = await supabase
        .from('electricity_charges')
        .select('id')
        .in('lease_id', leaseIds)
        .eq('paid', false)
        .or(`charge_date.eq.${reading.reading_date},reference_month.eq.${referenceMonth}`)
      unpaidCharges = charges ?? []
    }

    const n = unpaidCharges.length
    const extra = n > 0
      ? ` Também vai${n > 1 ? 'o' : ''} ser apagada${n > 1 ? 's' : ''} ${n} cobrança${n > 1 ? 's' : ''} de eletricidade associada${n > 1 ? 's' : ''} (não paga${n > 1 ? 's' : ''}).`
      : ''

    if (!confirm(`Apagar esta leitura?${extra}`)) return

    if (n > 0) {
      const { error } = await supabase.from('electricity_charges').delete().in('id', unpaidCharges.map(c => c.id))
      if (error) { alert(`Não foi possível apagar as cobranças:\n\n${error.message}`); return }
    }

    const { error: delError } = await supabase.from('electricity_readings').delete().eq('id', reading.id)
    if (delError) { alert(`Não foi possível apagar a leitura:\n\n${delError.message}`); return }

    // Apagar uma leitura no meio parte a cadeia de consumos das seguintes.
    await recalcularCadeia(reading.space_id)
    fetchAll()
  }

  const semInquilino = spaces.filter(s => !s.tenant_id).length
  const totalCobrado = Object.values(readings).flat()
    .filter(r => r.charged)
    .reduce((s, r) => s + (r.amount_calculated ?? 0), 0)
  const totalAcumulado = spaces.reduce((s, sp) => s + getAccumulatedAmount(sp.id), 0)
  const totalOferecido = Object.values(readings).flat()
    .filter(r => r.waived)
    .reduce((s, r) => s + (r.amount_calculated ?? 0), 0)

  const filteredSpaces = spaces.filter(space => {
    const matchesTenant = !filterTenant || matchesSearch(getTenantName(space.tenant, ''), filterTenant)
    const matchesSpace = filterSpaces.length === 0 || filterSpaces.includes(space.ref)
    return matchesTenant && matchesSpace
  })

  return (
    <AppLayout>
      <div className="p-4 md:p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Quadros dos Espaços</h1>
            <p className="text-sm text-gray-500 mt-1">{spaces.length} espaços com contador partilhado</p>
          </div>
          {canEdit && (
            <button
              onClick={() => setShowConfig(!showConfig)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${showConfig ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              <Settings className="w-4 h-4" />
              Configurações
            </button>
          )}
        </div>

        {/* Painel de Configurações */}
        {showConfig && canEdit && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-6">
            <h2 className="text-sm font-semibold text-blue-800 mb-4 flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Parâmetros de Cobrança
            </h2>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-medium text-blue-700 block mb-1">Preço por kWh (€, sem IVA)</label>
                <input type="number" step="0.001" className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm bg-white"
                  value={configForm.price_per_kwh}
                  onChange={e => setConfigForm(f => ({ ...f, price_per_kwh: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-blue-700 block mb-1">IVA (%)</label>
                <input type="number" step="1" className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm bg-white"
                  value={configForm.vat_rate}
                  onChange={e => setConfigForm(f => ({ ...f, vat_rate: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-blue-700 block mb-1">Valor mínimo para cobrar (€)</label>
                <input type="number" step="0.50" className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm bg-white"
                  value={configForm.min_charge}
                  onChange={e => setConfigForm(f => ({ ...f, min_charge: e.target.value }))} />
              </div>
            </div>
            <div className="mt-3 bg-white border border-blue-100 rounded-lg px-4 py-2 text-sm text-blue-800">
              Preço final com IVA: <strong>
                {formatCurrency(parseFloat(configForm.price_per_kwh || '0') * (1 + parseFloat(configForm.vat_rate || '0') / 100))}
              </strong> /kWh
            </div>
            <div className="flex items-center gap-3 mt-4">
              <button onClick={saveConfig} disabled={savingConfig}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                <Save className="w-4 h-4" />
                {savingConfig ? 'A guardar...' : 'Guardar configurações'}
              </button>
              {configSaved && <span className="text-sm text-emerald-600 font-medium">✓ Guardado com sucesso!</span>}
            </div>
          </div>
        )}

        <div className={`grid gap-3 mb-4 ${totalOferecido > 0 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3">
            <p className="text-xs text-gray-500 mb-0.5">Espaços com contador</p>
            <p className="text-lg font-bold text-gray-900">{spaces.length}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">H34 tem contador próprio (excluído)</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3">
            <p className="text-xs text-gray-500 mb-0.5">Total cobrado</p>
            <p className="text-lg font-bold text-emerald-600">{formatCurrency(totalCobrado)}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3">
            <p className="text-xs text-gray-500 mb-0.5">Por acumular</p>
            <p className="text-lg font-bold text-yellow-600">{formatCurrency(totalAcumulado)}</p>
          </div>
          {totalOferecido > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3">
              <p className="text-xs text-gray-500 mb-0.5">Oferecido</p>
              <p className="text-lg font-bold text-blue-600">{formatCurrency(totalOferecido)}</p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={filterTenant}
              onChange={e => setFilterTenant(e.target.value)}
              placeholder="Filtrar por inquilino..."
              className="input pl-8 pr-8"
            />
            {filterTenant && (
              <button onClick={() => setFilterTenant('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="relative flex-1 min-w-[180px]" ref={spaceDropdownRef}>
            <button
              onClick={() => setShowSpaceDropdown(!showSpaceDropdown)}
              className={`input w-full flex items-center justify-between text-left text-sm ${filterSpaces.length > 0 ? 'border-emerald-400 text-emerald-700' : 'text-gray-500'}`}>
              <span className="truncate">
                {filterSpaces.length === 0 ? 'Filtrar por espaço' : filterSpaces.length === 1 ? `${filterSpaces.length} espaço` : `${filterSpaces.length} espaços`}
              </span>
              <ChevronDown className="w-4 h-4 flex-shrink-0 ml-2" />
            </button>
            {showSpaceDropdown && (
              <div className="absolute z-20 top-full mt-1 w-64 bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
                <div className="p-2 border-b border-gray-100">
                  <button onClick={() => setFilterSpaces([])} className="text-xs text-gray-500 hover:text-emerald-600 hover:underline">
                    Limpar
                  </button>
                </div>
                <div className="p-1">
                  {[...spaces].sort((a, b) => a.ref.localeCompare(b.ref, 'pt', { numeric: true })).map(s => (
                    <label key={s.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer">
                      <input type="checkbox" checked={filterSpaces.includes(s.ref)} onChange={() => toggleSpace(s.ref)} className="accent-emerald-600 w-3.5 h-3.5 flex-shrink-0" />
                      <span className="text-sm text-gray-700">{s.ref}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          {(filterTenant || filterSpaces.length > 0) && (
            <button onClick={() => { setFilterTenant(''); setFilterSpaces([]) }} className="text-xs text-red-500 hover:text-red-700 font-medium">
              Limpar filtros
            </button>
          )}
        </div>

        {semInquilino > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 mb-4">
            <p className="text-sm text-yellow-700">⚠ <strong>{semInquilino}</strong> espaço(s) sem inquilino — leituras não geram cobrança</p>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
          </div>
        ) : (
          <div className="space-y-3">
            {filteredSpaces.length === 0 && (
              <div className="card text-center py-6 text-sm text-gray-500">
                Nenhum espaço encontrado com os filtros aplicados.
              </div>
            )}
            {filteredSpaces.map(space => {
              const spaceReadings = readings[space.id] ?? []
              const lastReading = spaceReadings[0]
              const isOpen = expanded[space.id]
              const accumulated = getAccumulatedAmount(space.id)
              const tenantName = getTenantName(space.tenant, '')

              return (
                <div key={space.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => toggleExpanded(space.id)}>
                    <div className="flex items-center gap-4">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${space.tenant_id ? 'bg-emerald-100' : 'bg-gray-100'}`}>
                        <Zap className={`w-4 h-4 ${space.tenant_id ? 'text-emerald-600' : 'text-gray-400'}`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-gray-900">{space.ref}</p>
                          <span className="text-xs text-gray-400 capitalize">{space.type}</span>
                          {!space.tenant_id && (
                            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Sem inquilino</span>
                          )}
                        </div>
                        {tenantName && <p className="text-xs text-gray-500">{tenantName}</p>}
                      </div>
                    </div>

                    <div className="flex items-center gap-6">
                      {accumulated > 0 && (
                        <div className="text-right">
                          <p className="text-xs text-yellow-600 font-medium">Acumulado</p>
                          <p className="text-sm font-semibold text-yellow-700">{formatCurrency(accumulated)}</p>
                        </div>
                      )}
                      <div className="text-right">
                        <p className="text-xs text-gray-500">Última leitura</p>
                        <p className="text-sm font-medium text-gray-700">{lastReading ? formatDate(lastReading.reading_date) : '—'}</p>
                        {lastReading?.reading_value != null && (
                          <p className="text-xs text-gray-400">{lastReading.reading_value} kWh</p>
                        )}
                      </div>
                      {canEdit && (
                        <button
                          onClick={e => { e.stopPropagation(); openReadingModal(space) }}
                          className="text-xs text-blue-600 hover:underline font-medium whitespace-nowrap">
                          + Leitura
                        </button>
                      )}
                      {canEdit && (isAdmin || isCoAdmin) && (
                        <button
                          onClick={e => { e.stopPropagation(); openResetModal(space) }}
                          className="text-xs text-amber-600 hover:underline font-medium whitespace-nowrap"
                          title="Fechar contas do inquilino que sai e pôr o contador a zero para o próximo">
                          ⟲ Fecho de contas
                        </button>
                      )}
                      {spaceReadings.length > 0 && (
                        <button
                          onClick={e => { e.stopPropagation(); printElectricity(space) }}
                          className="text-gray-400 hover:text-emerald-600 transition-colors"
                          title="Imprimir leituras">
                          <Printer className="w-4 h-4" />
                        </button>
                      )}
                      {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t border-gray-100 px-4 pb-4">
                      {spaceReadings.length === 0 ? (
                        <p className="text-sm text-gray-400 py-4 text-center">Sem leituras registadas</p>
                      ) : (
                        <table className="w-full mt-3">
                          <thead>
                            <tr className="text-xs text-gray-500 border-b border-gray-100">
                              <th className="text-left py-2">Data</th>
                              <th className="text-left py-2">Leitura</th>
                              <th className="text-left py-2">Anterior</th>
                              <th className="text-left py-2">kWh</th>
                              <th className="text-left py-2">Valor</th>
                              <th className="text-left py-2">Estado</th>
                              {canEdit && <th className="py-2"></th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {spaceReadings.map((r, index) => (
                              <tr key={r.id} className="hover:bg-gray-50">
                                <td className="py-2 text-sm">{formatDate(r.reading_date)}</td>
                                <td className="py-2 text-sm font-mono">{r.reading_value}</td>
                                <td className="py-2 text-sm font-mono text-gray-400">{r.previous_value ?? '—'}</td>
                                <td className="py-2 text-sm">{r.kwh_consumed != null ? `${Number(r.kwh_consumed).toFixed(2)} kWh` : '—'}</td>
                                <td className="py-2 text-sm font-semibold">
                                  {r.amount_calculated != null ? formatCurrency(r.amount_calculated) : '—'}
                                </td>
                                <td className="py-2">
                                  {r.waived ? (
                                    <span
                                      className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium"
                                      title={r.waived_reason ?? 'Não cobrado'}>
                                      🎁 Oferta
                                    </span>
                                  ) : r.charged ? (
                                    <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">Cobrado</span>
                                  ) : (
                                    <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">Acumulado</span>
                                  )}
                                  {r.waived && r.waived_reason && (
                                    <p className="text-[11px] text-gray-400 mt-0.5">{r.waived_reason}</p>
                                  )}
                                </td>
                                {canEdit && (
                                  <td className="py-2">
                                    <div className="flex items-center gap-2">
                                      {r.waived ? (
                                        <button onClick={() => anularOferta(r)}
                                          className="text-xs text-gray-400 hover:text-yellow-600 transition-colors whitespace-nowrap"
                                          title="Voltar a acumular este valor">
                                          anular oferta
                                        </button>
                                      ) : (isAdmin || isCoAdmin) && (
                                        <button onClick={() => marcarComoOferta(r, space.ref)}
                                          className="text-xs text-gray-400 hover:text-blue-600 transition-colors whitespace-nowrap"
                                          title={r.charged
                                            ? 'Não cobrar — apaga a cobrança da conta corrente do inquilino'
                                            : 'Não cobrar — o valor deixa de transitar para a próxima leitura'}>
                                          não cobrar
                                        </button>
                                      )}
                                      {/* Editar qualquer leitura: um engano numa data antiga
                                          também precisa de ser corrigido. A cadeia de consumos
                                          é refeita automaticamente ao gravar. */}
                                      <button onClick={() => openEditModal(r)}
                                        className="text-gray-300 hover:text-blue-500 transition-colors"
                                        title="Editar leitura">
                                        <Pencil className="w-3.5 h-3.5" />
                                      </button>
                                      <button onClick={() => deleteReading(r)} className="text-gray-300 hover:text-red-500 transition-colors">
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal Nova Leitura */}
      {resetModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg text-gray-900">
                Fecho de contas — {resetModal.space.ref}
              </h2>
              <button onClick={() => setResetModal(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>

            {!resetConfirm ? (
              <>
                <p className="text-sm text-gray-500 mb-4">
                  Fecha as contas de eletricidade do inquilino que sai e deixa o contador pronto para o próximo.
                </p>

                <div className="bg-gray-50 rounded-lg p-3 mb-4 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Inquilino atual</span>
                    <span className="font-medium text-gray-800">{resetModal.tenantName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Última leitura</span>
                    <span className="font-medium text-gray-800">
                      {resetModal.lastReading
                        ? `${resetModal.lastReading.reading_value} kWh · ${formatDate(resetModal.lastReading.reading_date)}`
                        : 'sem leituras'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Cobranças por pagar</span>
                    <span className={`font-medium ${resetModal.pendingCharges.length > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {resetModal.pendingCharges.length > 0
                        ? `${resetModal.pendingCharges.length} · ${formatCurrency(resetModal.pendingCharges.reduce((s, c) => s + (c.amount - (c.amount_paid ?? 0)), 0))}`
                        : 'nenhuma'}
                    </span>
                  </div>
                  {resetModal.accumulated > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Valor acumulado por cobrar</span>
                      <span className="font-medium text-amber-600">{formatCurrency(resetModal.accumulated)}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="label">Leitura atual do contador *</label>
                      <input className="input" type="number" step="0.001" placeholder="ex: 9012.500"
                        value={resetForm.reading_value}
                        onChange={e => setResetForm(f => ({ ...f, reading_value: e.target.value }))} />
                    </div>
                    <div>
                      <label className="label">Data</label>
                      <input className="input" type="date" value={resetForm.reading_date}
                        onChange={e => setResetForm(f => ({ ...f, reading_date: e.target.value }))} />
                    </div>
                  </div>

                  {resetForm.reading_value && resetModal.lastReading && (
                    <p className={`text-xs px-3 py-2 rounded-lg ${
                      parseFloat(resetForm.reading_value) < resetModal.lastReading.reading_value
                        ? 'text-red-700 bg-red-50'
                        : 'text-gray-600 bg-gray-50'
                    }`}>
                      {parseFloat(resetForm.reading_value) < resetModal.lastReading.reading_value
                        ? '⚠️ O valor é inferior à última leitura. Confirma que não te enganaste.'
                        : `Consumo desde a última leitura: ${(parseFloat(resetForm.reading_value) - resetModal.lastReading.reading_value).toFixed(2)} kWh — não vai ser cobrado a ninguém.`}
                    </p>
                  )}

                  {resetModal.pendingCharges.length > 0 && (
                    <label className={`flex items-start gap-2 cursor-pointer rounded-lg px-3 py-2 border ${
                      resetForm.forgiveCharges ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-100'
                    }`}>
                      <input type="checkbox" className="rounded mt-0.5" checked={resetForm.forgiveCharges}
                        onChange={e => setResetForm(f => ({ ...f, forgiveCharges: e.target.checked }))} />
                      <span className="text-xs">
                        <span className="font-medium text-gray-800">Perdoar as cobranças em aberto</span>
                        <span className="block text-gray-500 mt-0.5">
                          Saem da conta corrente do inquilino, mas não entram nos relatórios como dinheiro recebido.
                        </span>
                      </span>
                    </label>
                  )}

                  <div>
                    <label className="label">Notas <span className="font-normal text-gray-400">(opcional)</span></label>
                    <input className="input text-sm" placeholder="ex: chaves entregues a 31/07"
                      value={resetForm.notes}
                      onChange={e => setResetForm(f => ({ ...f, notes: e.target.value }))} />
                  </div>
                </div>

                <div className="flex justify-end gap-3 mt-6">
                  <button className="btn-secondary" onClick={() => setResetModal(null)}>Cancelar</button>
                  <button className="btn-primary" disabled={!resetForm.reading_value || resetLoading}
                    onClick={() => setResetConfirm(true)}>
                    Continuar
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                  <p className="text-sm font-medium text-amber-900 mb-2">
                    Confirmas que queres fazer isto no {resetModal.space.ref}?
                  </p>
                  <ul className="text-sm text-amber-800 space-y-1.5 list-disc list-inside">
                    <li>
                      Registar leitura de saída de <strong>{resetForm.reading_value} kWh</strong> a {formatDate(resetForm.reading_date)}
                    </li>
                    {resetForm.forgiveCharges && resetModal.pendingCharges.length > 0 && (
                      <li>
                        <strong>Perdoar {resetModal.pendingCharges.length} cobrança(s)</strong> no total de{' '}
                        <strong>{formatCurrency(resetModal.pendingCharges.reduce((s, c) => s + (c.amount - (c.amount_paid ?? 0)), 0))}</strong> de {resetModal.tenantName}
                      </li>
                    )}
                    <li>Limpar valores acumulados, para não serem cobrados ao próximo inquilino</li>
                  </ul>
                </div>

                <p className="text-xs text-gray-500 mb-4">
                  Esta operação não pode ser desfeita automaticamente. As leituras anteriores mantêm-se no histórico.
                </p>

                <div className="flex justify-end gap-3">
                  <button className="btn-secondary" onClick={() => setResetConfirm(false)} disabled={resetting}>
                    ← Voltar
                  </button>
                  <button
                    className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-60"
                    onClick={executeReset} disabled={resetting}>
                    {resetting ? 'A processar...' : 'Sim, fechar contas'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {readingModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg text-gray-900">Nova Leitura — {readingModal.space.ref}</h2>
              <button onClick={() => setReadingModal(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>

            {readingModal.lastReading && (
              <div className="bg-gray-50 rounded-lg p-3 mb-4 text-sm">
                <p className="text-gray-500 text-xs mb-1">Última leitura</p>
                <p className="font-medium text-gray-800">{readingModal.lastReading.reading_value} kWh — {formatDate(readingModal.lastReading.reading_date)}</p>
              </div>
            )}

            {getAccumulatedAmount(readingModal.space.id) > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                <p className="text-xs text-yellow-700 font-medium">
                  Valor acumulado de leituras anteriores: {formatCurrency(getAccumulatedAmount(readingModal.space.id))}
                </p>
                <p className="text-xs text-yellow-600 mt-0.5">Este valor será somado ao cálculo atual</p>
              </div>
            )}

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Data *</label>
                  <input type="date" className="input" value={readingForm.reading_date}
                    onChange={e => setReadingForm(f => ({ ...f, reading_date: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Valor do contador *</label>
                  <input type="number" step="0.01" className="input" placeholder="ex: 1250"
                    value={readingForm.reading_value}
                    onChange={e => setReadingForm(f => ({ ...f, reading_value: e.target.value }))} />
                </div>
              </div>

              {readingForm.reading_value && readingModal.lastReading && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
                  <p className="text-xs font-medium text-blue-700 mb-1">Pré-visualização:</p>
                  {(() => {
                    const kwh = parseFloat(readingForm.reading_value) - readingModal.lastReading!.reading_value
                    const acc = getAccumulatedAmount(readingModal.space.id)
                    const total = parseFloat((kwh * priceWithVat + acc).toFixed(2))
                    return (
                      <div className="text-xs text-blue-700 space-y-0.5">
                        <p>{kwh.toFixed(1)} kWh × {formatCurrency(priceWithVat)}/kWh = {formatCurrency(kwh * priceWithVat)}</p>
                        {acc > 0 && <p>+ Acumulado: {formatCurrency(acc)}</p>}
                        <p className="font-semibold text-blue-800 text-sm mt-1">Total: {formatCurrency(total)}</p>
                        {total < minCharge && (
                          <p className="text-yellow-700 font-medium mt-1">⚠ Abaixo de {formatCurrency(minCharge)} — recomenda-se acumular</p>
                        )}
                      </div>
                    )
                  })()}
                </div>
              )}

              <div>
                <label className="label">Notas</label>
                <textarea className="input" rows={2} value={readingForm.notes}
                  onChange={e => setReadingForm(f => ({ ...f, notes: e.target.value }))} />
              </div>

              <div>
                <label className="label">
                  Motivo da oferta <span className="font-normal text-gray-400">(só se escolheres &quot;não cobrar&quot;)</span>
                </label>
                <input className="input text-sm" placeholder="ex: avaria no contador, oferta de boas-vindas"
                  value={readingForm.waived_reason}
                  onChange={e => setReadingForm(f => ({ ...f, waived_reason: e.target.value }))} />
              </div>
            </div>

            <div className="mt-6 space-y-2">
              {readingModal.space.tenant_id ? (
                <>
                  <button onClick={() => saveReading('cobrar')} disabled={saving || !readingForm.reading_value}
                    className="w-full py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                    {saving ? 'A guardar...' : '✓ Cobrar ao inquilino'}
                  </button>
                  <button onClick={() => saveReading('acumular')} disabled={saving || !readingForm.reading_value}
                    className="w-full py-2.5 rounded-lg bg-yellow-500 text-white text-sm font-medium hover:bg-yellow-600 disabled:opacity-50">
                    {saving ? 'A guardar...' : 'Acumular para próxima leitura'}
                  </button>
                  <button onClick={() => saveReading('oferta')} disabled={saving || !readingForm.reading_value}
                    className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                    {saving ? 'A guardar...' : '🎁 Não cobrar — oferta'}
                  </button>
                  <p className="text-xs text-gray-400 text-center">
                    A oferta regista o consumo mas não gera cobrança, nem transita para a leitura seguinte.
                  </p>
                </>
              ) : (
                <button onClick={() => saveReading('acumular')} disabled={saving || !readingForm.reading_value}
                  className="w-full py-2.5 rounded-lg bg-gray-600 text-white text-sm font-medium hover:bg-gray-700 disabled:opacity-50">
                  {saving ? 'A guardar...' : 'Guardar leitura (sem inquilino)'}
                </button>
              )}
              <button onClick={() => setReadingModal(null)}
                className="w-full py-2.5 rounded-lg border border-gray-200 text-gray-600 text-sm hover:bg-gray-50">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Editar Última Leitura */}
      {editReadingModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg text-gray-900">Editar Última Leitura</h2>
              <button onClick={() => setEditReadingModal(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
              <p className="text-xs text-yellow-700 font-medium">⚠ Só é possível editar a última leitura.</p>
              <p className="text-xs text-yellow-600 mt-0.5">O valor calculado será recalculado automaticamente.</p>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Data *</label>
                  <input type="date" className="input" value={editForm.reading_date}
                    onChange={e => setEditForm(f => ({ ...f, reading_date: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Valor do contador *</label>
                  <input type="number" step="0.01" className="input"
                    value={editForm.reading_value}
                    onChange={e => setEditForm(f => ({ ...f, reading_value: e.target.value }))} />
                </div>
              </div>

              {editForm.reading_value && editReadingModal.previous_value != null && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
                  <p className="text-xs font-medium text-blue-700 mb-1">Pré-visualização:</p>
                  {(() => {
                    const kwh = parseFloat(editForm.reading_value) - editReadingModal.previous_value!
                    const total = parseFloat((kwh * priceWithVat).toFixed(2))
                    return (
                      <div className="text-xs text-blue-700 space-y-0.5">
                        <p>{kwh.toFixed(1)} kWh × {formatCurrency(priceWithVat)}/kWh = {formatCurrency(kwh * priceWithVat)}</p>
                        <p className="font-semibold text-blue-800 text-sm mt-1">Total: {formatCurrency(total)}</p>
                      </div>
                    )
                  })()}
                </div>
              )}

              <div>
                <label className="label">Notas</label>
                <textarea className="input" rows={2} value={editForm.notes}
                  onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} />
              </div>

              {!editReadingModal.charged && (editReadingModal.amount_calculated ?? 0) > 0 && editLeaseId && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                  {editAdvance > 0 ? (
                    <p className="text-xs text-emerald-700">
                      Adiantamento de {formatCurrency(Math.min(editAdvance, editReadingModal.amount_calculated ?? 0))} aplicado. Valor a cobrar: {formatCurrency(Math.max(0, (editReadingModal.amount_calculated ?? 0) - editAdvance))}
                    </p>
                  ) : (
                    <p className="text-xs text-emerald-700">
                      Valor a cobrar ao inquilino: {formatCurrency(editReadingModal.amount_calculated ?? 0)}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="mt-6 space-y-2">
              {!editReadingModal.charged && (editReadingModal.amount_calculated ?? 0) > 0 && editLeaseId && (
                <button onClick={handleCobrarAgora} disabled={saving}
                  className="w-full py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                  {saving ? 'A processar...' : '✓ Cobrar agora'}
                </button>
              )}
              {!editReadingModal.charged && (editReadingModal.amount_calculated ?? 0) > 0 && (
                <button onClick={handleOferecerValor} disabled={saving}
                  className="w-full py-2.5 rounded-lg border border-blue-300 bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 disabled:opacity-50"
                  title="Perdoar este valor — não é cobrado a ninguém e a conta fica a zeros">
                  {saving ? 'A processar...' : '🎁 Oferecer valor'}
                </button>
              )}
              <button onClick={saveEditReading} disabled={saving || !editForm.reading_value}
                className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'A guardar...' : '✓ Guardar alterações'}
              </button>
              <button onClick={() => setEditReadingModal(null)}
                className="w-full py-2.5 rounded-lg border border-gray-200 text-gray-600 text-sm hover:bg-gray-50">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

// https://quinta-gestao.vercel.app/eletricidade/espacos
