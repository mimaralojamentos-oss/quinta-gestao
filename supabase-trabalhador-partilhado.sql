-- ============================================================================
-- OS DOIS PROJETOS — Trabalhador partilhado pelas duas casas
-- ============================================================================
-- Idempotente: pode correr-se mais do que uma vez sem erro.
-- Correr no Quinta-Gestão E na SerpaPinto131A (cola o ficheiro COMPLETO).
--
-- O Xavier e o Yuran trabalham para as duas casas e têm um link só — o da
-- Serpa Pinto. Para o registo poder ir parar à casa certa, a ficha do
-- trabalhador na Serpa passa a poder apontar para a ficha do MESMO
-- trabalhador na Quinta.
--
-- NÃO há tabela nova: é uma coluna numa tabela que já existe. Uma coluna
-- herda as permissões e as políticas de RLS da tabela, por isso não há aqui
-- GRANTs nem REVOKEs a fazer — os da `workers` já estão em
-- supabase-grants-public.sql e as políticas em supabase-leitura-por-papel.sql.
-- O trigger de auditoria da tabela também já apanha esta coluna sozinho.
--
-- NA PRÁTICA, pela ordem certa:
--   1. Correr este ficheiro nas duas bases.
--   2. Criar o Xavier e o Yuran na Folha de Ponto da QUINTA, com as tarifas
--      de lá. Não precisam de e-mail: o acesso deles continua a ser o link
--      da Serpa, e a ficha da Quinta serve só para receber os registos.
--   3. Na Folha de Ponto da SERPA, editar cada um e colar no campo
--      "Mesma pessoa na outra casa" o id da ficha que acabou de criar na
--      Quinta (a consulta do ponto 5 dá-te os ids).
--   4. Pôr no Vercel do projeto da SERPA, só no servidor:
--        CROSS_SUPABASE_URL          = URL do projeto da Quinta
--        CROSS_SUPABASE_SERVICE_KEY  = service role da Quinta
--        CROSS_APP_NAME              = Quinta
--      Sem estas três, a app fica exatamente como está hoje.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. A coluna do mapeamento
-- ----------------------------------------------------------------------------
-- Guarda o id da ficha do MESMO trabalhador na outra base. Fica NULL em toda
-- a gente menos nos partilhados.
--
-- Sem chave estrangeira de propósito: aponta para uma linha que está NOUTRA
-- base de dados, onde o Postgres não consegue verificar nada. A verificação
-- é feita pela app, que lê a ficha na outra casa antes de gravar e recusa o
-- registo se ela não existir.
ALTER TABLE public.workers
  ADD COLUMN IF NOT EXISTS cross_worker_id uuid;

COMMENT ON COLUMN public.workers.cross_worker_id IS
  'Id do mesmo trabalhador na base da outra casa. NULL = não é partilhado. '
  'Não tem FK: a linha vive noutra base de dados.';


-- ----------------------------------------------------------------------------
-- 2. Um trabalhador não pode apontar para si próprio
-- ----------------------------------------------------------------------------
-- Rede de segurança contra um engano a colar o id: se alguém colar o id da
-- própria ficha, os registos "da outra casa" ficavam a cair na mesma base,
-- em duplicado e com a tarifa errada.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'workers_cross_worker_id_check'
                   AND conrelid = 'public.workers'::regclass) THEN
    ALTER TABLE public.workers
      ADD CONSTRAINT workers_cross_worker_id_check
      CHECK (cross_worker_id IS NULL OR cross_worker_id <> id);
  END IF;
END $$;


-- ----------------------------------------------------------------------------
-- 3. Dois trabalhadores não podem apontar para a mesma ficha
-- ----------------------------------------------------------------------------
-- Senão os registos de duas pessoas iam parar à mesma ficha na outra casa.
CREATE UNIQUE INDEX IF NOT EXISTS workers_cross_worker_id_unico
  ON public.workers (cross_worker_id)
  WHERE cross_worker_id IS NOT NULL;


-- ----------------------------------------------------------------------------
-- 4. A API tem de ver a coluna nova
-- ----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';


-- ----------------------------------------------------------------------------
-- 5. Verificação — e os ids de que precisas no passo 3
-- ----------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workers'
      AND column_name = 'cross_worker_id')                                   AS coluna_criada,
  (SELECT count(*) FROM pg_constraint
    WHERE conname = 'workers_cross_worker_id_check')                         AS check_criado,
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'workers_cross_worker_id_unico') AS indice_criado,
  (SELECT count(*) FROM public.workers WHERE cross_worker_id IS NOT NULL)    AS ja_mapeados;

-- Os ids para colar: corre isto na QUINTA depois de lá criares os dois.
SELECT id, name, hourly_rate, hourly_rate_holiday, active
  FROM public.workers
 ORDER BY name;
