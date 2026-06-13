import { requireRole } from '@/lib/require-role'

export async function requireAdmin() {
  return requireRole(['admin'])
}
