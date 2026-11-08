-- ============================================================================
-- OS DOIS PROJETOS — Alertas de e-mail da Folha de Ponto
-- ============================================================================
-- Idempotente: pode correr-se mais do que uma vez sem erro.
-- Correr no Quinta-Gestão E na SerpaPinto131A (cola o ficheiro COMPLETO).
--
-- Duas tabelas:
--   timesheet_alert_recipients  quem é avisado e com que frequência
--   timesheet_alert_sends       que resumos já foram enviados — é esta marca
--                               que impede o cron de enviar duas vezes o
--                               mesmo período se correr repetido
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Destinatários
-- ----------------------------------------------------------------------------
-- As periodicidades ficam em colunas boolean em vez de um array: são quatro,
-- fixas, e assim cada uma indexa e lê-se sem desempacotar nada.
CREATE TABLE IF NOT EXISTS public.timesheet_alert_recipients (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL,
  /** Um e-mail por cada registo novo, no momento da gravação. */
  imediato   boolean NOT NULL DEFAULT false,
  /** Às 9h, o resumo das entradas do dia anterior. */
  diario     boolean NOT NULL DEFAULT false,
  /** Sexta-feira às 20h, o resumo da semana (sábado a sexta). */
  semanal    boolean NOT NULL DEFAULT false,
  /** No último dia do mês às 20h, o resumo do mês civil. */
  mensal     boolean NOT NULL DEFAULT false,
  active     boolean NOT NULL DEFAULT true,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text
);

DO $$
BEGIN
  -- O mesmo endereço não se repete na lista.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'timesheet_alert_recipients_email_key'
                   AND conrelid = 'public.timesheet_alert_recipients'::regclass) THEN
    ALTER TABLE public.timesheet_alert_recipients
      ADD CONSTRAINT timesheet_alert_recipients_email_key UNIQUE (email);
  END IF;

  -- Um destinatário sem nenhuma periodicidade escolhida não faz sentido.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'timesheet_alert_recipients_alguma_check'
                   AND conrelid = 'public.timesheet_alert_recipients'::regclass) THEN
    ALTER TABLE public.timesheet_alert_recipients
      ADD CONSTRAINT timesheet_alert_recipients_alguma_check
      CHECK (imediato OR diario OR semanal OR mensal);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS timesheet_alert_recipients_ativos_idx
  ON public.timesheet_alert_recipients (active) WHERE active;


-- ----------------------------------------------------------------------------
-- 2. Marca dos envios agendados (idempotência)
-- ----------------------------------------------------------------------------
-- A chave única (destinatário, periodicidade, período) é o que garante que
-- correr o cron duas vezes no mesmo dia não manda o e-mail em dobro.
CREATE TABLE IF NOT EXISTS public.timesheet_alert_sends (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id  uuid NOT NULL REFERENCES public.timesheet_alert_recipients(id) ON DELETE CASCADE,
  periodicidade text NOT NULL,
  /** O período coberto, em texto ('diario:2026-11-07', 'mensal:2026-11'). */
  periodo       text NOT NULL,
  entradas      integer NOT NULL DEFAULT 0,
  enviado       boolean NOT NULL DEFAULT true,
  erro          text,
  sent_at       timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'timesheet_alert_sends_unicos'
                   AND conrelid = 'public.timesheet_alert_sends'::regclass) THEN
    ALTER TABLE public.timesheet_alert_sends
      ADD CONSTRAINT timesheet_alert_sends_unicos UNIQUE (recipient_id, periodicidade, periodo);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'timesheet_alert_sends_periodicidade_check'
                   AND conrelid = 'public.timesheet_alert_sends'::regclass) THEN
    ALTER TABLE public.timesheet_alert_sends
      ADD CONSTRAINT timesheet_alert_sends_periodicidade_check
      CHECK (periodicidade IN ('imediato', 'diario', 'semanal', 'mensal'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS timesheet_alert_sends_recente_idx
  ON public.timesheet_alert_sends (sent_at DESC);


-- ----------------------------------------------------------------------------
-- 3. RLS, políticas e GRANTs — conforme as regras do AGENTS.md
-- ----------------------------------------------------------------------------
-- A lista de destinatários é configuração de gestão: só admin e coadmin a
-- veem e a alteram. O anon não leva nada. O histórico de envios é só de
-- leitura para eles — quem escreve é o servidor, com a service role.
ALTER TABLE public.timesheet_alert_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheet_alert_sends      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS timesheet_alert_recipients_read ON public.timesheet_alert_recipients;
CREATE POLICY timesheet_alert_recipients_read ON public.timesheet_alert_recipients
  FOR SELECT TO authenticated
  USING (user_role() = ANY (ARRAY['admin', 'coadmin']));

DROP POLICY IF EXISTS timesheet_alert_recipients_write ON public.timesheet_alert_recipients;
CREATE POLICY timesheet_alert_recipients_write ON public.timesheet_alert_recipients
  FOR ALL TO authenticated
  USING (user_role() = ANY (ARRAY['admin', 'coadmin']))
  WITH CHECK (user_role() = ANY (ARRAY['admin', 'coadmin']));

DROP POLICY IF EXISTS timesheet_alert_sends_read ON public.timesheet_alert_sends;
CREATE POLICY timesheet_alert_sends_read ON public.timesheet_alert_sends
  FOR SELECT TO authenticated
  USING (user_role() = ANY (ARRAY['admin', 'coadmin']));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.timesheet_alert_recipients TO authenticated;
GRANT ALL    ON TABLE public.timesheet_alert_recipients TO service_role;
REVOKE ALL   ON TABLE public.timesheet_alert_recipients FROM anon;

-- Nos envios, o authenticated só lê: a escrita é do servidor.
GRANT SELECT ON TABLE public.timesheet_alert_sends TO authenticated;
GRANT ALL    ON TABLE public.timesheet_alert_sends TO service_role;
REVOKE ALL   ON TABLE public.timesheet_alert_sends FROM anon;


-- ----------------------------------------------------------------------------
-- 4. Auditoria — a lista de destinatários é configuração, fica registada
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_auditoria ON public.timesheet_alert_recipients;
CREATE TRIGGER trg_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.timesheet_alert_recipients
  FOR EACH ROW EXECUTE FUNCTION registar_auditoria();


NOTIFY pgrst, 'reload schema';


-- ----------------------------------------------------------------------------
-- 5. Verificação
-- ----------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM public.timesheet_alert_recipients)                       AS destinatarios,
  (SELECT count(*) FROM public.timesheet_alert_sends)                            AS envios_registados,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
     AND tablename IN ('timesheet_alert_recipients', 'timesheet_alert_sends'))    AS politicas,
  (SELECT has_table_privilege('authenticated', 'public.timesheet_alert_recipients', 'INSERT')) AS admin_escreve_lista,
  (SELECT has_table_privilege('authenticated', 'public.timesheet_alert_sends', 'INSERT'))      AS falha_authenticated_escreve_envios,
  (SELECT has_table_privilege('anon', 'public.timesheet_alert_recipients', 'SELECT'))          AS falha_anon_le,
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE NOT t.tgisinternal AND c.relname = 'timesheet_alert_recipients')        AS triggers;
