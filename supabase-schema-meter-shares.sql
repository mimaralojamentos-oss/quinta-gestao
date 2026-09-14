-- ============================================================================
-- OS DOIS PROJETOS — contador partilhado (luz e água) com divisão por percentagem
-- ============================================================================
-- Idempotente: pode correr-se mais do que uma vez sem erro.
-- Correr no Quinta-Gestão E na Serpa Pinto (cola o ficheiro COMPLETO).
--
-- Modelo:
--   Um espaço "titular" tem o contador e as leituras (como hoje). Se partilhar
--   a cobrança, existe uma linha por espaço participante — INCLUINDO o próprio
--   titular — com a sua percentagem. As percentagens do grupo somam 100
--   (validado na aplicação, que também recusa cobrar se não somarem).
--
--   Ex. apartamento 7, luz 50/50, contador no A07-A:
--     (luz, owner=A07-A, space=A07-A, 50)
--     (luz, owner=A07-A, space=A07-B, 50)
--
--   Espaço sem linhas = sem partilha = comportamento exatamente igual ao atual.
--   Luz e água configuram-se em separado (coluna service).
--   Um espaço só pode pertencer a um grupo por serviço (UNIQUE service+space).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Configuração da partilha
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meter_shares (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service         text NOT NULL,
  owner_space_id  uuid NOT NULL REFERENCES public.spaces(id) ON DELETE RESTRICT,
  space_id        uuid NOT NULL REFERENCES public.spaces(id) ON DELETE RESTRICT,
  percentage      numeric(5,2) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meter_shares_service_check' AND conrelid = 'public.meter_shares'::regclass) THEN
    ALTER TABLE public.meter_shares
      ADD CONSTRAINT meter_shares_service_check CHECK (service IN ('luz', 'agua'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meter_shares_percentage_check' AND conrelid = 'public.meter_shares'::regclass) THEN
    ALTER TABLE public.meter_shares
      ADD CONSTRAINT meter_shares_percentage_check CHECK (percentage > 0 AND percentage <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meter_shares_service_space_key' AND conrelid = 'public.meter_shares'::regclass) THEN
    ALTER TABLE public.meter_shares
      ADD CONSTRAINT meter_shares_service_space_key UNIQUE (service, space_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS meter_shares_owner_idx ON public.meter_shares (service, owner_space_id);


-- ----------------------------------------------------------------------------
-- 2. Retrato da divisão em cada leitura cobrada
-- ----------------------------------------------------------------------------
-- Guardado no momento da cobrança, para a divisão ficar registada mesmo que a
-- configuração mude depois — e para a parte de um espaço SEM contrato ativo
-- ficar visível como "por cobrar" em vez de desaparecer.
-- NULL = leitura sem partilha (todas as leituras de hoje).
-- Formato: [{ "space_id", "ref", "percentage", "amount", "lease_id" | null, "charge_id" | null }]
ALTER TABLE public.electricity_readings ADD COLUMN IF NOT EXISTS share_split jsonb;
ALTER TABLE public.water_readings       ADD COLUMN IF NOT EXISTS share_split jsonb;


-- ----------------------------------------------------------------------------
-- 3. RLS — leitura para todos os autenticados (como spaces); escrita só
--    admin/coadmin (é configuração do espaço, como spaces_write)
-- ----------------------------------------------------------------------------
ALTER TABLE public.meter_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meter_shares_read ON public.meter_shares;
CREATE POLICY meter_shares_read ON public.meter_shares FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS meter_shares_write ON public.meter_shares;
CREATE POLICY meter_shares_write ON public.meter_shares FOR ALL TO authenticated
  USING (user_role() = ANY (ARRAY['admin', 'coadmin']))
  WITH CHECK (user_role() = ANY (ARRAY['admin', 'coadmin']));


-- ----------------------------------------------------------------------------
-- 4. Auditoria — mesmo trigger de spaces e das leituras
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_auditoria ON public.meter_shares;
CREATE TRIGGER trg_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.meter_shares
  FOR EACH ROW EXECUTE FUNCTION registar_auditoria();


-- Recarregar o cache do PostgREST para a tabela e as colunas ficarem logo na API.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Fim. Depois de correr nos DOIS projetos, confirma para eu avançar.
-- ============================================================================
