'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, Search, FolderOpen, X, FileText, Eye, FolderInput } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import ProjectModal from './ProjectModal'

interface Project {
  id: string
  name: string
  type: string
  status: string
  space_id: string | null
  is_general: boolean
  location_label: string | null
  budget: number | null
  start_date: string | null
  end_date_planned: string | null
  description: string | null
  notes: string | null
  created_at: string
  space?: { ref: string; type: string } | null
  total_spent?: number
}

interface Expense {
  id: string
  expense_date: string
  description: string
  supplier: string | null
  amount: number
  category: string
  payment_method: string
  invoice_file_path: string | null
  project_id: string | null
}

const typeLabels: Record<string, string> = {
  construcao: '🏗️ Construção',
  renovacao: '🔨 Renovação',
  arranjo: '🔧 Arranjo',
  outro: '📦 Outro',
}

const typeColors: Record<string, string> = {
  construcao: 'bg-orange-100 text-orange-700',
  renovacao: 'bg-blue-100 text-blue-700',
  arranjo: 'bg-cyan-100 text-cyan-700',
  outro: 'bg-gray-100 text-gray-700',
}

const statusLabels: Record<string, string> = {
  em_curso: '🟢 Em curso',
  concluido: '✅ Concluído',
  pausado: '⏸️ Pausado',
}

const statusColors: Record<string, string> = {
  em_curso: 'bg-emerald-100 text-emerald-700',
  concluido: 'bg-gray-100 text-gray-600',
  pausado: 'bg-yellow-100 text-yellow-700',
}

const categoryColors: Record<string, string> = {
  obras: 'bg-orange-100 text-orange-700',
  edp: 'bg-yellow-100 text-yellow-700',
  pessoal: 'bg-blue-100 text-blue-700',
  contabilidade: 'bg-purple-100 text-purple-700',
  manutencao: 'bg-cyan-100 text-cyan-700',
  outros: 'bg-gray-100 text-gray-700',
}

const categoryLabels: Record<string, string> = {
  obras: 'Obras', edp: 'EDP', pessoal: 'Pessoal',
  contabilidade: 'Contabilidade', manutencao: 'Manutenção', outros: 'Outros',
}

