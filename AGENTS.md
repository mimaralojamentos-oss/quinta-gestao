<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Regras de base de dados

O schema vive em ficheiros `supabase-*.sql` na raiz do repo, colados à mão nos
DOIS projetos (Quinta-Gestão e SerpaPinto131A). Não há pasta de migrações do
CLI: o ficheiro é a fonte da verdade e tem de ser idempotente, para poder
correr mais do que uma vez sem erro.

## Todo o SQL que cria uma tabela em `public` inclui, no mesmo ficheiro:

1. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`
2. as **políticas** de leitura e de escrita (a escrita decidida por
   `user_role()`: `admin`, `coadmin`, `electrician`, `viewer`, `super_reader`);
3. os **GRANTs explícitos**:
   ```sql
   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.<tabela> TO authenticated;
   GRANT ALL ON TABLE public.<tabela> TO service_role;
   -- colunas serial/identity: também a sequence
   GRANT USAGE, SELECT ON SEQUENCE public.<tabela>_<coluna>_seq TO authenticated, service_role;
   ```
4. `anon` **não leva nada**, salvo justificação escrita no próprio ficheiro.
   Nenhuma página lê tabelas sem sessão: a app do trabalhador
   (`/ponto/<token>`) fala só com `/api/ponto`, que corre no servidor com a
   service role, e o `proxy.ts` usa a chave anon apenas para validar a sessão.
5. o trigger de auditoria, quando a tabela guarda dados de gestão:
   ```sql
   CREATE TRIGGER trg_auditoria AFTER INSERT OR UPDATE OR DELETE ON public.<tabela>
     FOR EACH ROW EXECUTE FUNCTION registar_auditoria();
   ```
6. `NOTIFY pgrst, 'reload schema';` no fim, para a API ver a tabela sem
   esperar.

## "permission denied for table" é falta de GRANT, não de RLS

São duas coisas diferentes e são precisas as duas: o **GRANT** diz se o papel
pode tocar na tabela, a **política de RLS** diz em que linhas. Sem GRANT, a
Data API responde `permission denied for table`; com GRANT e sem política,
devolve zero linhas sem erro. Desde 30/10/2026 o Supabase já não dá grants
automáticos a tabelas novas no `public`, por isso escrevê-los deixou de ser
opcional.

As permissões de todo o schema estão consolidadas em
`supabase-grants-public.sql`, que também deixa `ALTER DEFAULT PRIVILEGES`
como rede de segurança — mas isso é só uma rede: não dispensa os GRANTs no
ficheiro de cada tabela nova, porque não se aplica a objetos criados por
outro papel.
