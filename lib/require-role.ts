import { createClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

export async function requireRole(allowedRoles: string[]) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !allowedRoles.includes(profile.role)) {
    return { error: NextResponse.json({ error: 'Acesso não autorizado' }, { status: 403 }) }
  }

  return { user, profile, supabase }
}
