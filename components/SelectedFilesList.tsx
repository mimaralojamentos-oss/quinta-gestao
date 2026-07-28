'use client'

import { FileText, X } from 'lucide-react'
import { formatFileSize } from '@/lib/useFileDrop'

interface SelectedFilesListProps {
  files: File[]
  onRemove: (index: number) => void
  onClear?: () => void
  /** Nomes de ficheiros que já existem no sistema, para assinalar em laranja. */
  knownNames?: string[]
}

/**
 * Lista dos ficheiros selecionados, com nome, tamanho e botão para remover.
 * Serve para o utilizador confirmar o que vai carregar antes de processar
 * e perceber se está a repetir algum ficheiro.
 */
export default function SelectedFilesList({ files, onRemove, onClear, knownNames }: SelectedFilesListProps) {
  if (files.length === 0) return null

  const known = new Set((knownNames ?? []).map(n => n.toLowerCase()))

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs font-medium text-gray-600">
          {files.length} ficheiro{files.length > 1 ? 's' : ''} a carregar
        </p>
        {onClear && files.length > 1 && (
          <button type="button" onClick={onClear} className="text-xs text-gray-400 hover:text-red-500 transition-colors">
            Limpar tudo
          </button>
        )}
      </div>
      <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
        {files.map((f, i) => {
          const alreadyExists = known.has(f.name.toLowerCase())
          return (
            <div
              key={`${f.name}-${f.size}-${i}`}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                alreadyExists ? 'border-amber-200 bg-amber-50' : 'border-gray-100 bg-gray-50'
              }`}
            >
              <FileText className={`w-3.5 h-3.5 flex-shrink-0 ${alreadyExists ? 'text-amber-500' : 'text-gray-400'}`} />
              <span className="flex-1 min-w-0 truncate text-gray-700" title={f.name}>{f.name}</span>
              {alreadyExists && (
                <span className="flex-shrink-0 text-[10px] font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                  já existe
                </span>
              )}
              <span className="flex-shrink-0 text-gray-400">{formatFileSize(f.size)}</span>
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="flex-shrink-0 text-gray-300 hover:text-red-500 transition-colors"
                title="Remover"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
