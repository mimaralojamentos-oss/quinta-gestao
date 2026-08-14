import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { passwordAceitavel, REGRA_PASSWORD } from '@/lib/password'

const PAPEIS_VALIDOS = ['admin', 'coadmin', 'electrician', 'viewer', 'super_reader']

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const supabaseAdmin = getAdminClient()
    const { data, error } = await supabaseAdmin.auth.admin.listUsers()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ users: data.users.map(u => ({ id: u.id, email: u.email })) })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const { email, password, name, role } = await request.json()

    // A criação de contas não validava a força da palavra-passe.
    if (!passwordAceitavel(password)) {
      return NextResponse.json({ error: `Palavra-passe demasiado fraca. ${REGRA_PASSWORD}` }, { status: 400 })
    }
    // Só papéis conhecidos. Antes aceitava qualquer texto vindo do pedido.
    if (!PAPEIS_VALIDOS.includes(String(role))) {
      return NextResponse.json({ error: 'Papel de utilizador inválido.' }, { status: 400 })
    }

    const supabaseAdmin = getAdminClient()
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role }
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    await supabaseAdmin.from('profiles').insert({
      id: data.user.id,
      name,
      role,
    })
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const { id } = await request.json()
    const supabaseAdmin = getAdminClient()
    await supabaseAdmin.auth.admin.deleteUser(id)
    await supabaseAdmin.from('profiles').delete().eq('id', id)
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
