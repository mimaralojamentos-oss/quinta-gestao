/**
 * Coerência entre contratos (leases) e espaços (spaces.status / tenant_id).
 *
 *   - Um contrato ATIVO ocupa o espaço: status 'arrendado' e tenant_id do
 *     inquilino.
 *   - Quando um contrato termina (ou passa para outro espaço), o espaço só
 *     fica livre ('disponivel', sem inquilino) se não sobrar lá nenhum
 *     contrato ativo; se sobrar, fica com o inquilino desse contrato.
 *
 * Devolvem a mensagem de erro, ou null. Recebem o cliente Supabase de quem
 * chama (as páginas usam clientes diferentes).
 */

export async function ocuparEspaco(supabase: any, spaceId: string, tenantId: string): Promise<string | null> {
  const { error } = await supabase
    .from('spaces').update({ status: 'arrendado', tenant_id: tenantId }).eq('id', spaceId)
  return error?.message ?? null
}

export async function reavaliarEspaco(supabase: any, spaceId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('leases').select('tenant_id, start_date')
    .eq('space_id', spaceId).eq('status', 'ativo')
    .order('start_date', { ascending: false })
  if (error) return error.message

  const ativo = (data ?? [])[0]
  const { error: erroEspaco } = await supabase
    .from('spaces')
    .update(ativo ? { status: 'arrendado', tenant_id: ativo.tenant_id } : { status: 'disponivel', tenant_id: null })
    .eq('id', spaceId)
  return erroEspaco?.message ?? null
}
