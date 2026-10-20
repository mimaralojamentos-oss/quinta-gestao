-- ============================================================================
-- OS DOIS PROJETOS — Endurecimento das funções do schema public
-- ============================================================================
-- Idempotente: pode correr-se mais do que uma vez sem erro.
-- Correr no Quinta-Gestão E na SerpaPinto131A (cola o ficheiro COMPLETO).
--
-- Trata dois achados dos advisors de segurança do Supabase:
--
-- 1. search_path mutável (function_search_path_mutable)
--    Uma função sem search_path fixo resolve os nomes das tabelas pelo
--    search_path de quem a chama. Quem conseguir criar um schema à frente
--    do public pode fazer a função ler ou escrever noutra tabela — e nas
--    funções SECURITY DEFINER isso corre com os privilégios do dono.
--    Fixa-se em "public, pg_temp" (o pg_temp vai no fim de propósito, para
--    tabelas temporárias nunca se fazerem passar pelas verdadeiras).
--
-- 2. EXECUTE aberto a todos (anon_security_definer_function_executable)
--    Em Postgres as funções nascem executáveis por PUBLIC, o que no
--    Supabase significa chamáveis sem sessão em /rest/v1/rpc/<nome>.
--    Retira-se o EXECUTE a PUBLIC e ao anon, e dá-se explicitamente a
--    authenticated e service_role.
--
--    Os TRIGGERS não são afetados: o privilégio de EXECUTE é verificado
--    quando o trigger é criado, não cada vez que dispara. A auditoria
--    (registar_auditoria) continua a funcionar.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. search_path fixo em todas as funções do public que não o tenham
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS assinatura
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind IN ('f', 'p')          -- funções e procedimentos
      AND p.proconfig IS NULL              -- ainda sem search_path próprio
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', f.assinatura);
    RAISE NOTICE 'search_path fixado em %', f.assinatura;
  END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- 2. EXECUTE só para quem precisa
-- ----------------------------------------------------------------------------
-- As funções de trigger ficam também sem EXECUTE para o anon: não servem
-- para ser chamadas pela API, só para dispararem com as escritas.
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS assinatura
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.assinatura);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f.assinatura);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f.assinatura);
  END LOOP;
END $$;

-- As funções novas, criadas de agora em diante por quem corre este SQL,
-- já nascem assim. (Rede de segurança; não dispensa escrever isto nos
-- ficheiros de schema — ver "Regras de base de dados" no AGENTS.md.)
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 3. Verificação — deve dar 0 nas duas colunas de falhas
-- ----------------------------------------------------------------------------
WITH funcoes AS MATERIALIZED (
  SELECT p.oid, p.proname, p.prosecdef, p.proconfig
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
)
SELECT
  count(*)                                                               AS funcoes,
  count(*) FILTER (WHERE prosecdef)                                      AS security_definer,
  count(*) FILTER (WHERE proconfig IS NULL)                              AS falha_sem_search_path,
  count(*) FILTER (WHERE has_function_privilege('anon', oid, 'EXECUTE')) AS falha_anon_pode_executar,
  count(*) FILTER (WHERE NOT has_function_privilege('authenticated', oid, 'EXECUTE'))
                                                                         AS falha_authenticated_sem_execute
FROM funcoes;
