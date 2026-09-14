-- Folha de Ponto: sistema operativo do telemóvel do trabalhador.
--
-- Usado no e-mail "Dados de acesso" para mandar só as instruções de
-- instalação certas (iPhone → Safari; Android → Chrome). NULL = por definir,
-- e nesse caso o e-mail leva as duas versões.
--
-- Idempotente: pode correr-se mais do que uma vez sem erro.
-- Correr nos dois projetos (Quinta-Gestão e SerpaPinto131A).

ALTER TABLE public.workers ADD COLUMN IF NOT EXISTS phone_os TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workers_phone_os_check'
      AND conrelid = 'public.workers'::regclass
  ) THEN
    ALTER TABLE public.workers
      ADD CONSTRAINT workers_phone_os_check
      CHECK (phone_os IS NULL OR phone_os IN ('iphone', 'android'));
  END IF;
END $$;

-- Recarregar o cache do PostgREST para a coluna ficar logo disponível na API.
NOTIFY pgrst, 'reload schema';
