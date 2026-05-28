'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { X } from 'lucide-react'

interface Props {
  project: any | null
  onClose: () => void
  onSaved: () => void
}

export default function ProjectModal({ project, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    name: project?.name ?? '',
    type: project?.type ?? 'construcao',
    status: project?.status ?? 'em_curso',
    location_type: project?.is_general ? 'geral' : project?.space_id ? 'espaco' : 'livre',
    space_id: project?.space_id ?? '',
    is_general: project?.is_general ?? false,
    location_label: project?.location_label ?? '',
    budget: project?.budget ? String(project.budget) : '',
    start_date: project?.start_date ?? '',
    end_date_planned: project?.end_date_planned ?? '',
    description: project?.description ?? '',
    notes: project?.notes ?? '',
  })
  const [spaces, setSpaces] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function fetchSpaces() {
      const { data } = await supabase.from('spaces').select('id, ref, type').order('ref')
      setSpaces(data ?? [])
    }
    fetchSpaces()
  }, [])

  function setLocationType(type: string) {
    setForm(f => ({
      ...f,
      location_type: type,
      is_general: type === 'geral',
      space_id: type !== 'espaco' ? '' : f.space_id,
      location_label: type !== 'livre' ? '' : f.location_label,
    }))
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('O nome é obrigatório'); return }
    setSaving(true); setError('')

    const payload = {
      name: form.name.trim(),
      type: form.type,
      status: form.status,
      space_id: form.location_type === 'espaco' ? (form.space_id || null) : null,
      is_general: form.location_type === 'geral',
      location_label: form.location_type === 'livre' ? (form.location_label || null) : null,
      budget: form.budget ? parseFloat(form.budget) : null,
      start_date: form.start_date || null,
      end_date_planned: form.end_date_planned || null,
      description: form.description || null,
      notes: form.notes || null,
    }

    let err
    if (project) {
      ;({ error: err } = await supabase.from('projects').update(payload).eq('id', project.id))
    } else {
      ;({ error: err } = await supabase.from('projects').insert(payload))
    }

    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-lg text-gray-900">
            {project ? 'Editar Projeto' : 'Novo Projeto'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">Nome do Projeto *</label>
            <input className="input" placeholder="ex: Construção H21-B" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Tipo *</label>
              <select className="input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                <option value="construcao">🏗️ Construção</option>
                <option value="renovacao">🔨 Renovação</option>
                <option value="arranjo">🔧 Arranjo</option>
                <option value="outro">📦 Outro</option>
              </select>
            </div>
            <div>
              <label className="label">Estado *</label>
              <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                <option value="em_curso">🟢 Em curso</option>
                <option value="pausado">⏸️ Pausado</option>
                <option value="concluido">✅ Concluído</option>
              </select>
            </div>
          </div>

          {/* Localização — 3 opções */}
          <div>
            <label className="label">Localização</label>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <button
                onClick={() => setLocationType('espaco')}
                className={`py-2 rounded-lg border text-xs font-medium transition-colors ${form.location_type === 'espaco' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                📍 Espaço existente
              </button>
              <button
                onClick={() => setLocationType('livre')}
                className={`py-2 rounded-lg border text-xs font-medium transition-colors ${form.location_type === 'livre' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                🏗️ Local em construção
              </button>
              <button
                onClick={() => setLocationType('geral')}
                className={`py-2 rounded-lg border text-xs font-medium transition-colors ${form.location_type === 'geral' ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                🏡 Geral — Quinta
              </button>
            </div>

            {form.location_type === 'espaco' && (
              <select className="input" value={form.space_id}
                onChange={e => setForm(f => ({ ...f, space_id: e.target.value }))}>
                <option value="">— Seleciona o espaço —</option>
                {spaces.map(s => (
                  <option key={s.id} value={s.id}>{s.ref} — {s.type}</option>
                ))}
              </select>
            )}

            {form.location_type === 'livre' && (
              <input className="input" placeholder="ex: H21-B (em construção), Terreno Norte..."
                value={form.location_label}
                onChange={e => setForm(f => ({ ...f, location_label: e.target.value }))} />
            )}

            {form.location_type === 'geral' && (
              <p className="text-xs text-purple-600 mt-1">Este projeto aplica-se a toda a quinta.</p>
            )}
          </div>

          <div>
            <label className="label">Orçamento (€)</label>
            <input className="input" type="number" step="0.01" placeholder="0.00" value={form.budget}
              onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Data de Início</label>
              <input className="input" type="date" value={form.start_date}
                onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
            </div>
            <div>
              <label className="label">Fim Previsto</label>
              <input className="input" type="date" value={form.end_date_planned}
                onChange={e => setForm(f => ({ ...f, end_date_planned: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="label">Descrição</label>
            <textarea className="input" rows={2} placeholder="Descreve o projeto..." value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>

          <div>
            <label className="label">Notas</label>
            <textarea className="input" rows={2} placeholder="Observações..." value={form.notes}
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
