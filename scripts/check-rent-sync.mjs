import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

// Load env vars from .env.vercel.local without printing them
const envFile = readFileSync('.env.vercel.local', 'utf-8')
const env = {}
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/)
  if (m) env[m[1]] = m[2]
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const tenantNames = ['Fernando Gaston', 'Catarinos Carmen', 'Luis Figuereido', 'José Nabo']

const { data: tenants, error: tenantsErr } = await supabase
  .from('tenants')
  .select('id, name')

if (tenantsErr) { console.error('tenants error', tenantsErr); process.exit(1) }

console.log('=== Tenants found ===')
const matched = []
for (const name of tenantNames) {
  const found = tenants.filter(t => t.name && t.name.toLowerCase().includes(name.toLowerCase().split(' ')[0]))
  console.log(name, '->', found.map(f => `${f.name} (${f.id})`))
  matched.push({ searched: name, candidates: found })
}

const tenantIds = [...new Set(matched.flatMap(m => m.candidates.map(c => c.id)))]

console.log('\n=== Leases for these tenants ===')
const { data: leases, error: leasesErr } = await supabase
  .from('leases')
  .select('id, monthly_rent, status, tenant_id, tenant:tenants(name), space:spaces(ref)')
  .in('tenant_id', tenantIds)

if (leasesErr) { console.error('leases error', leasesErr); process.exit(1) }
for (const l of leases) {
  console.log(`lease ${l.id} | tenant=${l.tenant?.name} | space=${l.space?.ref} | rent=${l.monthly_rent} | status=${l.status}`)
}

const leaseIds = leases.map(l => l.id)

console.log('\n=== bank_transactions: confirmed_tenant_id in tenantIds, June 2026, amount > 0 ===')
const { data: txs, error: txsErr } = await supabase
  .from('bank_transactions')
  .select('id, transaction_date, amount, status, confirmed_type, confirmed_tenant_id, confirmed_lease_id, description')
  .in('confirmed_tenant_id', tenantIds)
  .gte('transaction_date', '2026-06-01')
  .lte('transaction_date', '2026-06-30')
  .gt('amount', 0)

if (txsErr) { console.error('txs error', txsErr); process.exit(1) }
for (const tx of txs) {
  const tenant = matched.flatMap(m => m.candidates).find(c => c.id === tx.confirmed_tenant_id)
  console.log(`tx ${tx.id} | date=${tx.transaction_date} | amount=${tx.amount} | status=${tx.status} | type=${tx.confirmed_type} | tenant=${tenant?.name} | lease_id=${tx.confirmed_lease_id} | desc="${tx.description}"`)
}

console.log('\n=== rent_payments for these leases, reference_month = 2026-06-01 ===')
const { data: rps, error: rpsErr } = await supabase
  .from('rent_payments')
  .select('id, lease_id, reference_month, amount, tipo, payment_method, payment_date, used')
  .in('lease_id', leaseIds)
  .eq('reference_month', '2026-06-01')

if (rpsErr) { console.error('rps error', rpsErr); process.exit(1) }
for (const rp of rps) {
  const lease = leases.find(l => l.id === rp.lease_id)
  console.log(`rp ${rp.id} | lease=${rp.lease_id} (${lease?.tenant?.name}) | ref=${rp.reference_month} | amount=${rp.amount} | tipo=${rp.tipo} | method=${rp.payment_method} | date=${rp.payment_date} | used=${rp.used}`)
}

console.log('\n=== Summary: tx without matching rent_payment ===')
for (const tx of txs) {
  if (tx.status !== 'validado' || tx.confirmed_type !== 'renda' || !tx.confirmed_lease_id) {
    console.log(`tx ${tx.id} | SKIP (status=${tx.status}, type=${tx.confirmed_type}, lease=${tx.confirmed_lease_id})`)
    continue
  }
  const refMonth = tx.transaction_date.slice(0, 7) + '-01'
  const match = rps.find(rp => rp.lease_id === tx.confirmed_lease_id && rp.reference_month === refMonth && (rp.tipo === 'renda' || !rp.tipo))
  const tenant = matched.flatMap(m => m.candidates).find(c => c.id === tx.confirmed_tenant_id)
  console.log(`tx ${tx.id} | tenant=${tenant?.name} | date=${tx.transaction_date} | amount=${tx.amount} | hasRentPayment=${!!match}`)
}
