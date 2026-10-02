-- ============================================================================
-- OS DOIS PROJETOS — registos de VALOR FIXO na folha de ponto
-- ============================================================================
-- Idempotente: pode correr-se mais do que uma vez sem erro.
-- Correr no Quinta-Gestão E na SerpaPinto131A (cola o ficheiro COMPLETO).
--
-- Um registo de valor fixo é uma work_entry com data, descrição e valor, sem
-- horário nem tarifa. Fica na MESMA tabela e nas mesmas contas dos registos
-- por horas — nada de totais paralelos.
--
-- O que muda:
--   1. entry_type: 'horas' (tudo o que já existe) ou 'valor_fixo'.
--   2. start_time/end_time passam a poder ser NULL — só para o valor fixo.
--   3. Uma restrição garante a coerência: registo por horas TEM horário,
--      registo de valor fixo NÃO tem. Assim não é possível criar um híbrido
--      por engano, nem pela app do trabalhador nem pelo backoffice.
--
-- hours e hourly_rate continuam NOT NULL e ficam a 0 nos registos de valor
-- fixo: assim as somas de horas e os cálculos já existentes continuam a
-- funcionar sem mudar nada, e o valor combinado vive em `amount`, como em
-- qualquer outro registo.
--
-- Nenhum registo existente é alterado: todos passam a entry_type 'horas',
-- que é exatamente o que são, e mantêm o horário que têm.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Tipo de registo
-- ----------------------------------------------------------------------------
ALTER TABLE public.work_entries
  ADD COLUMN IF NOT EXISTS entry_type text NOT NULL DEFAULT 'horas';


-- ----------------------------------------------------------------------------
-- 2. Horário opcional (só o valor fixo o dispensa — ver a restrição em 3)
-- ----------------------------------------------------------------------------
ALTER TABLE public.work_entries ALTER COLUMN start_time DROP NOT NULL;
ALTER TABLE public.work_entries ALTER COLUMN end_time   DROP NOT NULL;


-- ----------------------------------------------------------------------------
-- 3. Coerência: por horas tem horário; valor fixo não tem
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'work_entries_entry_type_check'
      AND conrelid = 'public.work_entries'::regclass
  ) THEN
    ALTER TABLE public.work_entries
      ADD CONSTRAINT work_entries_entry_type_check
      CHECK (entry_type IN ('horas', 'valor_fixo'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'work_entries_horario_check'
      AND conrelid = 'public.work_entries'::regclass
  ) THEN
    ALTER TABLE public.work_entries
      ADD CONSTRAINT work_entries_horario_check
      CHECK (
        (entry_type = 'horas'      AND start_time IS NOT NULL AND end_time IS NOT NULL)
        OR
        (entry_type = 'valor_fixo' AND start_time IS NULL     AND end_time IS NULL)
      );
  END IF;
END $$;


-- Recarregar o cache do PostgREST para a coluna ficar logo disponível na API.
NOTIFY pgrst, 'reload schema';


-- ----------------------------------------------------------------------------
-- 4. Verificação — deve dar todos os registos como 'horas' e 0 incoerentes
-- ----------------------------------------------------------------------------
SELECT
  entry_type,
  count(*)                                                        AS registos,
  count(*) FILTER (WHERE start_time IS NULL OR end_time IS NULL)  AS sem_horario,
  min(work_date)                                                  AS primeiro,
  max(work_date)                                                  AS ultimo
FROM public.work_entries
GROUP BY entry_type
ORDER BY entry_type;
