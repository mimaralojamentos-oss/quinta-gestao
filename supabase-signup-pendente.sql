-- ============================================================================
-- OS DOIS PROJETOS — Conta nova nasce 'pendente', sem acesso a nada
-- ============================================================================
-- Idempotente: pode correr-se mais do que uma vez sem erro.
-- Correr no Quinta-Gestão E na SerpaPinto131A (cola o ficheiro COMPLETO).
--
-- PORQUE É QUE ISTO EXISTE
-- O trigger que cria o perfil de cada conta nova lia o papel do metadata do
-- registo — e esse metadata é escrito por quem se registra (é o options.data
-- do supabase.auth.signUp, do lado do browser). Com o registo público aberto,
-- um desconhecido podia registar-se a pedir role = 'admin' e ficar com acesso
-- total. Nunca aconteceu (nenhuma conta nova nos últimos 90 dias), mas a
-- porta estava aberta.
--
-- Passa a ser assim: o papel NUNCA vem do metadata. Toda a conta nova nasce
-- 'pendente', que não consta de nenhuma política de RLS — não vê nem escreve
-- nada — até um administrador lhe dar um papel em Utilizadores.
--
-- Isto é a segunda camada. A primeira é desligar o registo público no painel
-- (Authentication → Sign In / Providers → Email → "Allow new users to sign
-- up"), e continua a ser o passo mais importante.
--
-- ORDEM DOS PASSOS (importa):
-- o CHECK de profiles.role só aceita os cinco papéis atuais. Se o trigger
-- gravasse 'pendente' antes de o CHECK o permitir, o INSERT falhava — e como
-- o trigger corre dentro da criação do utilizador, partia a criação de
-- QUALQUER conta, incluindo as feitas no painel. Por isso o CHECK vem
-- primeiro.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. PRIMEIRO: alargar o CHECK do papel
-- ----------------------------------------------------------------------------
-- A coluna é varchar na Quinta e text na Serpa; a comparação com ::text
-- funciona nas duas.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role::text = ANY (ARRAY['admin', 'coadmin', 'electrician', 'viewer', 'super_reader', 'pendente']));

-- Confirmação de que nenhum perfil existente ficou de fora do CHECK novo
-- (se isto devolver alguma linha, PARA e avisa — não deve devolver nada).
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM public.profiles
  WHERE role::text <> ALL (ARRAY['admin', 'coadmin', 'electrician', 'viewer', 'super_reader', 'pendente']);
  IF n > 0 THEN
    RAISE EXCEPTION 'Há % perfil(s) com um papel fora da lista — verifica antes de continuar', n;
  END IF;
END $$;


-- ----------------------------------------------------------------------------
-- 2. DEPOIS: o trigger que cria o perfil
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- O papel NÃO vem do metadata do registo: isso é escrito pelo próprio
  -- candidato e permitia a qualquer desconhecido criar-se como admin.
  -- O nome pode vir, que é só uma etiqueta.
  INSERT INTO public.profiles (id, name, role)
  VALUES (
    new.id,
    COALESCE(NULLIF(btrim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1)),
    'pendente'
  )
  ON CONFLICT (id) DO NOTHING;   -- criar a conta nunca falha por causa do perfil
  RETURN new;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO authenticated, service_role;

-- O trigger: na Quinta já existe (é substituído), na Serpa é criado agora
-- com o comportamento seguro desde o início.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ----------------------------------------------------------------------------
-- 3. Verificação
-- ----------------------------------------------------------------------------
SELECT
  (SELECT pg_get_constraintdef(con.oid) FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    WHERE c.relname = 'profiles' AND con.conname = 'profiles_role_check')          AS check_do_papel,
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE NOT t.tgisinternal AND c.relname = 'users'
      AND t.tgname = 'on_auth_user_created')                                       AS trigger_criado,
  (SELECT array_to_string(p.proconfig, ',') FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'handle_new_user')                   AS search_path_da_funcao,
  (SELECT has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE'))    AS anon_pode_executar,
  (SELECT string_agg(role::text || ': ' || n::text, ', ' ORDER BY role::text)
     FROM (SELECT role, count(*) AS n FROM public.profiles GROUP BY role) x)        AS papeis_existentes;
