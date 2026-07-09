export type SpaceType = 'pavilhao' | 'habitacao' | 'loja'
export type SpaceStatus = 'arrendado' | 'disponivel'
export type PaymentMethod = 'dinheiro' | 'banco' | 'transferencia'
export type ExpenseCategory = 'obras' | 'edp' | 'pessoal' | 'contabilidade' | 'manutencao' | 'outros'
export type ExpenseType = 'recorrente' | 'pontual'
export type UserRole = 'admin' | 'coadmin' | 'viewer' | 'electrician'

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
export interface CashFundMovement {
  id: string
  movement_date: string
  description: string
  amount: number
  type: 'entrada' | 'saida' | 'transferencia'
  notes: string | null
  created_at: string
}
