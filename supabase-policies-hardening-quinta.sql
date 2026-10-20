-- ============================================================================
-- SÓ NA QUINTA — substituir as políticas permissivas "Acesso autenticados"
-- ============================================================================
-- Idempotente: pode correr-se mais do que uma vez sem erro.
-- NÃO correr na SerpaPinto131A: lá estas políticas não existem (já segue o
-- padrão normal). Correr lá não faria mal, mas também não faz falta.
--
-- Nove tabelas da Quinta tinham uma política ALL com USING (true) chamada
-- "Acesso autenticados": qualquer utilizador com sessão — incluindo viewer,
-- electrician e super_reader — podia inserir, alterar e apagar. Passam ao
-- padrão das restantes 36 tabelas: leitura para quem tem sessão, escrita
-- decidida pelo papel (user_role()).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Escrita só para admin e coadmin
-- ----------------------------------------------------------------------------
-- Todos os caminhos da app que escrevem nestas tabelas já estão atrás de
-- (isAdmin || isCoAdmin) no ecrã, ou correm no servidor com a service role
-- (owners, escrita só pelo /api/process-document).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['debts', 'debt_payments', 'owners', 'projects', 'tenant_contacts']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Acesso autenticados" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write', t);

    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
                   t || '_read', t);
    EXECUTE format($f$CREATE POLICY %I ON public.%I FOR ALL TO authenticated
                      USING (user_role() = ANY (ARRAY['admin','coadmin']))
                      WITH CHECK (user_role() = ANY (ARRAY['admin','coadmin']))$f$,
                   t || '_write', t);
  END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- 2. Escrita para admin, coadmin e electrician
-- ----------------------------------------------------------------------------
-- O eletricista trata dos quadros, das leituras e dos preços da luz: nas
-- páginas da eletricidade o botão de Configurações está atrás do mesmo
-- canEdit que o inclui, e o gémeo water_config já o tem na política.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['meters', 'meter_readings', 'electricity_config']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Acesso autenticados" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write', t);

    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
                   t || '_read', t);
    EXECUTE format($f$CREATE POLICY %I ON public.%I FOR ALL TO authenticated
                      USING (user_role() = ANY (ARRAY['admin','coadmin','electrician']))
                      WITH CHECK (user_role() = ANY (ARRAY['admin','coadmin','electrician']))$f$,
                   t || '_write', t);
  END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- 3. dismissed_alerts — aberta a quem tem sessão, de propósito
-- ----------------------------------------------------------------------------
-- Dispensar um alerta é preferência de ecrã, não dado de gestão: o ✕ na
-- página de Alertas não tem (nem precisa de) restrição de papel, e qualquer
-- pessoa que use a app pode limpar a sua lista. Fica com política própria e
-- explícita, em vez da "Acesso autenticados" genérica, para se ver que é
-- intencional e não um esquecimento.
DROP POLICY IF EXISTS "Acesso autenticados" ON public.dismissed_alerts;
DROP POLICY IF EXISTS dismissed_alerts_read ON public.dismissed_alerts;
DROP POLICY IF EXISTS dismissed_alerts_write ON public.dismissed_alerts;

CREATE POLICY dismissed_alerts_read ON public.dismissed_alerts
  FOR SELECT TO authenticated USING (true);
CREATE POLICY dismissed_alerts_write ON public.dismissed_alerts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------------------
-- 4. Verificação
-- ----------------------------------------------------------------------------
SELECT
  coalesce((SELECT string_agg(DISTINCT tablename, ', ' ORDER BY tablename)
            FROM pg_policies
            WHERE schemaname = 'public' AND cmd = 'ALL'
              AND coalesce(qual, 'true') IN ('true', '(true)')
              AND tablename <> 'dismissed_alerts'), 'nenhuma')
    AS tabelas_ainda_com_escrita_aberta,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND policyname = 'Acesso autenticados') AS politicas_antigas_que_sobram,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN
      ('debts','debt_payments','owners','projects','tenant_contacts','meters','meter_readings','electricity_config','dismissed_alerts'))
    AS politicas_nas_nove_tabelas;
