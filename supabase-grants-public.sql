-- ============================================================================
-- OS DOIS PROJETOS — Permissões da Data API (GRANTs) no schema public
-- ============================================================================
-- Idempotente: pode correr-se mais do que uma vez sem erro.
-- Correr no Quinta-Gestão E na SerpaPinto131A (cola o ficheiro COMPLETO).
--
-- PORQUE É QUE ISTO EXISTE
-- A partir de 30/10/2026 o Supabase deixa de dar automaticamente acesso à
-- Data API (supabase-js / PostgREST) às tabelas NOVAS do schema public: uma
-- tabela criada sem GRANT explícito responde "permission denied for table",
-- mesmo com RLS e políticas corretas. As tabelas que já existem mantêm os
-- grants antigos, mas qualquer recriação (projeto novo, reset da base,
-- restauro) perde-os se não estiverem escritos num SQL nosso. Este ficheiro
-- é esse SQL: passa a ser a fonte da verdade das permissões.
--
-- RLS E GRANTS SÃO COISAS DIFERENTES, e são precisas as duas:
--   · o GRANT diz se o papel pode tocar na tabela;
--   · a política de RLS diz em que linhas.
-- Sem GRANT dá "permission denied for table"; com GRANT e sem política dá
-- zero linhas. Este ficheiro trata só dos GRANTs — as políticas vivem nos
-- ficheiros de schema de cada módulo.
--
-- O QUE CADA PAPEL LEVA
--   anon          NADA. Nenhuma página da app lê tabelas sem sessão: a app
--                 do trabalhador (/ponto/<token>) não usa supabase-js, fala
--                 só com /api/ponto, que corre no servidor com a service
--                 role; e o proxy.ts usa a chave anon apenas para validar a
--                 sessão (auth.getUser), nunca para ler tabelas. Hoje o anon
--                 tem SELECT/INSERT/UPDATE/DELETE em quase tudo (o antigo
--                 comportamento por omissão do Supabase) e só o RLS o
--                 travava — isto retira-lhe esse acesso.
--   authenticated SELECT/INSERT/UPDATE/DELETE, com as três exceções abaixo.
--                 Quem pode fazer o quê continua a ser decidido pelo RLS
--                 (user_role(): admin, coadmin, electrician, viewer,
--                 super_reader).
--   service_role  tudo (as rotas /api do servidor).
--
-- AS TRÊS EXCEÇÕES (registos que não se reescrevem nem se apagam do lado
-- do utilizador — mantêm-se exatamente como já estavam nas duas bases):
--   · audit_log      authenticated só lê. Quem escreve é o trigger
--                    registar_auditoria(), que é SECURITY DEFINER e corre
--                    como dono da tabela — por isso não precisa de INSERT.
--   · access_logs    authenticated lê e insere (registo de acessos), não
--                    altera nem apaga.
--   · email_settings nada para authenticated: só o servidor lê e escreve as
--                    credenciais de e-mail.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. O schema tem de estar visível para os três papéis
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 2. Tabelas
-- ----------------------------------------------------------------------------
-- Percorre todas as tabelas do public, para não ficar nenhuma esquecida nem
-- ser preciso mexer no ficheiro quando se acrescenta uma tabela nova.
--
-- Para o authenticated, os quatro privilégios de dados são retirados e
-- voltados a dar conforme a regra. Só esses quatro: REFERENCES, TRIGGER e
-- TRUNCATE ficam como estiverem, porque são de manutenção do schema e não
-- da Data API.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname AS nome
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')   -- tabelas e particionadas
    ORDER BY c.relname
  LOOP
    -- anon: nenhum acesso à Data API
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t.nome);

    -- service_role: tudo (as rotas do servidor)
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t.nome);

    -- authenticated: parte-se do zero nos privilégios de dados...
    EXECUTE format('REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I FROM authenticated', t.nome);

    -- ...e dá-se o que a tabela precisa
    IF t.nome = 'audit_log' THEN
      EXECUTE 'GRANT SELECT ON TABLE public.audit_log TO authenticated';
    ELSIF t.nome = 'access_logs' THEN
      EXECUTE 'GRANT SELECT, INSERT ON TABLE public.access_logs TO authenticated';
    ELSIF t.nome = 'email_settings' THEN
      NULL;  -- só o servidor
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', t.nome);
    END IF;
  END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- 3. Views (hoje não há nenhuma no public; fica a regra para quando houver)
