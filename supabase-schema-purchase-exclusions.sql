-- ============================================================================
-- OS DOIS PROJETOS — Compras: exclusões (documentos, fornecedores e itens)
-- ============================================================================
-- Idempotente: pode correr-se mais do que uma vez sem erro.
-- Correr no Quinta-Gestão E na SerpaPinto131A (cola o ficheiro COMPLETO).
--
-- Nem tudo o que é fatura é uma compra de materiais. Isto acrescenta:
--   1. o estado 'excluido' nos documentos (excluído = sem linhas e sempre
--      ignorado pela extração e pelo lote);
--   2. regras automáticas: documentos gerados pela app, despesas de pessoal
--      e fornecedores marcados como excluídos;
--   3. regras manuais por texto na descrição do item;
--   4. uma função que aplica tudo isto ao que já está processado, tantas
--      vezes quantas se quiser, sempre com o mesmo resultado.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Estado 'excluido' e o motivo da exclusão
-- ----------------------------------------------------------------------------
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_purchase_items_status_check;
ALTER TABLE public.documents
  ADD CONSTRAINT documents_purchase_items_status_check
  CHECK (purchase_items_status IS NULL
         OR purchase_items_status IN ('ok', 'sem_linhas', 'erro', 'excluido'));

-- Porque é que o documento foi excluído (para se poder ver e reincluir).
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS purchase_items_motivo text;


-- ----------------------------------------------------------------------------
-- 2. Normalização — a mesma que a app usa, para comparar nomes e descrições
-- ----------------------------------------------------------------------------
-- Sem acentos e em minúsculas (igual ao normalizeText do lado da app).
CREATE OR REPLACE FUNCTION public.compras_norm_texto(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(lower(translate(
    coalesce(p, ''),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
    'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')))
$$;

-- Versão "achatada" de um nome de fornecedor: sem acentos, sem pontuação,
-- minúsculas, espaços únicos (igual ao normalizeSupplier do lado da app).
CREATE OR REPLACE FUNCTION public.compras_norm_fornecedor(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(
           regexp_replace(public.compras_norm_texto(p), '[^a-z0-9]+', ' ', 'g'),
         '\s+', ' ', 'g'))
$$;


-- ----------------------------------------------------------------------------
-- 3. Fornecedores excluídos das Compras
-- ----------------------------------------------------------------------------
-- Marcar um fornecedor aqui tira do catálogo todas as faturas dele, antigas
-- e futuras. É o que resolve as mensalidades de serviços (MEO e afins).
CREATE TABLE IF NOT EXISTS public.purchase_supplier_exclusions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name       text NOT NULL,   -- nome como se mostra
  supplier_normalized text NOT NULL,   -- chave de comparação
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'purchase_supplier_exclusions_key'
                   AND conrelid = 'public.purchase_supplier_exclusions'::regclass) THEN
    ALTER TABLE public.purchase_supplier_exclusions
      ADD CONSTRAINT purchase_supplier_exclusions_key UNIQUE (supplier_normalized);
  END IF;
END $$;

-- A MEO já fica marcada, como pediste.
INSERT INTO public.purchase_supplier_exclusions (supplier_name, supplier_normalized, notes)
SELECT 'MEO', public.compras_norm_fornecedor('MEO'),
       'Mensalidade de serviços — não é compra de materiais'
WHERE NOT EXISTS (
  SELECT 1 FROM public.purchase_supplier_exclusions
  WHERE supplier_normalized = public.compras_norm_fornecedor('MEO')
);


