import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireRole } from '@/lib/require-role'
import { createClient } from '@supabase/supabase-js'
import { checkFileSize } from '@/lib/fileUpload'
import { extractWaterInvoice, findWaterMeter, waterInvoiceMediaBlock } from '@/lib/waterInvoiceExtraction'

// Extrai os dados de uma fatura de água (identificação do contador + a
// leitura/valor desta fatura em concreto), para preencher automaticamente
// tanto o "Novo Contador" como o "+ Leitura" em /agua/contadores.
// Espelha app/api/extract-edp-meter/route.ts. A extração (prompts afinados
// com uma fatura real) vive em lib/waterInvoiceExtraction.ts, partilhada com
// /api/process-document. NÃO guarda nada — apenas devolve os campos para o
// utilizador rever e confirmar.
export async function POST(request: Request) {
  const auth = await requireRole(['admin', 'coadmin', 'electrician'])
  if (auth.error) return auth.error

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) return NextResponse.json({ error: 'Ficheiro não encontrado' }, { status: 400 })
    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Apenas ficheiros PDF são aceites' }, { status: 400 })
    }
    const sizeError = checkFileSize(file)
    if (sizeError) return sizeError

    const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

    const data = await extractWaterInvoice(anthropic, waterInvoiceMediaBlock(base64, file.type))
    if (!data) return NextResponse.json({ error: 'Não foi possível ler os dados desta fatura' }, { status: 422 })

    // Avisar se já existe um contador com este contrato ou nº de contador,
    // para não duplicar. Sem o fallback de "único contador ativo" — aqui é
    // para criar um contador novo, e esse fallback daria sempre falso alarme.
    let existingMeter: any = null
    if (data.contract_number || data.meter_number) {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      )
      const { data: meters } = await supabase.from('water_meters').select('id, name, contract_number, meter_number')
      existingMeter = findWaterMeter(meters ?? [], data)?.meter ?? null
    }

    return NextResponse.json({ success: true, data, existingMeter })
  } catch (e: any) {
    console.error(e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
