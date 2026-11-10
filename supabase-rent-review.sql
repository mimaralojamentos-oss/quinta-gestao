-- ============================================================================
-- OS DOIS PROJETOS — Revisão de Rendas (estudo anual)
-- ============================================================================
-- Idempotente: pode correr-se mais do que uma vez sem erro.
-- Correr no Quinta-Gestão E na SerpaPinto131A (cola o ficheiro COMPLETO).
--
-- É SÓ UM ESTUDO. Estas tabelas guardam o exercício anual de revisão de
-- preços; os contratos, as rendas e os pagamentos reais nunca são alterados
-- pela página. O valor atual de cada fração é uma FOTOGRAFIA tirada quando o
-- estudo é criado e guardada aqui — é o que permite abrir o estudo do ano
-- passado e ver os números com que se decidiu, mesmo que as rendas já tenham
-- mudado.
--
-- ATENÇÃO AOS PRIVILÉGIOS POR OMISSÃO: uma tabela nova NÃO nasce fechada. O
-- supabase-grants-public.sql deixou ALTER DEFAULT PRIVILEGES a dar
-- SELECT/INSERT/UPDATE/DELETE ao authenticated em tudo o que se criar no
-- public, por isso cada tabela aqui começa por um REVOKE ALL explícito e só
-- depois recebe o que é para ter.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. O estudo (um por ano)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rent_review_studies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  /** O ano a que a revisão se aplica (o primeiro estudo é para 2027). */
  ano         integer NOT NULL,
  /** Multiplicador do IPC: 1.0256 é +2,56%. Escreve-se no ecrã das duas formas. */
  coeficiente numeric NOT NULL DEFAULT 1,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  -- Um estudo por ano: abrir o mesmo ano duas vezes não cria dois exercícios.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'rent_review_studies_ano_key'
                   AND conrelid = 'public.rent_review_studies'::regclass) THEN
    ALTER TABLE public.rent_review_studies
      ADD CONSTRAINT rent_review_studies_ano_key UNIQUE (ano);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'rent_review_studies_ano_check'
                   AND conrelid = 'public.rent_review_studies'::regclass) THEN
    ALTER TABLE public.rent_review_studies
      ADD CONSTRAINT rent_review_studies_ano_check CHECK (ano BETWEEN 2020 AND 2100);
  END IF;

  -- Um coeficiente fora deste intervalo é engano de escrita, não uma decisão.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'rent_review_studies_coeficiente_check'
                   AND conrelid = 'public.rent_review_studies'::regclass) THEN
    ALTER TABLE public.rent_review_studies
      ADD CONSTRAINT rent_review_studies_coeficiente_check CHECK (coeficiente BETWEEN 0.5 AND 2);
  END IF;
END $$;


-- ----------------------------------------------------------------------------
-- 2. As linhas do estudo (uma por fração com contrato ativo)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rent_review_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id          uuid NOT NULL REFERENCES public.rent_review_studies(id) ON DELETE CASCADE,
  /** A fração. ON DELETE RESTRICT: apagar um espaço não apaga história de estudos. */
  space_id          uuid NOT NULL REFERENCES public.spaces(id) ON DELETE RESTRICT,
  /** Capturados na criação do estudo — a fotografia, que não se mexe sozinha. */
  space_ref         text NOT NULL,
  tenant_name       text,
  valor_atual       numeric NOT NULL,
  lease_id          uuid,
  lease_start_date  date,
  /** false = fração excluída do exercício: o valor a pedir é o atual. */
  com_aumento       boolean NOT NULL DEFAULT true,
  /** NULL = segue o recomendado (valor atual × coeficiente). */
  valor_a_pedir     numeric,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  -- Uma linha por fração em cada estudo.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'rent_review_items_estudo_fracao_key'
                   AND conrelid = 'public.rent_review_items'::regclass) THEN
    ALTER TABLE public.rent_review_items
      ADD CONSTRAINT rent_review_items_estudo_fracao_key UNIQUE (study_id, space_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'rent_review_items_valores_check'
                   AND conrelid = 'public.rent_review_items'::regclass) THEN
    ALTER TABLE public.rent_review_items
      ADD CONSTRAINT rent_review_items_valores_check
      CHECK (valor_atual >= 0 AND (valor_a_pedir IS NULL OR valor_a_pedir >= 0));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS rent_review_items_estudo_idx ON public.rent_review_items (study_id);


