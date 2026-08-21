import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-PT', {
    style: 'currency',
    currency: 'EUR',
  }).format(value)
}
/**
 * Data em DD/MM/AAAA, sempre.
 *
 * Não usa toLocaleDateString nem constrói um Date a partir de "2026-08-01":
 *  - toLocaleDateString depende dos dados de idioma do dispositivo; num
 *    telemóvel configurado em inglês saía 8/1/2026.
 *  - new Date('2026-08-01') é interpretado como meia-noite UTC, por isso em
 *    fusos atrás de Greenwich a data recuava um dia (mostrava 31/07/2026).
 *
 * Aceita 'YYYY-MM-DD', ISO com hora, ou um Date.
 */
export function formatDate(dateString: string | Date | null | undefined): string {
  if (!dateString) return '—'

  if (dateString instanceof Date) {
    if (isNaN(dateString.getTime())) return '—'
    const d = String(dateString.getDate()).padStart(2, '0')
    const m = String(dateString.getMonth() + 1).padStart(2, '0')
    return `${d}/${m}/${dateString.getFullYear()}`
  }

  const texto = String(dateString).trim()

  // Caso normal: o que vem da base de dados começa por AAAA-MM-DD
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const [, ano, mes, dia] = iso
    return `${dia}/${mes}/${ano}`
  }

  // Já está em DD/MM/AAAA
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(texto)) return texto

  const d = new Date(texto)
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

/** Data e hora em DD/MM/AAAA HH:MM. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return '—'
  const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${formatDate(d)} ${hora}`
}
export function getCurrentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}
const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const MESES_ABREV_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

/**
 * "Mês Ano" a partir de 'AAAA-MM' ou 'AAAA-MM-DD'.
 *
 * Extrai o mês diretamente da string em vez de usar `new Date(dateString)`
 * — pela mesma razão do formatDate acima: evita o recuo de um dia em fusos
 * atrás de Greenwich.
 */
export function getMonthLabel(dateString: string | null | undefined): string {
  if (!dateString) return '—'
  const [ano, mes] = String(dateString).split('-')
  const i = Number(mes) - 1
  return MESES_PT[i] ? `${MESES_PT[i]} ${ano}` : String(dateString)
}

/** "Mês abreviado Ano" a partir de 'AAAA-MM' ou 'AAAA-MM-DD' — para eixos de gráficos. */
export function formatMonthShort(dateString: string | null | undefined): string {
  if (!dateString) return '—'
  const [ano, mes] = String(dateString).split('-')
  const i = Number(mes) - 1
  return MESES_ABREV_PT[i] ? `${MESES_ABREV_PT[i]} ${ano}` : String(dateString)
}
export function spaceTypeLabel(type: string): string {
  const map: Record<string, string> = {
    pavilhao: 'Pavilhão',
    habitacao: 'Habitação',
    loja: 'Loja',
  }
  return map[type] ?? type
}
export function categoryLabel(cat: string): string {
  const map: Record<string, string> = {
    obras: 'Obras',
    edp: 'Eletricidade (EDP)',
    pessoal: 'Pessoal',
    contabilidade: 'Contabilidade',
    manutencao: 'Manutenção',
    outros: 'Outros',
  }
  return map[cat] ?? cat
}

/** Nome do inquilino a partir de um valor de join do Supabase (pode vir como objeto ou como array). */
export function getTenantName(tenant: any, fallback: string = '—'): string {
  if (!tenant) return fallback
  if (Array.isArray(tenant)) return tenant[0]?.name ?? fallback
  return tenant.name ?? fallback
}

/** Referência do espaço a partir de um valor de join do Supabase (pode vir como objeto ou como array). */
export function getSpaceRef(space: any, fallback: string = '—'): string {
  if (!space) return fallback
  if (Array.isArray(space)) return space[0]?.ref ?? fallback
  return space.ref ?? fallback
}

/**
 * Abre um ficheiro do bucket 'documents' numa nova aba, com um link
 * temporário válido por 60 segundos. Se não conseguir gerar o link (ex.:
 * o ficheiro já não existe no storage), avisa em vez de falhar em silêncio.
 */
export async function openStorageDocument(supabase: any, path: string): Promise<void> {
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 60)
  if (error || !data?.signedUrl) { alert('Não foi possível abrir o documento.'); return }
  window.open(data.signedUrl, '_blank')
}

/**
 * Versão comparável de um texto para pesquisas: sem acentos e em minúsculas.
 *
 * Serve para "rogerio" encontrar "Rogério", "joao" encontrar "João" e
 * "eletricidade" encontrar "Eletricidade". Sem isto, quem escreve sem acentos
 * — que é a maioria das pessoas a escrever depressa — não encontrava nada.
 */
export function normalizeText(texto: string | null | undefined): string {
  if (!texto) return ''
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // remove os sinais de acentuação
    .toLowerCase()
    .trim()
}

/**
 * True se `texto` contém `pesquisa`, ignorando acentos e maiúsculas.
 * Uma pesquisa vazia dá sempre true, para não esconder nada.
 */
export function matchesSearch(texto: string | null | undefined, pesquisa: string | null | undefined): boolean {
  const alvo = normalizeText(pesquisa)
  if (!alvo) return true
  return normalizeText(texto).includes(alvo)
}
