'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatDate } from '@/lib/utils'
import { Plus, Edit2, Trash2, Bell, BellOff, CheckCircle, NotebookPen, User, Send, MessageSquare, X, Archive, ArchiveRestore } from 'lucide-react'
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

// miguelseverino é sempre vermelho
const USER_COLORS: Record<string, { bg: string; border: string; avatar: string; text: string }> = {
  miguelseverino: { bg: 'bg-red-50', border: 'border-red-200', avatar: 'bg-red-500', text: 'text-red-700' },
}

const COLOR_PALETTE = [
  { bg: 'bg-blue-50', border: 'border-blue-200', avatar: 'bg-blue-500', text: 'text-blue-700' },
  { bg: 'bg-emerald-50', border: 'border-emerald-200', avatar: 'bg-emerald-500', text: 'text-emerald-700' },
  { bg: 'bg-purple-50', border: 'border-purple-200', avatar: 'bg-purple-500', text: 'text-purple-700' },
  { bg: 'bg-orange-50', border: 'border-orange-200', avatar: 'bg-orange-500', text: 'text-orange-700' },
  { bg: 'bg-teal-50', border: 'border-teal-200', avatar: 'bg-teal-500', text: 'text-teal-700' },
  { bg: 'bg-pink-50', border: 'border-pink-200', avatar: 'bg-pink-500', text: 'text-pink-700' },
]

function getUserColor(name: string) {
  const normalized = name?.toLowerCase().replace(/\s/g, '') ?? ''
  if (USER_COLORS[normalized]) return USER_COLORS[normalized]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const index = Math.abs(hash) % COLOR_PALETTE.length
  return COLOR_PALETTE[index]
}

