'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatDate } from '@/lib/utils'
import { Plus, Edit2, Trash2, Bell, BellOff, CheckCircle, NotebookPen } from 'lucide-react'
import NoteModal from './NoteModal'

const NOTE_TYPE_LABELS: Record<string, string> = {
  chamada: '📞 Chamada',
  geral: '🏡 Geral',
  lembrete: '⏰ Lembrete',
  outro: '📝 Outro',
}

const NOTE_TYPE_COLORS: Record<string, string> = {
  chamada: 'bg-blue-100 text-blue-700',
  geral: 'bg-emerald-100 text-emerald-700',
  lembrete: 'bg-yellow-100 text-yellow-700',
  outro: 'bg-gray-100 text-gray-600',
}

export default function NotasPage() {
  const supabase = createClient()
  const [notes, setNotes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editNote, setEditNote] = useState<any>(null)
  const [filterType, setFilterType] = useState<string>('all')

  useEffect(() => { fetchNotes() }, [])

  async function fetchNotes() {
    setLoading(true)
    const { data } = await supabase
      .from('notes')
      .select('*, space:spaces(ref), tenant:tenants(name)')
      .eq('dismissed', false)
      .order('note_date', { ascending: false })
      .order('note_time', { ascending: false })
    setNotes(data ?? [])
    setLoading(false)
  }

  async function handleDismiss(id: string) {
    if (!confirm('Marcar esta nota como dispensada? Deixará de aparecer na lista.')) return
    await supabase.from('notes').update({ dismissed: true, dismissed_at: new Date().toISOString() }).eq('id', id)
    fetchNotes()
  }

  async function handleMarkSeen(id: string) {
    await supabase.from('notes').update({
      reminder_seen_at: new Date().toISOString(),
    }).eq('id', id)
    fetchNotes()
  }

  async function handleDelete(id: string) {
    if (!confirm('Apagar esta nota permanentemente?')) return
    await supabase.from('notes').delete().eq('id', id)
    fetchNotes()
  }

  const filtered = notes.filter(n => filterType === 'all' || n.type === filterType)

  const todayStr = new Date().toISOString().slice(0, 10)
  const pendingReminders = notes.filter(n =>
    n.has_reminder && !n.reminder_seen_at && n.reminder_date <= todayStr
  ).length

  return (
    <AppLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <NotebookPen className="w-6 h-6 text-emerald-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Notas</h1>
              <p className="text-sm text-gray-500 mt-0.5">{notes.length} nota(s) ativa(s)</p>
            </div>
          </div>
          <button onClick={() => { setEditNote(null); setShowModal(true) }} className="btn-primary">
            <Plus className="w-4 h-4" /> Nova Nota
          </button>
        </div>

        {/* Alerta de lembretes pendentes */}
        {pendingReminders > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-5 flex items-center gap-3">
            <Bell className="w-5 h-5 text-yellow-500 flex-shrink-0" />
            <p className="text-sm text-yellow-800 font-medium">
              Tens {pendingReminders} lembrete(s) por ver hoje ou em atraso!
            </p>
          </div>
        )}

        {/* Filtros por tipo */}
        <div className="flex flex-wrap gap-2 mb-5">
          {[
            { key: 'all', label: 'Todas' },
            { key: 'chamada', label: '📞 Chamadas' },
            { key: 'geral', label: '🏡 Geral' },
            { key: 'lembrete', label: '⏰ Lembretes' },
            { key: 'outro', label: '📝 Outro' },
          ].map(f => (
            <button key={f.key} onClick={() => setFilterType(f.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterType === f.key ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Lista de notas */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <NotebookPen className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Nenhuma nota encontrada.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(note => {
              const isReminderPending = note.has_reminder && !note.reminder_seen_at && note.reminder_date <= todayStr
              const isReminderFuture = note.has_reminder && !note.reminder_seen_at && note.reminder_date > todayStr
              const isReminderSeen = note.has_reminder && note.reminder_seen_at

              return (
                <div key={note.id}
                  className={`bg-white border rounded-xl p-4 shadow-sm transition-colors ${isReminderPending ? 'border-yellow-300 bg-yellow-50/30' : 'border-gray-100'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {/* Cabeçalho */}
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${NOTE_TYPE_COLORS[note.type] ?? 'bg-gray-100 text-gray-600'}`}>
                          {NOTE_TYPE_LABELS[note.type] ?? note.type}
                        </span>
                        {note.space?.ref && (
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                            {note.space.ref}{note.tenant?.name ? ` — ${note.tenant.name}` : ''}
                          </span>
                        )}
                        {isReminderPending && (
                          <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                            <Bell className="w-3 h-3" /> Lembrete pendente
                          </span>
                        )}
                        {isReminderFuture && (
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Bell className="w-3 h-3" /> {formatDate(note.reminder_date)} às {note.reminder_time?.slice(0, 5)}
                          </span>
                        )}
                        {isReminderSeen && (
                          <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" /> Visto
                          </span>
                        )}
                      </div>

                      {/* Título */}
                      <h3 className="text-sm font-semibold text-gray-900">{note.title}</h3>

                      {/* Descrição */}
                      {note.description && (
                        <p className="text-sm text-gray-500 mt-1 whitespace-pre-line">{note.description}</p>
                      )}

                      {/* Data/hora */}
                      <p className="text-xs text-gray-400 mt-2">
                        {formatDate(note.note_date)} às {note.note_time?.slice(0, 5)}
                      </p>
                    </div>

                    {/* Ações */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {isReminderPending && (
                        <button onClick={() => handleMarkSeen(note.id)}
                          title="Marcar lembrete como visto"
                          className="p-1.5 text-yellow-500 hover:bg-yellow-50 rounded-lg transition-colors">
                          <CheckCircle className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => { setEditNote(note); setShowModal(true) }}
                        title="Editar"
                        className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDismiss(note.id)}
                        title="Dispensar"
                        className="p-1.5 text-gray-400 hover:text-orange-500 hover:bg-orange-50 rounded-lg transition-colors">
                        <BellOff className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(note.id)}
                        title="Apagar"
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showModal && (
        <NoteModal
          note={editNote}
          onClose={() => { setShowModal(false); setEditNote(null) }}
          onSaved={() => { setShowModal(false); setEditNote(null); fetchNotes() }}
        />
      )}
    </AppLayout>
  )
}