-- ----------------------------------------------------------------------------
-- 4. Regras de exclusão ao nível do item (texto na descrição)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_exclusion_rules (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_type          text NOT NULL DEFAULT 'descricao',
  pattern            text NOT NULL,   -- o texto como foi escrito
  pattern_normalized text NOT NULL,   -- o mesmo texto, achatado
  notes              text,
  created_by         text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'purchase_exclusion_rules_type_check'
                   AND conrelid = 'public.purchase_exclusion_rules'::regclass) THEN
    ALTER TABLE public.purchase_exclusion_rules
      ADD CONSTRAINT purchase_exclusion_rules_type_check CHECK (rule_type IN ('descricao'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'purchase_exclusion_rules_key'
                   AND conrelid = 'public.purchase_exclusion_rules'::regclass) THEN
    ALTER TABLE public.purchase_exclusion_rules
      ADD CONSTRAINT purchase_exclusion_rules_key UNIQUE (rule_type, pattern_normalized);
  END IF;
END $$;


-- ----------------------------------------------------------------------------
-- 5. O motivo de exclusão de um documento — regra única, usada por todos
-- ----------------------------------------------------------------------------
-- Devolve o motivo, ou NULL se o documento pode entrar no catálogo.
-- Usada pela extração (antes de gastar uma leitura) e pela limpeza em lote.
CREATE OR REPLACE FUNCTION public.compras_motivo_exclusao(p_document_id uuid)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
  d           record;
  v_norm      text;
  v_canonico  text;
  v_canon_norm text;
BEGIN
  SELECT dd.file_path, dd.tipo_custom, dd.category, dd.supplier_name,
         e.category AS categoria_despesa
    INTO d
  FROM public.documents dd
  LEFT JOIN public.expenses e ON e.id = dd.expense_id
  WHERE dd.id = p_document_id;

  IF NOT FOUND THEN RETURN NULL; END IF;

  -- a) Documentos gerados pela própria app: recibos internos, nunca compras.
  IF coalesce(d.file_path, '') LIKE 'manual/%'
     OR coalesce(d.file_path, '') LIKE 'recibos/%'
     OR coalesce(d.tipo_custom, '') IN ('Despesa Manual', 'Receita Manual',
                                        'Nota Manual', 'Recibo de pagamento') THEN
    RETURN 'documento gerado pela app';
  END IF;

  -- b) Pagamentos a pessoal.
  IF d.categoria_despesa = 'pessoal' OR d.category = 'pessoal' THEN
    RETURN 'despesa de pessoal';
  END IF;

  -- c) Fornecedor marcado como excluído. Compara o nome que vem na fatura e
  --    o nome real (tabela de equivalências), e apanha as variantes que
  --    começam pelo nome marcado — "MEO" apanha "MEO SERVICOS DE ...".
  v_norm := public.compras_norm_fornecedor(d.supplier_name);
  IF v_norm <> '' THEN
    SELECT canonical_name INTO v_canonico
    FROM public.supplier_aliases WHERE alias_normalized = v_norm LIMIT 1;

    v_canon_norm := public.compras_norm_fornecedor(coalesce(v_canonico, d.supplier_name));

    IF EXISTS (
      SELECT 1 FROM public.purchase_supplier_exclusions x
      WHERE v_norm = x.supplier_normalized
         OR v_norm LIKE x.supplier_normalized || ' %'
         OR v_canon_norm = x.supplier_normalized
         OR v_canon_norm LIKE x.supplier_normalized || ' %'
    ) THEN
      RETURN 'fornecedor excluído das Compras';
    END IF;
  END IF;

  RETURN NULL;
END $$;


-- ----------------------------------------------------------------------------
-- 6. Substituição em bloco — agora também aceita 'excluido' e guarda o motivo
-- ----------------------------------------------------------------------------
-- Excluir um documento apaga as linhas dele NA MESMA transação.
-- (A versão de 3 argumentos é substituída por esta; as chamadas antigas
--  continuam a funcionar porque o 4º argumento tem valor por omissão.)
DROP FUNCTION IF EXISTS public.replace_purchase_items(uuid, jsonb, text);

