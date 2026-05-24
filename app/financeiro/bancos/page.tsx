'use client'

export const dynamic = 'force-dynamic'

import AppLayout from '@/components/layout/AppLayout'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { formatCurrency } from '@/lib/utils'
import { Plus, Building, CreditCard, ArrowUpRight, ArrowDownRight, Upload, Eye, X, Loader2 } from 'lucide-react'
import Link from 'next/link'

interface Bank {
  id: string
  name: string
  iban: string | null
  account_number: string | null
  notes: string | null
  active: boolean
  _stats?: { total_in: number; total_out: number; pending: number }
}

export default function BancosPage() {
  const [banks, setBanks] = useState<Bank[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editBank, setEditBank] = useState<Bank | null>(null)
  const supabase = createClient()

  useEffect(() => { fetchBanks() }, [])

  async function fetchBanks() {
    setLoading(true)
    const { data: banksData } = await supabase.from('banks').select('*').order('name')
    const { data: txData } = await supabase.from('bank_transactions').select('bank_id, amount, status')

    const banksWithStats = (banksData ?? []).map(bank => {
      const txs = (txData ?? []).filter(t => t.bank_id === bank.id)
      return {
        ...bank,
        _stats: {
          total_in: txs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0),
          total_out: txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0),
          pending: txs.filter(t => t.status === 'por_validar').length,
        }
      }
    })

    setBanks(banksWithStats)
    setLoading(false)
  }

  return (
    <AppLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Bancos</h1>
            <p className="text-sm text-gray-500 mt-1">Gestão de contas bancárias e extratos</p>
          </div>
          <button className="btn-primary" onClick={() => { setEditBank(null); setShowModal(true) }}>
            <Plus className="w-4 h-4" /> Novo Banco
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
          </div>
        ) : banks.length === 0 ? (
          <div className="card flex flex-col items-center py-16 text-center">
            <Building className="w-12 h-12 text-gray-300 mb-3" />
            <p className="text-lg font-semibold text-gray-700">Nenhum banco configurado</p>
            <p className="text-sm text-gray-500 mt-1 mb-4">Adiciona o teu primeiro banco para começar a importar extratos</p>
            <button className="btn-primary" onClick={() => setShowModal(true)}>
              <Plus className="w-4 h-4" /> Adicionar Banco
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {banks.map(bank => (
              <div key={bank.id} className="card">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center">
                      <CreditCard className="w-6 h-6 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 text-lg">{bank.name}</h3>
                      {bank.iban && <p className="text-sm text-gray-500 font-mono">{bank.iban}</p>}
                      {bank.account_number && <p className="text-xs text-gray-400">Conta: {bank.account_number}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {bank._stats && bank._stats.pending > 0 && (
                      <span className="badge-amarelo">{bank._stats.pending} por validar</span>
                    )}
                    <button onClick={() => { setEditBank(bank); setShowModal(true) }}
                      className="btn-secondary text-xs py-1.5 px-3">Editar</button>
                    <Link href={`/financeiro/bancos/${bank.id}`} className="btn-primary text-xs py-1.5 px-3">
                      <Eye className="w-3 h-3" /> Ver extrato
                    </Link>
                  </div>
                </div>
                {bank._stats && (
                  <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-100">
                    <div className="flex items-center gap-2">
                      <ArrowUpRight className="w-4 h-4 text-emerald-500" />
                      <div>
                        <p className="text-xs text-gray-500">Total Entradas</p>
                        <p className="font-semibold text-emerald-600">{formatCurrency(bank._stats.total_in)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <ArrowDownRight className="w-4 h-4 text-red-500" />
                      <div>
                        <p className="text-xs text-gray-500">Total Saídas</p>
                        <p className="font-semibold text-red-600">{formatCurrency(bank._stats.total_out)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Upload className="w-4 h-4 text-blue-500" />
                      <div>
                        <p className="text-xs text-gray-500">Por Validar</p>
                        <p className="font-semibold text-gray-800">{bank._stats.pending} linhas</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <BankModal
          bank={editBank}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); fetchBanks() }}
        />
      )}
    </AppLayout>
  )
}

function BankModal({ bank, onClose, onSaved }: { bank: Bank | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: bank?.name ?? '',
    iban: bank?.iban ?? '',
    account_number: bank?.account_number ?? '',
    notes: bank?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  async function handleSave() {
    if (!form.name.trim()) { setError('O nome é obrigatório'); return }
    setSaving(true); setError('')
    const payload = {
      name: form.name.trim(),
      iban: form.iban || null,
      account_number: form.account_number || null,
      notes: form.notes || null,
    }
    let err
    if (bank) {
      ;({ error: err } = await supabase.from('banks').update(payload).eq('id', bank.id))
    } else {
      ;({ error: err } = await supabase.from('banks').insert(payload))
    }
    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-lg text-gray-900">{bank ? 'Editar Banco' : 'Novo Banco'}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="label">Nome do Banco *</label>
            <input className="input" placeholder="ex: Caixa Geral de Depósitos" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className="label">IBAN</label>
            <input className="input font-mono" placeholder="PT50 0000 0000 0000 0000 0000 0" value={form.iban}
              onChange={e => setForm(f => ({ ...f, iban: e.target.value }))} />
          </div>
          <div>
            <label className="label">Número de Conta</label>
            <input className="input" placeholder="ex: 0000000000" value={form.account_number}
              onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))} />
          </div>
          <div>
            <label className="label">Notas</label>
            <textarea className="input" rows={2} value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> A guardar...</> : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
