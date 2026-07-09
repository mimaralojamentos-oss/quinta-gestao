'use client'

import AppLayout from '@/components/layout/AppLayout'
import { useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import { useAuth } from '@/lib/auth-context'
import { User, Lock, CheckCircle, AlertCircle } from 'lucide-react'

export default function PerfilPage() {
  const supabase = createClient()
  const { profile, user } = useAuth()

  // nome
  const [name, setName] = useState(profile?.name ?? '')
  const [savingName, setSavingName] = useState(false)
  const [nameMsg, setNameMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  // password
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordMsg, setPasswordMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  async function handleSaveName() {
    if (!name.trim()) return
    setSavingName(true)
    setNameMsg(null)
    const { error } = await supabase
      .from('profiles')
      .update({ name: name.trim() })
      .eq('id', profile?.id)
    if (error) {
      setNameMsg({ type: 'error', text: 'Erro ao guardar o nome.' })
    } else {
      setNameMsg({ type: 'ok', text: 'Nome atualizado com sucesso!' })
    }
    setSavingName(false)
  }

  async function handleSavePassword() {
    setPasswordMsg(null)
    if (!newPassword || !confirmPassword) {
      setPasswordMsg({ type: 'error', text: 'Preenche todos os campos.' })
      return
    }
    if (newPassword.length < 6) {
      setPasswordMsg({ type: 'error', text: 'A password deve ter pelo menos 6 caracteres.' })
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: 'error', text: 'As passwords não coincidem.' })
      return
    }
    setSavingPassword(true)

    // verificar password atual fazendo sign in
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user?.email ?? '',
      password: currentPassword,
    })
    if (signInError) {
      setPasswordMsg({ type: 'error', text: 'Password atual incorreta.' })
      setSavingPassword(false)
      return
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) {
      setPasswordMsg({ type: 'error', text: 'Erro ao atualizar a password.' })
    } else {
      setPasswordMsg({ type: 'ok', text: 'Password alterada com sucesso!' })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    }
    setSavingPassword(false)
  }

  return (
    <AppLayout>
      <div className="p-8 max-w-xl">
        <div className="flex items-center gap-3 mb-6">
          <User className="w-6 h-6 text-emerald-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">O Meu Perfil</h1>
            <p className="text-sm text-gray-500 mt-0.5">Gere o teu nome e password</p>
          </div>
        </div>

        {/* info conta */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6 flex items-center gap-3">
          <div className="w-12 h-12 bg-emerald-600 rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-white text-lg font-bold">
              {profile?.name?.charAt(0).toUpperCase() ?? '?'}
            </span>
          </div>
          <div>
            <p className="font-semibold text-gray-900">{profile?.name}</p>
            <p className="text-sm text-gray-500">{user?.email}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {profile?.role === 'admin' ? '🔑 Administrador' : profile?.role === 'coadmin' ? '🔑 Co-Administrador' : profile?.role === 'electrician' ? '⚡ Eletricista' : '👁 Visualizador'}
            </p>
          </div>
        </div>

        {/* alterar nome */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <User className="w-4 h-4 text-emerald-600" /> Alterar Nome
          </h2>
          <div className="space-y-3">
            <div>
              <label className="label">Nome de utilizador</label>
              <input
                className="input"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="O teu nome..."
              />
            </div>
            {nameMsg && (
              <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${nameMsg.type === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                {nameMsg.type === 'ok' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                {nameMsg.text}
              </div>
            )}
            <button
              onClick={handleSaveName}
              disabled={savingName || !name.trim()}
              className="btn-primary w-full">
              {savingName ? 'A guardar...' : 'Guardar Nome'}
            </button>
          </div>
        </div>

        {/* alterar password */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <Lock className="w-4 h-4 text-emerald-600" /> Alterar Password
          </h2>
          <div className="space-y-3">
            <div>
              <label className="label">Password atual</label>
              <input
                type="password"
                className="input"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <div>
              <label className="label">Nova password</label>
              <input
                type="password"
                className="input"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
              />
            </div>
            <div>
              <label className="label">Confirmar nova password</label>
              <input
                type="password"
                className="input"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repete a nova password"
              />
            </div>
            {passwordMsg && (
              <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${passwordMsg.type === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                {passwordMsg.type === 'ok' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                {passwordMsg.text}
              </div>
            )}
            <button
              onClick={handleSavePassword}
              disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}
              className="btn-primary w-full">
              {savingPassword ? 'A verificar...' : 'Alterar Password'}
            </button>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
