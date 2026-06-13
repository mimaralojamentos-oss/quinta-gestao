-- ============================================
-- RLS por nível de acesso (role-based)
-- Prioridades 2 e 3 da auditoria de segurança
-- Execute este SQL no Supabase SQL Editor
--
-- Modelo de permissões (ver app/utilizadores/page.tsx):
--   admin       -> acesso total (incl. gerir utilizadores)
--   coadmin     -> acesso total, exceto gerir utilizadores
--   electrician -> CRUD em eletricidade, leitura nas restantes tabelas
--   viewer      -> leitura em tudo
-- ============================================


-- ============================================
-- PARTE 1: Tabela profiles (Prioridade 3)
-- ============================================

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'coadmin', 'electrician', 'viewer')),
  created_at TIMESTAMPTZ DEFAULT now()
);


-- ============================================
-- PARTE 2: Função auxiliar - role do utilizador autenticado
-- SECURITY DEFINER para não recursar nas policies de "profiles"
-- ============================================

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
-- PARTE 3: RLS da tabela profiles
-- ============================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Cada utilizador vê o seu próprio perfil; admin vê todos (necessário para /utilizadores)
DROP POLICY IF EXISTS "Utilizador vê o próprio perfil; admin vê todos" ON profiles;
CREATE POLICY "Utilizador vê o próprio perfil; admin vê todos" ON profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.user_role() = 'admin');

-- Cada utilizador atualiza o seu próprio perfil (ex: nome); admin atualiza todos (ex: roles)
DROP POLICY IF EXISTS "Utilizador atualiza o próprio perfil; admin atualiza todos" ON profiles;
CREATE POLICY "Utilizador atualiza o próprio perfil; admin atualiza todos" ON profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id OR public.user_role() = 'admin')
  WITH CHECK (auth.uid() = id OR public.user_role() = 'admin');

-- INSERT/DELETE só via service role (rota /api/create-user) - sem policy para "authenticated"

-- Trigger: só um admin pode alterar o "role" de um perfil (próprio ou de outros)
CREATE OR REPLACE FUNCTION public.prevent_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND public.user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Apenas administradores podem alterar o nível de acesso';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_role_change ON profiles;
CREATE TRIGGER trg_prevent_role_change
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_role_change();

GRANT SELECT, UPDATE ON profiles TO authenticated;


-- ============================================
-- PARTE 4: Policies por role nas tabelas principais (Prioridade 2)
-- ============================================

-- Remove as policies antigas "tudo permitido a qualquer autenticado"
DROP POLICY IF EXISTS "Authenticated users can do everything" ON spaces;
DROP POLICY IF EXISTS "Authenticated users can do everything" ON tenants;
DROP POLICY IF EXISTS "Authenticated users can do everything" ON leases;
DROP POLICY IF EXISTS "Authenticated users can do everything" ON rent_payments;
DROP POLICY IF EXISTS "Authenticated users can do everything" ON electricity_readings;
DROP POLICY IF EXISTS "Authenticated users can do everything" ON electricity_charges;
DROP POLICY IF EXISTS "Authenticated users can do everything" ON expenses;
DROP POLICY IF EXISTS "Authenticated users can do everything" ON cash_fund_movements;

-- --- spaces, tenants, leases, rent_payments, expenses, cash_fund_movements ---
-- Leitura: todos os autenticados. Escrita (criar/editar/apagar): admin e coadmin.

CREATE POLICY "Leitura para todos os autenticados" ON spaces
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Escrita para admin e coadmin" ON spaces
  FOR ALL TO authenticated
  USING (public.user_role() IN ('admin', 'coadmin'))
  WITH CHECK (public.user_role() IN ('admin', 'coadmin'));

CREATE POLICY "Leitura para todos os autenticados" ON tenants
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Escrita para admin e coadmin" ON tenants
  FOR ALL TO authenticated
  USING (public.user_role() IN ('admin', 'coadmin'))
  WITH CHECK (public.user_role() IN ('admin', 'coadmin'));

CREATE POLICY "Leitura para todos os autenticados" ON leases
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Escrita para admin e coadmin" ON leases
  FOR ALL TO authenticated
  USING (public.user_role() IN ('admin', 'coadmin'))
  WITH CHECK (public.user_role() IN ('admin', 'coadmin'));

CREATE POLICY "Leitura para todos os autenticados" ON rent_payments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Escrita para admin e coadmin" ON rent_payments
  FOR ALL TO authenticated
  USING (public.user_role() IN ('admin', 'coadmin'))
  WITH CHECK (public.user_role() IN ('admin', 'coadmin'));

CREATE POLICY "Leitura para todos os autenticados" ON expenses
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Escrita para admin e coadmin" ON expenses
  FOR ALL TO authenticated
  USING (public.user_role() IN ('admin', 'coadmin'))
  WITH CHECK (public.user_role() IN ('admin', 'coadmin'));

CREATE POLICY "Leitura para todos os autenticados" ON cash_fund_movements
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Escrita para admin e coadmin" ON cash_fund_movements
  FOR ALL TO authenticated
  USING (public.user_role() IN ('admin', 'coadmin'))
  WITH CHECK (public.user_role() IN ('admin', 'coadmin'));

-- --- electricity_readings, electricity_charges ---
-- Leitura: todos os autenticados. Escrita: admin, coadmin e eletricista.

CREATE POLICY "Leitura para todos os autenticados" ON electricity_readings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Escrita para admin, coadmin e eletricista" ON electricity_readings
  FOR ALL TO authenticated
  USING (public.user_role() IN ('admin', 'coadmin', 'electrician'))
  WITH CHECK (public.user_role() IN ('admin', 'coadmin', 'electrician'));

CREATE POLICY "Leitura para todos os autenticados" ON electricity_charges
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Escrita para admin, coadmin e eletricista" ON electricity_charges
  FOR ALL TO authenticated
  USING (public.user_role() IN ('admin', 'coadmin', 'electrician'))
  WITH CHECK (public.user_role() IN ('admin', 'coadmin', 'electrician'));
