-- ============================================================================
-- OS DOIS PROJETOS — Compras: catálogo de itens comprados, linha a linha
-- ============================================================================
-- Idempotente: pode correr-se mais do que uma vez sem erro.
-- Correr no Quinta-Gestão E na SerpaPinto131A (cola o ficheiro COMPLETO).
--
-- Cada linha de fatura é uma linha desta tabela, sempre ligada ao documento
-- de origem. Não guarda totais de fatura — isso já vive em documents.amount.
--
-- ANTI-DUPLICADOS, nas três camadas que pediste:
--   a) documents.purchase_items_status marca o documento como processado, e
--      a extração em lote salta sempre os que já têm marca;
--   b) a função replace_purchase_items() apaga as linhas antigas do documento
--      e grava as novas NA MESMA transação (uma só chamada = uma transação),
--      por isso reprocessar substitui, nunca soma;
--   c) a estrutura impede repetições: document_id obrigatório em todas as
--      linhas e UNIQUE (document_id, line_number) — a mesma linha da mesma
--      fatura não pode entrar duas vezes. Apagar o documento apaga as linhas.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. As linhas de compra
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Fatura de origem. Apagar a fatura apaga as suas linhas.
  document_id     uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  -- Ordem da linha na fatura (1, 2, 3...).
  line_number     integer NOT NULL,

  purchase_date   date,            -- data da compra (a data da fatura)
  supplier_name   text,            -- nome do fornecedor, já normalizado
  description     text NOT NULL,   -- descrição do item como vem na fatura
  unit            text,            -- un, L, kg, m, m2, saco...
  quantity        numeric,
  unit_price_net  numeric,         -- preço unitário SEM IVA
  total_net       numeric,         -- total da linha SEM IVA
  vat_rate        numeric,         -- taxa de IVA (ex.: 0.23)
  vat_amount      numeric,         -- IVA da linha
  total_gross     numeric,         -- total da linha COM IVA
  -- true quando o IVA não vinha por linha e foi calculado a partir da taxa.
  vat_estimated   boolean NOT NULL DEFAULT false,

  -- Projeto do documento (via a despesa dele), copiado no momento da extração.
  project_id      uuid REFERENCES public.projects(id) ON DELETE SET NULL,

  -- 'ia' = extraída pela leitura automática · 'manual' = corrigida à mão
  source          text NOT NULL DEFAULT 'ia',
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_items_source_check' AND conrelid = 'public.purchase_items'::regclass) THEN
    ALTER TABLE public.purchase_items
      ADD CONSTRAINT purchase_items_source_check CHECK (source IN ('ia', 'manual'));
  END IF;

  -- A mesma linha da mesma fatura não pode entrar duas vezes.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_items_document_line_key' AND conrelid = 'public.purchase_items'::regclass) THEN
    ALTER TABLE public.purchase_items
      ADD CONSTRAINT purchase_items_document_line_key UNIQUE (document_id, line_number);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS purchase_items_document_idx ON public.purchase_items (document_id);
CREATE INDEX IF NOT EXISTS purchase_items_date_idx     ON public.purchase_items (purchase_date DESC);
CREATE INDEX IF NOT EXISTS purchase_items_supplier_idx ON public.purchase_items (supplier_name);


-- ----------------------------------------------------------------------------
-- 2. Marca de "fatura processada" no documento
-- ----------------------------------------------------------------------------
-- NULL = ainda não processada (é o que a extração em lote procura).
--   'ok'         — linhas extraídas
--   'sem_linhas' — a IA leu mas não encontrou linhas de itens
--   'erro'       — falhou a leitura; fica registada e o lote continua
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS purchase_items_status      text;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS purchase_items_extracted_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_purchase_items_status_check' AND conrelid = 'public.documents'::regclass) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_purchase_items_status_check
      CHECK (purchase_items_status IS NULL OR purchase_items_status IN ('ok', 'sem_linhas', 'erro'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS documents_purchase_items_status_idx
  ON public.documents (purchase_items_status);


-- ----------------------------------------------------------------------------
-- 3. Substituição em bloco — uma chamada, uma transação
-- ----------------------------------------------------------------------------
-- Apaga as linhas do documento, grava as novas e marca o documento como
-- processado. Se qualquer passo falhar, nada é gravado.
-- Devolve o número de linhas que ficaram.
CREATE OR REPLACE FUNCTION public.replace_purchase_items(
  p_document_id uuid,
  p_items       jsonb,
  p_status      text DEFAULT 'ok'
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_linhas integer := 0;
BEGIN
  IF p_status NOT IN ('ok', 'sem_linhas', 'erro') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_status;
  END IF;

  DELETE FROM public.purchase_items WHERE document_id = p_document_id;

  INSERT INTO public.purchase_items (
    document_id, line_number, purchase_date, supplier_name, description, unit,
    quantity, unit_price_net, total_net, vat_rate, vat_amount, total_gross,
    vat_estimated, project_id, source, notes
  )
  SELECT
    p_document_id,
    COALESCE((item->>'line_number')::integer, ord::integer),
    (item->>'purchase_date')::date,
    item->>'supplier_name',
    item->>'description',
    item->>'unit',
    (item->>'quantity')::numeric,
    (item->>'unit_price_net')::numeric,
    (item->>'total_net')::numeric,
    (item->>'vat_rate')::numeric,
    (item->>'vat_amount')::numeric,
    (item->>'total_gross')::numeric,
    COALESCE((item->>'vat_estimated')::boolean, false),
    NULLIF(item->>'project_id', '')::uuid,
    COALESCE(NULLIF(item->>'source', ''), 'ia'),
    item->>'notes'
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) WITH ORDINALITY AS t(item, ord)
  WHERE COALESCE(item->>'description', '') <> '';

  SELECT count(*) INTO v_linhas FROM public.purchase_items WHERE document_id = p_document_id;

  UPDATE public.documents
  SET purchase_items_status      = p_status,
      purchase_items_extracted_at = now()
  WHERE id = p_document_id;

  RETURN v_linhas;
END $$;


-- ----------------------------------------------------------------------------
-- 4. RLS — leitura para autenticados; escrita só admin/coadmin
--    (a extração automática corre no servidor com a service role)
-- ----------------------------------------------------------------------------
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_items_read ON public.purchase_items;
CREATE POLICY purchase_items_read ON public.purchase_items FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS purchase_items_write ON public.purchase_items;
CREATE POLICY purchase_items_write ON public.purchase_items FOR ALL TO authenticated
  USING (user_role() = ANY (ARRAY['admin', 'coadmin']))
  WITH CHECK (user_role() = ANY (ARRAY['admin', 'coadmin']));


-- ----------------------------------------------------------------------------
-- 5. Auditoria — mesmo trigger das restantes tabelas
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_auditoria ON public.purchase_items;
CREATE TRIGGER trg_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.purchase_items
  FOR EACH ROW EXECUTE FUNCTION registar_auditoria();


-- Recarregar o cache do PostgREST para a tabela, as colunas e a função
-- ficarem logo disponíveis na API.
NOTIFY pgrst, 'reload schema';


-- ----------------------------------------------------------------------------
-- 6. Verificação — 0 linhas, 0 faturas processadas e as faturas por processar
-- ----------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM public.purchase_items)                                        AS linhas_de_compra,
  (SELECT count(*) FROM public.documents WHERE purchase_items_status IS NOT NULL)      AS faturas_processadas,
  (SELECT count(*) FROM public.documents
    WHERE tipo = 'fatura' AND status = 'ativo' AND purchase_items_status IS NULL)      AS faturas_por_processar;