CREATE OR REPLACE FUNCTION public.replace_purchase_items(
  p_document_id uuid,
  p_items       jsonb,
  p_status      text DEFAULT 'ok',
  p_motivo      text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_linhas integer := 0;
BEGIN
  IF p_status NOT IN ('ok', 'sem_linhas', 'erro', 'excluido') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_status;
  END IF;

  DELETE FROM public.purchase_items WHERE document_id = p_document_id;

  -- Um documento excluído nunca fica com linhas, mesmo que lhe mandem algumas.
  IF p_status <> 'excluido' THEN
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
  END IF;

  SELECT count(*) INTO v_linhas FROM public.purchase_items WHERE document_id = p_document_id;

  UPDATE public.documents
  SET purchase_items_status      = p_status,
      purchase_items_motivo      = p_motivo,
      purchase_items_extracted_at = now()
  WHERE id = p_document_id;

  RETURN v_linhas;
END $$;


-- ----------------------------------------------------------------------------
-- 7. Quantas linhas é que uma regra de descrição remove (antes de a criar)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compras_contar_linhas_da_regra(p_pattern text)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer FROM public.purchase_items
  WHERE public.compras_norm_texto(p_pattern) <> ''
    AND position(public.compras_norm_texto(p_pattern)
                 IN public.compras_norm_texto(description)) > 0
$$;


-- ----------------------------------------------------------------------------
-- 8. Aplicar todas as regras ao que já está processado — idempotente
-- ----------------------------------------------------------------------------
-- Corre as regras dos documentos (5a/5b/5c) e as regras de descrição.
-- Correr duas vezes seguidas dá o mesmo resultado que correr uma.
CREATE OR REPLACE FUNCTION public.aplicar_regras_compras()
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  r              record;
  v_motivo       text;
  v_docs         integer := 0;
  v_linhas_docs  integer := 0;
  v_linhas_regra integer := 0;
  v_conta        integer;
BEGIN
  -- Documentos que as regras excluem (e que ainda não estão excluídos).
  FOR r IN
    SELECT d.id FROM public.documents d
    WHERE d.status = 'ativo'
      AND (d.tipo = 'fatura' OR d.purchase_items_status IS NOT NULL)
      AND coalesce(d.purchase_items_status, '') <> 'excluido'
  LOOP
    v_motivo := public.compras_motivo_exclusao(r.id);
    IF v_motivo IS NOT NULL THEN
      SELECT count(*) INTO v_conta FROM public.purchase_items WHERE document_id = r.id;
      PERFORM public.replace_purchase_items(r.id, '[]'::jsonb, 'excluido', v_motivo);
      v_docs := v_docs + 1;
      v_linhas_docs := v_linhas_docs + v_conta;
    END IF;
  END LOOP;

  -- Linhas que as regras de descrição removem.
  WITH apagadas AS (
    DELETE FROM public.purchase_items pi
    WHERE EXISTS (
      SELECT 1 FROM public.purchase_exclusion_rules x
      WHERE x.rule_type = 'descricao'
        AND x.pattern_normalized <> ''
        AND position(x.pattern_normalized IN public.compras_norm_texto(pi.description)) > 0
    )
    RETURNING 1
  )
  SELECT count(*) INTO v_linhas_regra FROM apagadas;

  RETURN jsonb_build_object(
    'documentos_excluidos', v_docs,
    'linhas_removidas_dos_documentos', v_linhas_docs,
    'linhas_removidas_por_regra', v_linhas_regra
  );
END $$;


-- ----------------------------------------------------------------------------
-- 9. RLS — leitura para autenticados; escrita só admin/coadmin
-- ----------------------------------------------------------------------------
ALTER TABLE public.purchase_supplier_exclusions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchase_supplier_exclusions_read ON public.purchase_supplier_exclusions;
CREATE POLICY purchase_supplier_exclusions_read ON public.purchase_supplier_exclusions
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS purchase_supplier_exclusions_write ON public.purchase_supplier_exclusions;
CREATE POLICY purchase_supplier_exclusions_write ON public.purchase_supplier_exclusions
  FOR ALL TO authenticated
  USING (user_role() = ANY (ARRAY['admin', 'coadmin']))
  WITH CHECK (user_role() = ANY (ARRAY['admin', 'coadmin']));

ALTER TABLE public.purchase_exclusion_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchase_exclusion_rules_read ON public.purchase_exclusion_rules;
CREATE POLICY purchase_exclusion_rules_read ON public.purchase_exclusion_rules
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS purchase_exclusion_rules_write ON public.purchase_exclusion_rules;
CREATE POLICY purchase_exclusion_rules_write ON public.purchase_exclusion_rules
  FOR ALL TO authenticated
  USING (user_role() = ANY (ARRAY['admin', 'coadmin']))
  WITH CHECK (user_role() = ANY (ARRAY['admin', 'coadmin']));


-- ----------------------------------------------------------------------------
-- 10. Auditoria — mesmo trigger das restantes tabelas
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_auditoria ON public.purchase_supplier_exclusions;
CREATE TRIGGER trg_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.purchase_supplier_exclusions
  FOR EACH ROW EXECUTE FUNCTION registar_auditoria();

DROP TRIGGER IF EXISTS trg_auditoria ON public.purchase_exclusion_rules;
CREATE TRIGGER trg_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.purchase_exclusion_rules
  FOR EACH ROW EXECUTE FUNCTION registar_auditoria();


NOTIFY pgrst, 'reload schema';


-- ----------------------------------------------------------------------------
-- 11. Verificação — o que as regras vão apanhar (ainda NÃO altera nada)
-- ----------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM public.purchase_supplier_exclusions)                      AS fornecedores_excluidos,
  (SELECT count(*) FROM public.purchase_exclusion_rules)                          AS regras_de_descricao,
  (SELECT count(*) FROM public.documents d
    WHERE d.status = 'ativo' AND (d.tipo = 'fatura' OR d.purchase_items_status IS NOT NULL)
      AND coalesce(d.purchase_items_status, '') <> 'excluido'
      AND public.compras_motivo_exclusao(d.id) IS NOT NULL)                       AS documentos_a_excluir,
  (SELECT count(*) FROM public.purchase_items pi
    WHERE public.compras_motivo_exclusao(pi.document_id) IS NOT NULL)             AS linhas_que_desaparecem;
