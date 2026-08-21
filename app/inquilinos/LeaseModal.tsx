'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Tenant, Lease, Space } from '@/lib/types'
import { X, Upload, FileText, Loader2, Sparkles } from 'lucide-react'
import { formatCurrency, openStorageDocument, slugifyFilename, getMonthLabel } from '@/lib/utils'
import { logAccess } from '@/lib/logAccess'
import { useFileDrop } from '@/lib/useFileDrop'

interface Props {
  tenant: Tenant
  onClose: () => void
  onSaved: () => void
}

export default function LeaseModal({ tenant, onClose, onSaved }: Props) {
  const [spaces, setSpaces] = useState<Space[]>([])
  const [existingLease, setExistingLease] = useState<Lease | null>(null)
  const [form, setForm] = useState({
    space_id: '',
    monthly_rent: '',
    deposit: '',
    start_date: '',
    end_date: '',
    notes: '',
    status: 'ativo',
  })
  const [originalRent, setOriginalRent] = useState('')
  const [rentChangeDate, setRentChangeDate] = useState(new Date().toISOString().slice(0, 10))
  const [rentHistory, setRentHistory] = useState<any[]>([])
  const [contractFile, setContractFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [processingOCR, setProcessingOCR] = useState(false)
  const [ocrDone, setOcrDone] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: spacesData } = await supabase.from('spaces').select('*').order('ref')
      setSpaces(spacesData ?? [])

      const { data: leaseData } = await supabase
        .from('leases')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('status', 'ativo')
        .single()

      if (leaseData) {
        setExistingLease(leaseData)
        setOriginalRent(String(leaseData.monthly_rent))
        setForm({
          space_id: leaseData.space_id,
          monthly_rent: String(leaseData.monthly_rent),
          deposit: String(leaseData.deposit ?? ''),
          start_date: leaseData.start_date,
          end_date: leaseData.end_date ?? '',
          notes: leaseData.notes ?? '',
          status: leaseData.status,
        })
        const { data: histData } = await supabase
          .from('lease_rent_history')
          .select('*')
          .eq('lease_id', leaseData.id)
          .order('effective_date', { ascending: false })
        setRentHistory(histData ?? [])
      }
    }
    load()
  }, [tenant.id])

  const contractDrop = useFileDrop({
    accept: ['.pdf'],
    onFiles: dropped => { if (dropped[0]) handleFileChange(dropped[0]) },
    disabled: processingOCR,
  })

  async function handleFileChange(file: File) {
    setContractFile(file)
    setOcrDone(false)
    setError('')

    // Processar OCR automaticamente ao selecionar o ficheiro
    setProcessingOCR(true)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/process-contract', {
        method: 'POST',
        body: formData,
      })

      const result = await res.json()

      if (result.error) {
        setError('Erro no OCR: ' + result.error)
        setProcessingOCR(false)
        return
      }

      const d = result.data

      // Preencher formulário com dados extraídos (só os que estiverem vazios)
      setForm(f => ({
        ...f,
        monthly_rent: d.monthly_rent ? String(d.monthly_rent) : f.monthly_rent,
        deposit: d.deposit ? String(d.deposit) : f.deposit,
        start_date: d.start_date ?? f.start_date,
        end_date: d.end_date ?? f.end_date,
        notes: d.notes ?? f.notes,
      }))

      // Atualizar dados do inquilino se encontrados
      if (d.tenant_name || d.tenant_nif || d.tenant_phone || d.tenant_email) {
        const updatePayload: any = {}
        if (d.tenant_nif && !tenant.nif) updatePayload.nif = d.tenant_nif
        if (d.tenant_phone && !tenant.phone) updatePayload.phone = d.tenant_phone
        if (d.tenant_email && !tenant.email) updatePayload.email = d.tenant_email

        if (Object.keys(updatePayload).length > 0) {
          await supabase.from('tenants').update(updatePayload).eq('id', tenant.id)
        }
      }

      setOcrDone(true)
    } catch (e: any) {
      setError('Erro ao processar contrato: ' + e.message)
    }
    setProcessingOCR(false)
  }

  async function handleSave() {
    if (!form.space_id || !form.monthly_rent || !form.start_date) {
      setError('Espaço, renda e data de início são obrigatórios')
      return
    }
    setSaving(true); setError('')

    let contractPath = existingLease?.contract_file_path ?? null

    if (contractFile) {
      const safeName = slugifyFilename(contractFile.name, { allowDot: true })
      const filename = `contracts/${tenant.id}/${Date.now()}_${safeName}`
      const { error: uploadErr } = await supabase.storage
        .from('documents')
        .upload(filename, contractFile)
      if (uploadErr) { setError('Erro ao fazer upload do contrato: ' + uploadErr.message); setSaving(false); return }
      contractPath = filename
    }

    const payload = {
      space_id: form.space_id,
      tenant_id: tenant.id,
      monthly_rent: parseFloat(form.monthly_rent),
      deposit: form.deposit ? parseFloat(form.deposit) : null,
      start_date: form.start_date,
      end_date: form.end_date || null,
      notes: form.notes || null,
      status: form.status,
      contract_file_path: contractPath,
    }

    const rentChanged = !!existingLease && originalRent !== '' && form.monthly_rent !== originalRent

    let err
    if (existingLease) {
      ;({ error: err } = await supabase.from('leases').update(payload).eq('id', existingLease.id))
      if (!err && rentChanged) {
        // Seed renda inicial no histórico se ainda não existir
        if (rentHistory.length === 0) {
          await supabase.from('lease_rent_history').insert({
            lease_id: existingLease.id,
            monthly_rent: parseFloat(originalRent),
            effective_date: existingLease.start_date,
            notes: 'Renda inicial',
          })
        }
        await supabase.from('lease_rent_history').insert({
          lease_id: existingLease.id,
          monthly_rent: parseFloat(form.monthly_rent),
          effective_date: rentChangeDate,
          notes: 'Atualização de renda',
        })
      }
    } else {
      const { data: newLeaseData, error: insertErr } = await supabase.from('leases').insert(payload).select().single()
      err = insertErr
      if (!err && newLeaseData) {
        // Seed renda inicial para novo contrato
        await supabase.from('lease_rent_history').insert({
          lease_id: newLeaseData.id,
          monthly_rent: parseFloat(form.monthly_rent),
          effective_date: form.start_date,
          notes: 'Renda inicial',
        })
        await supabase.from('spaces').update({ status: 'arrendado' }).eq('id', form.space_id)
      }
    }

    setSaving(false)
    if (err) { setError(err.message); return }
    const space = spaces.find(s => s.id === form.space_id)
    await logAccess({
      action: existingLease ? 'editar' : 'criar',
      page: '/inquilinos',
      details: `${existingLease ? 'Editou' : 'Criou'} contrato de "${tenant.name}" no espaço ${space?.ref ?? ''} (${formatCurrency(parseFloat(form.monthly_rent))}/mês)`,
    })
    onSaved()
  }

  async function downloadContract() {
    if (!existingLease?.contract_file_path) return
    await openStorageDocument(supabase, existingLease.contract_file_path)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-semibold text-lg text-gray-900">Contrato de Arrendamento</h2>
            <p className="text-sm text-gray-500">{tenant.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4">

          {/* Upload do contrato — no topo para fazer OCR primeiro */}
          <div>
            <label className="label">Contrato (PDF)</label>
            {existingLease?.contract_file_path && !contractFile && (
              <button onClick={downloadContract}
                className="flex items-center gap-2 text-sm text-emerald-600 hover:underline mb-2">
                <FileText className="w-4 h-4" />
                Ver contrato atual
              </button>
            )}
            <label
              {...contractDrop.dropProps}
              className={`flex items-center gap-3 border-2 border-dashed rounded-lg p-4 cursor-pointer transition-colors ${
              contractDrop.isDragging ? 'border-emerald-500 bg-emerald-50' :
              processingOCR ? 'border-blue-300 bg-blue-50' :
              ocrDone ? 'border-emerald-400 bg-emerald-50' :
              'border-gray-200 hover:border-emerald-400'
            }`}>
              {processingOCR ? (
                <Loader2 className="w-5 h-5 text-blue-500 animate-spin flex-shrink-0" />
              ) : ocrDone ? (
                <Sparkles className="w-5 h-5 text-emerald-500 flex-shrink-0" />
              ) : (
                <Upload className={`w-5 h-5 flex-shrink-0 ${contractDrop.isDragging ? 'text-emerald-500' : 'text-gray-400'}`} />
              )}
              <div>
                {processingOCR && (
                  <p className="text-sm text-blue-600 font-medium">A ler contrato com IA...</p>
                )}
                {ocrDone && (
                  <p className="text-sm text-emerald-600 font-medium">✓ Dados extraídos automaticamente!</p>
                )}
                {!processingOCR && !ocrDone && (
                  <p className="text-sm text-gray-600">
                    {contractDrop.isDragging ? 'Larga aqui o contrato'
                      : contractFile ? contractFile.name
                      : 'Arrasta para aqui ou clica para fazer upload do contrato'}
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-0.5">
                  {processingOCR ? 'A preencher os campos abaixo...' :
                   ocrDone ? contractFile?.name :
                   'PDF — os campos serão preenchidos automaticamente pela IA'}
                </p>
              </div>
              <input type="file" accept=".pdf" className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) handleFileChange(f)
                }} />
            </label>
          </div>

          <div>
            <label className="label">Espaço *</label>
            <select className="input" value={form.space_id}
              onChange={e => setForm(f => ({ ...f, space_id: e.target.value }))}>
              <option value="">Selecionar espaço...</option>
              {spaces.map(s => (
                <option key={s.id} value={s.id}>{s.ref} — {s.type}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Renda Mensal (€) *</label>
              <input className="input" type="number" placeholder="0.00" value={form.monthly_rent}
                onChange={e => setForm(f => ({ ...f, monthly_rent: e.target.value }))} />
            </div>
            <div>
              <label className="label">Caução / Sinal (€)</label>
              <input className="input" type="number" placeholder="0.00" value={form.deposit}
                onChange={e => setForm(f => ({ ...f, deposit: e.target.value }))} />
            </div>
          </div>

          {/* Aviso de alteração de renda */}
          {existingLease && originalRent !== '' && form.monthly_rent !== originalRent && form.monthly_rent !== '' && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
              <p className="text-sm font-medium text-amber-800">
                Alteracao de renda: {formatCurrency(parseFloat(originalRent || '0'))} para {formatCurrency(parseFloat(form.monthly_rent || '0'))}
              </p>
              <div>
                <label className="label text-amber-700">Aplicar a partir de *</label>
                <input
                  className="input border-amber-300 focus:ring-amber-400"
                  type="date"
                  value={rentChangeDate}
                  onChange={e => setRentChangeDate(e.target.value)}
                />
                <p className="text-xs text-amber-600 mt-1">
                  Meses anteriores a esta data mantem a renda atual ({formatCurrency(parseFloat(originalRent || '0'))})
                </p>
              </div>
            </div>
          )}

          {/* Historico de rendas */}
          {rentHistory.length > 0 && (
            <div>
              <label className="label">Historico de rendas</label>
              <div className="space-y-1">
                {rentHistory.map((h, i) => (
                  <div key={h.id} className="flex justify-between items-center text-sm py-1.5 px-3 rounded-lg bg-gray-50 border border-gray-100">
                    <span className="text-gray-600">{getMonthLabel(h.effective_date)}</span>
                    <span className={`font-medium ${i === 0 ? 'text-emerald-700' : 'text-gray-500'}`}>{formatCurrency(h.monthly_rent)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Data de Inicio *</label>
              <input className="input" type="date" value={form.start_date}
                onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
            </div>
            <div>
              <label className="label">Data de Fim</label>
              <input className="input" type="date" value={form.end_date}
                onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="label">Estado do Contrato</label>
            <select className="input" value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              <option value="ativo">Ativo</option>
              <option value="terminado">Terminado</option>
            </select>
          </div>

          <div>
            <label className="label">Notas</label>
            <textarea className="input" rows={2} value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving || processingOCR}>
            {saving ? 'A guardar...' : 'Guardar'}
                </button>
        </div>
      </div>
    </div>
  )
}
