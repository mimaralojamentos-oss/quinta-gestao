'use client'

import { useCallback, useRef, useState } from 'react'

interface UseFileDropOptions {
  /** Extensões aceites, ex: ['.pdf', '.jpg']. Vazio = aceita tudo. */
  accept?: string[]
  /** Permitir largar vários ficheiros de uma vez. */
  multiple?: boolean
  /** Chamado com os ficheiros válidos que foram largados. */
  onFiles: (files: File[]) => void
  /** Desativa o arrastar (ex: enquanto está a processar). */
  disabled?: boolean
}

/**
 * Adiciona "arrastar e largar" a qualquer zona de upload.
 *
 * Uso:
 *   const { isDragging, dropProps } = useFileDrop({ accept: ['.pdf'], onFiles: setFiles })
 *   <label {...dropProps} className={isDragging ? 'ring-2 ring-emerald-400' : ''}> ... </label>
 *
 * Nota: o contador de "enter/leave" existe porque o browser dispara dragleave
 * ao passar sobre elementos filhos — sem ele a moldura piscava.
 */
/**
 * Junta ficheiros novos aos já selecionados, ignorando repetidos.
 * Dois ficheiros são considerados o mesmo se tiverem o mesmo nome e tamanho.
 * Devolve também os nomes ignorados, para poder avisar o utilizador.
 */
export function mergeUniqueFiles(existing: File[], incoming: File[]): { files: File[]; ignored: string[] } {
  const key = (f: File) => `${f.name}::${f.size}`
  const seen = new Set(existing.map(key))
  const files = [...existing]
  const ignored: string[] = []

  for (const f of incoming) {
    if (seen.has(key(f))) { ignored.push(f.name); continue }
    seen.add(key(f))
    files.push(f)
  }
  return { files, ignored }
}

/** Tamanho legível, ex: "1,2 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

export function useFileDrop({ accept, multiple = false, onFiles, disabled = false }: UseFileDropOptions) {
  const [isDragging, setIsDragging] = useState(false)
  const depth = useRef(0)

  const matchesAccept = useCallback((file: File) => {
    if (!accept || accept.length === 0) return true
    const name = file.name.toLowerCase()
    return accept.some(ext => name.endsWith(ext.toLowerCase()))
  }, [accept])

  const reset = useCallback(() => {
    depth.current = 0
    setIsDragging(false)
  }, [])

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (disabled) return
    e.preventDefault(); e.stopPropagation()
    depth.current++
    if (e.dataTransfer?.types?.includes('Files')) setIsDragging(true)
  }, [disabled])

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (disabled) return
    // Sem isto o browser abre o ficheiro em vez de o entregar à app.
    e.preventDefault(); e.stopPropagation()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }, [disabled])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (disabled) return
    e.preventDefault(); e.stopPropagation()
    depth.current--
    if (depth.current <= 0) reset()
  }, [disabled, reset])

  const onDrop = useCallback((e: React.DragEvent) => {
    if (disabled) return
    e.preventDefault(); e.stopPropagation()
    reset()

    const dropped = Array.from(e.dataTransfer?.files ?? [])
    if (dropped.length === 0) return

    const valid = dropped.filter(matchesAccept)
    const rejected = dropped.length - valid.length

    if (valid.length === 0) {
      alert(`Formato não suportado. Aceita: ${(accept ?? []).join(', ')}`)
      return
    }
    if (rejected > 0) {
      alert(`${rejected} ficheiro(s) ignorado(s) por não serem ${(accept ?? []).join(', ')}.`)
    }

    onFiles(multiple ? valid : [valid[0]])
  }, [disabled, reset, matchesAccept, onFiles, multiple, accept])

  return {
    isDragging,
    dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
  }
}
