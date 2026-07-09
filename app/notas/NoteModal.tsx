'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase-client'
import { X, Search, Bell, BellOff } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

interface NoteModalProps {
  note?: any
  onClose: () => void
  onSaved: () => void
}

const NOTE_TYPES = [
  { value: 'chamada', label: '📞 Chamada telefónica' },
  { value: 'geral', label: '🏡 Geral da quinta' },
  { value: 'lembrete', label: '⏰ Lembrete' },
  { value: 'outro', label: '📝 Outro' },
]

export default function NoteModal({ note, onClose, onSaved }: NoteModalProps) {
  const supabase = createClient()
  const { profile } = useAuth()

  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const timeStr = now.toTimeString().slice(0, 5)

  const [title, setTitle] = useState(note?.title ?? '')
  const [description, setDescription] = useState(note?.description ?? '')
  const [type, setType] = useState(note?.type ?? 'geral')
  const [noteDate, setNoteDate] = useState(note?.note_date ?? todayStr)
  const [noteTime, setNoteTime] = useState(note?.note_time?.slice(0, 5) ?? timeStr)
  const [spaceId, setSpaceId] = useState(note?.space_id ?? '')
  const [tenantId, setTenantId] = useState(note?.tenant_id ?? '')
  const [hasReminder, setHasReminder] = useState(note?.has_reminder ?? false)
  const [reminderDate, setReminderDate] = useState(note?.reminder_date ?? todayStr)
  const [reminderTime, setReminderTime] = useState(note?.reminder_time?.slice(0, 5) ?? '09:00')
  const [saving, setSaving] = useState(false)

  const [spaces, setSpaces] = useState<any[]>([])
  const [spaceSearch, setSpaceSearch] = useState('')
  const [showSpaceDropdown, setShowSpaceDropdown] = useState(false)
  const spaceRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchSpaces()
    function handleClick(e: MouseEvent) {
      if (spaceRef.current && !spaceRef.current.contains(e.target as Node)) {
        setShowSpaceDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function fetchSpaces() {
    const { data } = await supabase
      .from('spaces')
      .select('id, ref, status, leases(id, status, tenant:tenants(id, name))')
      .order('ref')

    const spacesData = (data ?? []) as any[]
    setSpaces(spacesData)

    if (note?.space_id && spacesData.length > 0) {
      const found = spacesData.find((s: any) => s.id === note.space_id)
      if (found) {
        const activeLease = (found.leases ?? []).find((l: any) => l.status === 'ativo')
        const tenantName = activeLease?.tenant?.name ?? ''
        const label = `${found.ref}${tenantName ? ` — ${tenantName}` : ''}`
        setSpaceSearch(label)
      }
    }
  }

  const filteredSpaces = spaces.filter((s: any) => {
    if (!spaceSearch || spaceId) return true
    const activeLease = (s.leases ?? []).find((l: any) => l.status === 'ativo')
    const tenantName = activeLease?.tenant?.name ?? ''
    const label = `${s.ref} ${tenantName}`.toLowerCase()
    return label.includes(spaceSearch.toLowerCase())
  })

  function selectSpace(space: any) {
    const activeLease = (space.leases ?? []).find((l: any) => l.status === 'ativo')
    const tenant = activeLease?.tenant
    const label = `${space.ref}${tenant ? ` — ${tenant.name}` : ''}`
    setSpaceId(space.id)
    setTenantId(tenant?.id ?? '')
    setSpaceSearch(label)
    setShowSpaceDropdown(false)
  }

  function clearSpace() {
    setSpaceId('')
    setTenantId('')
    setSpaceSearch('')
  }

  async function handleSave() {
    if (!title.trim()) return
    setSaving(true)
    try {
      const payload: any = {
        title: title.trim(),
        description: description.trim() || null,
        type,
        note_date: noteDate,
        note_time: noteTime,
        space_id: spaceId || null,
        tenant_id: tenantId || null,
        has_reminder: hasReminder,
        reminder_date: hasReminder ? reminderDate : null,
        reminder_time: hasReminder ? reminderTime : '09:00',
        dismissed: false,
      }

      if (!note?.id) {
        // Só define created_by na criação
        payload.created_by = profile?.id ?? null
      }

      if (note?.id) {
        await supabase.from('notes').update(payload).eq('id', note.id)
      } else {
        await supabase.from('notes').insert(payload)
      }
      onSaved()
    } catch (e) {
      console.error(e)
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-lg text-gray-900">
            {note ? 'Editar Nota' : 'Nova Nota'}
          </h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="space-y-4">

          {/* Título */}
          <div>
            <label className="label">Título <span className="text-red-500">*</span></label>
            <input className="input" placeholder="Título da nota..."
              value={title} onChange={e => setTitle(e.target.value)} />
          </div>

          {/* Tipo */}
          <div>
            <label className="label">Tipo</label>
            <div className="grid grid-cols-2 gap-2">
              {NOTE_TYPES.map(t => (
                <button key={t.value} onClick={() => setType(t.value)}
                  className={`py-2 px-3 rounded-lg border text-sm font-medium text-left transition-colors ${type === t.value ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Data e Hora */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Data</label>
              <input type="date" className="input" value={noteDate} onChange={e => setNoteDate(e.target.value)} />
            </div>
            <div>
              <label className="label">Hora</label>
              <input type="time" className="input" value={noteTime} onChange={e => setNoteTime(e.target.value)} />
            </div>
          </div>

          {/* Espaço — autocomplete */}
          <div>
            <label className="label">Espaço / Inquilino <span className="text-xs text-gray-400">(opcional)</span></label>
            <div className="relative" ref={spaceRef}>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  className="input pl-8 pr-8"
                  placeholder="Pesquisar espaço ou inquilino..."
                  value={spaceSearch}
                  onChange={e => {
                    setSpaceSearch(e.target.value)
                    setSpaceId('')
                    setTenantId('')
                    setShowSpaceDropdown(true)
                  }}
                  onFocus={() => setShowSpaceDropdown(true)}
                />
                {spaceSearch && (
                  <button onClick={clearSpace}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {showSpaceDropdown && filteredSpaces.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {filteredSpaces.map((space: any) => {
                    const activeLease = (space.leases ?? []).find((l: any) => l.status === 'ativo')
                    const tenant = activeLease?.tenant
                    return (
                      <div key={space.id} onClick={() => selectSpace(space)}
                        className="flex items-center justify-between px-3 py-2.5 hover:bg-emerald-50 cursor-pointer border-b border-gray-50 last:border-0">
                        <span className="text-sm font-medium text-gray-800">{space.ref}</span>
                        {tenant ? (
                          <span className="text-sm text-gray-500">{tenant.name}</span>
                        ) : (
                          <span className="text-xs text-gray-300">disponível</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Descrição */}
          <div>
            <label className="label">Descrição <span className="text-xs text-gray-400">(opcional)</span></label>
            <textarea className="input min-h-[80px] resize-none" placeholder="Detalhes da nota..."
              value={description} onChange={e => setDescription(e.target.value)} />
          </div>

          {/* Lembrete */}
          <div className="border border-gray-200 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {hasReminder ? <Bell className="w-4 h-4 text-emerald-600" /> : <BellOff className="w-4 h-4 text-gray-400" />}
                <span className="text-sm font-medium text-gray-700">Lembrete</span>
              </div>
              <button onClick={() => setHasReminder((v: boolean) => !v)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${hasReminder ? 'bg-emerald-600' : 'bg-gray-200'}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${hasReminder ? 'translate-x-4' : 'translate-x-1'}`} />
              </button>
            </div>

            {hasReminder && (
              <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-gray-100">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Dia do lembrete</label>
                  <input type="date" className="input text-sm" value={reminderDate}
                    onChange={e => setReminderDate(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Hora (default 09:00)</label>
                  <input type="time" className="input text-sm" value={reminderTime}
                    onChange={e => setReminderTime(e.target.value)} />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving || !title.trim()}>
            {saving ? 'A guardar...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
