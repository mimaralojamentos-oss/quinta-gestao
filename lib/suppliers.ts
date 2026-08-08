/**
 * Fornecedores e a tabela de equivalências.
 *
 * O nome do fornecedor nas faturas vem do OCR e chega escrito de várias
 * maneiras para a mesma empresa: "EDP Comercial", "EDP COMERCIAL - COMERCIALIZAÇÃO
 * DE ENERGIA, S.A.", "Edp comercial sa"... A tabela `supplier_aliases` guarda,
 * para cada variante, qual é o nome real do fornecedor.
 *
 * A chave de comparação é uma versão "achatada" do nome — sem acentos, sem
 * pontuação e sem maiúsculas — para que pequenas diferenças de escrita não
 * obriguem a criar equivalências novas.
 */

/** Versão comparável de um nome: sem acentos, sem pontuação, minúsculas. */
export function normalizeSupplier(name: string | null | undefined): string {
  if (!name) return ''
  return String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // tira acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')      // pontuação vira espaço
    .trim()
    .replace(/\s+/g, ' ')
}

export interface SupplierAlias {
  id: string
  alias: string
  alias_normalized: string
  canonical_name: string
  notes: string | null
}

/** Mapa pronto a consultar: nome achatado → nome real. */
export function buildAliasMap(aliases: SupplierAlias[] | null | undefined): Map<string, string> {
  const map = new Map<string, string>()
  for (const a of aliases ?? []) {
    map.set(a.alias_normalized || normalizeSupplier(a.alias), a.canonical_name)
  }
  return map
}

/** O nome real de um fornecedor: o da equivalência, ou o próprio se não houver. */
export function resolveSupplier(raw: string | null | undefined, aliasMap: Map<string, string>): string {
  const limpo = String(raw ?? '').trim()
  if (!limpo) return '(sem fornecedor)'
  return aliasMap.get(normalizeSupplier(limpo)) ?? limpo
}

export interface SupplierVariant {
  /** Nome exatamente como aparece nas faturas. */
  raw: string
  docs: number
  total: number
  /** true se já existe uma equivalência definida para esta variante. */
  mapped: boolean
}

export interface SupplierGroup {
  /** Nome real, já resolvido. */
  name: string
  docs: number
  total: number
  firstDate: string | null
  lastDate: string | null
  variants: SupplierVariant[]
}

interface DocLike {
  supplier_name: string | null
  amount: number | null
  doc_date: string | null
}

/**
 * Agrupa as faturas por fornecedor real, juntando as variantes de nome.
 * Devolve a lista ordenada por total gasto, do maior para o menor.
 */
export function groupSuppliers(docs: DocLike[], aliasMap: Map<string, string>): SupplierGroup[] {
  const grupos = new Map<string, SupplierGroup>()

  for (const d of docs) {
    const raw = String(d.supplier_name ?? '').trim()
    if (!raw) continue

    const nome = resolveSupplier(raw, aliasMap)
    const valor = Number(d.amount ?? 0)

    let g = grupos.get(nome)
    if (!g) {
      g = { name: nome, docs: 0, total: 0, firstDate: null, lastDate: null, variants: [] }
      grupos.set(nome, g)
    }

    g.docs += 1
    g.total = parseFloat((g.total + valor).toFixed(2))
    if (d.doc_date) {
      if (!g.firstDate || d.doc_date < g.firstDate) g.firstDate = d.doc_date
      if (!g.lastDate || d.doc_date > g.lastDate) g.lastDate = d.doc_date
    }

    let v = g.variants.find(x => x.raw === raw)
    if (!v) {
      v = { raw, docs: 0, total: 0, mapped: aliasMap.has(normalizeSupplier(raw)) }
      g.variants.push(v)
    }
    v.docs += 1
    v.total = parseFloat((v.total + valor).toFixed(2))
  }

  const lista = [...grupos.values()]
  for (const g of lista) g.variants.sort((a, b) => b.docs - a.docs)
  return lista.sort((a, b) => b.total - a.total)
}
