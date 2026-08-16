-- ============================================
-- CORREÇÃO: RLS em falta nas tabelas de trabalhadores/auditoria
-- Execute este SQL no SQL Editor do Supabase, em CADA projeto usado
-- em produção (confirmar quais com o utilizador antes de correr).
--
-- Idempotente: seguro de correr mais que uma vez, mesmo que a tabela
-- já tenha RLS ativo ou políticas com outro nome.
-- ============================================

-- Função auxiliar (garante que existe; já usada noutras policies do projeto)
CREATE OR REPLACE FUNCTION public.user_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$;

-- ============================================
-- workers, work_entries, worker_payments
-- Contêm o access_token e o pin da folha de ponto, e valores de
-- salários — leitura e escrita só para admin e coadmin.
-- ============================================

DO $$
DECLARE
  t TEXT;
  tabelas TEXT[] := ARRAY['workers', 'work_entries', 'worker_payments'];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

      EXECUTE format('DROP POLICY IF EXISTS "Leitura para admin e coadmin" ON public.%I', t);
      EXECUTE format('CREATE POLICY "Leitura para admin e coadmin" ON public.%I FOR SELECT TO authenticated USING (public.user_role() IN (''admin'', ''coadmin''))', t);

      EXECUTE format('DROP POLICY IF EXISTS "Escrita para admin e coadmin" ON public.%I', t);
      EXECUTE format('CREATE POLICY "Escrita para admin e coadmin" ON public.%I FOR ALL TO authenticated USING (public.user_role() IN (''admin'', ''coadmin'')) WITH CHECK (public.user_role() IN (''admin'', ''coadmin''))', t);

      RAISE NOTICE 'RLS aplicado (admin/coadmin): %', t;
    ELSE
      RAISE NOTICE 'Tabela não existe neste projeto (ignorada): %', t;
    END IF;
  END LOOP;
END $$;

-- ============================================
-- audit_log
-- Só admin pode ler (como já é feito no ecrã /extras/auditoria).
-- Sem política de escrita: ninguém escreve aqui a partir do browser.
-- ============================================

DO $$
BEGIN
  IF to_regclass('public.audit_log') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Leitura para admin" ON public.audit_log';
    EXECUTE 'CREATE POLICY "Leitura para admin" ON public.audit_log FOR SELECT TO authenticated USING (public.user_role() = ''admin'')';
    RAISE NOTICE 'RLS aplicado (admin): audit_log';
  ELSE
    RAISE NOTICE 'Tabela não existe neste projeto (ignorada): audit_log';
  END IF;
END $$;

-- ============================================
-- sent_emails
-- Leitura para admin, coadmin e super_reader (como já é feito no
-- ecrã /extras/emails). Sem política de escrita: a gravação é sempre
-- feita pelo servidor com a service role (ver lib/sentEmails.ts).
-- ============================================

DO $$
BEGIN
  IF to_regclass('public.sent_emails') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.sent_emails ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Leitura para admin, coadmin e super_reader" ON public.sent_emails';
    EXECUTE 'CREATE POLICY "Leitura para admin, coadmin e super_reader" ON public.sent_emails FOR SELECT TO authenticated USING (public.user_role() IN (''admin'', ''coadmin'', ''super_reader''))';
    RAISE NOTICE 'RLS aplicado (admin/coadmin/super_reader): sent_emails';
  ELSE
    RAISE NOTICE 'Tabela não existe neste projeto (ignorada): sent_emails';
  END IF;
END $$;

-- ============================================
-- supplier_aliases
-- Leitura para todos os autenticados, escrita para admin e coadmin
-- (como já é feito no ecrã /extras/fornecedores).
-- ============================================

DO $$
BEGIN
  IF to_regclass('public.supplier_aliases') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.supplier_aliases ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS "Leitura para todos os autenticados" ON public.supplier_aliases';
    EXECUTE 'CREATE POLICY "Leitura para todos os autenticados" ON public.supplier_aliases FOR SELECT TO authenticated USING (true)';

    EXECUTE 'DROP POLICY IF EXISTS "Escrita para admin e coadmin" ON public.supplier_aliases';
    EXECUTE 'CREATE POLICY "Escrita para admin e coadmin" ON public.supplier_aliases FOR ALL TO authenticated USING (public.user_role() IN (''admin'', ''coadmin'')) WITH CHECK (public.user_role() IN (''admin'', ''coadmin''))';

    RAISE NOTICE 'RLS aplicado: supplier_aliases';
  ELSE
    RAISE NOTICE 'Tabela não existe neste projeto (ignorada): supplier_aliases';
  END IF;
END $$;

-- ============================================
-- VERIFICAÇÃO — corre isto depois e confirma que rowsecurity = true
-- nas 6 tabelas abaixo
-- ============================================

SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('workers', 'work_entries', 'worker_payments', 'audit_log', 'sent_emails', 'supplier_aliases')
ORDER BY tablename;
