'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-client'
import { logAccess } from '@/lib/logAccess'
import { Home, Eye, EyeOff, Loader2 } from 'lucide-react'

// Imagens de fundo do login, configuráveis por propriedade.
//
// A mesma base de código serve a Quinta e o Serpa Pinto, por isso as fotos
// vêm de NEXT_PUBLIC_LOGIN_IMAGES — uma lista de caminhos separados por
// vírgula, ex: "/serpa1.jpg,/serpa2.jpg". Sem a variável definida, mantém
// as fotos da Quinta (comportamento anterior).
const DEFAULT_IMAGES = ['/QdBC1.jpeg', '/QdBC2.jpeg']

const images = (process.env.NEXT_PUBLIC_LOGIN_IMAGES ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const backgroundImages = images.length > 0 ? images : DEFAULT_IMAGES

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [currentImage, setCurrentImage] = useState(0)
  const supabase = createClient()

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentImage(prev => (prev + 1) % backgroundImages.length)
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !password) { setError('Preenche o email e a password'); return }
    setLoading(true)
    setError('')
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) { setError('Email ou password incorretos. Tenta novamente.'); setLoading(false); return }
    await logAccess({ action: 'login', page: '/login' })
    window.location.href = '/dashboard'
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Imagens de fundo com transição */}
      {backgroundImages.map((img, idx) => (
        <div
          key={img}
          className="absolute inset-0 transition-opacity duration-1000"
          style={{
            backgroundImage: `url(${img})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            opacity: idx === currentImage ? 1 : 0,
          }}
        />
      ))}

      {/* Overlay escuro */}
      <div className="absolute inset-0 bg-black/40" />

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-600 rounded-2xl shadow-lg mb-4">
            <Home className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white drop-shadow-lg">{process.env.NEXT_PUBLIC_APP_NAME || 'Gestão da Quinta'}</h1>
          <p className="text-white/80 text-sm mt-1 drop-shadow">{process.env.NEXT_PUBLIC_APP_LOCATION || 'Évora'} · Sistema de Arrendamentos</p>
        </div>

        <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">Entrar na aplicação</h2>
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" placeholder="o-teu@email.com" value={email}
                onChange={e => setEmail(e.target.value)} autoComplete="email" autoFocus />
            </div>
            <div>
              <label className="label">Password</label>
              <div className="relative">
                <input className="input pr-10" type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
                <button type="button" onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {error && <div className="bg-red-50 border border-red-100 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>}
            <button type="submit" disabled={loading} className="w-full btn-primary justify-center py-3 text-base">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> A entrar...</> : 'Entrar'}
            </button>
          </form>
        </div>

        {/* Indicadores de imagem — só fazem sentido com mais do que uma */}
        <div className="flex justify-center gap-2 mt-4">
          {backgroundImages.length > 1 && backgroundImages.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentImage(idx)}
              className={`w-2 h-2 rounded-full transition-all ${idx === currentImage ? 'bg-white w-4' : 'bg-white/50'}`}
            />
          ))}
        </div>

        <p className="text-center text-xs text-white/60 mt-4 drop-shadow">Acesso restrito a utilizadores autorizados</p>
      </div>
    </div>
  )
}
