'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, Trash2, X, Search, FileText, TrendingUp } from 'lucide-react'

interface IncomeRecord {
  id: string
  description: string
  amount: number
  income_date: string
  category: string
  notes: string | null
  created_at: string
  document_id: string | null
  document?: { id: string; file_url: string | null; original_filename: string | null } | null
}

const CATEGORIES = [
  { value: 'energia_solar', label: '☀️ Energia Solar' },
  { value: 'arrendamento_comercial', label: '🏢 Arrendamento Comercial' },
  { value: 'subsidio', label: '💶 Subsídio / Apoio' },
  { value: 'indemnizacao', label: '⚖️ Indemnização' },
  { value: 'venda_ativo', label: '📦 Venda de Ativo' },
  { value: 'outros', label: '💰 Outros' },
]

function categoryLabel(cat: string) {
  return CATEGORIES.find(c => c.value === cat)?.label ?? cat
}

export default function ReceitasPage() {
  const supabase = createClient()
  const [records, setRecords] = useState<IncomeRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterYear, setFilterYear] = useState(new Date().getFullYear().toString())
  const [showModal, setShowModal] = useState(false)
  const [editRecord, setEditRecord] = useState<IncomeRecord | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    description: '',
    amount: '',
    income_date: new Date().toISOString().slice(0, 10),
    category: 'outros',
    notes: '',
  })

  async function fetchData() {
    setLoading(true)
    const { data } = await supabase
      .from('income_records')
      .select('*, document:document_id(id, file_url, original_filename)')
      .order('income_date', { ascending: false })
    setRecords(data ?? [])
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [])

  function openNew() {
    setEditRecord(null)
    setForm({ description: '', amount: '', income_date: new Date().toISOString().slice(0, 10), category: 'outros', notes: '' })
    setShowModal(true)
  }

  function openEdit(r: IncomeRecord) {
    setEditRecord(r)
    setForm({ description: r.description, amount: String(r.amount), income_date: r.income_date, category: r.category, notes: r.notes ?? '' })
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.description || !form.amount || !form.income_date) return
    setSaving(true)
    const payload = {
      description: form.description,
      amount: parseFloat(form.amount),
      income_date: form.income_date,
      category: form.category,
      notes: form.notes || null,
    }
    if (editRecord) {
      await supabase.from('income_records').update(payload).eq('id', editRecord.id)
    } else {
      await supabase.from('income_records').insert(payload)
    }
    setSaving(false)
    setShowModal(false)
    fetchData()
  }

  async function handleDelete(id: string) {
    await supabase.from('income_records').delete().eq('id', id)
    setDeleteId(null)
    fetchData()
  }

  const years = Array.from(new Set(records.map(r => r.income_date.slice(0, 4)))).sort((a, b) => b.localeCompare(a))
  if (!years.includes(new Date().getFullYear().toString())) years.unshift(new Date().getFullYear().toString())

  const filtered = records.filter(r => {
    const matchSearch = !search || r.description.toLowerCase().includes(search.toLowerCase()) || (r.notes ?? '').toLowerCase().includes(search.toLowerCase())
    const matchCat = filterCategory === 'all' || r.category === filterCategory
    const matchYear = filterYear === 'all' || r.income_date.startsWith(filterYear)
    return matchSearch && matchCat && matchYear
  })

  const total = filtered.reduce((s, r) => s + r.amount, 0)

  return (
    <AppLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Receitas Extraordinárias</h1>
              <p className="text-sm text-gray-500">Receitas que não são rendas (energia solar, subsídios, etc.)</p>
            </div>
          </div>
          <button onClick={openNew} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> Nova Receita
          </button>
        </div>

        {/* Sumário */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center justify-between">
          <span className="text-sm text-emerald-700 font-medium">Total {filterYear !== 'all' ? filterYear : ''} {filterCategory !== 'all' ? `· ${categoryLabel(filterCategory)}` : ''}</span>
          <span className="text-2xl font-bold text-emerald-700">{formatCurrency(total)}</span>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9 w-full" placeholder="Pesquisar..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="input w-40" value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
            <option value="all">Todas as categorias</option>
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <select className="input w-28" value={filterYear} onChange={e => setFilterYear(e.target.value)}>
            <option value="all">Todos os anos</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {/* Tabela */}
        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <TrendingUp className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Sem receitas registadas</p>
            <p className="text-sm mt-1">Clica em "Nova Receita" para adicionar</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="table-header text-left">Data</th>
                  <th className="table-header text-left">Descrição</th>
                  <th className="table-header text-left">Categoria</th>
                  <th className="table-header text-right">Valor</th>
                  <th className="table-header text-right">Doc.</th>
                  <th className="table-header"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => openEdit(r)}>
                    <td className="table-cell text-gray-500 whitespace-nowrap">{formatDate(r.income_date)}</td>
                    <td className="table-cell font-medium text-gray-900">
                      {r.description}
                      {r.notes && <p className="text-xs text-gray-400 font-normal mt-0.5 truncate max-w-xs">{r.notes}</p>}
                    </td>
                    <td className="table-cell"><span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">{categoryLabel(r.category)}</span></td>
                    <td className="table-cell text-right font-semibold text-emerald-700">{formatCurrency(r.amount)}</td>
                    <td className="table-cell text-right">
                      {r.document?.file_url ? (
                        <a href={r.document.file_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                          className="text-blue-500 hover:text-blue-700">
                          <FileText className="w-4 h-4" />
                        </a>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="table-cell text-right">
                      <button onClick={e => { e.stopPropagation(); setDeleteId(r.id) }}
                        className="text-gray-300 hover:text-red-500 p-1 rounded">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal novo/editar */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">{editRecord ? 'Editar Receita' : 'Nova Receita Extraordinária'}</h2>
              <button onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-gray-100"><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="label">Descrição *</label>
                <input className="input w-full" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="ex: Produção energia solar Janeiro" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Valor (€) *</label>
                  <input type="number" step="0.01" className="input w-full" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
                </div>
                <div>
                  <label className="label">Data *</label>
                  <input type="date" className="input w-full" value={form.income_date} onChange={e => setForm(f => ({ ...f, income_date: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="label">Categoria</label>
                <select className="input w-full" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Notas</label>
                <textarea className="input w-full h-20 resize-none" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Observações opcionais..." />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowModal(false)} className="btn-secondary flex-1">Cancelar</button>
              <button onClick={handleSave} disabled={saving || !form.description || !form.amount} className="btn-primary flex-1">
                {saving ? 'A guardar...' : editRecord ? 'Guardar' : 'Criar Receita'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmar eliminação */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Eliminar receita?</h2>
            <p className="text-sm text-gray-500">Esta ação não pode ser desfeita.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteId(null)} className="btn-secondary flex-1">Cancelar</button>
              <button onClick={() => handleDelete(deleteId)} className="flex-1 py-2 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600">Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
