-- Folha de Ponto: e-mail do trabalhador.
--
-- Idempotente: pode correr-se mais do que uma vez sem erro.
-- Correr nos dois projetos (Quinta-Gestão e SerpaPinto131A).
--
-- Confirmado contra a tabela workers: todos os outros campos dos formulários
-- (nome, telefone, NIF, notas, preço/hora, preço fds/feriados, ativo) já
-- existem. Só falta o e-mail.
--
-- O histórico do preço/hora não precisa de colunas novas: work_entries já
-- guarda hourly_rate e amount no momento do registo.

ALTER TABLE public.workers ADD COLUMN IF NOT EXISTS email TEXT;

-- Recarregar o cache do PostgREST para a coluna ficar logo disponível na API.
NOTIFY pgrst, 'reload schema';
