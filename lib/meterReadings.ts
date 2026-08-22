// Verificação de leitura de contador já registada. Antes havia 3 critérios
// diferentes espalhados por 3 sítios: um não verificava nada, dois só
// verificavam por contador+data, e um (o mais robusto, na importação
// automática de documentos) verificava também pelo número da fatura — útil
// quando a data da leitura muda entre versões do mesmo documento.
//
// Esta função usa sempre o critério mais robusto: contador+data, OU
// contador+nº de fatura quando este existe.

export async function meterReadingExists(
  supabase: any,
  meterId: string,
  readingDate: string,
  invoiceNumber?: string | null,
): Promise<boolean> {
  const { data: byDate } = await supabase
    .from('meter_readings').select('id')
    .eq('meter_id', meterId).eq('reading_date', readingDate).maybeSingle()
  if (byDate) return true

  if (invoiceNumber) {
    const { data: byInvoice } = await supabase
      .from('meter_readings').select('id')
      .eq('meter_id', meterId).eq('invoice_number', invoiceNumber).maybeSingle()
    if (byInvoice) return true
  }

  return false
}
