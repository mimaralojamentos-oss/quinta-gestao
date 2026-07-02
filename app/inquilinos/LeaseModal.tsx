'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Tenant, Lease, Space } from '@/lib/types'
import { X, Upload, FileText, Loader2, Sparkles } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { logAccess } from '@/lib/logAccess'

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
        setForm({
          space_id: leaseData.space_id,
          monthly_rent: String(leaseData.monthly_rent),
          deposit: String(leaseData.deposit ?? ''),
          start_date: leaseData.start_date,
          end_date: leaseData.end_date ?? '',
          notes: leaseData.notes ?? '',
          status: leaseData.status,
        })
      }
    }
    load()
  }, [tenant.id])

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
      const safeName = contractFile.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_')
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

    let err
    if (existingLease) {
      ;({ error: err } = await supabase.from('leases').update(payload).eq('id', existingLease.id))
    } else {
      ;({ error: err } = await supabase.from('leases').insert(payload))
      if (!err) {
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
    const { data } = await supabase.storage.from('documents').createSignedUrl(existingLease.contract_file_path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
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
            <label className={`flex items-center gap-3 border-2 border-dashed rounded-lg p-4 cursor-pointer transition-colors ${
              processingOCR ? 'border-blue-300 bg-blue-50' :
              ocrDone ? 'border-emerald-400 bg-emerald-50' :
              'border-gray-200 hover:border-emerald-400'
            }`}>
              {processingOCR ? (
                <Loader2 className="w-5 h-5 text-blue-500 animate-spin flex-shrink-0" />
              ) : ocrDone ? (
                <Sparkles className="w-5 h-5 text-emerald-500 flex-shrink-0" />
              ) : (
                <Upload className="w-5 h-5 text-gray-400 flex-shrink-0" />
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
                    {contractFile ? contractFile.name : 'Clique para fazer upload do contrato'}
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Data de Início *</label>
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
