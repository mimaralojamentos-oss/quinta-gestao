'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, Zap, CheckCircle } from 'lucide-react'
import ElectricityModal from './ElectricityModal'
import { useAuth } from '@/lib/auth-context'

interface ChargeWithDetails {
  id: string
  charge_date: string
  reference_month: string
  units: number
  amount: number
  paid: boolean
  payment_date: string | null
  payment_method: string | null
  notes: string | null
  lease: {
    id: string
    space: { ref: string }
    tenant: { name: string }
  }
}

export default function EletricidadePage() {
  const { isAdmin } = useAuth()
  const [charges, setCharges] = useState<ChargeWithDetails[]>([])
  const [readings, setReadings] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'charges' | 'readings'>('charges')
  const [showModal, setShowModal] = useState(false)
  const [editCharge, setEditCharge] = useState<ChargeWithDetails | null>(null)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data: chargesData } = await supabase
      .from('electricity_charges')
      .select('*, lease:leases(id, space:spaces(ref), tenant:tenants(name))')
      .order('charge_date', { ascending: false })

    const { data: readingsData } = await supabase
      .from('electricity_readings')
      .select('*, space:spaces(ref)')
      .order('reading_date', { ascending: false })

    setCharges(chargesData ?? [])
    setReadings(readingsData ?? [])
    setLoading(false)
  }

  async function markPaid(charge: ChargeWithDetails) {
    await supabase.from('electricity_charges').update({
      paid: true,
      payment_date: new Date().toISOString().slice(0, 10),
      payment_method: 'dinheiro',
    }).eq('id', charge.id)
    fetchData()
  }

  const unpaidTotal = charges.filter(c => !c.paid).reduce((s, c) => s + c.amount, 0)

  return (
    <AppLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Eletricidade</h1>
            <p className="text-sm text-gray-500 mt-1">Cobranças e leituras de contadores</p>
          </div>
          {isAdmin && (
            <button className="btn-primary" onClick={() => { setEditCharge(null); setShowModal(true) }}>
              <Plus className="w-4 h-4" />
              Nova Cobrança
            </button>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="card">
            <p className="text-sm text-gray-500 mb-1">Por Receber</p>
            <p className="text-xl font-bold text-red-600">{formatCurrency(unpaidTotal)}</p>
          </div>
          <div className="card">
            <p className="text-sm text-gray-500 mb-1">Cobranças Pendentes</p>
            <p className="text-xl font-bold text-gray-900">{charges.filter(c => !c.paid).length}</p>
          </div>
          <div className="card">
            <p className="text-sm text-gray-500 mb-1">Leituras Registadas</p>
            <p className="text-xl font-bold text-gray-900">{readings.length}</p>
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setActiveTab('charges')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'charges' ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}>
            Cobranças
          </button>
          <button
            onClick={() => setActiveTab('readings')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'readings' ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}>
            Leituras de Contadores
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
          </div>
        ) : activeTab === 'charges' ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="table-header">Espaço</th>
                  <th className="table-header">Inquilino</th>
                  <th className="table-header">Data</th>
                  <th className="table-header">kWh</th>
                  <th className="table-header">Valor</th>
                  <th className="table-header">Estado</th>
                  <th className="table-header">Notas</th>
                  {isAdmin && <th className="table-header"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {charges.map(charge => (
                  <tr key={charge.id} className="hover:bg-gray-50">
                    <td className="table-cell font-semibold text-gray-900">{charge.lease?.space?.ref}</td>
                    <td className="table-cell">{charge.lease?.tenant?.name}</td>
                    <td className="table-cell text-sm">{formatDate(charge.charge_date)}</td>
                    <td className="table-cell">{charge.units ? `${charge.units} kWh` : '—'}</td>
                    <td className="table-cell font-medium">{formatCurrency(charge.amount)}</td>
                    <td className="table-cell">
                      {charge.paid ? (
                        <span className="badge-verde flex items-center gap-1 w-fit">
                          <CheckCircle className="w-3 h-3" /> Pago
                        </span>
                      ) : (
                        <span className="badge-vermelho flex items-center gap-1 w-fit">
                          <Zap className="w-3 h-3" /> Pendente
                        </span>
                      )}
                    </td>
                    <td className="table-cell text-xs text-gray-500">{charge.notes ?? '—'}</td>
                    {isAdmin && (
                      <td className="table-cell">
                        {!charge.paid && (
                          <button onClick={() => markPaid(charge)}
                            className="text-xs text-emerald-600 hover:underline font-medium">
                            Marcar pago
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {charges.length === 0 && (
                  <tr><td colSpan={isAdmin ? 8 : 7} className="py-12 text-center text-gray-400 text-sm">Sem cobranças registadas</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="table-header">Espaço</th>
                  <th className="table-header">Data da Leitura</th>
                  <th className="table-header">Leitura (kWh)</th>
                  <th className="table-header">Notas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {readings.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="table-cell font-semibold text-gray-900">{r.space?.ref}</td>
                    <td className="table-cell">{formatDate(r.reading_date)}</td>
                    <td className="table-cell font-medium">{r.reading_value}</td>
                    <td className="table-cell text-xs text-gray-500">{r.notes ?? '—'}</td>
                  </tr>
                ))}
                {readings.length === 0 && (
                  <tr><td colSpan={4} className="py-12 text-center text-gray-400 text-sm">Sem leituras registadas</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && isAdmin && (
        <ElectricityModal
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); fetchData() }}
        />
      )}
    </AppLayout>
  )
}
