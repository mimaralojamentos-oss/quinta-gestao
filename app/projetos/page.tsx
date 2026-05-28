'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, Search, FolderOpen, Building2, Wrench, HardHat, MoreHorizontal } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import ProjectModal from './ProjectModal'

interface Project {
  id: string
  name: string
  type: string
  status: string
  space_id: string | null
  is_general: boolean
  budget: number | null
  start_date: string | null
  end_date_planned: string | null
  description: string | null
  notes: string | null
  created_at: string
  space?: { ref: string; type: string } | null
  total_spent?: number
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

export default function ProjetosPage() {
  const { isAdmin } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'em_curso' | 'concluido' | 'pausado'>('all')
  const [filterType, setFilterType] = useState<'all' | 'construcao' | 'renovacao' | 'arranjo' | 'outro'>('all')
  const [showModal, setShowModal] = useState(false)
  const [editProject, setEditProject] = useState<Project | null>(null)

  useEffect(() => { fetchProjects() }, [])

  async function fetchProjects() {
    setLoading(true)

    const { data: projectsData } = await supabase
      .from('projects')
      .select('*, space:spaces(ref, type)')
      .order('created_at', { ascending: false })

    // Calcular total gasto por projeto via despesas
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

  return (
    <AppLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Projetos</h1>
            <p className="text-sm text-gray-500 mt-1">{projects.length} projetos registados</p>
          </div>
          {isAdmin && (
            <button className="btn-primary" onClick={() => { setEditProject(null); setShowModal(true) }}>
              <Plus className="w-4 h-4" />
              Novo Projeto
            </button>
          )}
        </div>

        {/* Resumo */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="card text-center py-4">
            <p className="text-xs text-gray-500 mb-1">Em Curso</p>
            <p className="text-2xl font-bold text-emerald-600">
              {projects.filter(p => p.status === 'em_curso').length}
            </p>
          </div>
          <div className="card text-center py-4">
            <p className="text-xs text-gray-500 mb-1">Concluídos</p>
            <p className="text-2xl font-bold text-gray-600">
              {projects.filter(p => p.status === 'concluido').length}
            </p>
          </div>
          <div className="card text-center py-4">
            <p className="text-xs text-gray-500 mb-1">Orçamento em curso</p>
            <p className="text-xl font-bold text-gray-900">{formatCurrency(totalBudget)}</p>
          </div>
          <div className="card text-center py-4">
            <p className="text-xs text-gray-500 mb-1">Gasto em curso</p>
            <p className={`text-xl font-bold ${totalSpent > totalBudget && totalBudget > 0 ? 'text-red-600' : 'text-gray-900'}`}>
              {formatCurrency(totalSpent)}
            </p>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex gap-3 mb-6">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9" placeholder="Pesquisar projeto..." value={search}
              onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="input w-44" value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)}>
            <option value="all">Todos os estados</option>
            <option value="em_curso">🟢 Em curso</option>
            <option value="concluido">✅ Concluído</option>
            <option value="pausado">⏸️ Pausado</option>
          </select>
          <select className="input w-44" value={filterType} onChange={e => setFilterType(e.target.value as any)}>
            <option value="all">Todos os tipos</option>
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

              return (
                <div key={project.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow">
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
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700">
                            🏡 Geral — Quinta
                          </span>
                        )}
                        {project.space && !project.is_general && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600">
                            📍 {project.space.ref}
                          </span>
                        )}
                      </div>
                      {project.description && (
                        <p className="text-sm text-gray-500">{project.description}</p>
                      )}
                    </div>
                    {isAdmin && (
                      <button
                        onClick={() => { setEditProject(project); setShowModal(true) }}
                        className="text-xs text-emerald-600 hover:underline font-medium ml-4"
                      >
                        Editar
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                    <div>
                      <p className="text-xs text-gray-400">Início</p>
                      <p className="text-sm font-medium">{project.start_date ? formatDate(project.start_date) : '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Fim previsto</p>
                      <p className="text-sm font-medium">{project.end_date_planned ? formatDate(project.end_date_planned) : '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Orçamento</p>
                      <p className="text-sm font-medium">{project.budget ? formatCurrency(project.budget) : '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Gasto</p>
                      <p className={`text-sm font-semibold ${isOverBudget ? 'text-red-600' : 'text-gray-900'}`}>
                        {formatCurrency(project.total_spent ?? 0)}
                        {isOverBudget && <span className="ml-1 text-xs">⚠ Acima do orçamento!</span>}
                      </p>
                    </div>
                  </div>

                  {/* Barra de progresso do orçamento */}
                  {percentSpent !== null && (
                    <div>
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>Execução do orçamento</span>
                        <span>{Math.round(percentSpent)}%</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all ${isOverBudget ? 'bg-red-500' : percentSpent > 80 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                          style={{ width: `${percentSpent}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
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
