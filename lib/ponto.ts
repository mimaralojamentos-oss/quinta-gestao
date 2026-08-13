/**
 * Folha de ponto dos trabalhadores temporários.
 *
 * Três regras de negócio vivem aqui, e só aqui, para o cálculo ser sempre
 * o mesmo no telemóvel do trabalhador e no ecrã do gestor:
 *
 *   1. As horas de cada turno são arredondadas ao quarto de hora.
 *   2. Sábados, domingos e feriados nacionais pagam a tarifa alta.
 *   3. Os pagamentos abatem sempre aos dias mais antigos primeiro.
 */

export interface Worker {
  id: string
  name: string
  phone: string | null
  nif: string | null
  notes: string | null
  hourly_rate: number
  /** Fim de semana e feriados. A null usa a tarifa normal. */
  hourly_rate_holiday: number | null
  access_token: string
  pin: string
  active: boolean
  created_at?: string
}

export interface WorkEntry {
  id: string
  worker_id: string
  work_date: string        // AAAA-MM-DD
  start_time: string       // HH:MM
  end_time: string         // HH:MM
  hours: number
  is_holiday: boolean
  hourly_rate: number
  amount: number
  description: string | null
  created_by: string | null
  created_at?: string
}

export interface WorkerPayment {
  id: string
  worker_id: string
  payment_date: string
  amount: number
  payment_method: string | null
  notes: string | null
  expense_id: string | null
  document_id: string | null
  created_at?: string
}

// ---------------------------------------------------------------- horas

/** 'HH:MM' → minutos desde a meia-noite. */
function paraMinutos(hora: string): number {
  const [h, m] = String(hora).slice(0, 5).split(':').map(Number)
  if (isNaN(h) || isNaN(m)) return NaN
  return h * 60 + m
}

/**
 * Horas de um turno, arredondadas ao quarto de hora.
 *
 * Se a saída for anterior à entrada, assume-se que o turno passou da
 * meia-noite (ex.: 22:00 às 02:00 = 4 horas).
 */
export function calcularHoras(inicio: string, fim: string): number {
  const a = paraMinutos(inicio)
  const b = paraMinutos(fim)
  if (isNaN(a) || isNaN(b)) return 0

  let minutos = b - a
  if (minutos < 0) minutos += 24 * 60   // turno que passa da meia-noite
  if (minutos <= 0) return 0

  // Ao quarto de hora COMPLETO: das 08:10 às 17:05 conta 8h45, não 9h.
  // Só contam quartos de hora inteiros efetivamente trabalhados.
  const quartos = Math.floor(minutos / 15)
  return parseFloat((quartos / 4).toFixed(2))
}

/** '8h45' em vez de '8.75' — muito mais fácil de conferir. */
export function formatarHoras(horas: number): string {
  const total = Math.round((horas ?? 0) * 60)
  const h = Math.floor(total / 60)
  const m = total % 60
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

// ---------------------------------------------------------------- feriados

/**
 * Domingo de Páscoa de um ano, pelo algoritmo de Meeus/Jones/Butcher.
 * É a partir dele que se calculam a Sexta-feira Santa e o Corpo de Deus,
 * os dois feriados portugueses que mudam de data todos os anos.
 */
function domingoDePascoa(ano: number): Date {
  const a = ano % 19
  const b = Math.floor(ano / 100)
  const c = ano % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31)
  const dia = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(ano, mes - 1, dia)
}

function paraISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function somarDias(d: Date, dias: number): Date {
  const novo = new Date(d)
  novo.setDate(novo.getDate() + dias)
  return novo
}

/** Feriados nacionais portugueses de um ano, em 'AAAA-MM-DD'. */
export function feriadosNacionais(ano: number): Set<string> {
  const fixos = [
    `${ano}-01-01`, // Ano Novo
    `${ano}-04-25`, // Dia da Liberdade
    `${ano}-05-01`, // Dia do Trabalhador
    `${ano}-06-10`, // Dia de Portugal
    `${ano}-08-15`, // Assunção de Nossa Senhora
    `${ano}-10-05`, // Implantação da República
    `${ano}-11-01`, // Todos os Santos
    `${ano}-12-01`, // Restauração da Independência
    `${ano}-12-08`, // Imaculada Conceição
    `${ano}-12-25`, // Natal
  ]

  const pascoa = domingoDePascoa(ano)
  const moveis = [
    paraISO(somarDias(pascoa, -2)),  // Sexta-feira Santa
    paraISO(pascoa),                 // Domingo de Páscoa
    paraISO(somarDias(pascoa, 60)),  // Corpo de Deus
  ]

  return new Set([...fixos, ...moveis])
}

