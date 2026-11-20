-- ============================================================================
-- OS DOIS PROJETOS — Uma renda tem sempre data de pagamento
-- ============================================================================
-- Idempotente: pode correr-se mais do que uma vez sem erro.
-- Correr no Quinta-Gestão E na SerpaPinto131A (cola o ficheiro COMPLETO).
--
-- A app deixou de aceitar rendas sem data de pagamento (lib/rentShortfall.ts,
-- validarRendaComData). Isto é a mesma regra do lado da base de dados, para
-- valer mesmo que um ecrã novo se esqueça dela: a app escreve em rent_payments
-- diretamente do browser, por isso o "servidor" que pode recusar é o Postgres.
--
-- NÃO CORRIGE DADOS. A restrição nasce NOT VALID de propósito: o Postgres não
-- a verifica nas linhas que já existem, só nas que forem criadas ou alteradas
-- daqui em diante. As rendas antigas sem data ficam exatamente como estão, à
-- espera de serem corrigidas à mão, uma a uma, na ficha do inquilino.
--
-- Consequência prática numa linha antiga sem data: qualquer alteração que lhe
-- façam tem de a deixar COM data (ou então apaga-se). É o que se quer.
--
-- Não há tabela nova, por isso não há GRANTs, políticas nem trigger a criar.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. A restrição
-- ----------------------------------------------------------------------------
-- "Renda" é o tipo 'renda' ou o tipo por preencher, tal como a app o lê.
-- Os outros tipos (caução, extra, adiantamento…) não são tocados.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'rent_payments_renda_com_data'
                   AND conrelid = 'public.rent_payments'::regclass) THEN
    ALTER TABLE public.rent_payments
      ADD CONSTRAINT rent_payments_renda_com_data
      CHECK (payment_date IS NOT NULL OR coalesce(tipo, 'renda') <> 'renda')
      NOT VALID;
  END IF;
END $$;

COMMENT ON CONSTRAINT rent_payments_renda_com_data ON public.rent_payments IS
  'Uma renda grava-se quando e paga, com a data. NOT VALID: nao verifica as '
  'linhas antigas, so as novas e as alteradas.';


-- ----------------------------------------------------------------------------
-- 2. Verificação
-- ----------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM pg_constraint
    WHERE conname = 'rent_payments_renda_com_data')                        AS restricao_criada,
  (SELECT NOT convalidated FROM pg_constraint
    WHERE conname = 'rent_payments_renda_com_data')                        AS so_para_linhas_novas,
  (SELECT count(*) FROM public.rent_payments
    WHERE payment_date IS NULL AND coalesce(tipo, 'renda') = 'renda')      AS rendas_antigas_sem_data,
  (SELECT count(*) FROM public.rent_payments WHERE payment_date IS NULL)   AS linhas_sem_data_de_qualquer_tipo;


-- ----------------------------------------------------------------------------
-- 3. A lista de trabalho: as linhas sem data, para corrigir à mão
-- ----------------------------------------------------------------------------
SELECT t.name AS inquilino, s.ref AS fracao,
       to_char(p.reference_month, 'YYYY-MM') AS mes,
       p.amount AS valor, coalesce(p.tipo, '(sem tipo)') AS tipo,
       l.status AS contrato, p.created_at::date AS criado_em
  FROM public.rent_payments p
  LEFT JOIN public.leases  l ON l.id = p.lease_id
  LEFT JOIN public.tenants t ON t.id = l.tenant_id
  LEFT JOIN public.spaces  s ON s.id = l.space_id
 WHERE p.payment_date IS NULL
 ORDER BY t.name, p.reference_month;
