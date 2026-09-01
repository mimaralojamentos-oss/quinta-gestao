-- ============================================
-- Impede contratos sem inquilino associado
-- ============================================
--
-- Um contrato (leases) foi criado com tenant_id vazio através de uma corrida
-- no botão "Guardar tudo" do fluxo de Novo Inquilino via OCR (corrigido em
-- app/inquilinos/TenantModal.tsx). A app já não permite isto, mas esta
-- restrição impede que volte a acontecer, venha de onde vier (app, script,
-- ou o editor SQL do Supabase).
--
-- Confirmado antes de aplicar: 0 contratos com tenant_id NULL na base de
-- dados de produção.

ALTER TABLE leases ALTER COLUMN tenant_id SET NOT NULL;
