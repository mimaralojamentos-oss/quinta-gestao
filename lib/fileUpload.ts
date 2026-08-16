import { NextResponse } from 'next/server'

/**
 * Limite para ficheiros enviados às rotas que os passam à API da Anthropic
 * (contratos, faturas, extratos bancários). Sem isto, um ficheiro enorme
 * gera custos desnecessários e pode esgotar a memória da função.
 */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024 // 15 MB

/** Devolve uma resposta de erro 413 se o ficheiro exceder o limite, ou null se estiver dentro do limite. */
export function checkFileSize(file: File): NextResponse | null {
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `Ficheiro demasiado grande (máximo ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB)` },
      { status: 413 }
    )
  }
  return null
}
