'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface UseFileDropOptions {
  /** Extensões aceites, ex: ['.pdf', '.jpg']. Vazio = aceita tudo. */
  accept?: string[]
  /** Permitir largar vários ficheiros de uma vez. */
  multiple?: boolean
  /** Chamado com os ficheiros válidos que foram largados. */
  onFiles: (files: File[]) => void
  /** Desativa o arrastar (ex: enquanto está a processar). */
  disabled?: boolean
  /**
   * Ouvir a JANELA inteira em vez de um elemento — para largar ficheiros em
   * qualquer ponto da página (ver app/documentos/page.tsx). Continua a valer
   * a mesma validação; um modal aberto que trate o mesmo ficheiro trava o
   * evento antes de ele chegar aqui.
   */
  onWindow?: boolean
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

export function useFileDrop({ accept, multiple = false, onFiles, disabled = false, onWindow = false }: UseFileDropOptions) {
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

  /** Validação comum ao arrasto num elemento e ao arrasto na janela. */
  const entregar = useCallback((dropped: File[]) => {
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
  }, [matchesAccept, accept, multiple, onFiles])

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
    entregar(Array.from(e.dataTransfer?.files ?? []))
  }, [disabled, reset, entregar])

  /**
   * Modo janela: os mesmos passos, mas em toda a página. Só mexe em arrastos
   * que tragam ficheiros — assim o "arrastar e largar" de texto ou de links
   * continua a funcionar como no browser.
   */
  useEffect(() => {
    if (!onWindow || disabled || typeof window === 'undefined') return

    const temFicheiros = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

    const enter = (e: DragEvent) => {
      if (!temFicheiros(e)) return
      e.preventDefault()
      depth.current++
      setIsDragging(true)
    }
    const over = (e: DragEvent) => {
      if (!temFicheiros(e)) return
      // Impede o browser de abrir o ficheiro numa aba nova.
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const leave = (e: DragEvent) => {
      if (!temFicheiros(e)) return
      depth.current--
      // relatedTarget a null = o ponteiro saiu mesmo da janela.
      if (depth.current <= 0 || !e.relatedTarget) reset()
    }
    const drop = (e: DragEvent) => {
      if (!temFicheiros(e)) return
      e.preventDefault()
      reset()
      entregar(Array.from(e.dataTransfer?.files ?? []))
    }

    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
      reset()
    }
  }, [onWindow, disabled, entregar, reset])

  return {
    isDragging,
    dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
  }
}