export default function NotasPage() {
  const supabase = createClient()
  const { profile } = useAuth()
  const [notes, setNotes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editNote, setEditNote] = useState<any>(null)
  const [filterType, setFilterType] = useState<string>('all')
  const [showArchived, setShowArchived] = useState(false)
  const [expandedNote, setExpandedNote] = useState<string | null>(null)
  const [comments, setComments] = useState<Record<string, any[]>>({})
  const [newComment, setNewComment] = useState<Record<string, string>>({})
  const [savingComment, setSavingComment] = useState<string | null>(null)
  const [editingComment, setEditingComment] = useState<string | null>(null)
  const [editingCommentText, setEditingCommentText] = useState<string>('')
  const [savingEditComment, setSavingEditComment] = useState(false)

  useEffect(() => { fetchNotes() }, [showArchived])

  async function fetchNotes() {
    setLoading(true)
    const { data } = await supabase
      .from('notes')
      .select('*, space:spaces(ref), tenant:tenants(name), creator:profiles!notes_created_by_fkey(name)')
      .eq('dismissed', false)
      .eq('archived', showArchived)
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

  function startEditComment(comment: any) {
    setEditingComment(comment.id)
    setEditingCommentText(comment.content)
  }

  function cancelEditComment() {
    setEditingComment(null)
    setEditingCommentText('')
  }

  async function handleSaveEditComment(noteId: string, commentId: string) {
    const content = editingCommentText.trim()
    if (!content) return
    setSavingEditComment(true)
    await supabase.from('note_comments').update({ content }).eq('id', commentId)
    setEditingComment(null)
    setEditingCommentText('')
    await fetchComments(noteId)
    setSavingEditComment(false)
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
    await supabase.from('notes').update({ reminder_seen_at: new Date().toISOString() }).eq('id', id)
    fetchNotes()
  }

  async function handleDelete(id: string) {
    if (!confirm('Apagar esta nota permanentemente?')) return
    await supabase.from('notes').delete().eq('id', id)
    fetchNotes()
  }

  async function handleArchive(id: string) {
    await supabase.from('notes').update({ archived: true }).eq('id', id)
    fetchNotes()
  }

  async function handleRestore(id: string) {
    await supabase.from('notes').update({ archived: false }).eq('id', id)
    fetchNotes()
  }

  // CORRIGIDO: o filtro "Lembretes" mostra notas do tipo lembrete
  // E também qualquer nota que tenha um lembrete associado (has_reminder = true)
  const filtered = notes.filter(n => {
    if (filterType === 'all') return true
    if (filterType === 'lembrete') return n.type === 'lembrete' || n.has_reminder === true
    return n.type === filterType
  })

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
              <p className="text-sm text-gray-500 mt-0.5">{notes.length} nota(s) {showArchived ? 'arquivada(s)' : 'ativa(s)'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowArchived(v => !v)} className="btn-secondary">
              {showArchived ? <NotebookPen className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
              {showArchived ? 'Notas ativas' : 'Notas arquivadas'}
            </button>
            <button onClick={() => { setEditNote(null); setShowModal(true) }} className="btn-primary">
              <Plus className="w-4 h-4" /> Nova Nota
            </button>
          </div>
        </div>

        {pendingReminders > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-5 flex items-center gap-3">
            <Bell className="w-5 h-5 text-yellow-500 flex-shrink-0" />
            <p className="text-sm text-yellow-800 font-medium">
              Tens {pendingReminders} lembrete(s) por ver hoje ou em atraso!
            </p>
          </div>
        )}

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

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <NotebookPen className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">{showArchived ? 'Nenhuma nota arquivada.' : 'Nenhuma nota encontrada.'}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(note => {
              const creatorColors = getUserColor(note.creator?.name ?? '')
              const isReminderPending = note.has_reminder && !note.reminder_seen_at && note.reminder_date <= todayStr
              const isReminderFuture = note.has_reminder && !note.reminder_seen_at && note.reminder_date > todayStr
              const isReminderSeen = note.has_reminder && note.reminder_seen_at
              const isExpanded = expandedNote === note.id
              const noteComments = comments[note.id] ?? []
              const canEdit = isOwner(note)

              return (
                <div key={note.id}
                  className={`border rounded-xl shadow-sm transition-colors ${creatorColors.bg} ${creatorColors.border} ${isReminderPending ? 'ring-2 ring-yellow-300' : ''}`}>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${NOTE_TYPE_COLORS[note.type] ?? 'bg-gray-100 text-gray-600'}`}>
                            {NOTE_TYPE_LABELS[note.type] ?? note.type}
                          </span>
                          {note.space?.ref && (
                            <span className="text-xs bg-white/70 text-gray-600 px-2 py-0.5 rounded-full border border-white">
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
                            <span className="text-xs bg-white/70 text-gray-400 px-2 py-0.5 rounded-full flex items-center gap-1">
                              <CheckCircle className="w-3 h-3" /> Visto
                            </span>
                          )}
                        </div>

                        <h3 className="text-sm font-semibold text-gray-900">{note.title}</h3>

                        {note.description && (
                          <p className="text-sm text-gray-600 mt-1 whitespace-pre-line">{note.description}</p>
                        )}

                        <div className="flex items-center gap-3 mt-2">
                          <div className={`flex items-center gap-1.5 text-xs font-medium ${creatorColors.text}`}>
                            <div className={`w-4 h-4 ${creatorColors.avatar} rounded-full flex items-center justify-center`}>
                              <span className="text-white" style={{ fontSize: '9px', fontWeight: 'bold' }}>
                                {note.creator?.name?.charAt(0).toUpperCase() ?? '?'}
                              </span>
                            </div>
                            <span>{note.creator?.name ?? '—'}</span>
                          </div>
                          <span className="text-xs text-gray-400">·</span>
                          <span className="text-xs text-gray-500">
                            {formatDate(note.note_date)} às {note.note_time?.slice(0, 5)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 flex-shrink-0">
                        {isReminderPending && (
                          <button onClick={() => handleMarkSeen(note.id)}
                            title="Marcar lembrete como visto"
                            className="p-1.5 text-yellow-500 hover:bg-yellow-100 rounded-lg transition-colors">
                            <CheckCircle className="w-4 h-4" />
                          </button>
                        )}
                        {canEdit && (
                          <>
                            <button onClick={() => { setEditNote(note); setShowModal(true) }}
                              title="Editar"
                              className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-white/50 rounded-lg transition-colors">
                              <Edit2 className="w-4 h-4" />
                            </button>
                            {showArchived ? (
                              <button onClick={() => handleRestore(note.id)}
                                title="Restaurar"
                                className="p-1.5 text-gray-400 hover:text-emerald-500 hover:bg-white/50 rounded-lg transition-colors">
                                <ArchiveRestore className="w-4 h-4" />
                              </button>
                            ) : (
                              <button onClick={() => handleArchive(note.id)}
                                title="Arquivar"
                                className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-white/50 rounded-lg transition-colors">
                                <Archive className="w-4 h-4" />
                              </button>
                            )}
                            <button onClick={() => handleDismiss(note.id)}
                              title="Dispensar"
                              className="p-1.5 text-gray-400 hover:text-orange-500 hover:bg-white/50 rounded-lg transition-colors">
                              <BellOff className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleDelete(note.id)}
                              title="Apagar"
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-white/50 rounded-lg transition-colors">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        <button onClick={() => toggleExpand(note.id)}
                          title="Comentários"
                          className={`p-1.5 rounded-lg transition-colors flex items-center gap-1 ${isExpanded ? 'bg-white/50 text-emerald-600' : 'text-gray-400 hover:text-emerald-500 hover:bg-white/50'}`}>
                          <MessageSquare className="w-4 h-4" />
                          {noteComments.length > 0 && (
                            <span className="text-xs font-medium">{noteComments.length}</span>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className={`border-t px-4 pb-4 pt-3 ${creatorColors.border}`}>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Comentários</p>

                      {noteComments.length === 0 ? (
                        <p className="text-xs text-gray-400 mb-3">Ainda sem comentários.</p>
                      ) : (
                        <div className="space-y-2 mb-3">
                          {noteComments.map(c => {
                            const colors = getUserColor(c.author?.name ?? '')
                            return (
                              <div key={c.id} className="flex items-start gap-2">
                                <div className={`w-7 h-7 ${colors.avatar} rounded-full flex items-center justify-center flex-shrink-0 mt-0.5`}>
                                  <span className="text-xs font-bold text-white">
                                    {c.author?.name?.charAt(0).toUpperCase() ?? '?'}
                                  </span>
                                </div>
                                <div className={`flex-1 min-w-0 border rounded-lg px-3 py-2 ${colors.bg} ${colors.border}`}>
                                  <div className="flex items-center justify-between gap-2 mb-0.5">
                                    <span className={`text-xs font-semibold ${colors.text}`}>{c.author?.name ?? '—'}</span>
                                    <span className="text-xs text-gray-400">
                                      {new Date(c.created_at).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  </div>

                                  {editingComment === c.id ? (
                                    <div className="mt-1">
                                      <textarea
                                        className="input text-sm w-full min-h-[60px] resize-none"
                                        value={editingCommentText}
                                        onChange={e => setEditingCommentText(e.target.value)}
                                        autoFocus
                                      />
                                      <div className="flex gap-2 mt-2">
                                        <button
                                          onClick={() => handleSaveEditComment(note.id, c.id)}
                                          disabled={!editingCommentText.trim() || savingEditComment}
                                          className="text-xs bg-emerald-600 text-white px-3 py-1 rounded-lg hover:bg-emerald-700 disabled:opacity-40 transition-colors">
                                          {savingEditComment ? 'A guardar...' : 'Guardar'}
                                        </button>
                                        <button onClick={cancelEditComment}
                                          className="text-xs bg-gray-100 text-gray-600 px-3 py-1 rounded-lg hover:bg-gray-200 transition-colors">
                                          Cancelar
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <p className="text-sm text-gray-700">{c.content}</p>
                                  )}
                                </div>

                                {c.created_by === profile?.id && editingComment !== c.id && (
                                  <div className="flex flex-col gap-1 flex-shrink-0 mt-0.5">
                                    <button onClick={() => startEditComment(c)}
                                      title="Editar comentário"
                                      className="p-1 text-gray-300 hover:text-blue-400 transition-colors">
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button onClick={() => handleDeleteComment(note.id, c.id)}
                                      title="Apagar comentário"
                                      className="p-1 text-gray-300 hover:text-red-400 transition-colors">
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                )}
                                {editingComment === c.id && (
                                  <button onClick={cancelEditComment}
                                    className="p-1 text-gray-300 hover:text-gray-500 transition-colors flex-shrink-0 mt-0.5">
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 ${getUserColor(profile?.name ?? '').avatar} rounded-full flex items-center justify-center flex-shrink-0`}>
                          <span className="text-xs font-bold text-white">
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
