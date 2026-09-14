-- ============================================================================
-- SÓ SERPA PINTO — sub-espaços do apartamento 7 (A07-A e A07-B)
-- ============================================================================
-- Diagnóstico (colado pelo Miguel): já existe o espaço A07
--   id d00a60df-4980-4f3f-9e44-dfeb83e142f3 · habitação · disponível
--   1 contrato (terminado) · 5 leituras de luz · 1 cobrança de luz
--   nota: "Passar fatura a partir de Fevereiro 2026."
--
-- Decisão: RENOMEAR o A07 para A07-A (o titular do contador) e criar só o A07-B.
-- Assim o histórico do 7 — contrato antigo, leituras, cobrança, e a sequência
-- de leituras de onde sai o consumo da próxima — fica no espaço que tem o
-- contador. Nada na base de dados guarda a referência como texto (contratos,
-- leituras, cobranças, documentos e notas ligam por id), por isso renomear
-- não parte nada.
--
-- Idempotente: pode correr-se mais do que uma vez sem erro nem duplicados.
-- ============================================================================

BEGIN;

-- 1. A07 → A07-A (só se ainda for A07 e ainda não existir um A07-A)
UPDATE public.spaces
SET ref = 'A07-A'
WHERE id = 'd00a60df-4980-4f3f-9e44-dfeb83e142f3'
  AND ref = 'A07'
  AND NOT EXISTS (SELECT 1 FROM public.spaces WHERE ref = 'A07-A');

-- 2. Novo A07-B — habitação, disponível, sem contador próprio da EDP/águas
--    (has_own_meter/has_own_water_meter a false, como todos os apartamentos:
--    é o que faz aparecer nas páginas de luz e água)
INSERT INTO public.spaces (ref, type, status, has_own_meter, has_own_water_meter)
VALUES ('A07-B', 'habitacao', 'disponivel', false, false)
ON CONFLICT (ref) DO NOTHING;

COMMIT;

-- 3. Verificação — devem aparecer exatamente A07-A (com o id acima) e A07-B
SELECT
  s.ref, s.type, s.status, s.has_own_meter, s.has_own_water_meter, s.notes,
  (SELECT count(*) FROM public.electricity_readings r WHERE r.space_id = s.id) AS leituras_luz,
  (SELECT count(*) FROM public.leases l WHERE l.space_id = s.id)               AS contratos,
  s.id
FROM public.spaces s
WHERE s.ref ILIKE 'A07%'
ORDER BY s.ref;
