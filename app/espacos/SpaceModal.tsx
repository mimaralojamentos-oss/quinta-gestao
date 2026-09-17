'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Space } from '@/lib/types'
import { X } from 'lucide-react'

interface Tenant {
  id: string
  name: string
}

interface Props {
  space: Space | null
  onClose: () => void
  onSaved: () => void
}

/** Contrato ativo mais recente do espaço — é ele que define a ocupação. */
interface ContratoAtivo {
  tenant_id: string
  tenant_name: string | null
}

async function contratoAtivoDoEspaco(spaceId: string): Promise<{ contrato: ContratoAtivo | null; erro: string | null }> {
  const { data, error } = await supabase
    .from('leases').select('tenant_id, start_date, tenant:tenants(name)')
    .eq('space_id', spaceId).eq('status', 'ativo')
    .order('start_date', { ascending: false })
  if (error) return { contrato: null, erro: error.message }
  const l = (data ?? [])[0] as any
  return { contrato: l ? { tenant_id: l.tenant_id, tenant_name: l.tenant?.name ?? null } : null, erro: null }
}

export default function SpaceModal({ space, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    ref: space?.ref ?? '',
    type: space?.type ?? 'pavilhao',
    status: space?.status ?? 'disponivel',
    condition: space?.condition ?? '',
    notes: space?.notes ?? '',
    tenant_id: (space as any)?.tenant_id ?? '',
  })
  const [tenants, setTenants] = useState<Tenant[]>([])
  // Com contrato ativo, o estado e o inquilino seguem o contrato e não se editam aqui.
  const [contrato, setContrato] = useState<ContratoAtivo | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function carregar() {
      const { data } = await supabase
        .from('tenants')
        .select('id, name')
        .order('name')
      setTenants(data ?? [])

      if (space) {
        const { contrato: ativo } = await contratoAtivoDoEspaco(space.id)
        if (ativo) {
          setContrato(ativo)
          // Mostra (e grava) a ocupação do contrato, mesmo que o espaço estivesse incoerente.
          setForm(f => ({ ...f, status: 'arrendado', tenant_id: ativo.tenant_id }))
        }
      }
    }
    carregar()
  }, [])

  async function handleSave() {
    if (!form.ref.trim()) { setError('A referência é obrigatória'); return }
    setSaving(true)
    setError('')

    // Os contratos mandam na ocupação: confirma no momento de gravar (e não só
    // no que foi carregado ao abrir a janela).
    if (space) {
      const { contrato: ativo, erro } = await contratoAtivoDoEspaco(space.id)
      if (erro) { setSaving(false); setError(`Não foi possível confirmar os contratos do espaço: ${erro}`); return }
      if (ativo && (form.status !== 'arrendado' || form.tenant_id !== ativo.tenant_id)) {
        setSaving(false)
        setError(
          `Este espaço tem um contrato ativo${ativo.tenant_name ? ` de ${ativo.tenant_name}` : ''} — não pode ficar disponível nem com outro inquilino. ` +
          'Para o libertar, termina o contrato (Inquilinos → botão "Contrato" → Estado: Terminado).'
        )
        return
      }
    }

    const payload = {
      ref: form.ref.trim().toUpperCase(),
      type: form.type,
      status: form.status,
      condition: form.condition || null,
      notes: form.notes || null,
      tenant_id: form.tenant_id || null,
    }
    let err
    if (space) {
      ;({ error: err } = await supabase.from('spaces').update(payload).eq('id', space.id))
    } else {
      ;({ error: err } = await supabase.from('spaces').insert(payload))
    }
    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved()
  }

  const ocupacaoManual = !contrato && (form.status === 'arrendado' || !!form.tenant_id)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-lg text-gray-900">{space ? 'Editar Espaço' : 'Novo Espaço'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Referência *</label>
              <input className="input" placeholder="ex: P01, H33" value={form.ref}
                onChange={e => setForm(f => ({ ...f, ref: e.target.value }))} />
            </div>
            <div>
              <label className="label">Tipo *</label>
              <select className="input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as any }))}>
                <option value="pavilhao">Pavilhão</option>
                <option value="habitacao">Habitação</option>
                <option value="loja">Loja</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Estado</label>
              <select className="input" value={form.status} disabled={!!contrato}
                onChange={e => setForm(f => ({ ...f, status: e.target.value as any }))}>
                <option value="disponivel">Disponível</option>
                <option value="arrendado">Arrendado</option>
              </select>
            </div>
            <div>
              <label className="label">Inquilino associado</label>
              <select className="input" value={form.tenant_id} disabled={!!contrato}
                onChange={e => setForm(f => ({ ...f, tenant_id: e.target.value }))}>
                <option value="">— Sem inquilino —</option>
                {tenants.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>
          {contrato && (
            <p className="text-xs text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
              Ocupação definida pelo contrato ativo{contrato.tenant_name ? ` de ${contrato.tenant_name}` : ''}. Para libertar o
              espaço, termina o contrato em Inquilinos → botão &quot;Contrato&quot; → Estado: Terminado.
            </p>
          )}
          {ocupacaoManual && (
            <p className="text-xs text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
              ℹ️ Sem contrato ativo na app — a ocupação fica marcada à mão (ex.: uso próprio da família).
            </p>
          )}
          <div>
            <label className="label">Condição do espaço</label>
            <input className="input" placeholder="ex: ótimo estado, precisa de obras..." value={form.condition}
              onChange={e => setForm(f => ({ ...f, condition: e.target.value }))} />
          </div>
          <div>
            <label className="label">Notas</label>
            <textarea className="input" rows={3} placeholder="Observações gerais..." value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'A guardar...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
