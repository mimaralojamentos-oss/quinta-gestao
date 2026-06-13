import fs from 'fs'

const env = {}
for (const line of fs.readFileSync('.env.local', 'utf-8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}

const url = env.NEXT_PUBLIC_SUPABASE_URL
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const tables = ['debts', 'debt_payments', 'owners', 'bank_transactions', 'banks', 'sms_log', 'gate_phones', 'tenant_contacts', 'notes', 'meters', 'meter_readings', 'electricity_readings', 'electricity_charges']

for (const t of tables) {
  const res = await fetch(`${url}/rest/v1/${t}?select=id&limit=1`, {
    method: 'GET',
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      Prefer: 'count=exact',
    },
  })
  const contentRange = res.headers.get('content-range')
  const text = await res.text()
  let info
  try {
    const json = JSON.parse(text)
    info = Array.isArray(json) ? `rows_returned=${json.length}` : `error=${json.code ?? ''} ${json.message ?? ''}`
  } catch {
    info = text.slice(0, 120)
  }
  console.log(t.padEnd(20), 'status=' + res.status, 'content-range=' + contentRange, info)
}
