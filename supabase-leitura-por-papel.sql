-- ============================================================================
-- OS DOIS PROJETOS — Só quem tem papel atribuído lê
-- ============================================================================
-- Idempotente: pode correr-se mais do que uma vez sem erro.
-- Correr no Quinta-Gestão E na SerpaPinto131A (cola o ficheiro COMPLETO).
--
-- PORQUE É QUE ISTO EXISTE
-- As políticas de leitura eram todas USING (true): qualquer sessão lia tudo.
-- Com a conta nova a nascer 'pendente' (ver supabase-signup-pendente.sql),
-- isso deixava um pendente a ler todos os dados de gestão — só não escrevia.
-- A etiqueta "sem acesso" prometia mais do que entregava.
--
-- Passa a ser preciso TER PAPEL ATRIBUÍDO para ler: admin, coadmin,
-- electrician, viewer ou super_reader. Fica de fora quem não tem perfil
-- (user_role() devolve NULL) e quem está 'pendente'.
--
-- A tabela profiles fica DE PROPÓSITO fora da regra: cada um tem de poder
-- ler o seu próprio perfil, senão a app não descobre o papel e ninguém
-- entra — incluindo os administradores.
--
-- A escrita não é tocada: continua decidida pelas políticas de escrita de
-- cada tabela, que já olham ao papel.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Leitura: de "qualquer sessão" para "quem tem papel atribuído"
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  p record;
  n integer := 0;
BEGIN
  FOR p IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND cmd = 'SELECT'
      AND coalesce(qual, 'true') IN ('true', '(true)')
      AND tablename <> 'profiles'          -- ver a nota no cabeçalho
    ORDER BY tablename, policyname
  LOOP
    EXECUTE format(
      'ALTER POLICY %I ON public.%I USING (user_role() = ANY (ARRAY[%L, %L, %L, %L, %L]))',
      p.policyname, p.tablename, 'admin', 'coadmin', 'electrician', 'viewer', 'super_reader');
    n := n + 1;
  END LOOP;
  RAISE NOTICE '% política(s) de leitura passaram a exigir papel atribuído', n;
END $$;


-- ----------------------------------------------------------------------------
-- 2. Funções de trigger: sem EXECUTE para authenticated
-- ----------------------------------------------------------------------------
-- registar_auditoria e handle_new_user só servem para disparar com as
-- escritas e com a criação de contas. O privilégio de EXECUTE é verificado
-- quando o trigger é criado, não a cada disparo, por isso retirá-lo não
-- afeta a auditoria nem a criação de utilizadores — só fecha a porta de
-- /rest/v1/rpc/<nome> a quem tem sessão.
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS assinatura
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('registar_auditoria', 'handle_new_user')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f.assinatura);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.assinatura);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f.assinatura);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.assinatura);
  END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- 3. Verificação
-- ----------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND cmd = 'SELECT'
      AND coalesce(qual, 'true') ILIKE '%user_role%')                       AS leituras_por_papel,
  (SELECT coalesce(string_agg(DISTINCT tablename, ', ' ORDER BY tablename), 'nenhuma')
     FROM pg_policies
    WHERE schemaname = 'public' AND cmd = 'SELECT'
      AND coalesce(qual, 'true') IN ('true', '(true)'))                      AS leitura_ainda_aberta,
  (SELECT coalesce(string_agg(DISTINCT tablename, ', ' ORDER BY tablename), 'nenhuma')
     FROM pg_policies
    WHERE schemaname = 'public' AND cmd = 'ALL'
      AND coalesce(qual, 'true') IN ('true', '(true)'))                      AS escrita_ainda_aberta,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('registar_auditoria', 'handle_new_user')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE'))         AS falha_triggers_com_execute,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('user_role', 'is_admin')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))     AS falha_user_role_sem_execute;