-- ----------------------------------------------------------------------------
-- Uma view só se lê pela Data API. Quem quiser escrever, escreve na tabela.
DO $$
DECLARE
  v record;
BEGIN
  FOR v IN
    SELECT c.relname AS nome
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')   -- views e materializadas
    ORDER BY c.relname
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v.nome);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v.nome);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', v.nome);
  END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- 4. Sequences
-- ----------------------------------------------------------------------------
-- As colunas serial/identity precisam de USAGE na sequence para o INSERT
-- funcionar, e de SELECT para currval/lastval.
DO $$
DECLARE
  s record;
BEGIN
  FOR s IN
    SELECT c.relname AS nome
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'
    ORDER BY c.relname
  LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM anon', s.nome);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO authenticated, service_role', s.nome);
  END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- 5. Funções chamadas pela app (supabase.rpc)
-- ----------------------------------------------------------------------------
-- Em Postgres as funções já nascem executáveis por todos (PUBLIC), por isso
-- isto é só para o acesso ficar escrito e sobreviver a uma recriação.
-- NOTA: de propósito NÃO se retira o EXECUTE a PUBLIC/anon — mexer nisso é
-- outra decisão, a tomar com calma, e as funções que tocam dados (como a
-- replace_purchase_items) são SECURITY INVOKER, logo o RLS continua a valer.
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS assinatura
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f.assinatura);
  END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- 6. Rede de segurança para o futuro
-- ----------------------------------------------------------------------------
-- Dá os mesmos grants, automaticamente, às tabelas e sequences criadas de
-- agora em diante por quem corre este SQL (o papel do SQL Editor).
--
-- É só uma rede: não substitui escrever os GRANTs no ficheiro de schema de
-- cada tabela nova (ver "Regras de base de dados" no AGENTS.md), porque não
-- se aplica a objetos criados por outro papel nem noutro projeto.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO service_role;


-- ----------------------------------------------------------------------------
-- 7. Verificação — o que ficou (deve dar 0 em todas as colunas de falhas)
-- ----------------------------------------------------------------------------
WITH objetos AS (
  SELECT c.oid, c.relname AS nome, c.relkind,
         has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_select,
         has_table_privilege('authenticated', c.oid, 'INSERT') AS auth_insert,
         has_table_privilege('service_role',  c.oid, 'SELECT') AS srv_select,
         has_table_privilege('service_role',  c.oid, 'DELETE') AS srv_delete,
         (has_table_privilege('anon', c.oid, 'SELECT')
          OR has_table_privilege('anon', c.oid, 'INSERT')
          OR has_table_privilege('anon', c.oid, 'UPDATE')
          OR has_table_privilege('anon', c.oid, 'DELETE')) AS anon_tem_acesso,
         c.relrowsecurity AS rls,
         (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS politicas
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
)
SELECT
  count(*)                                                                   AS tabelas,
  count(*) FILTER (WHERE anon_tem_acesso)                                    AS falha_anon_com_acesso,
  count(*) FILTER (WHERE NOT srv_select OR NOT srv_delete)                   AS falha_service_role_sem_tudo,
  count(*) FILTER (WHERE NOT auth_select AND nome <> 'email_settings')       AS falha_authenticated_sem_leitura,
  count(*) FILTER (WHERE NOT auth_insert AND nome NOT IN ('audit_log', 'email_settings'))
                                                                             AS falha_authenticated_sem_escrita,
  count(*) FILTER (WHERE NOT rls)                                            AS tabelas_sem_rls,
  coalesce(string_agg(nome, ', ' ORDER BY nome) FILTER (WHERE politicas = 0), 'nenhuma')
                                                                             AS tabelas_sem_politicas,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'
      AND NOT has_sequence_privilege('authenticated', c.oid, 'USAGE'))        AS falha_sequences_sem_usage
FROM objetos;
