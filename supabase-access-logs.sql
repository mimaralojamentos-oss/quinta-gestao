-- ============================================
-- TABELA: access_logs
-- Registo de acessos e ações na aplicação
-- Execute este SQL no Supabase SQL Editor
-- ============================================

CREATE TABLE IF NOT EXISTS access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email TEXT,
  action TEXT NOT NULL,
  page TEXT,
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- POLÍTICAS DE ACESSO (Row Level Security)
-- ============================================

ALTER TABLE access_logs ENABLE ROW LEVEL SECURITY;

-- Admins têm acesso total (ver, criar, editar, apagar todos os registos)
CREATE POLICY "Admins têm acesso total aos logs" ON access_logs
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- Qualquer utilizador autenticado pode registar as suas próprias ações
CREATE POLICY "Utilizadores podem registar as suas ações" ON access_logs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ============================================
-- PERMISSÕES
-- ============================================

GRANT SELECT, INSERT, UPDATE, DELETE ON access_logs TO authenticated;
