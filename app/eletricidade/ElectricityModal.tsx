'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { X } from 'lucide-react'

interface Props {
  onClose: () => void
  onSaved: () => void
}

export default function ElectricityModal({ onClose, onSaved }: Props) {
  const [leases, setLeases] = useState<any[]>([])
  const [spaces, setSpaces] = useState<any[]>([])
  const [mode, setMode] = useState<'charge' | 'reading'>('charge')
  const [form, setForm] = useState({
    lease_id: '',
    space_id: '',
    charge_date: new Date().toISOString().slice(0, 10),
    reference_month: new Date().toISOString().slice(0, 8) + '01',
    units: '',
    amount: '',
    reading_value: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const { data: l } = await supabase.from('leases').select('id, space:spaces(ref), tenant:tenants(name)').eq('status', 'ativo')
      const { data: s } = await supabase.from('spaces').select('*').order('ref')
      setLeases(l ?? [])
      setSpaces(s ?? [])
    }
    load()
  }, [])

  async function handleSave() {
    setSaving(true); setError('')

    if (mode === 'charge') {
      if (!form.lease_id || !form.amount) { setError('Arrendamento e valor são obrigatórios'); setSaving(false); return }
      const { error: err } = await supabase.from('electricity_charges').insert({
        lease_id: form.lease_id,
        charge_date: form.charge_date,
        reference_month: form.reference_month,
        units: form.units ? parseFloat(form.units) : null,
        amount: parseFloat(form.amount),
        paid: false,
        notes: form.notes || null,
      })
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      if (!form.space_id || !form.reading_value) { setError('Espaço e leitura são obrigatórios'); setSaving(false); return }
      const { error: err } = await supabase.from('electricity_readings').insert({
        space_id: form.space_id,
        reading_date: form.charge_date,
        reading_value: parseFloat(form.reading_value),
        notes: form.notes || null,
      })
      if (err) { setError(err.message); setSaving(false); return }
    }

    setSaving(false)
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-lg text-gray-900">Registar Eletricidade</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="flex gap-2 mb-5">
          {['charge', 'reading'].map(m => (
            <button key={m} onClick={() => setMode(m as any)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium ${mode === m ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
              {m === 'charge' ? 'Cobrança a Inquilino' : 'Leitura de Contador'}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {mode === 'charge' ? (
            <>
              <div>
                <label className="label">Inquilino / Espaço *</label>
                <select className="input" value={form.lease_id} onChange={e => setForm(f => ({ ...f, lease_id: e.target.value }))}>
                  <option value="">Selecionar...</option>
                  {leases.map(l => (
                    <option key={l.id} value={l.id}>{l.space?.ref} — {l.tenant?.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">kWh consumidos</label>
                  <input className="input" type="number" value={form.units}
                    onChange={e => setForm(f => ({ ...f, units: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Valor a cobrar (€) *</label>
                  <input className="input" type="number" step="0.01" value={form.amount}
                    onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="label">Mês de referência</label>
                <input className="input" type="month" value={form.reference_month.slice(0, 7)}
                  onChange={e => setForm(f => ({ ...f, reference_month: e.target.value + '-01' }))} />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="label">Espaço *</label>
                <select className="input" value={form.space_id} onChange={e => setForm(f => ({ ...f, space_id: e.target.value }))}>
                  <option value="">Selecionar...</option>
                  {spaces.map(s => (
                    <option key={s.id} value={s.id}>{s.ref}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Leitura do contador (kWh) *</label>
                <input className="input" type="number" step="0.001" value={form.reading_value}
                  onChange={e => setForm(f => ({ ...f, reading_value: e.target.value }))} />
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Data</label>
              <input className="input" type="date" value={form.charge_date}
                onChange={e => setForm(f => ({ ...f, charge_date: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="label">Notas</label>
            <input className="input" value={form.notes}
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
