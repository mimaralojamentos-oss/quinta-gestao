-- Nova categoria de despesa 'agua' (💧 Água), para as despesas criadas a
-- partir de faturas de água (tal como 'edp' para a luz).
--
-- A tabela expenses tem uma constraint que só aceita as categorias antigas —
-- sem isto, a criação da despesa de uma fatura de água seria REJEITADA pela
-- base de dados (o mesmo problema que já aconteceu com documents.tipo e
-- 'fatura_agua').
--
-- Corre nos dois projetos (Quinta-Gestão e SerpaPinto131A). Está numa
-- transação: se a Serpa Pinto tiver alguma despesa com uma categoria fora
-- desta lista, o ADD falha e o DROP é desfeito — nada fica partido. Nesse
-- caso, corre primeiro o SELECT de baixo e diz-me o que aparece.
--
--   select category, count(*) from expenses group by category order by category;
--
-- Em 2026-09-13, a Quinta-Gestão tinha exatamente: administracao,
-- contabilidade, edp, manutencao, obras, outros, pessoal.

BEGIN;

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_category_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_category_check
  CHECK (category IN (
    'administracao', 'obras', 'edp', 'agua', 'pessoal',
    'contabilidade', 'manutencao', 'outros'
  ));

COMMIT;
