import type { ExpenseCategoryValue } from './expenseCategories'

export type SpaceType = 'pavilhao' | 'habitacao' | 'loja'
export type SpaceStatus = 'arrendado' | 'disponivel'
export type PaymentMethod = 'dinheiro' | 'banco' | 'transferencia'
export type ExpenseCategory = ExpenseCategoryValue
export type ExpenseType = 'recorrente' | 'pontual'
export type UserRole = 'admin' | 'coadmin' | 'viewer' | 'electrician' | 'super_reader'

export interface Profile {
  id: string
  email: string
  role: UserRole
  created_at: string
}

export interface Space {
  id: string
  ref: string
  type: SpaceType
  number: number | null
  status: SpaceStatus
  condition: string | null
  notes: string | null
  created_at: string
}
export interface Tenant {
  id: string
  name: string
  phone: string | null
  email: string | null
  nif: string | null
  notes: string | null
  created_at: string
}
export interface Lease {
  id: string
  space_id: string
  tenant_id: string
  monthly_rent: number
  deposit: number | null
  start_date: string
  end_date: string | null
  status: 'ativo' | 'terminado'
  notes: string | null
  contract_file_path: string | null
  created_at: string
  space?: Space
  tenant?: Tenant
}
export interface RentPayment {
  id: string
  lease_id: string
  payment_date: string | null
  reference_month: string
  amount: number
  payment_method: PaymentMethod | null
  notes: string | null
  created_at: string
  lease?: Lease
}
export interface ElectricityReading {
  id: string
  space_id: string
  reading_date: string
  reading_value: number
  notes: string | null
  created_at: string
  space?: Space
}
export interface ElectricityCharge {
  id: string
  lease_id: string
  charge_date: string
  reference_month: string
  units: number | null
  amount: number
  paid: boolean
  payment_date: string | null
  payment_method: PaymentMethod | null
  notes: string | null
  created_at: string
  lease?: Lease
}
export interface Expense {
  id: string
  expense_date: string
  category: ExpenseCategory
  type: ExpenseType
  description: string
  amount: number
  payment_method: PaymentMethod | null
  supplier: string | null
  invoice_file_path: string | null
  notes: string | null
  created_at: string
}
export interface Debt {
  id: string
  tenant_id: string
  description: string
  original_amount: number
  reference_date: string
  created_at: string
  tenant?: Tenant
  payments?: DebtPayment[]
}
export interface DebtPayment {
  id: string
  debt_id: string
  payment_date: string
  amount: number
  payment_method: PaymentMethod | null
  notes: string | null
  created_at: string
  debt?: Debt
}
export interface Bank {
  id: string
  name: string
  holder_name: string | null
  iban: string | null
  account_number: string | null
  notes: string | null
  column_mapping: Record<string, string> | null
  created_at: string
}
export type BankTransactionStatus = 'por_validar' | 'validado' | 'ignorado'
export interface BankTransaction {
  id: string
  bank_id: string
  transaction_date: string
  description: string
  amount: number
  balance: number | null
  reference: string | null
  import_code: string | null
  status: BankTransactionStatus
  suggested_type: string | null
  suggested_lease_id: string | null
  confirmed_type: string | null
  confirmed_tenant_id: string | null
  confirmed_lease_id: string | null
  confirmed_expense_id: string | null
  confirmed_income_id: string | null
  confirmed_document_id: string | null
  skip_processing: boolean | null
  notes: string | null
  created_at: string
}
export type NoteType = 'chamada' | 'geral' | 'lembrete' | 'outro'
export interface Note {
  id: string
  title: string
  description: string | null
  type: NoteType
  note_date: string
  note_time: string | null
  space_id: string | null
  tenant_id: string | null
  has_reminder: boolean
  reminder_date: string | null
  reminder_time: string | null
  reminder_seen_at: string | null
  dismissed: boolean
  archived?: boolean
  created_by: string | null
  created_at: string
  space?: Space
  tenant?: Tenant
  creator?: Profile
}
export interface CashFundMovement {
  id: string
  movement_date: string
  description: string
  amount: number
  type: 'entrada' | 'saida' | 'transferencia'
  notes: string | null
  created_at: string
}
