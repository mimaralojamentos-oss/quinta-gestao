-- ============================================================================
-- Módulo de ÁGUA — schema espelhado no módulo de Eletricidade
-- ============================================================================
--
-- Este ficheiro é idempotente (pode ser corrido várias vezes sem partir nada)
-- e é para correr, na íntegra, no SQL Editor de CADA UM dos dois projetos
-- Supabase (Quinta-Gestão e SerpaPinto131A) — partilham o código mas têm
-- bases de dados separadas.
--
-- NÃO TOCA em nenhuma tabela, política, trigger ou dado do módulo de
-- eletricidade (meters, meter_readings, electricity_readings,
-- electricity_charges, electricity_config) — duplicação deliberada, para
-- risco zero no módulo que já funciona.
--
-- Espelhamento tabela a tabela (nomes da luz → nomes da água):
--   meters                → water_meters              (contadores gerais do prédio/quinta)
--   meter_readings        → water_meter_readings       (leituras + fatura desses contadores)
--   electricity_readings  → water_readings             (leituras por espaço, com oferta/acumulado)
--   electricity_charges   → water_charges              (cobrança ao inquilino)
--   electricity_config    → water_config               (preço, singleton)
--   spaces.has_own_meter  → spaces.has_own_water_meter (espaço com contador de água próprio)
--
-- Diferenças deliberadas face ao espelho 1:1, e porquê:
--   - meters.cpe (Código do Ponto de Entrega — conceito específico da rede
--     elétrica) não faz sentido em água; substituído por
--     water_meters.meter_number (nº de série do contador físico).
--   - electricity_readings.accumulated_from_ids existe na tabela da luz mas
--     está morta (sem nenhuma leitura no código atual) — não foi replicada.
--   - electricity_readings.kwh_consumed → water_readings.m3_consumed
--     (mesmo papel, unidade diferente). electricity_charges.units mantém-se
--     "units" em water_charges (já era um nome neutro — passa a guardar m³).
--   - water_config inclui vat_rate e min_charge tal como electricity_config,
--     para o código de cálculo poder ser um espelho exato (preço × (1+IVA),
--     limite mínimo para cobrar) — mas com valor neutro (0), para o
--     resultado ser hoje simplesmente "consumo (m³) × preço", como foi
--     pedido. Ficam prontos para ativar mais tarde sem migração, se a água
--     alguma vez também tiver IVA ou um mínimo de fatura.
--
-- RLS: reutiliza os mesmos 3 perfis de escrita da luz (admin, coadmin,
-- electrician) em vez de criar um perfil novo (ex.: "canalizador") — evita
-- mexer no sistema de permissões (a tabela profiles tem um CHECK fixo com 5
-- perfis, e o ecrã /utilizadores) só por causa disto. Fica fácil de mudar
-- mais tarde se fizer sentido ter um perfil próprio para a água.
--
-- Nota sobre uma política encontrada durante o estudo: as tabelas "meters"
-- e "meter_readings" têm hoje uma política extra "Acesso autenticados" (ALL,
-- USING true) que, por ser permissiva, na prática anula a restrição de
-- escrita a admin/coadmin/electrician — qualquer utilizador autenticado
-- consegue escrever nelas. Não repliquei essa política solta aqui: as
-- tabelas de água usam sempre o padrão correto (leitura para todos, escrita
-- restrita), igual ao que já protege electricity_readings/electricity_charges.
-- Não alterei nada nas tabelas da luz.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. spaces.has_own_water_meter
-- ----------------------------------------------------------------------------
-- Espelha spaces.has_own_meter: espaços com contador de água próprio ficam
-- de fora da lista de "Contadores dos Espaços" (faturados fora deste
-- módulo, tal como H34 já fica de fora da luz).
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS has_own_water_meter BOOLEAN DEFAULT false;


