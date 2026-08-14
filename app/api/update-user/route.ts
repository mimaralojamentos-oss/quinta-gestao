import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { passwordAceitavel, REGRA_PASSWORD } from '@/lib/password'

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const { userId, password, email } = await request.json()

    if (!userId) {
      return NextResponse.json({ error: 'userId é obrigatório' }, { status: 400 })
    }

    // 6 caracteres é fraco de mais para contas que veem contas bancárias,
    // rendas e dados pessoais de inquilinos.
    if (password && !passwordAceitavel(password)) {
      return NextResponse.json({ error: `Palavra-passe demasiado fraca. ${REGRA_PASSWORD}` }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const updates: any = {}
    if (password) updates.password = password
    if (email) updates.email = email

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: true })
    }

    const { error } = await supabase.auth.admin.updateUserById(userId, updates)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
