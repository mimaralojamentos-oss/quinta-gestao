-- ============================================
-- QUINTA MANAGEMENT - SUPABASE DATABASE SCHEMA
-- Execute este SQL no Supabase SQL Editor
-- ============================================

-- Espaços (pavilhões, habitações, casas)
CREATE TABLE IF NOT EXISTS spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref VARCHAR(10) UNIQUE NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('pavilhao', 'habitacao', 'casa')),
  status VARCHAR(20) DEFAULT 'disponivel' CHECK (status IN ('arrendado', 'disponivel')),
  condition TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Inquilinos
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  email VARCHAR(255),
  nif VARCHAR(20),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Contratos de arrendamento
CREATE TABLE IF NOT EXISTS leases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID REFERENCES spaces(id) ON DELETE RESTRICT,
  tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT,
  monthly_rent DECIMAL(10,2) NOT NULL,
  deposit DECIMAL(10,2),
  start_date DATE NOT NULL,
  end_date DATE,
  status VARCHAR(20) DEFAULT 'ativo' CHECK (status IN ('ativo', 'terminado')),
  notes TEXT,
  contract_file_path TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Pagamentos de renda
CREATE TABLE IF NOT EXISTS rent_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id UUID REFERENCES leases(id) ON DELETE RESTRICT,
  payment_date DATE,
  reference_month DATE NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  payment_method VARCHAR(20) CHECK (payment_method IN ('dinheiro', 'banco', 'transferencia')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Leituras de contadores de eletricidade
CREATE TABLE IF NOT EXISTS electricity_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID REFERENCES spaces(id) ON DELETE RESTRICT,
  reading_date DATE NOT NULL,
  reading_value DECIMAL(12,3) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Cobranças de eletricidade a inquilinos
CREATE TABLE IF NOT EXISTS electricity_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id UUID REFERENCES leases(id) ON DELETE RESTRICT,
  charge_date DATE NOT NULL,
  reference_month DATE NOT NULL,
  units DECIMAL(12,3),
  amount DECIMAL(10,2) NOT NULL,
  paid BOOLEAN DEFAULT FALSE,
  payment_date DATE,
  payment_method VARCHAR(20) CHECK (payment_method IN ('dinheiro', 'banco', 'transferencia')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Despesas da quinta
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date DATE NOT NULL,
  category VARCHAR(50) NOT NULL CHECK (category IN ('obras', 'edp', 'pessoal', 'contabilidade', 'manutencao', 'outros')),
  type VARCHAR(20) NOT NULL CHECK (type IN ('recorrente', 'pontual')),
  description TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  payment_method VARCHAR(20) CHECK (payment_method IN ('dinheiro', 'banco', 'transferencia')),
  supplier VARCHAR(255),
  invoice_file_path TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Fundo de caixa
CREATE TABLE IF NOT EXISTS cash_fund_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_date DATE NOT NULL,
  description TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  type VARCHAR(20) CHECK (type IN ('entrada', 'saida', 'transferencia')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- POLÍTICAS DE ACESSO (Row Level Security)
-- ============================================

ALTER TABLE spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE rent_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE electricity_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE electricity_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_fund_movements ENABLE ROW LEVEL SECURITY;

-- Permitir acesso total a utilizadores autenticados
CREATE POLICY "Authenticated users can do everything" ON spaces FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can do everything" ON tenants FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can do everything" ON leases FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can do everything" ON rent_payments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can do everything" ON electricity_readings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can do everything" ON electricity_charges FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can do everything" ON expenses FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can do everything" ON cash_fund_movements FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================
-- STORAGE BUCKET para documentos
-- ============================================

-- Criar bucket 'documents' no Supabase Storage
-- (fazer manualmente no painel Supabase > Storage > New bucket)
-- Nome: documents
-- Public: NÃO (privado)

-- ============================================
-- DADOS INICIAIS - Espaços da Quinta
-- (baseado no ficheiro Geral Quinta)
-- ============================================

INSERT INTO spaces (ref, type, status, notes) VALUES
('P00', 'pavilhao', 'arrendado', 'Oficina e armazém'),
('P01', 'pavilhao', 'arrendado', 'Oficina geral com elevador da casa'),
('P02', 'pavilhao', 'arrendado', 'Lavagens de viaturas'),
('P04', 'pavilhao', 'arrendado', 'Armazém'),
('P05', 'pavilhao', 'arrendado', 'Oficina'),
('P06', 'pavilhao', 'arrendado', 'Armazém'),
('P07', 'pavilhao', 'disponivel', NULL),
('P08', 'pavilhao', 'arrendado', 'Armazém'),
('P09', 'pavilhao', 'arrendado', 'Armazém e Oficina'),
('P10', 'pavilhao', 'arrendado', 'Armazém'),
('P11', 'pavilhao', 'arrendado', 'Oficina'),
('P12', 'pavilhao', 'arrendado', 'Oficina'),
('P13', 'pavilhao', 'arrendado', 'Oficina'),
('P14', 'pavilhao', 'arrendado', 'Oficina'),
('P16', 'pavilhao', 'arrendado', NULL),
('P17', 'pavilhao', 'arrendado', 'Armazém + Oficina'),
('P18', 'pavilhao', 'arrendado', 'Armazém'),
('P19', 'pavilhao', 'disponivel', 'Em série com P21'),
('P20', 'pavilhao', 'disponivel', 'Em série com P21'),
('P21', 'pavilhao', 'disponivel', NULL),
('P22', 'pavilhao', 'disponivel', 'Sem cabo'),
('P23', 'pavilhao', 'arrendado', NULL),
('P24N', 'pavilhao', 'arrendado', 'Carpinteiros'),
('P24S', 'pavilhao', 'arrendado', 'Pintor'),
('P25', 'pavilhao', 'arrendado', 'Armazém'),
('P26', 'pavilhao', 'arrendado', 'Armazém'),
('P27', 'pavilhao', 'arrendado', 'Oficina'),
('P28', 'pavilhao', 'disponivel', NULL),
('P29', 'pavilhao', 'arrendado', 'Armazém'),
('P30', 'pavilhao', 'arrendado', 'Armazém'),
('P31', 'pavilhao', 'disponivel', NULL),
('P32', 'pavilhao', 'disponivel', 'Sem cabo'),
('H21', 'habitacao', 'arrendado', NULL),
('H33', 'habitacao', 'arrendado', 'Habitação'),
('H34', 'habitacao', 'arrendado', 'Habitação'),
('H35', 'habitacao', 'arrendado', 'Habitação'),
('H36', 'habitacao', 'arrendado', 'Habitação'),
('H37', 'habitacao', 'arrendado', 'Habitação - ótimo estado'),
('H38', 'casa', 'disponivel', NULL)
ON CONFLICT (ref) DO NOTHING;