-- ----------------------------------------------------------------------------
-- 2. water_meters — espelha "meters" (Contadores Gerais)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS water_meters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contract_number TEXT NOT NULL,
  meter_number TEXT,
  location TEXT,
  notes TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 3. water_meter_readings — espelha "meter_readings"
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS water_meter_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id UUID REFERENCES water_meters(id) ON DELETE CASCADE,
  reading_date DATE NOT NULL,
  reading_value NUMERIC NOT NULL,
  invoice_amount NUMERIC,
  invoice_number TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 4. water_readings — espelha "electricity_readings" (leituras por espaço)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS water_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID REFERENCES spaces(id) ON DELETE RESTRICT,
  reading_date DATE NOT NULL,
  reading_value NUMERIC NOT NULL,
  previous_value NUMERIC,
  m3_consumed NUMERIC,
  amount_calculated NUMERIC,
  charged BOOLEAN DEFAULT false,
  accumulated BOOLEAN DEFAULT false,
  -- Leitura registada mas deliberadamente não cobrada (oferta) — nunca
  -- volta a acumular para a leitura seguinte. Espelha electricity_readings.waived.
  waived BOOLEAN NOT NULL DEFAULT false,
  waived_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 5. water_charges — espelha "electricity_charges" (cobrança ao inquilino)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS water_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id UUID REFERENCES leases(id) ON DELETE RESTRICT,
  charge_date DATE NOT NULL,
  reference_month DATE NOT NULL,
  units NUMERIC,
  amount NUMERIC NOT NULL,
  paid BOOLEAN DEFAULT false,
  payment_date DATE,
  payment_method VARCHAR CHECK (payment_method IN ('dinheiro', 'banco', 'transferencia')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  amount_paid NUMERIC DEFAULT 0,
  -- Liga-se sempre à leitura que a gerou — é assim que uma oferta
  -- posterior encontra e apaga a cobrança correspondente (mesma lógica de
  -- encontrarCobrancaDaLeitura em eletricidade).
  reading_id UUID REFERENCES water_readings(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS water_charges_reading_id_idx ON water_charges(reading_id);

-- ----------------------------------------------------------------------------
-- 6. water_config — espelha "electricity_config" (singleton)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS water_config (
  id SERIAL PRIMARY KEY,
  price_per_m3 NUMERIC NOT NULL DEFAULT 1.50,
  -- Neutros por omissão — ver nota no cabeçalho do ficheiro.
  vat_rate NUMERIC NOT NULL DEFAULT 0,
  min_charge NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Garante que existe sempre exatamente uma linha de configuração, tal como
-- acontece hoje em electricity_config (lido com .single()).
INSERT INTO water_config (price_per_m3, vat_rate, min_charge)
SELECT 1.50, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM water_config);


-- ----------------------------------------------------------------------------
-- 7. RLS — mesmo padrão de electricity_readings/electricity_charges
-- ----------------------------------------------------------------------------
ALTER TABLE water_meters ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_meter_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS water_meters_read ON water_meters;
CREATE POLICY water_meters_read ON water_meters FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS water_meters_write ON water_meters;
CREATE POLICY water_meters_write ON water_meters FOR ALL TO authenticated
  USING (user_role() = ANY (ARRAY['admin', 'coadmin', 'electrician']))
  WITH CHECK (user_role() = ANY (ARRAY['admin', 'coadmin', 'electrician']));

DROP POLICY IF EXISTS water_meter_readings_read ON water_meter_readings;
CREATE POLICY water_meter_readings_read ON water_meter_readings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS water_meter_readings_write ON water_meter_readings;
CREATE POLICY water_meter_readings_write ON water_meter_readings FOR ALL TO authenticated
  USING (user_role() = ANY (ARRAY['admin', 'coadmin', 'electrician']))
  WITH CHECK (user_role() = ANY (ARRAY['admin', 'coadmin', 'electrician']));

DROP POLICY IF EXISTS water_readings_read ON water_readings;
CREATE POLICY water_readings_read ON water_readings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS water_readings_write ON water_readings;
CREATE POLICY water_readings_write ON water_readings FOR ALL TO authenticated
  USING (user_role() = ANY (ARRAY['admin', 'coadmin', 'electrician']))
  WITH CHECK (user_role() = ANY (ARRAY['admin', 'coadmin', 'electrician']));

DROP POLICY IF EXISTS water_charges_read ON water_charges;
CREATE POLICY water_charges_read ON water_charges FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS water_charges_write ON water_charges;
CREATE POLICY water_charges_write ON water_charges FOR ALL TO authenticated
  USING (user_role() = ANY (ARRAY['admin', 'coadmin', 'electrician']))
  WITH CHECK (user_role() = ANY (ARRAY['admin', 'coadmin', 'electrician']));

DROP POLICY IF EXISTS water_config_read ON water_config;
CREATE POLICY water_config_read ON water_config FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS water_config_write ON water_config;
CREATE POLICY water_config_write ON water_config FOR ALL TO authenticated
  USING (user_role() = ANY (ARRAY['admin', 'coadmin', 'electrician']))
  WITH CHECK (user_role() = ANY (ARRAY['admin', 'coadmin', 'electrician']));


-- ----------------------------------------------------------------------------
-- 8. Auditoria — espelha os triggers de electricity_readings/electricity_charges
--    (meters/meter_readings também não têm, por isso water_meters/
--    water_meter_readings ficam de fora aqui também, para espelhar exatamente).
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_auditoria ON water_readings;
CREATE TRIGGER trg_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON water_readings
  FOR EACH ROW EXECUTE FUNCTION registar_auditoria();

DROP TRIGGER IF EXISTS trg_auditoria ON water_charges;
CREATE TRIGGER trg_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON water_charges
  FOR EACH ROW EXECUTE FUNCTION registar_auditoria();

-- ============================================================================
-- Fim. Depois de correr isto nos DOIS projetos, confirma para eu avançar
-- para a Fase 2 (implementação).
-- ============================================================================
