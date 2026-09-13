// Verificação de leitura de contador de água já registada.
// Espelha lib/meterReadings.ts (eletricidade) — mesmo critério: contador+data,
// OU contador+nº de fatura quando este existe.

export async function waterMeterReadingExists(
  supabase: any,
  meterId: string,
  readingDate: string,
  invoiceNumber?: string | null,
): Promise<boolean> {
  const { data: byDate } = await supabase
    .from('water_meter_readings').select('id')
    .eq('meter_id', meterId).eq('reading_date', readingDate).maybeSingle()
  if (byDate) return true

  if (invoiceNumber) {
    const { data: byInvoice } = await supabase
      .from('water_meter_readings').select('id')
      .eq('meter_id', meterId).eq('invoice_number', invoiceNumber).maybeSingle()
    if (byInvoice) return true
  }

  return false
}
