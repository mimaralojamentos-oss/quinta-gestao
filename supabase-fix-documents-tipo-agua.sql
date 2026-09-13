-- Bug antigo: a interface de Documentos oferece "💧 Fatura da Água"
-- (tipo='fatura_agua') no upload e na mudança de tipo desde sempre, mas a
-- constraint da base de dados nunca incluiu esse valor — qualquer tentativa
-- de gravar um documento com esse tipo era sempre rejeitada (erro 23514).
-- Reproduzido e confirmado em 2026-09-13.
--
-- As duas bases de dados tinham, além disso, constraints DIFERENTES entre
-- si desde o início (Quinta-Gestão bloqueava 'receita'/'carta'/'registo_predial';
-- SerpaPinto131A aceitava 'receita' e tinha 1 documento antigo com
-- tipo='contrato'). Esta é a lista final, já aplicada pelo utilizador nos
-- dois projetos, unificando ambos com tudo o que o código já esperava:
--   fatura, fatura_luz, fatura_agua, receita, registo_predial, carta,
--   contrato, outro, transferencia_interna
--
-- Ficheiro só de registo histórico — a alteração já foi aplicada
-- diretamente pelo utilizador nos dois projetos. Idempotente, para o caso
-- de ser preciso reaplicar nalgum ambiente novo.

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_tipo_check;
ALTER TABLE documents ADD CONSTRAINT documents_tipo_check
  CHECK (tipo = ANY (ARRAY[
    'fatura', 'fatura_luz', 'fatura_agua', 'receita', 'registo_predial',
    'carta', 'contrato', 'outro', 'transferencia_interna'
  ]));