-- ----------------------------------------------------------------------------
-- 3. RLS, políticas e GRANTs — conforme as regras do AGENTS.md
-- ----------------------------------------------------------------------------
-- O estudo é matéria de gestão: admin e coadmin leem e escrevem, mais ninguém.
ALTER TABLE public.rent_review_studies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rent_review_items   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rent_review_studies_read ON public.rent_review_studies;
CREATE POLICY rent_review_studies_read ON public.rent_review_studies
  FOR SELECT TO authenticated USING (user_role() = ANY (ARRAY['admin', 'coadmin']));
DROP POLICY IF EXISTS rent_review_studies_write ON public.rent_review_studies;
CREATE POLICY rent_review_studies_write ON public.rent_review_studies
  FOR ALL TO authenticated
  USING (user_role() = ANY (ARRAY['admin', 'coadmin']))
  WITH CHECK (user_role() = ANY (ARRAY['admin', 'coadmin']));

DROP POLICY IF EXISTS rent_review_items_read ON public.rent_review_items;
CREATE POLICY rent_review_items_read ON public.rent_review_items
  FOR SELECT TO authenticated USING (user_role() = ANY (ARRAY['admin', 'coadmin']));
DROP POLICY IF EXISTS rent_review_items_write ON public.rent_review_items;
CREATE POLICY rent_review_items_write ON public.rent_review_items
  FOR ALL TO authenticated
  USING (user_role() = ANY (ARRAY['admin', 'coadmin']))
  WITH CHECK (user_role() = ANY (ARRAY['admin', 'coadmin']));

-- Primeiro tirar tudo (por causa dos privilégios por omissão), depois dar.
REVOKE ALL ON TABLE public.rent_review_studies FROM authenticated, anon;
REVOKE ALL ON TABLE public.rent_review_items   FROM authenticated, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rent_review_studies TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rent_review_items   TO authenticated;
GRANT ALL ON TABLE public.rent_review_studies TO service_role;
GRANT ALL ON TABLE public.rent_review_items   TO service_role;


-- ----------------------------------------------------------------------------
-- 4. Auditoria — o estudo é uma decisão de gestão, fica registado
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_auditoria ON public.rent_review_studies;
CREATE TRIGGER trg_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.rent_review_studies
  FOR EACH ROW EXECUTE FUNCTION registar_auditoria();

DROP TRIGGER IF EXISTS trg_auditoria ON public.rent_review_items;
CREATE TRIGGER trg_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.rent_review_items
  FOR EACH ROW EXECUTE FUNCTION registar_auditoria();


NOTIFY pgrst, 'reload schema';


-- ----------------------------------------------------------------------------
-- 5. Verificação
-- ----------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM public.rent_review_studies)                                     AS estudos,
  (SELECT count(*) FROM public.rent_review_items)                                       AS linhas,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
     AND tablename IN ('rent_review_studies', 'rent_review_items'))                     AS politicas,
  (SELECT has_table_privilege('authenticated', 'public.rent_review_items', 'UPDATE'))    AS authenticated_escreve,
  (SELECT has_table_privilege('anon', 'public.rent_review_studies', 'SELECT'))           AS falha_anon_le,
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE NOT t.tgisinternal AND c.relname IN ('rent_review_studies', 'rent_review_items')) AS triggers,
  -- Quantas frações entrariam num estudo criado hoje
  (SELECT count(*) FROM public.leases WHERE status = 'ativo')                            AS contratos_ativos_hoje,
  (SELECT round(sum(monthly_rent)::numeric, 2) FROM public.leases WHERE status = 'ativo') AS renda_mensal_total_hoje;