export default function ProjetosPage() {
  const { isAdmin } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'em_curso' | 'concluido' | 'pausado'>('all')
  const [filterType, setFilterType] = useState<'all' | 'construcao' | 'renovacao' | 'arranjo' | 'outro'>('all')
  const [showModal, setShowModal] = useState(false)
  const [editProject, setEditProject] = useState<Project | null>(null)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [projectExpenses, setProjectExpenses] = useState<Expense[]>([])
  const [loadingExpenses, setLoadingExpenses] = useState(false)
  const [movingExpense, setMovingExpense] = useState<string | null>(null) // expense id

  useEffect(() => { fetchProjects() }, [])

  async function fetchProjects() {
    setLoading(true)
    const { data: projectsData } = await supabase
      .from('projects')
      .select('*, space:spaces(ref, type)')
      .order('created_at', { ascending: false })

    const { data: expensesData } = await supabase
      .from('expenses')
      .select('project_id, amount')
      .not('project_id', 'is', null)

    const projectsWithSpent = (projectsData ?? []).map(p => ({
      ...p,
      total_spent: (expensesData ?? [])
        .filter(e => e.project_id === p.id)
        .reduce((s, e) => s + (e.amount ?? 0), 0)
    }))

    setProjects(projectsWithSpent)
    setLoading(false)
  }

  async function handleSelectProject(project: Project) {
    setSelectedProject(project)
    setMovingExpense(null)
    setLoadingExpenses(true)
    const { data } = await supabase
      .from('expenses')
      .select('*')
      .eq('project_id', project.id)
      .order('expense_date', { ascending: false })
    setProjectExpenses(data ?? [])
    setLoadingExpenses(false)
  }

  async function openDocument(filePath: string) {
    const { data } = await supabase.storage.from('documents').createSignedUrl(filePath, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function moveExpense(expenseId: string, newProjectId: string | null) {
    await supabase.from('expenses').update({ project_id: newProjectId }).eq('id', expenseId)
    setMovingExpense(null)
    // Recarregar despesas e projetos
    await fetchProjects()
    if (selectedProject) await handleSelectProject({ ...selectedProject })
  }

  const filtered = projects.filter(p => {
    const matchSearch = !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description?.toLowerCase().includes(search.toLowerCase()) ||
      p.space?.ref?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = filterStatus === 'all' || p.status === filterStatus
    const matchType = filterType === 'all' || p.type === filterType
    return matchSearch && matchStatus && matchType
  })

  const totalBudget = projects.filter(p => p.status === 'em_curso').reduce((s, p) => s + (p.budget ?? 0), 0)
  const totalSpent = projects.filter(p => p.status === 'em_curso').reduce((s, p) => s + (p.total_spent ?? 0), 0)

  const expensesByCategory = projectExpenses.reduce((acc, e) => {
    const cat = e.category ?? 'outros'
    if (!acc[cat]) acc[cat] = { total: 0, items: [] }
    acc[cat].total += e.amount
    acc[cat].items.push(e)
    return acc
  }, {} as Record<string, { total: number; items: Expense[] }>)

  // Projetos disponíveis para mover (excluindo o atual)
  const otherProjects = projects.filter(p => p.id !== selectedProject?.id)

  return (
    <AppLayout>
      <div className="flex h-full">
        {/* Lista de projetos */}
        <div className={`flex-1 p-8 overflow-y-auto transition-all ${selectedProject ? 'max-w-[60%]' : ''}`}>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Projetos</h1>
              <p className="text-sm text-gray-500 mt-1">{projects.length} projetos registados</p>
            </div>
            {isAdmin && (
              <button className="btn-primary" onClick={() => { setEditProject(null); setShowModal(true) }}>
                <Plus className="w-4 h-4" /> Novo Projeto
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="card text-center py-3">
              <p className="text-xs text-gray-500 mb-1">Orçamento em curso</p>
              <p className="text-lg font-bold text-gray-900">{formatCurrency(totalBudget)}</p>
            </div>
            <div className="card text-center py-3">
              <p className="text-xs text-gray-500 mb-1">Gasto em curso</p>
              <p className={`text-lg font-bold ${totalSpent > totalBudget && totalBudget > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {formatCurrency(totalSpent)}
              </p>
            </div>
          </div>

          <div className="flex gap-3 mb-6 flex-wrap">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input className="input pl-9" placeholder="Pesquisar..." value={search}
                onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="input w-36" value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)}>
              <option value="all">Todos</option>
              <option value="em_curso">🟢 Em curso</option>
              <option value="concluido">✅ Concluído</option>
              <option value="pausado">⏸️ Pausado</option>
            </select>
            <select className="input w-36" value={filterType} onChange={e => setFilterType(e.target.value as any)}>
              <option value="all">Todos</option>
              <option value="construcao">🏗️ Construção</option>
              <option value="renovacao">🔨 Renovação</option>
              <option value="arranjo">🔧 Arranjo</option>
              <option value="outro">📦 Outro</option>
            </select>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-gray-400">
              <FolderOpen className="w-12 h-12 mb-3" />
              <p className="text-sm">Nenhum projeto encontrado</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {filtered.map(project => {
                const percentSpent = project.budget && project.budget > 0
                  ? Math.min((project.total_spent ?? 0) / project.budget * 100, 100)
                  : null
                const isOverBudget = project.budget && (project.total_spent ?? 0) > project.budget
                const isSelected = selectedProject?.id === project.id

                return (
                  <div key={project.id} onClick={() => handleSelectProject(project)}
                    className={`bg-white rounded-xl border shadow-sm p-5 cursor-pointer transition-all hover:shadow-md ${isSelected ? 'border-emerald-400 ring-2 ring-emerald-200' : 'border-gray-100'}`}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="font-semibold text-gray-900">{project.name}</h3>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeColors[project.type]}`}>
                            {typeLabels[project.type]}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[project.status]}`}>
                            {statusLabels[project.status]}
                          </span>
                          {project.is_general && (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700">🏡 Geral</span>
                          )}
                          {project.space && !project.is_general && (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600">📍 {project.space.ref}</span>
                          )}
                          {project.location_label && !project.is_general && !project.space && (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">🏗️ {project.location_label}</span>
                          )}
                        </div>
                        {project.description && <p className="text-sm text-gray-500">{project.description}</p>}
                      </div>
                      {isAdmin && (
                        <button onClick={e => { e.stopPropagation(); setEditProject(project); setShowModal(true) }}
                          className="text-xs text-emerald-600 hover:underline font-medium ml-4">
                          Editar
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-4 gap-3 mb-3">
                      <div>
                        <p className="text-xs text-gray-400">Início</p>
                        <p className="text-xs font-medium">{project.start_date ? formatDate(project.start_date) : '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">Fim previsto</p>
                        <p className="text-xs font-medium">{project.end_date_planned ? formatDate(project.end_date_planned) : '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">Orçamento</p>
                        <p className="text-xs font-medium">{project.budget ? formatCurrency(project.budget) : '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">Gasto</p>
                        <p className={`text-xs font-semibold ${isOverBudget ? 'text-red-600' : 'text-gray-900'}`}>
                          {formatCurrency(project.total_spent ?? 0)}
                          {isOverBudget && <span className="ml-1">⚠</span>}
                        </p>
                      </div>
                    </div>

                    {percentSpent !== null && (
                      <div>
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                          <span>Execução do orçamento</span>
                          <span>{Math.round(percentSpent)}%</span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2">
                          <div className={`h-2 rounded-full transition-all ${isOverBudget ? 'bg-red-500' : percentSpent > 80 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                            style={{ width: `${percentSpent}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Painel lateral de custos */}
        {selectedProject && (
          <div className="w-[40%] border-l border-gray-100 bg-gray-50 flex flex-col h-screen sticky top-0">
            <div className="p-5 bg-white border-b border-gray-100 flex items-start justify-between">
              <div>
                <h2 className="font-bold text-gray-900">{selectedProject.name}</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {selectedProject.budget
                    ? `Orçamento: ${formatCurrency(selectedProject.budget)} · Gasto: ${formatCurrency(selectedProject.total_spent ?? 0)}`
                    : `Total gasto: ${formatCurrency(selectedProject.total_spent ?? 0)}`}
                </p>
              </div>
              <button onClick={() => { setSelectedProject(null); setMovingExpense(null) }} className="text-gray-400 hover:text-gray-600 ml-3">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Resumo por categoria */}
            {Object.keys(expensesByCategory).length > 0 && (
              <div className="p-4 bg-white border-b border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Resumo por categoria</p>
                <div className="space-y-2">
                  {Object.entries(expensesByCategory)
                    .sort((a, b) => b[1].total - a[1].total)
                    .map(([cat, data]) => (
                      <div key={cat} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${categoryColors[cat]}`}>
                            {categoryLabels[cat] ?? cat}
                          </span>
                          <span className="text-xs text-gray-500">{data.items.length} despesa(s)</span>
                        </div>
                        <span className="text-sm font-semibold text-gray-900">{formatCurrency(data.total)}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Lista de despesas */}
            <div className="flex-1 overflow-y-auto p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Todas as despesas ({projectExpenses.length})
              </p>

              {loadingExpenses ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-600" />
                </div>
              ) : projectExpenses.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <FileText className="w-8 h-8 mx-auto mb-2" />
                  <p className="text-sm">Sem despesas associadas</p>
                  <p className="text-xs mt-1">Associa despesas a este projeto na página de Despesas</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {projectExpenses.map(expense => (
                    <div key={expense.id} className="bg-white rounded-lg border border-gray-100 p-3">
                      <div className="flex items-start justify-between mb-1">
                        <p className="text-sm font-medium text-gray-800 flex-1 pr-2">{expense.description}</p>
                        <p className="text-sm font-bold text-red-600 whitespace-nowrap">{formatCurrency(expense.amount)}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <span className="text-xs text-gray-400">{formatDate(expense.expense_date)}</span>
                        {expense.supplier && <span className="text-xs text-gray-500">· {expense.supplier}</span>}
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${categoryColors[expense.category]}`}>
                          {categoryLabels[expense.category] ?? expense.category}
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${expense.payment_method === 'dinheiro' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                          {expense.payment_method === 'dinheiro' ? '💵' : '🏦'}
                        </span>
                      </div>

                      {/* Botões de ação */}
                      <div className="flex items-center gap-3 pt-1 border-t border-gray-50">
                        {/* Ver documento */}
                        {expense.invoice_file_path ? (
                          <button onClick={() => openDocument(expense.invoice_file_path!)}
                            className="flex items-center gap-1 text-xs text-emerald-600 hover:underline font-medium">
                            <Eye className="w-3.5 h-3.5" /> Ver fatura
                          </button>
                        ) : (
                          <span className="text-xs text-gray-300 flex items-center gap-1">
                            <Eye className="w-3.5 h-3.5" /> Sem documento
                          </span>
                        )}

                        <span className="text-gray-200">|</span>

                        {/* Mover projeto */}
                        {isAdmin && (
                          <div className="relative">
                            <button onClick={() => setMovingExpense(movingExpense === expense.id ? null : expense.id)}
                              className="flex items-center gap-1 text-xs text-blue-500 hover:underline font-medium">
                              <FolderInput className="w-3.5 h-3.5" /> Mover projeto
                            </button>

                            {movingExpense === expense.id && (
                              <div className="absolute bottom-full left-0 mb-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 w-56 py-1">
                                <p className="text-xs text-gray-400 px-3 py-1.5 border-b border-gray-100">Mover para:</p>
                                <button
                                  onClick={() => moveExpense(expense.id, null)}
                                  className="w-full text-left px-3 py-2 text-xs text-gray-500 hover:bg-gray-50">
                                  — Sem projeto
                                </button>
                                {otherProjects.map(p => (
                                  <button key={p.id}
                                    onClick={() => moveExpense(expense.id, p.id)}
                                    className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-emerald-50 hover:text-emerald-700">
                                    {p.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showModal && isAdmin && (
        <ProjectModal
          project={editProject}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); fetchProjects() }}
        />
      )}
    </AppLayout>
  )
}

// https://quinta-gestao.vercel.app/projetos
