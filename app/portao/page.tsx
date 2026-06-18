'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Plus, Trash2, Send, MessageSquare, Check, X, Search } from 'lucide-react'

interface GatePhone {
  id: string
  phone: string
  name: string | null
  space: string | null
  activation_date: string | null
  active: boolean
  notes: string | null
}

interface SmsLog {
  id: string
  message: string
  recipients: any[]
  sent_by: string
  sent_at: string
  status: string
}

// ✅ FORA do componente principal — evita recriação a cada render
const CellInput = ({ value, onChange, type = 'text', placeholder = '' }: {
  value: string | null | undefined
  onChange: (v: string) => void
  type?: string
  placeholder?: string
}) => (
  <input
    type={type}
    value={value ?? ''}
    onChange={e => onChange(e.target.value)}
    placeholder={placeholder}
    className="w-full px-2 py-1 text-sm border border-emerald-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-emerald-50"
  />
)

export default function PortaoPage() {
  const [phones, setPhones] = useState<GatePhone[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<GatePhone>>({})
  const [saving, setSaving] = useState(false)

  // SMS
  const [tab, setTab] = useState<'lista' | 'sms' | 'historico'>('lista')
  const [smsMessage, setSmsMessage] = useState('')
  const [selectedPhones, setSelectedPhones] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ sent: number; errors: number } | null>(null)
  const [smsLog, setSmsLog] = useState<SmsLog[]>([])
  const [loadingLog, setLoadingLog] = useState(false)

  // Nova linha
  const [showNewRow, setShowNewRow] = useState(false)
  const [newForm, setNewForm] = useState({ phone: '', name: '', space: '', activation_date: '', notes: '' })

  useEffect(() => { fetchPhones() }, [])

  async function fetchPhones() {
    setLoading(true)
    const { data } = await supabase.from('gate_phones').select('*').order('name')
    setPhones(data ?? [])
    setLoading(false)
  }

  async function fetchLog() {
    setLoadingLog(true)
    const { data } = await supabase.from('sms_log').select('*').order('sent_at', { ascending: false }).limit(50)
    setSmsLog(data ?? [])
    setLoadingLog(false)
  }

  function startEdit(phone: GatePhone) {
    setEditingId(phone.id)
    setEditForm({ ...phone })
  }

  async function saveEdit() {
    if (!editingId) return
    setSaving(true)
    await supabase.from('gate_phones').update({
      phone: editForm.phone,
      name: editForm.name || null,
      space: editForm.space || null,
      activation_date: editForm.activation_date || null,
      active: editForm.active,
      notes: editForm.notes || null,
    }).eq('id', editingId)
    setSaving(false)
    setEditingId(null)
    fetchPhones()
  }

  function cancelEdit() {
    setEditingId(null)
    setEditForm({})
  }

  async function deletePhone(id: string) {
    if (!confirm('Apagar este número?')) return
    await supabase.from('gate_phones').delete().eq('id', id)
    fetchPhones()
  }

  async function saveNewRow() {
    if (!newForm.phone) return
    setSaving(true)
    await supabase.from('gate_phones').insert({
      phone: newForm.phone,
      name: newForm.name || null,
      space: newForm.space || null,
      activation_date: newForm.activation_date || null,
      notes: newForm.notes || null,
      active: true,
    })
    setSaving(false)
    setShowNewRow(false)
    setNewForm({ phone: '', name: '', space: '', activation_date: '', notes: '' })
    fetchPhones()
  }

  function toggleSelectPhone(id: string) {
    setSelectedPhones(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    )
  }

  function selectAll() {
    const filtered = phones.filter(p => p.active && matchesSearch(p))
    if (selectedPhones.length === filtered.length) {
      setSelectedPhones([])
    } else {
      setSelectedPhones(filtered.map(p => p.id))
    }
  }

  function matchesSearch(p: GatePhone) {
    if (!search) return true
    const s = search.toLowerCase()
    return (
      p.phone.includes(s) ||
      (p.name ?? '').toLowerCase().includes(s) ||
      (p.space ?? '').toLowerCase().includes(s)
    )
  }

  async function sendSms() {
    if (!smsMessage.trim() || selectedPhones.length === 0) return
    setSending(true)
    setSendResult(null)

    const recipients = phones
      .filter(p => selectedPhones.includes(p.id))
      .map(p => ({ phone: p.phone, name: p.name }))

    const res = await fetch('/api/send-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: smsMessage, recipients }),
    })
    const data = await res.json()
    setSendResult({ sent: data.sent ?? 0, errors: data.errors ?? 0 })
    setSending(false)
    if (data.sent > 0) {
      setSmsMessage('')
      setSelectedPhones([])
    }
  }

  const filteredPhones = phones.filter(matchesSearch)
  const activePhones = filteredPhones.filter(p => p.active)
  const inactivePhones = filteredPhones.filter(p => !p.active)

  return (
    <AppLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Portão</h1>
            <p className="text-sm text-gray-500 mt-1">{phones.filter(p => p.active).length} números ativos · {phones.length} total</p>
          </div>
          <button
            onClick={() => setShowNewRow(true)}
            className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700">
            <Plus className="w-4 h-4" /> Novo Número
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
          <button onClick={() => setTab('lista')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'lista' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            Lista de Acessos
          </button>
          <button onClick={() => setTab('sms')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'sms' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <Send className="w-4 h-4" /> Enviar SMS
          </button>
          <button onClick={() => { setTab('historico'); fetchLog() }}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'historico' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <MessageSquare className="w-4 h-4" /> Histórico SMS
          </button>
        </div>

        {/* TAB: LISTA */}
        {tab === 'lista' && (
          <>
            <div className="flex items-center gap-3 mb-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="Pesquisar nome, número, espaço..."
                  value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>

            {loading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
              </div>
            ) : (
              <>
              <div className="hidden lg:block bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Telefone</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Nome</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Espaço</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Ativação</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Notas</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Estado</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {/* Nova linha */}
                    {showNewRow && (
                      <tr className="bg-emerald-50">
                        <td className="px-4 py-2"><CellInput value={newForm.phone} onChange={(v) => setNewForm(f => ({ ...f, phone: v }))} placeholder="9XXXXXXXXX" /></td>
                        <td className="px-4 py-2"><CellInput value={newForm.name} onChange={(v) => setNewForm(f => ({ ...f, name: v }))} placeholder="Nome" /></td>
                        <td className="px-4 py-2"><CellInput value={newForm.space} onChange={(v) => setNewForm(f => ({ ...f, space: v }))} placeholder="P01" /></td>
                        <td className="px-4 py-2"><CellInput value={newForm.activation_date} onChange={(v) => setNewForm(f => ({ ...f, activation_date: v }))} type="date" /></td>
                        <td className="px-4 py-2"><CellInput value={newForm.notes} onChange={(v) => setNewForm(f => ({ ...f, notes: v }))} placeholder="Notas" /></td>
                        <td className="px-4 py-2"></td>
                        <td className="px-4 py-2">
                          <div className="flex gap-1">
                            <button onClick={saveNewRow} disabled={saving || !newForm.phone}
                              className="p-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50">
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setShowNewRow(false)}
                              className="p-1.5 bg-gray-200 text-gray-600 rounded hover:bg-gray-300">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}

                    {activePhones.map(phone => (
                      <tr key={phone.id} className={`hover:bg-gray-50 transition-colors ${editingId === phone.id ? 'bg-emerald-50' : ''}`}>
                        {editingId === phone.id ? (
                          <>
                            <td className="px-4 py-2"><CellInput value={editForm.phone} onChange={(v) => setEditForm(f => ({ ...f, phone: v }))} /></td>
                            <td className="px-4 py-2"><CellInput value={editForm.name} onChange={(v) => setEditForm(f => ({ ...f, name: v }))} /></td>
                            <td className="px-4 py-2"><CellInput value={editForm.space} onChange={(v) => setEditForm(f => ({ ...f, space: v }))} /></td>
                            <td className="px-4 py-2"><CellInput value={editForm.activation_date} onChange={(v) => setEditForm(f => ({ ...f, activation_date: v }))} type="date" /></td>
                            <td className="px-4 py-2"><CellInput value={editForm.notes} onChange={(v) => setEditForm(f => ({ ...f, notes: v }))} /></td>
                            <td className="px-4 py-2">
                              <select value={editForm.active ? 'true' : 'false'}
                                onChange={e => setEditForm(f => ({ ...f, active: e.target.value === 'true' }))}
                                className="text-xs border border-emerald-300 rounded px-2 py-1 bg-emerald-50">
                                <option value="true">Ativo</option>
                                <option value="false">Inativo</option>
                              </select>
                            </td>
                            <td className="px-4 py-2">
                              <div className="flex gap-1">
                                <button onClick={saveEdit} disabled={saving}
                                  className="p-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50">
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={cancelEdit}
                                  className="p-1.5 bg-gray-200 text-gray-600 rounded hover:bg-gray-300">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-3 font-mono text-gray-700 cursor-pointer hover:text-emerald-600" onClick={() => startEdit(phone)}>{phone.phone}</td>
                            <td className="px-4 py-3 text-gray-800 cursor-pointer hover:text-emerald-600" onClick={() => startEdit(phone)}>{phone.name ?? <span className="text-gray-300">—</span>}</td>
                            <td className="px-4 py-3 cursor-pointer" onClick={() => startEdit(phone)}>
                              {phone.space ? <span className="bg-emerald-100 text-emerald-700 text-xs font-medium px-2 py-0.5 rounded-full">{phone.space}</span> : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-4 py-3 text-gray-500 text-xs cursor-pointer" onClick={() => startEdit(phone)}>
                              {phone.activation_date ? new Date(phone.activation_date).toLocaleDateString('pt-PT') : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-4 py-3 text-gray-500 text-xs cursor-pointer max-w-[150px] truncate" onClick={() => startEdit(phone)}>{phone.notes ?? <span className="text-gray-300">—</span>}</td>
                            <td className="px-4 py-3">
                              <span className="bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded-full">Ativo</span>
                            </td>
                            <td className="px-4 py-3">
                              <button onClick={() => deletePhone(phone.id)}
                                className="p-1.5 text-gray-300 hover:text-red-500 transition-colors">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}

                    {inactivePhones.length > 0 && (
                      <>
                        <tr className="bg-gray-50">
                          <td colSpan={7} className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                            Inativos ({inactivePhones.length})
                          </td>
                        </tr>
                        {inactivePhones.map(phone => (
                          <tr key={phone.id} className={`opacity-50 hover:opacity-75 transition-opacity ${editingId === phone.id ? 'bg-emerald-50 opacity-100' : ''}`}>
                            {editingId === phone.id ? (
                              <>
                                <td className="px-4 py-2"><CellInput value={editForm.phone} onChange={(v) => setEditForm(f => ({ ...f, phone: v }))} /></td>
                                <td className="px-4 py-2"><CellInput value={editForm.name} onChange={(v) => setEditForm(f => ({ ...f, name: v }))} /></td>
                                <td className="px-4 py-2"><CellInput value={editForm.space} onChange={(v) => setEditForm(f => ({ ...f, space: v }))} /></td>
                                <td className="px-4 py-2"><CellInput value={editForm.activation_date} onChange={(v) => setEditForm(f => ({ ...f, activation_date: v }))} type="date" /></td>
                                <td className="px-4 py-2"><CellInput value={editForm.notes} onChange={(v) => setEditForm(f => ({ ...f, notes: v }))} /></td>
                                <td className="px-4 py-2">
                                  <select value={editForm.active ? 'true' : 'false'}
                                    onChange={e => setEditForm(f => ({ ...f, active: e.target.value === 'true' }))}
                                    className="text-xs border border-emerald-300 rounded px-2 py-1 bg-emerald-50">
                                    <option value="true">Ativo</option>
                                    <option value="false">Inativo</option>
                                  </select>
                                </td>
                                <td className="px-4 py-2">
                                  <div className="flex gap-1">
                                    <button onClick={saveEdit} disabled={saving}
                                      className="p-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50">
                                      <Check className="w-3.5 h-3.5" />
                                    </button>
                                    <button onClick={cancelEdit}
                                      className="p-1.5 bg-gray-200 text-gray-600 rounded hover:bg-gray-300">
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="px-4 py-3 font-mono text-gray-700 cursor-pointer" onClick={() => startEdit(phone)}>{phone.phone}</td>
                                <td className="px-4 py-3 text-gray-800 cursor-pointer" onClick={() => startEdit(phone)}>{phone.name ?? <span className="text-gray-300">—</span>}</td>
                                <td className="px-4 py-3 cursor-pointer" onClick={() => startEdit(phone)}>
                                  {phone.space ? <span className="bg-gray-100 text-gray-500 text-xs font-medium px-2 py-0.5 rounded-full">{phone.space}</span> : <span className="text-gray-300">—</span>}
                                </td>
                                <td className="px-4 py-3 text-gray-500 text-xs cursor-pointer" onClick={() => startEdit(phone)}>
                                  {phone.activation_date ? new Date(phone.activation_date).toLocaleDateString('pt-PT') : <span className="text-gray-300">—</span>}
                                </td>
                                <td className="px-4 py-3 text-gray-500 text-xs cursor-pointer max-w-[150px] truncate" onClick={() => startEdit(phone)}>{phone.notes ?? <span className="text-gray-300">—</span>}</td>
                                <td className="px-4 py-3">
                                  <span className="bg-gray-100 text-gray-500 text-xs font-medium px-2 py-0.5 rounded-full">Inativo</span>
                                </td>
                                <td className="px-4 py-3">
                                  <button onClick={() => deletePhone(phone.id)}
                                    className="p-1.5 text-gray-300 hover:text-red-500 transition-colors">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                      </>
                    )}

                    {filteredPhones.length === 0 && !showNewRow && (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-gray-400 text-sm">Nenhum número encontrado</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {/* Vista mobile */}
              <div className="lg:hidden bg-white rounded-xl border border-gray-100 shadow-sm divide-y divide-gray-100">
                {showNewRow && (
                  <div className="p-4 bg-emerald-50 space-y-2">
                    <p className="text-xs font-semibold text-emerald-700 mb-2">Novo número</p>
                    <CellInput value={newForm.phone} onChange={(v) => setNewForm(f => ({ ...f, phone: v }))} placeholder="9XXXXXXXXX" />
                    <CellInput value={newForm.name} onChange={(v) => setNewForm(f => ({ ...f, name: v }))} placeholder="Nome" />
                    <CellInput value={newForm.space} onChange={(v) => setNewForm(f => ({ ...f, space: v }))} placeholder="Espaço (ex: P01)" />
                    <div className="flex gap-2 mt-2">
                      <button onClick={saveNewRow} disabled={saving || !newForm.phone}
                        className="flex-1 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                        {saving ? 'A guardar...' : 'Guardar'}
                      </button>
                      <button onClick={() => setShowNewRow(false)}
                        className="flex-1 py-2 bg-gray-200 text-gray-600 rounded-lg text-sm">
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
                {filteredPhones.map(phone => (
                  <div key={phone.id} className={`p-4 ${!phone.active ? 'opacity-50' : ''}`}>
                    {editingId === phone.id ? (
                      <div className="space-y-2">
                        <CellInput value={editForm.phone} onChange={(v) => setEditForm(f => ({ ...f, phone: v }))} />
                        <CellInput value={editForm.name} onChange={(v) => setEditForm(f => ({ ...f, name: v }))} placeholder="Nome" />
                        <CellInput value={editForm.space} onChange={(v) => setEditForm(f => ({ ...f, space: v }))} placeholder="Espaço" />
                        <select value={editForm.active ? 'true' : 'false'}
                          onChange={e => setEditForm(f => ({ ...f, active: e.target.value === 'true' }))}
                          className="w-full text-sm border border-emerald-300 rounded px-2 py-1.5 bg-emerald-50">
                          <option value="true">Ativo</option>
                          <option value="false">Inativo</option>
                        </select>
                        <div className="flex gap-2 mt-2">
                          <button onClick={saveEdit} disabled={saving}
                            className="flex-1 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                            {saving ? 'A guardar...' : 'Guardar'}
                          </button>
                          <button onClick={cancelEdit}
                            className="flex-1 py-2 bg-gray-200 text-gray-600 rounded-lg text-sm">
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-mono text-gray-800 font-medium">{phone.phone}</p>
                          <p className="text-sm text-gray-600">{phone.name ?? '—'}</p>
                          <div className="flex items-center gap-2 mt-1">
                            {phone.space && <span className="bg-emerald-100 text-emerald-700 text-xs font-medium px-2 py-0.5 rounded-full">{phone.space}</span>}
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${phone.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                              {phone.active ? 'Ativo' : 'Inativo'}
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <button onClick={() => startEdit(phone)} className="text-xs text-emerald-600 font-medium hover:underline">Editar</button>
                          <button onClick={() => deletePhone(phone.id)} className="text-xs text-red-500 font-medium hover:underline">Apagar</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {filteredPhones.length === 0 && !showNewRow && (
                  <div className="py-12 text-center text-gray-400 text-sm">Nenhum número encontrado</div>
                )}
              </div>
              </>
            )}
          </>
        )}

        {/* TAB: SMS */}
        {tab === 'sms' && (
          <div className="max-w-3xl">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-4">
              <h2 className="font-semibold text-gray-900 mb-4">Mensagem</h2>
              <textarea
                className="w-full border border-gray-200 rounded-lg p-3 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-none"
                rows={4}
                placeholder="Escreve a mensagem SMS aqui..."
                value={smsMessage}
                onChange={e => setSmsMessage(e.target.value)}
              />
              <div className="flex items-center justify-between mt-2">
                <p className="text-xs text-gray-400">{smsMessage.length} caracteres {smsMessage.length > 160 ? '⚠️ mais de 1 SMS' : ''}</p>
                <p className="text-xs text-gray-400">{selectedPhones.length} destinatário(s) selecionado(s)</p>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900">Destinatários</h2>
                <button onClick={selectAll}
                  className="text-xs text-emerald-600 hover:underline font-medium">
                  {selectedPhones.length === phones.filter(p => p.active).length ? 'Desselecionar todos' : 'Selecionar todos os ativos'}
                </button>
              </div>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="Pesquisar..."
                  value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <div className="max-h-80 overflow-y-auto space-y-1">
                {phones.filter(p => p.active && matchesSearch(p)).map(phone => (
                  <label key={phone.id}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${selectedPhones.includes(phone.id) ? 'bg-emerald-50 border border-emerald-200' : 'hover:bg-gray-50 border border-transparent'}`}>
                    <input type="checkbox"
                      checked={selectedPhones.includes(phone.id)}
                      onChange={() => toggleSelectPhone(phone.id)}
                      className="accent-emerald-600 w-4 h-4" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">{phone.name ?? <span className="text-gray-400">Sem nome</span>}</p>
                      <p className="text-xs text-gray-500">{phone.phone}{phone.space ? ` · ${phone.space}` : ''}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {sendResult && (
              <div className={`p-4 rounded-lg mb-4 ${sendResult.errors === 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-orange-50 border border-orange-200'}`}>
                <p className="text-sm font-medium">
                  {sendResult.errors === 0
                    ? `✅ ${sendResult.sent} SMS enviado(s) com sucesso!`
                    : `⚠️ ${sendResult.sent} enviado(s), ${sendResult.errors} erro(s)`}
                </p>
              </div>
            )}

            <button
              onClick={sendSms}
              disabled={sending || !smsMessage.trim() || selectedPhones.length === 0}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white py-3 rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed">
              {sending ? (
                <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> A enviar...</>
              ) : (
                <><Send className="w-4 h-4" /> Enviar {selectedPhones.length > 0 ? `para ${selectedPhones.length} número(s)` : 'SMS'}</>
              )}
            </button>
          </div>
        )}

        {/* TAB: HISTÓRICO */}
        {tab === 'historico' && (
          <div className="max-w-3xl">
            {loadingLog ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
              </div>
            ) : smsLog.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <MessageSquare className="w-10 h-10 mx-auto mb-2 text-gray-200" />
                <p>Ainda não foram enviados SMS</p>
              </div>
            ) : (
              <div className="space-y-3">
                {smsLog.map(log => (
                  <div key={log.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                    <div className="flex items-start justify-between mb-2">
                      <p className="text-sm font-medium text-gray-800 flex-1">{log.message}</p>
                      <span className={`ml-3 text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                        log.status === 'success' ? 'bg-emerald-100 text-emerald-700'
                        : log.status === 'failed' ? 'bg-red-100 text-red-700'
                        : 'bg-orange-100 text-orange-700'
                      }`}>
                        {log.status === 'success' ? '✓ Enviado' : log.status === 'failed' ? '✗ Falhou' : '⚠ Parcial'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      <span>{new Date(log.sent_at).toLocaleString('pt-PT')}</span>
                      <span>·</span>
                      <span>{Array.isArray(log.recipients) ? log.recipients.length : 0} destinatário(s)</span>
                    </div>
                    {Array.isArray(log.recipients) && log.recipients.length > 0 && (
                      <p className="text-xs text-gray-400 mt-1 truncate">
                        {log.recipients.map((r: any) => r.name ?? r.phone).join(', ')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
