-- ============================================================================
-- OS DOIS PROJETOS — Grupo de recebimento nos pagamentos
-- ============================================================================
-- Idempotente: pode correr-se mais do que uma vez sem erro.
-- Correr no Quinta-Gestão E na SerpaPinto131A (cola o ficheiro COMPLETO).
--
-- PORQUE É QUE ISTO EXISTE
-- Apagar um pagamento passa a desfazer tudo o que o registo desse pagamento
-- criou: devolver o crédito consumido, apagar o adiantamento do excedente e
-- limpar os movimentos do fundo de maneio. Para isso é preciso saber, sem
-- adivinhar, que linhas nasceram do MESMO recebimento.
--
-- Sem estas colunas a aplicação trabalha por aproximação (mesmo contrato,
-- mesma data, mesmo mês) e avisa-o no diálogo de confirmação — o que basta
-- para os registos antigos, mas é frágil quando um mês tem mais do que um
-- pagamento. Com elas, a ligação é exata.
--
-- DUAS COLUNAS, porque são duas ligações diferentes:
--   receipt_group_id       a que recebimento é que esta linha pertence
--                          (a renda, a caução e o adiantamento do excedente
--                          criados no mesmo registo partilham o valor);
--   consumed_by_receipt_id que recebimento é que GASTOU este adiantamento
--                          (vive na linha do crédito antigo, que foi criada
--                          por um recebimento anterior e por isso já tem o
--                          seu próprio receipt_group_id).
--
-- Nada é preenchido para trás: os registos antigos ficam com as duas a NULL,
-- e é isso que a aplicação deteta para avisar que trabalhou por aproximação.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. As colunas
-- ----------------------------------------------------------------------------
ALTER TABLE public.rent_payments ADD COLUMN IF NOT EXISTS receipt_group_id       uuid;
ALTER TABLE public.rent_payments ADD COLUMN IF NOT EXISTS consumed_by_receipt_id uuid;

COMMENT ON COLUMN public.rent_payments.receipt_group_id IS
  'Recebimento a que esta linha pertence: renda, caução e adiantamento criados no mesmo registo partilham-no. NULL nos registos anteriores a esta coluna.';
COMMENT ON COLUMN public.rent_payments.consumed_by_receipt_id IS
  'Recebimento que consumiu este adiantamento. Serve para apagar esse recebimento e devolver exatamente este crédito.';

-- Os dois índices servem as consultas da reversão (todas as linhas de um
-- recebimento; todo o crédito que um recebimento gastou).
CREATE INDEX IF NOT EXISTS rent_payments_receipt_group_idx
  ON public.rent_payments (receipt_group_id) WHERE receipt_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS rent_payments_consumed_by_receipt_idx
  ON public.rent_payments (consumed_by_receipt_id) WHERE consumed_by_receipt_id IS NOT NULL;


-- ----------------------------------------------------------------------------
-- 2. RLS, políticas e GRANTs — conforme as regras do AGENTS.md
-- ----------------------------------------------------------------------------
-- A tabela já existe, já tem RLS ativo e as políticas de leitura e escrita;
-- acrescentar colunas não as altera. Fica aqui a confirmação explícita, para
-- o ficheiro ser auto-suficiente se a tabela algum dia for recriada.
ALTER TABLE public.rent_payments ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rent_payments TO authenticated;
GRANT ALL ON TABLE public.rent_payments TO service_role;
REVOKE ALL ON TABLE public.rent_payments FROM anon;

NOTIFY pgrst, 'reload schema';


-- ----------------------------------------------------------------------------
-- 3. Verificação
-- ----------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rent_payments'
      AND column_name IN ('receipt_group_id', 'consumed_by_receipt_id'))        AS colunas_criadas,
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN ('rent_payments_receipt_group_idx', 'rent_payments_consumed_by_receipt_idx')) AS indices,
  (SELECT count(*) FROM public.rent_payments)                                    AS pagamentos,
  (SELECT count(*) FROM public.rent_payments WHERE receipt_group_id IS NOT NULL)  AS ja_com_grupo,
  (SELECT has_table_privilege('authenticated', 'public.rent_payments', 'UPDATE')) AS authenticated_escreve,
  (SELECT has_table_privilege('anon', 'public.rent_payments', 'SELECT'))          AS falha_anon_le;
