'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatDate } from '@/lib/utils'
import { Plus, Edit2, Trash2, Bell, BellOff, CheckCircle, NotebookPen, User, Send, MessageSquare } from 'lucide-react'
import NoteModal from './NoteModal'
import { useAuth } from '@/lib/auth-context'

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
  const { profile } = useAuth()
  const [notes, setNotes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editNote, setEditNote] = useState<any>(null)
  const [filterType, setFilterType] = useState<string>('all')
  const [expandedNote, setExpandedNote] = useState<string | null>(null)
  const [comments, setComments] = useState<Record<string, any[]>>({})
  const [newComment, setNewComment] = useState<Record<string, string>>({})
  const [savingComment, setSavingComment] = useState<string | null>(null)

  useEffect(() => { fetchNotes() }, [])

  async function fetchNotes() {
    setLoading(true)
    const { data } = await supabase
      .from('notes')
      .select('*, space:spaces(ref), tenant:tenants(name), creator:profiles!notes_created_by_fkey(name)')
      .eq('dismissed', false)
      .order('note_date', { ascending: false })
      .order('note_time', { ascending: false })
    setNotes(data ?? [])
    setLoading(false)
  }

  async function fetchComments(noteId: string) {
    const { data } = await supabase
      .from('note_comments')
      .select('*, author:profiles!note_comments_created_by_fkey(name)')
      .eq('note_id', noteId)
      .order('created_at', { ascending: true })
    setComments(prev => ({ ...prev, [noteId]: data ?? [] }))
  }

  async function handleAddComment(noteId: string) {
    const content = newComment[noteId]?.trim()
    if (!content) return
    setSavingComment(noteId)
    await supabase.from('note_comments').insert({
      note_id: noteId,
      content,
      created_by: profile?.id,
    })
    setNewComment(prev => ({ ...prev, [noteId]: '' }))
    await fetchComments(noteId)
    setSavingComment(null)
  }

  async function handleDeleteComment(noteId: string, commentId: string) {
    if (!confirm('Apagar este comentário?')) return
    await supabase.from('note_comments').delete().eq('id', commentId)
    fetchComments(noteId)
  }

  function toggleExpand(noteId: string) {
    if (expandedNote === noteId) {
      setExpandedNote(null)
    } else {
      setExpandedNote(noteId)
      fetchComments(noteId)
    }
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

  const isOwner = (note: any) => note.created_by === profile?.id

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
              const isExpanded = expandedNote === note.id
              const noteComments = comments[note.id] ?? []
              const canEdit = isOwner(note)

              return (
                <div key={note.id}
                  className={`bg-white border rounded-xl shadow-sm transition-colors ${isReminderPending ? 'border-yellow-300 bg-yellow-50/30' : 'border-gray-100'}`}>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {/* Badges */}
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

                        {/* Rodapé: criador + data */}
                        <div className="flex items-center gap-3 mt-2">
                          <div className="flex items-center gap-1 text-xs text-gray-400">
                            <User className="w-3 h-3" />
                            <span>{note.creator?.name ?? '—'}</span>
                          </div>
                          <span className="text-xs text-gray-300">·</span>
                          <span className="text-xs text-gray-400">
                            {formatDate(note.note_date)} às {note.note_time?.slice(0, 5)}
                          </span>
                        </div>
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
                        {/* Só o criador pode editar/dispensar/apagar */}
                        {canEdit && (
                          <>
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
                          </>
                        )}
                        {/* Botão comentários — todos podem ver/adicionar */}
                        <button onClick={() => toggleExpand(note.id)}
                          title="Comentários"
                          className={`p-1.5 rounded-lg transition-colors flex items-center gap-1 ${isExpanded ? 'bg-emerald-50 text-emerald-600' : 'text-gray-400 hover:text-emerald-500 hover:bg-emerald-50'}`}>
                          <MessageSquare className="w-4 h-4" />
                          {noteComments.length > 0 && (
                            <span className="text-xs font-medium">{noteComments.length}</span>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Secção de comentários */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 px-4 pb-4 pt-3">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Comentários</p>

                      {/* Lista de comentários */}
                      {noteComments.length === 0 ? (
                        <p className="text-xs text-gray-400 mb-3">Ainda sem comentários.</p>
                      ) : (
                        <div className="space-y-2 mb-3">
                          {noteComments.map(c => (
                            <div key={c.id} className="flex items-start gap-2">
                              <div className="w-6 h-6 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                                <span className="text-xs font-bold text-emerald-700">
                                  {c.author?.name?.charAt(0).toUpperCase() ?? '?'}
                                </span>
                              </div>
                              <div className="flex-1 min-w-0 bg-gray-50 rounded-lg px-3 py-2">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-medium text-gray-700">{c.author?.name ?? '—'}</span>
                                  <span className="text-xs text-gray-400">
                                    {new Date(c.created_at).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                                <p className="text-sm text-gray-600 mt-0.5">{c.content}</p>
                              </div>
                              {/* Só o autor do comentário pode apagar */}
                              {c.created_by === profile?.id && (
                                <button onClick={() => handleDeleteComment(note.id, c.id)}
                                  className="p-1 text-gray-300 hover:text-red-400 transition-colors flex-shrink-0 mt-1">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Caixa de novo comentário */}
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-emerald-700">
                            {profile?.name?.charAt(0).toUpperCase() ?? '?'}
                          </span>
                        </div>
                        <input
                          className="input text-sm flex-1"
                          placeholder="Escreve um comentário..."
                          value={newComment[note.id] ?? ''}
                          onChange={e => setNewComment(prev => ({ ...prev, [note.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') handleAddComment(note.id) }}
                        />
                        <button
                          onClick={() => handleAddComment(note.id)}
                          disabled={!newComment[note.id]?.trim() || savingComment === note.id}
                          className="p-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40 transition-colors flex-shrink-0">
                          <Send className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
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
