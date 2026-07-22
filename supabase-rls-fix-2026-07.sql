-- ============================================
-- CORREÇÃO: "Table publicly accessible" (RLS desativado)
-- Execute este SQL no SQL Editor do Supabase
-- IMPORTANTE: correr em AMBOS os projetos:
--   1) Quinta-Gestao
--   2) serpa-pinto-131a
--
-- Este script é seguro de correr mesmo que uma tabela já
-- tenha RLS ativo ou não exista num dos dois projetos —
-- cada bloco verifica antes de agir.
-- ============================================

-- Função auxiliar (garante que existe; já usada noutras policies)
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
-- Tabelas de gestão geral
-- Leitura: todos os autenticados. Escrita: admin e coadmin.
-- ============================================

DO $$
DECLARE
  t TEXT;
  tabelas TEXT[] := ARRAY[
    'debts', 'debt_payments', 'bank_transactions', 'banks',
    'bank_matching_rules', 'documents', 'projects', 'notes',
    'note_comments', 'owners', 'tenant_contacts', 'income_records',
    'lease_rent_history', 'dismissed_alerts', 'sms_log', 'gate_phones'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS "Leitura para todos os autenticados" ON public.%I', t);
      EXECUTE format('CREATE POLICY "Leitura para todos os autenticados" ON public.%I FOR SELECT TO authenticated USING (true)', t);
      EXECUTE format('DROP POLICY IF EXISTS "Escrita para admin e coadmin" ON public.%I', t);
      EXECUTE format('CREATE POLICY "Escrita para admin e coadmin" ON public.%I FOR ALL TO authenticated USING (public.user_role() IN (''admin'', ''coadmin'')) WITH CHECK (public.user_role() IN (''admin'', ''coadmin''))', t);
      RAISE NOTICE 'RLS aplicado: %', t;
    ELSE
      RAISE NOTICE 'Tabela não existe neste projeto (ignorada): %', t;
    END IF;
  END LOOP;
END $$;

-- ============================================
-- Tabelas de eletricidade
-- Leitura: todos os autenticados. Escrita: admin, coadmin, eletricista.
-- ============================================

DO $$
DECLARE
  t TEXT;
  tabelas TEXT[] := ARRAY[
    'electricity_config', 'meters', 'meter_readings'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS "Leitura para todos os autenticados" ON public.%I', t);
      EXECUTE format('CREATE POLICY "Leitura para todos os autenticados" ON public.%I FOR SELECT TO authenticated USING (true)', t);
      EXECUTE format('DROP POLICY IF EXISTS "Escrita para admin, coadmin e eletricista" ON public.%I', t);
      EXECUTE format('CREATE POLICY "Escrita para admin, coadmin e eletricista" ON public.%I FOR ALL TO authenticated USING (public.user_role() IN (''admin'', ''coadmin'', ''electrician'')) WITH CHECK (public.user_role() IN (''admin'', ''coadmin'', ''electrician''))', t);
      RAISE NOTICE 'RLS aplicado: %', t;
    ELSE
      RAISE NOTICE 'Tabela não existe neste projeto (ignorada): %', t;
    END IF;
  END LOOP;
END $$;

-- ============================================
-- Garantir que as tabelas já cobertas nos ficheiros antigos
-- (supabase-schema.sql / supabase-rls-policies.sql / supabase-access-logs.sql)
-- também têm RLS realmente ativo (idempotente, não mexe nas policies existentes)
-- ============================================

DO $$
DECLARE
  t TEXT;
  tabelas TEXT[] := ARRAY[
    'spaces', 'tenants', 'leases', 'rent_payments',
    'electricity_readings', 'electricity_charges', 'expenses',
    'cash_fund_movements', 'profiles', 'access_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

-- ============================================
-- VERIFICAÇÃO — corre isto depois e confirma que
-- a coluna rowsecurity é "true" em todas as linhas
-- ============================================

SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