/**
 * Um dia paga a tarifa alta se for sábado, domingo ou feriado nacional.
 * `extra` permite juntar feriados municipais (em Évora, 29 de junho).
 */
export function ehDiaEspecial(dataISO: string, extra?: Set<string>): boolean {
  if (!dataISO) return false
  const [ano, mes, dia] = dataISO.slice(0, 10).split('-').map(Number)
  const d = new Date(ano, mes - 1, dia)
  const diaSemana = d.getDay()          // 0 = domingo, 6 = sábado
  if (diaSemana === 0 || diaSemana === 6) return true
  if (extra?.has(dataISO.slice(0, 10))) return true
  return feriadosNacionais(ano).has(dataISO.slice(0, 10))
}

/** Motivo da tarifa alta, para explicar no ecrã. */
export function motivoDiaEspecial(dataISO: string): string | null {
  if (!dataISO) return null
  const [ano, mes, dia] = dataISO.slice(0, 10).split('-').map(Number)
  const d = new Date(ano, mes - 1, dia)
  const diaSemana = d.getDay()
  if (diaSemana === 6) return 'sábado'
  if (diaSemana === 0) return 'domingo'
  if (feriadosNacionais(ano).has(dataISO.slice(0, 10))) return 'feriado'
  return null
}

/** Tarifa a aplicar num dia. Sem tarifa de feriado definida, usa a normal. */
export function tarifaDoDia(worker: Pick<Worker, 'hourly_rate' | 'hourly_rate_holiday'>, dataISO: string): number {
  const especial = ehDiaEspecial(dataISO)
  if (especial && worker.hourly_rate_holiday != null && worker.hourly_rate_holiday > 0) {
    return Number(worker.hourly_rate_holiday)
  }
  return Number(worker.hourly_rate ?? 0)
}

// ---------------------------------------------------------------- saldo

export interface EntradaComEstado extends WorkEntry {
  /** Quanto desta entrada já foi coberto por pagamentos. */
  pago: number
  /** Quanto falta receber desta entrada. */
  emFalta: number
  estado: 'pago' | 'parcial' | 'por_pagar'
}

export interface ResumoConta {
  totalGanho: number
  totalPago: number
  saldo: number
  totalHoras: number
  entradas: EntradaComEstado[]
}

/**
 * Distribui os pagamentos pelas entradas, das mais antigas para as mais
 * recentes. Não é preciso guardar esta distribuição na base de dados: é
 * sempre recalculada, por isso nunca fica dessincronizada.
 */
export function calcularConta(entries: WorkEntry[], payments: WorkerPayment[]): ResumoConta {
  const ordenadas = [...(entries ?? [])].sort((a, b) => {
    const d = String(a.work_date).localeCompare(String(b.work_date))
    if (d !== 0) return d
    return String(a.start_time).localeCompare(String(b.start_time))
  })

  const totalGanho = parseFloat(ordenadas.reduce((s, e) => s + Number(e.amount ?? 0), 0).toFixed(2))
  const totalPago = parseFloat((payments ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0).toFixed(2))
  const totalHoras = parseFloat(ordenadas.reduce((s, e) => s + Number(e.hours ?? 0), 0).toFixed(2))

  let porDistribuir = totalPago
  const comEstado: EntradaComEstado[] = ordenadas.map(e => {
    const valor = Number(e.amount ?? 0)
    const pago = parseFloat(Math.min(porDistribuir, valor).toFixed(2))
    porDistribuir = parseFloat((porDistribuir - pago).toFixed(2))
    const emFalta = parseFloat((valor - pago).toFixed(2))
    return {
      ...e,
      pago,
      emFalta,
      estado: emFalta <= 0.005 ? 'pago' : pago > 0 ? 'parcial' : 'por_pagar',
    }
  })

  return {
    totalGanho,
    totalPago,
    saldo: parseFloat((totalGanho - totalPago).toFixed(2)),
    totalHoras,
    // Do mais recente para o mais antigo, que é como se lê no ecrã
    entradas: comEstado.reverse(),
  }
}

/** Token do link secreto: 40 caracteres, impossível de adivinhar. */
export function gerarToken(): string {
  const alfabeto = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(40)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => alfabeto[b % alfabeto.length]).join('')
}

/** Código de 4 dígitos. Evita 0000 e sequências óbvias. */
export function gerarPin(): string {
  const proibidos = new Set(['0000', '1111', '1234', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999'])
  for (let i = 0; i < 50; i++) {
    const bytes = new Uint32Array(1)
    crypto.getRandomValues(bytes)
    const pin = String(bytes[0] % 10000).padStart(4, '0')
    if (!proibidos.has(pin)) return pin
  }
  return '4271'
}
